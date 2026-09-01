// === Map Maker (client half of the old map.js — A1 step 9) ===
//
// The editor UI, its input handling, and the test-play flow. Per the guide's
// §4 map.js entry this all stays client-side: map maker painting is local
// editor input, not server-authoritative game state, and it deliberately does
// not get routed through the action protocol in A1.
//
// The generation/placement logic that used to share map.js with this code now
// lives in js/server/map-generation.js. Three functions here are thin wrappers
// over the pure halves there, keeping their original names and signatures so
// every existing call site (main.js, ui.js, save.js, client/input.js) is
// unchanged: performFloodFill, resizeMapGrid, updateBaseCampLocations.
//
// getMapMakerBaseCampTileKeys was dropped in this move - it had no callers
// anywhere in the codebase (Track I1 cleanup, flagged rather than silent).

function startMapTest() {
    // 1. Unit Validation (Applies to ALL map sizes)
    const p1Units = engine.state.units.filter(u => u.player === 1).length;
    const p2Units = engine.state.units.filter(u => u.player === 2).length;

    if (p1Units === 0 || p2Units === 0) {
        showInstruction("Map must contain at least one unit for each player to start a test.", 3000);
        return; 
    }

    // 2. Base Camp Validation (Applies ONLY to Expansive R=4 maps)
    if (engine.state.gridRadius === 4) {
        const p1Base = engine.state.baseCampPositions.player1;
        const p2Base = engine.state.baseCampPositions.player2;

        // Check if bases are arrays (Expansive format) and have exactly 3 tiles
        const p1Complete = Array.isArray(p1Base) && p1Base.length === 3;
        const p2Complete = Array.isArray(p2Base) && p2Base.length === 3;

        if (!p1Complete || !p2Complete) {
            let msg = "Cannot start test: ";
            if (!p1Complete && !p2Complete) {
                msg += "Both players need complete Base Camps (3 tiles).";
            } else if (!p1Complete) {
                msg += "Player 1 needs a complete Base Camp (3 tiles).";
            } else {
                msg += "Player 2 needs a complete Base Camp (3 tiles).";
            }
            showInstruction(msg, 4000);
            return;
        }
    }

    console.log("Starting map test...");
    // 1. Save the current editor state
    mapMakerStateBackup = createMapDataObject();
    gameState.isTestingMap = true;

    // 2. Transition the UI from editor to game
    exitMapMakerMode(); // Cleans up editor UI

    // 3. Initialize a new game with the backed-up map data
    const tileMap = new Map(mapMakerStateBackup.tiles);
    const units = mapMakerStateBackup.units.map(u => ({ ...u, typeName: u.typeName.toUpperCase() }));
    initializeGrid(tileMap, units);
    engine.state.baseCampPositions = mapMakerStateBackup.baseCampPositions;
    
    // Ensure flags are linked to the positions (handling both Edge strings and Tile Arrays implicitly via game logic)
    if (engine.state.flags) {
        engine.state.flags.p1_flag.homePosition = mapMakerStateBackup.baseCampPositions.player1;
        engine.state.flags.p2_flag.homePosition = mapMakerStateBackup.baseCampPositions.player2;
    }

    // 4. Configure the UI for test mode
    const testButtonContainer = document.getElementById('testButtonContainer');
    const testStopButton = document.getElementById('testStopButton');
    if (testButtonContainer && testStopButton) {
        testButtonContainer.style.display = 'block'; 
        testStopButton.textContent = 'Stop Test';
        testStopButton.className = 'action-button'; 

        testStopButton.style.backgroundColor = '#3090D0'; 
        testStopButton.style.boxShadow = '0 3px #2080B0';

        // Re-assign the click listener to the stop function
        testStopButton.onclick = stopMapTest; 
    }
    updateMainButtonsForTestMode(true); // Disable Save/Load
    showInstruction("Test mode started. Play the map.", 3000);
}

function stopMapTest() {
    console.log("Stopping map test...");
    gameState.isTestingMap = false;

    ui.victoryMessage.style.display = 'none';

    // 1. Re-enter map maker mode to restore the editor UI
    enterMapMakerMode();
    
    // 2. Restore the backed-up map state
    if (mapMakerStateBackup) {
        loadMapFromDataObject(mapMakerStateBackup);
        mapMakerStateBackup = null; // Clear the backup
    }

    // 3. Re-enable main buttons and show instruction
    updateMainButtonsForTestMode(false); // Re-enable Save/Load
    showInstruction("Returned to Map Maker.", 2000);
}

function performFloodFill(startQ, startR) {
    const result = PerformFloodFill(startQ, startR, gameState.mapMakerBrush.value);

    if (result.reason === 'base_camp') {
        showInstruction("Cannot change the terrain of a base camp tile.", 2000);
        return;
    }
    if (!result.filled) return;

    autoSaveMap();
    gameState.needsRedraw = true;
}

function updateMainButtonsForTestMode(isTesting) {
    const saveBtn = document.getElementById('saveGameButton');
    const loadBtn = document.getElementById('loadGameButton');
    const newMapBtn = document.getElementById('newMapButton');
    
    saveBtn.disabled = isTesting;
    loadBtn.disabled = isTesting;
    newMapBtn.disabled = isTesting;
}

function enterMapMakerMode() {  
    console.log("Entering Map Maker mode.");
    engine.state.mapMakerMode = true;
    clearSelectionAndDebugState();
    
    // --- FIX: Clear all gameplay selection states to prevent visual artifacts ---
    gameState.selectedUnit = null;
    gameState.currentReachableMoves.clear();
    resetActionSelectionStates();
    // ---------------------------------------------------------------------------

    engine.state.playerActionTaken.player1 = false;
    engine.state.playerActionTaken.player2 = false;

    // --- NEW ORDER: Build UI First, Then Initialize Grid ---
    hideGameplayUI();
    buildMapMakerPalette();
    buildMapMakerControls();
    
    resizeMapGrid(engine.state.gridRadius); 
    // --- END OF NEW ORDER ---

    // Configure the Test Map button for the editor
    const testButtonContainer = document.getElementById('testButtonContainer');
    const testStopButton = document.getElementById('testStopButton');
    if (testButtonContainer && testStopButton) {
        testButtonContainer.style.display = 'flex';
        testStopButton.textContent = 'Test Map';
        testStopButton.className = 'action-button'; 
        testStopButton.style.backgroundColor = '#20B060'; 
        testStopButton.style.boxShadow = '0 3px #208040';
        testStopButton.onclick = startMapTest; 
    }

    // Ensure the end turn button's container is visible
    const endTurnButtonContainer = document.querySelector('#rightPanel .buttons-container');
    if (endTurnButtonContainer) {
        endTurnButtonContainer.style.display = 'flex'; 
        endTurnButtonContainer.style.marginTop = 'auto'; 
    }

    // --- FIX: Clean up Arcade Visuals ---
    const endTurnBtn = document.getElementById('endTurnButton');
    endTurnBtn.textContent = 'Clear Map';
    endTurnBtn.classList.remove('arcade-timer-active'); // Remove the timer class
    endTurnBtn.style.background = ''; // Remove the gradient
    // ------------------------------------

    showInstruction("Map Maker Mode. Left-click to paint, Right-click to erase.", 5000);
    
    // Repurpose Save/Load buttons for Map Maker
    document.getElementById('saveGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Map`;
    document.getElementById('loadGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Load Map`;
    updateTurnDisplay(); 
}

function exitMapMakerMode() {
    if (!engine.state.mapMakerMode) return; // Do nothing if not in map maker mode

    console.log("Exiting Map Maker mode.");
    engine.state.mapMakerMode = false;
    gameState.fillToolActive = false;
    
    // --- Hide the Test Map button container on general exit ---
    const testButtonContainer = document.getElementById('testButtonContainer');
    if (testButtonContainer) testButtonContainer.style.display = 'none';

    // --- Restore UI Elements ---
    // Restore the right panel
    document.getElementById('turnDisplay').style.display = 'block';
    const gameplayDivider = document.getElementById('gameplayDivider');
    if (gameplayDivider) gameplayDivider.style.display = 'block';
    document.getElementById('actionsPanel').style.display = 'flex';
    const endTurnButtonContainer = document.querySelector('#rightPanel .buttons-container');
    if (endTurnButtonContainer) {
        endTurnButtonContainer.style.display = 'flex';
    }
    document.getElementById('rightPanel').style.justifyContent = ''; // Reset justification
    
    // Remove the map maker controls from the right panel
    const controlsContainer = document.getElementById('mapMakerControlsContainer');
    if (controlsContainer) {
        controlsContainer.remove();
    }
    
    // Restore the left panel
    const leftPanel = document.getElementById('leftPanel');
    leftPanel.querySelectorAll(':scope > div:not(#mapMakerPaletteContainer)').forEach(el => {
        el.style.display = 'block';
    });
    const paletteContainer = document.getElementById('mapMakerPaletteContainer');
    if (paletteContainer) {
        paletteContainer.remove();
    }
    
    // Restore original button labels for the main Save/Load buttons
    document.getElementById('endTurnButton').textContent = 'End Turn';
    document.getElementById('saveGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Game`;
    document.getElementById('loadGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Load Game`;
    
    // No need to reset modal buttons here, that's handled by showLoadGameModal
    updateTurnDisplay();
}

function hideGameplayUI() {
    // Hide the right panel's turn display and action buttons
    document.getElementById('turnDisplay').style.display = 'none';
    const gameplayDivider = document.getElementById('gameplayDivider');
    if (gameplayDivider) gameplayDivider.style.display = 'none';
    document.getElementById('actionsPanel').style.display = 'none';

    // The buttons-container should remain visible in map maker mode, so we remove the 'display: none' here.
    const leftPanel = document.getElementById('leftPanel');
    leftPanel.querySelectorAll(':scope > div:not(#mapMakerPaletteContainer)').forEach(el => {
        el.style.display = 'none';
    });
}

function buildMapMakerPalette() {
    const leftPanel = document.getElementById('leftPanel');
    let paletteContainer = document.getElementById('mapMakerPaletteContainer');
    if (!paletteContainer) {
        paletteContainer = document.createElement('div');
        paletteContainer.id = 'mapMakerPaletteContainer';
        paletteContainer.style.width = '100%';
        leftPanel.appendChild(paletteContainer);
    }
    paletteContainer.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = 'Palette';
    title.className = 'text-center';
    title.style.cssText = "font-size: 1.5em; color: #FFC020; margin-bottom: 15px;";
    paletteContainer.appendChild(title);

    const divider = document.createElement('hr');
    divider.style.cssText = "width: 100%; border-color: #4a6075; margin-bottom: 20px; margin-top: 0;";
    paletteContainer.appendChild(divider);

    // --- Tiles Section ---
    const tilesTitle = document.createElement('h4');
    tilesTitle.textContent = 'Tiles';
    tilesTitle.style.cssText = "text-align: center; color: #F0F0F0; margin-bottom: 10px;";
    paletteContainer.appendChild(tilesTitle);
    const tilePalette = document.createElement('div');
    tilePalette.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 12px;";
    paletteContainer.appendChild(tilePalette);
    
    const PALETTE_HEX_SIZE = 30;
    function drawPaletteHex(canvas, tileType, size) {
        const ctx = canvas.getContext('2d');
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (60 * i - 30);
            const x = centerX + size * Math.cos(angle);
            const y = centerY + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        let fillColor;
        switch (tileType) {
            case TILE_TYPES.MOUNTAIN: fillColor = '#808080'; break;
            case TILE_TYPES.FOREST: fillColor = '#208020'; break;
            case TILE_TYPES.WATER: fillColor = '#80C0E0'; break;
            case TILE_TYPES.PLAINS: fillColor = '#90E090'; break;
            default: fillColor = tileType.color;
        }
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
    Object.entries(TILE_TYPES).forEach(([key, tileType]) => {
        const tileOptionContainer = document.createElement('div');
        tileOptionContainer.className = 'tile-option'; 
        tileOptionContainer.style.cssText = `display: flex; align-items: center; gap: 15px; cursor: pointer; width: 90%; padding: 5px; border: 2px solid #4a6075; border-radius: 8px; transition: all 0.2s;`;
        const hexCanvas = document.createElement('canvas');
        hexCanvas.width = PALETTE_HEX_SIZE * 2;
        hexCanvas.height = PALETTE_HEX_SIZE * 2;
        drawPaletteHex(hexCanvas, tileType, PALETTE_HEX_SIZE);
        const nameLabel = document.createElement('span');
        nameLabel.textContent = tileType.name;
        nameLabel.style.fontWeight = 'bold';
        tileOptionContainer.appendChild(hexCanvas);
        tileOptionContainer.appendChild(nameLabel);
        if (key === 'PLAINS') { tileOptionContainer.style.borderColor = '#FFC020'; }
        
        tileOptionContainer.addEventListener('click', () => {
            // Validate Base Camp Completion
            if (gameState.mapMakerBrush.type === 'base_camp') {
                const p = gameState.mapMakerBrush.player;
                const base = engine.state.baseCampPositions[`player${p}`];
                if (Array.isArray(base) && base.length > 0 && base.length < 3) {
                    showInstruction(`P${p} Base incomplete! Must place 3 tiles.`, 2000);
                    return;
                }
            }

            gameState.mapMakerBrush = { type: 'tile', value: TILE_TYPES[key], player: null };
            
            // Clear selections
            tilePalette.querySelectorAll('.tile-option').forEach(el => { el.style.borderColor = '#4a6075'; });
            document.getElementById('unitPalette')?.querySelectorAll('.unit-option').forEach(el => { el.classList.remove('selected'); });
            
            // Deselect Base Camp Buttons (Revert Colors)
            const controls = document.getElementById('mapMakerControlsContainer');
            if (controls) {
                const p1Btn = controls.querySelector('#p1BaseBtn');
                const p2Btn = controls.querySelector('#p2BaseBtn');
                if (p1Btn) {
                    const c = TEAM_COLORS.player1.primary;
                    p1Btn.style.backgroundColor = c;
                    p1Btn.style.boxShadow = `0 3px ${adjustBrightness(c, -20)}`;
                }
                if (p2Btn) {
                    const c = TEAM_COLORS.player2.primary;
                    p2Btn.style.backgroundColor = c;
                    p2Btn.style.boxShadow = `0 3px ${adjustBrightness(c, -20)}`;
                }
            }

            tileOptionContainer.style.borderColor = '#FFC020';
        });
        tilePalette.appendChild(tileOptionContainer);
    });

    // --- Units Section ---
    const unitsTitle = document.createElement('h4');
    unitsTitle.textContent = 'Units';
    unitsTitle.style.cssText = "text-align: center; color: #F0F0F0; margin-top: 30px; margin-bottom: 15px;";
    paletteContainer.appendChild(unitsTitle);

    const unitPaletteTabs = document.createElement('div');
    unitPaletteTabs.id = 'mapMakerUnitTabs';
    unitPaletteTabs.style.cssText = `display: flex; border-bottom: 2px solid #4a6075; margin-bottom: 15px; width: 100%;`;
    const p1Tab = document.createElement('button');
    p1Tab.dataset.player = '1';
    p1Tab.textContent = 'P1';
    const p2Tab = document.createElement('button');
    p2Tab.dataset.player = '2';
    p2Tab.textContent = 'P2';
    [p1Tab, p2Tab].forEach(tab => {
        tab.style.cssText = `flex-grow: 1; padding: 10px; background-color: transparent; border: none; color: #bdc3c7; font-size: 1.1em; font-family: 'Exo 2', sans-serif; font-weight: bold; cursor: pointer; border-bottom: 3px solid transparent; transition: color 0.4s ease-in-out, border-color 0.4s ease-in-out;`;
    });
    unitPaletteTabs.appendChild(p1Tab);
    unitPaletteTabs.appendChild(p2Tab);
    paletteContainer.appendChild(unitPaletteTabs);

    const unitPalette = document.createElement('div');
    unitPalette.id = 'unitPalette';
    unitPalette.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 15px; justify-items: center;";
    paletteContainer.appendChild(unitPalette);

    let selectedPlayer = 1;
    let paletteAnimation = { active: false, startTime: 0, fromColor: '', toColor: '' };

    const buildUnitOptions = () => {
        unitPalette.innerHTML = '';
        const PALETTE_UNIT_RADIUS = UNIT_DRAW_SIZE_ON_EDGE * 1.8;   
        Object.entries(UNIT_TYPES).forEach(([key, unitType]) => {
            const unitOptionContainer = document.createElement('div');
            unitOptionContainer.className = 'unit-option';
            unitOptionContainer.dataset.unitType = key;
            unitOptionContainer.style.cssText = `border-radius: 50%; padding: 3px; border: 3px solid transparent; cursor: pointer; transition: all 0.2s;`;
            const unitCanvas = document.createElement('canvas');
            unitCanvas.width = (PALETTE_UNIT_RADIUS + 5) * 2;
            unitCanvas.height = (PALETTE_UNIT_RADIUS + 5) * 2;
            unitOptionContainer.appendChild(unitCanvas);
            
            unitOptionContainer.addEventListener('click', () => {
                // Validate Base Camp Completion
                if (gameState.mapMakerBrush.type === 'base_camp') {
                    const p = gameState.mapMakerBrush.player;
                    const base = engine.state.baseCampPositions[`player${p}`];
                    if (Array.isArray(base) && base.length > 0 && base.length < 3) {
                        showInstruction(`P${p} Base incomplete! Must place 3 tiles.`, 2000);
                        return;
                    }
                }

                gameState.mapMakerBrush = { type: 'unit', value: UNIT_TYPES[key], player: selectedPlayer };
                
                unitPalette.querySelectorAll('.unit-option').forEach(el => { el.classList.remove('selected'); });
                tilePalette.querySelectorAll('.tile-option').forEach(el => { el.style.borderColor = '#4a6075'; });
                
                // Deselect Base Camp Buttons
                const controls = document.getElementById('mapMakerControlsContainer');
                if (controls) {
                    const p1Btn = controls.querySelector('#p1BaseBtn');
                    const p2Btn = controls.querySelector('#p2BaseBtn');
                    if (p1Btn) {
                        const c = TEAM_COLORS.player1.primary;
                        p1Btn.style.backgroundColor = c;
                        p1Btn.style.boxShadow = `0 3px ${adjustBrightness(c, -20)}`;
                    }
                    if (p2Btn) {
                        const c = TEAM_COLORS.player2.primary;
                        p2Btn.style.backgroundColor = c;
                        p2Btn.style.boxShadow = `0 3px ${adjustBrightness(c, -20)}`;
                    }
                }

                unitOptionContainer.classList.add('selected');
            });
            unitPalette.appendChild(unitOptionContainer);
        });
    };

    const runPaletteLoop = () => {
        if (!engine.state.mapMakerMode) return;
        p1Tab.style.color = selectedPlayer === 1 ? TEAM_COLORS.player1.secondary : '#bdc3c7';
        p1Tab.style.borderBottomColor = selectedPlayer === 1 ? TEAM_COLORS.player1.secondary : 'transparent';
        p2Tab.style.color = selectedPlayer === 2 ? TEAM_COLORS.player2.secondary : '#bdc3c7';
        p2Tab.style.borderBottomColor = selectedPlayer === 2 ? TEAM_COLORS.player2.secondary : 'transparent';

        let frameDrawColor = null;
        if (paletteAnimation.active) {
            const elapsedTime = Date.now() - paletteAnimation.startTime;
            const progress = Math.min(elapsedTime / COLOR_TRANSITION_DURATION_MS, 1);
            frameDrawColor = lerpColor(paletteAnimation.fromColor, paletteAnimation.toColor, progress);
            if (progress >= 1) paletteAnimation.active = false;
        }

        const PALETTE_UNIT_RADIUS = UNIT_DRAW_SIZE_ON_EDGE * 1.8;
        const playerKey = `player${selectedPlayer}`;
        const baseColor = currentDrawingColors[playerKey].primary;
        const finalDrawColor = frameDrawColor || baseColor;

        unitPalette.querySelectorAll('.unit-option').forEach(container => {
            const canvas = container.querySelector('canvas');
            const unitTypeKey = container.dataset.unitType;
            if (canvas && unitTypeKey) {
                const unitCtx = canvas.getContext('2d');
                unitCtx.clearRect(0, 0, canvas.width, canvas.height);
                const dummyUnit = { player: selectedPlayer, type: UNIT_TYPES[unitTypeKey] };
                const originalColor = currentDrawingColors[playerKey].primary;
                currentDrawingColors[playerKey].primary = finalDrawColor;
                drawSingleUnit(unitCtx, dummyUnit, canvas.width / 2, canvas.height / 2, PALETTE_UNIT_RADIUS, null, true);
                currentDrawingColors[playerKey].primary = originalColor; 

                if (container.classList.contains('selected')) {
                    const centerX = canvas.width / 2;
                    const centerY = canvas.height / 2;
                    const ringRadius = PALETTE_UNIT_RADIUS + 2; 
                    unitCtx.beginPath();
                    unitCtx.arc(centerX, centerY, ringRadius, 0, 2 * Math.PI);
                    unitCtx.strokeStyle = '#FFD700'; 
                    unitCtx.lineWidth = 3; 
                    unitCtx.stroke();
                }
            }
        });
        requestAnimationFrame(runPaletteLoop);
    };

    const handleTabClick = (newPlayer) => {
        if (selectedPlayer === newPlayer) return;
        unitPalette.querySelectorAll('.unit-option.selected').forEach(el => { el.classList.remove('selected'); });
        if (gameState.mapMakerBrush.type === 'unit') {
            gameState.mapMakerBrush = { type: 'tile', value: TILE_TYPES.PLAINS, player: null };
        }
        const fromPlayerKey = `player${selectedPlayer}`;
        const toPlayerKey = `player${newPlayer}`;
        paletteAnimation.fromColor = TEAM_COLORS[fromPlayerKey].primary;
        paletteAnimation.toColor = TEAM_COLORS[toPlayerKey].primary;
        paletteAnimation.active = true;
        paletteAnimation.startTime = Date.now();
        selectedPlayer = newPlayer;
        p1Tab.classList.toggle('active', selectedPlayer === 1);
        p2Tab.classList.toggle('active', selectedPlayer === 2);
    };
    
    p1Tab.addEventListener('click', () => handleTabClick(1));
    p2Tab.addEventListener('click', () => handleTabClick(2));

    buildUnitOptions();
    p1Tab.classList.add('active');
    runPaletteLoop();
}

function buildMapMakerControls() {
    const rightPanel = document.getElementById('rightPanel');

    let controlsContainer = document.getElementById('mapMakerControlsContainer');
    if (!controlsContainer) {
        controlsContainer = document.createElement('div');
        controlsContainer.id = 'mapMakerControlsContainer';
        controlsContainer.style.width = '100%';
        rightPanel.prepend(controlsContainer);
    }
    controlsContainer.innerHTML = ''; 

    const title = document.createElement('h3');
    title.textContent = 'Options';
    title.className = 'text-center';
    title.style.cssText = "font-size: 1.5em; color: #FFC020; margin-bottom: 15px;";
    controlsContainer.appendChild(title);

    const divider = document.createElement('hr');
    divider.style.cssText = "width: 100%; border-color: #4a6075; margin-bottom: 20px; margin-top: 0;";
    controlsContainer.appendChild(divider);

    // --- Base Camp Slider (Standard R=3) ---
    const sliderContainer = document.createElement('div');
    sliderContainer.id = 'baseCampSliderContainer'; 
    sliderContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        background-color: var(--bg-color);
        border: 1px solid #4a6075;
        border-radius: 5px;
    `;
    sliderContainer.style.display = (engine.state.gridRadius === 3) ? 'flex' : 'none';
    
    const sliderLabel = document.createElement('label');
    sliderLabel.htmlFor = 'baseCampSlider';
    sliderLabel.textContent = 'Base Camp Location';
    sliderLabel.style.fontWeight = 'bold';

    const slider = document.createElement('input');
    slider.id = 'baseCampSlider';
    slider.type = 'range';
    slider.min = '0';
    slider.max = '5'; 
    slider.step = '1'; 
    slider.value = '3'; 
    slider.style.width = '100%';

    slider.addEventListener('input', (event) => {
        const position = event.target.value;
        updateBaseCampLocations(position);
    });
    
    sliderContainer.appendChild(sliderLabel);
    sliderContainer.appendChild(slider);
    controlsContainer.appendChild(sliderContainer);

    // --- Expansive Map Base Camp Buttons (R=4) ---
    if (engine.state.gridRadius === 4) {
        const baseToolsContainer = document.createElement('div');
        baseToolsContainer.style.cssText = "display: flex; gap: 10px; justify-content: center; margin-top: 10px; margin-bottom: 10px;";

        // Helper: Check if we can switch away from the current tool
        const canSwitchFromBaseCamp = () => {
            if (gameState.mapMakerBrush.type === 'base_camp') {
                const p = gameState.mapMakerBrush.player;
                const base = engine.state.baseCampPositions[`player${p}`];
                if (Array.isArray(base) && base.length > 0 && base.length < 3) {
                    showInstruction(`P${p} Base incomplete! Must place 3 tiles.`, 2000);
                    return false;
                }
            }
            return true;
        };

        // Colors
        const p1Color = TEAM_COLORS.player1.primary;
        const p1Shadow = adjustBrightness(p1Color, -20);
        const p2Color = TEAM_COLORS.player2.primary;
        const p2Shadow = adjustBrightness(p2Color, -20);
        const activeColor = '#FFC020';
        const activeShadow = adjustBrightness(activeColor, -20);

        // Helper: Common logic for clicking a base button
        const handleBaseButtonClick = (player, btn, otherBtn, originalColor, originalShadow, otherOriginalColor, otherOriginalShadow) => {
            // 1. If clicking the already active button -> Toggle Off
            if (gameState.mapMakerBrush.type === 'base_camp' && gameState.mapMakerBrush.player === player) {
                if (!canSwitchFromBaseCamp()) return;
                // Deselect: Reset brush to default tile
                gameState.mapMakerBrush = { type: 'tile', value: TILE_TYPES.PLAINS, player: null };
                // Revert visual state
                btn.style.backgroundColor = originalColor;
                btn.style.boxShadow = `0 3px ${originalShadow}`;
                gameState.needsRedraw = true; // <-- ADD REDRAW HERE
                return;
            }

            // 2. If switching from another tool (or the other player) -> Check constraints
            if (!canSwitchFromBaseCamp()) return;

            // 3. Activate this button
            gameState.mapMakerBrush = { type: 'base_camp', player: player };
            
            // Highlight this button (Yellow)
            btn.style.backgroundColor = activeColor;
            btn.style.boxShadow = `0 3px ${activeShadow}`;
            
            // Reset the other button
            otherBtn.style.backgroundColor = otherOriginalColor;
            otherBtn.style.boxShadow = `0 3px ${otherOriginalShadow}`;
            
            // Deactivate Fill Tool if active
            if (gameState.fillToolActive) {
                gameState.fillToolActive = false;
                const fillBtn = document.getElementById('fillToolButton');
                if (fillBtn) {
                    fillBtn.textContent = 'Fill';
                    fillBtn.classList.remove('selecting');
                }
            }

            // Clear Palette selections
            const palette = document.getElementById('mapMakerPaletteContainer');
            if (palette) {
                palette.querySelectorAll('.unit-option').forEach(el => el.classList.remove('selected'));
                palette.querySelectorAll('.tile-option').forEach(el => el.style.borderColor = '#4a6075');
            }

            gameState.needsRedraw = true; 
        };

        const p1BaseBtn = document.createElement('button');
        p1BaseBtn.id = 'p1BaseBtn';
        p1BaseBtn.textContent = "P1 Base";
        p1BaseBtn.className = 'action-button';
        p1BaseBtn.style.backgroundColor = p1Color;
        p1BaseBtn.style.boxShadow = `0 3px ${p1Shadow}`;
        p1BaseBtn.style.width = 'auto';
        p1BaseBtn.style.margin = '0';
        p1BaseBtn.onclick = () => handleBaseButtonClick(1, p1BaseBtn, p2BaseBtn, p1Color, p1Shadow, p2Color, p2Shadow);

        const p2BaseBtn = document.createElement('button');
        p2BaseBtn.id = 'p2BaseBtn';
        p2BaseBtn.textContent = "P2 Base";
        p2BaseBtn.className = 'action-button';
        p2BaseBtn.style.backgroundColor = p2Color;
        p2BaseBtn.style.boxShadow = `0 3px ${p2Shadow}`;
        p2BaseBtn.style.width = 'auto';
        p2BaseBtn.style.margin = '0';
        p2BaseBtn.onclick = () => handleBaseButtonClick(2, p2BaseBtn, p1BaseBtn, p2Color, p2Shadow, p1Color, p1Shadow);

        baseToolsContainer.appendChild(p1BaseBtn);
        baseToolsContainer.appendChild(p2BaseBtn);
        controlsContainer.appendChild(baseToolsContainer);
    }

    // --- Map Size Slider ---
    const sizeSliderContainer = document.createElement('div');
    sizeSliderContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        margin-top: 20px;
        background-color: var(--bg-color);
        border: 1px solid #4a6075;
        border-radius: 5px;
    `;
    const sizeSliderLabel = document.createElement('label');
    sizeSliderLabel.htmlFor = 'mapSizeSlider';
    sizeSliderLabel.style.fontWeight = 'bold';

    const sizeSlider = document.createElement('input');
    sizeSlider.id = 'mapSizeSlider';
    sizeSlider.type = 'range';
    sizeSlider.min = '2'; 
    sizeSlider.max = '4'; 
    sizeSlider.step = '1';
    sizeSlider.value = engine.state.gridRadius.toString();
    sizeSlider.style.width = '100%';

    const sizeValueLabel = document.createElement('span');
    sizeValueLabel.style.textAlign = 'center';
    const updateSizeLabel = (value) => {
        const sizeNames = { '2': 'Compact (R=2)', '3': 'Normal (R=3)', '4': 'Expansive (R=4)' };
        sizeSliderLabel.textContent = `Map Size: ${sizeNames[value]}`;
    };
    updateSizeLabel(sizeSlider.value);

    sizeSlider.addEventListener('change', (event) => { 
        const newRadius = parseInt(event.target.value, 10);
        if (newRadius !== engine.state.gridRadius) {
            document.getElementById('customConfirmMessage').textContent = 'Resizing the map will clear all units and terrain. Are you sure?';
            currentConfirmAction = () => { 
                resizeMapGrid(newRadius); 
                autoSaveMap(); 
                currentCancelAction = null; 
            };
            currentCancelAction = () => { sizeSlider.value = engine.state.gridRadius; updateSizeLabel(engine.state.gridRadius); };
            const confirmModal = document.getElementById('customConfirmModal');
            if (confirmModal) {
                confirmModal.style.display = 'flex';
                setTimeout(() => confirmModal.classList.add('modal-visible'), 10);
            }
        }
    });
     sizeSlider.addEventListener('input', (event) => { updateSizeLabel(event.target.value); });

    sizeSliderContainer.appendChild(sizeSliderLabel);
    sizeSliderContainer.appendChild(sizeSlider);
    controlsContainer.appendChild(sizeSliderContainer);

    // --- Fill Tool Button ---
    const fillButtonContainer = document.createElement('div');
    fillButtonContainer.style.cssText = "display: flex; justify-content: center; width: 100%; margin-top: 20px;";

    const fillButton = document.createElement('button');
    fillButton.id = 'fillToolButton';
    fillButton.className = 'action-button';
    fillButton.style.width = '160px';
    fillButton.style.margin = '0'; 
    fillButton.textContent = 'Fill';

    fillButton.addEventListener('click', () => {
        // Check if we can switch tool (Base Camp validation)
        if (gameState.mapMakerBrush.type === 'base_camp') {
            const p = gameState.mapMakerBrush.player;
            const base = engine.state.baseCampPositions[`player${p}`];
            if (Array.isArray(base) && base.length > 0 && base.length < 3) {
                showInstruction(`P${p} Base incomplete! Must place 3 tiles.`, 2000);
                return;
            }
            // If valid switch, reset brush to default tile
            gameState.mapMakerBrush = { type: 'tile', value: TILE_TYPES.PLAINS, player: null };
            
            // Visually deselect base buttons (revert colors)
            const p1Btn = document.getElementById('p1BaseBtn');
            const p2Btn = document.getElementById('p2BaseBtn');
            if (p1Btn) {
                const c = TEAM_COLORS.player1.primary;
                p1Btn.style.backgroundColor = c;
                p1Btn.style.boxShadow = `0 3px ${adjustBrightness(c, -20)}`;
            }
            if (p2Btn) {
                const c = TEAM_COLORS.player2.primary;
                p2Btn.style.backgroundColor = c;
                p2Btn.style.boxShadow = `0 3px ${adjustBrightness(c, -20)}`;
            }
        }

        gameState.fillToolActive = !gameState.fillToolActive; 
        if (gameState.fillToolActive) {
            fillButton.textContent = 'Cancel Fill';
            fillButton.classList.add('selecting'); 
        } else {
            fillButton.textContent = 'Fill';
            fillButton.classList.remove('selecting');
        }
    });

    fillButtonContainer.appendChild(fillButton);
    controlsContainer.appendChild(fillButtonContainer);
}

function resizeMapGrid(newRadius) {
    console.log(`Resizing grid to radius ${newRadius}`);

    const slider = document.getElementById('mapSizeSlider');
    if (slider) slider.value = newRadius;

    // Mode first, so the controls rebuild below sees the new radius.
    SetGridMode(newRadius);

    // Camera framing for the new board size is client-owned.
    if (newRadius === 2) {
        gameState.renderScale = 1.3;
    } else if (newRadius === 4) {
        const expansiveMapWidth = (2 * 4 + 1.5) * (HEX_SIZE * Math.sqrt(3));
        gameState.renderScale = CANVAS_WIDTH_NORMAL / expansiveMapWidth;
    } else {
        gameState.renderScale = 1.0;
    }
    gameState.renderOffset = { x: 0, y: 0 };

    // Rebuild Controls (Adds/Removes Base Camp Buttons based on radius).
    // This also recreates the base camp slider at its default position, which
    // is why its value is read afterwards rather than before.
    if (engine.state.mapMakerMode) {
        buildMapMakerControls();
        buildMapMakerPalette();
    }

    canvas.width = CANVAS_WIDTH_NORMAL;
    canvas.height = CANVAS_HEIGHT_NORMAL;
    document.querySelectorAll('.ui-panel').forEach(panel => {
        panel.style.minHeight = canvas.height + 'px';
    });

    const baseCampSliderEl = document.getElementById('baseCampSlider');
    InitializeGridDimensions(newRadius, baseCampSliderEl ? baseCampSliderEl.value : '3');

    gameState.needsRedraw = true;
    showInstruction(`Map resized to ${newRadius === 2 ? 'Compact (Arcade)' : newRadius === 3 ? 'Normal' : 'Expansive'}.`, 2500);
}

function eraseAt(x, y) {
    const hexCoords = pixelToAxial(x, y);
    const hexKey = getTileKey(hexCoords.q, hexCoords.r);
    
    const { key: closestEdgeKey, distance } = findClosestEdgeToPoint(x, y);
    const edge = engine.state.edges.get(closestEdgeKey);
    
    // Prioritize erasing units if clicking near an edge with units on it
    if (edge && edge.units.length > 0 && distance < (HEX_SIZE * 0.4)) {
        const unitToRemove = edge.units[edge.units.length - 1]; 
        engine.state.units = engine.state.units.filter(u => u.id !== unitToRemove.id);
    } else {
        // Otherwise, erase the tile by setting it to plains
        const tile = engine.state.tiles.get(hexKey);
        if (tile) {
            if (tile.isBaseCampTile) {
                showInstruction("Cannot erase a base camp tile.", 1500);
                return;
            }
            tile.type = TILE_TYPES.PLAINS;
        }
    }
    autoSaveMap();
    gameState.needsRedraw = true;
}

function clearMapForMaker() {
    // Clear tiles back to plains and unlock them
    engine.state.tiles.forEach(tile => {
        tile.type = TILE_TYPES.PLAINS;
        tile.isBaseCampTile = false; // Reset the lock flag
    });

    // Clear all units
    engine.state.units = [];   

    //Fog of War Reset 
    engine.visionCache = null;
    gameState.fogAnimState = null;
    engine.visionDirty = true;

    // Reset Base Camp Data
    if (engine.state.gridRadius === 3) {
        // For Standard maps (R=3), re-apply the slider position to restore the fixed base camps
        const sliderEl = document.getElementById('baseCampSlider');
        if (sliderEl) {
            updateBaseCampLocations(sliderEl.value);
        }
    } else {
        // For Expansive (R=4) and Compact (R=2), fully clear the base camp data
        engine.state.baseCampPositions = { player1: null, player2: null };
        if (engine.state.flags) {
             engine.state.flags.p1_flag.homePosition = null;
             engine.state.flags.p2_flag.homePosition = null;
        }
    }

    showInstruction('Map Cleared!', 2000);
    autoSaveMap(); // Autosave the cleared state
    gameState.needsRedraw = true;
}

function updateBaseCampLocations(sliderValue) {
    if (UpdateBaseCampLocations(sliderValue)) {
        gameState.needsRedraw = true;
    }
}

function applyMapMakerBrush(x, y) {
    const hexCoords = pixelToAxial(x, y);
    const hexKey = getTileKey(hexCoords.q, hexCoords.r);

    if (hexKey === gameState.mapMakerLastPaintedHexKey && gameState.isDragging) return;
    gameState.mapMakerLastPaintedHexKey = hexKey;
    
    const brush = gameState.mapMakerBrush;

    // --- BASE CAMP BRUSH LOGIC ---
    if (brush.type === 'base_camp') {
        if (engine.state.gridRadius !== 4) return; 

        if (!engine.state.tiles.has(hexKey)) return;

        const player = brush.player;
        const playerKey = `player${player}`;
        const enemyPlayerKey = `player${player === 1 ? 2 : 1}`;
        
        const currentBase = Array.isArray(engine.state.baseCampPositions[playerKey]) 
                            ? engine.state.baseCampPositions[playerKey] 
                            : [];
        
        const enemyBase = Array.isArray(engine.state.baseCampPositions[enemyPlayerKey])
                          ? new Set(engine.state.baseCampPositions[enemyPlayerKey])
                          : new Set();

        // Validation
        const neighbors = getNeighbors(hexCoords.q, hexCoords.r);
        for (let n of neighbors) {
            if (enemyBase.has(getTileKey(n.q, n.r))) {
                showInstruction("Cannot be adjacent to enemy base.", 1500);
                return;
            }
        }

        // Logic: Toggle or Add
        let newBase = [...currentBase];
        if (newBase.includes(hexKey)) {
            // --- REMOVE FROM BASE ---
            newBase = newBase.filter(k => k !== hexKey);
            const tile = engine.state.tiles.get(hexKey);
            if (tile) {
                tile.isBaseCampTile = false; // Unlock the tile
            }
        } else {
            // --- ADD TO BASE ---
            if (newBase.length >= 3) {
                showInstruction("Base camp max size is 3 tiles.", 1500);
                return;
            }
            newBase.push(hexKey);
            
            if (!isSetContiguous(newBase)) {
                showInstruction("Base tiles must be contiguous.", 1500);
                return;
            }
            
            const tile = engine.state.tiles.get(hexKey);
            if (tile) {
                tile.type = TILE_TYPES.PLAINS; // Force Plains
                tile.isBaseCampTile = true;    // Lock the tile
            }
        }

        // Apply
        engine.state.baseCampPositions[playerKey] = newBase;

    // --- TILE BRUSH LOGIC ---
    } else if (brush.type === 'tile') {
        const tile = engine.state.tiles.get(hexKey);
        if (tile) {
            // --- PROPERTY CHECK ---
            if (tile.isBaseCampTile) {
                showInstruction("Cannot change the terrain of a base camp tile.", 2000);
                return; // Block painting
            }

            tile.type = brush.value;
            // Remove invalid units on water
            if (brush.value === TILE_TYPES.WATER) {
                getEdgesOfTile(tile.q, tile.r).forEach(edgeKey => {
                    const edge = engine.state.edges.get(edgeKey);
                    if (edge && edge.units.length > 0) {
                        const otherTileQ = (edge.q1 === tile.q && edge.r1 === tile.r) ? edge.q2 : edge.q1;
                        const otherTileR = (edge.r1 === tile.r && edge.q1 === tile.q) ? edge.r2 : edge.r1;
                        const otherTile = engine.state.tiles.get(getTileKey(otherTileQ, otherTileR));
                        
                        if (otherTile && otherTile.type === TILE_TYPES.WATER) {
                            // Filter via master array, don't try to clear the getter array!
                            const unitsToRemove = edge.units;
                            engine.state.units = engine.state.units.filter(u => !unitsToRemove.some(rem => rem.id === u.id));
                        }
                    }
                });
            }
        }

 // --- UNIT BRUSH LOGIC ---
    } else if (brush.type === 'unit') {
        const { key: closestEdgeKey } = findClosestEdgeToPoint(x, y);
        if (!closestEdgeKey) return;

        if (isInternalBaseEdge(closestEdgeKey)) {
            showInstruction("Cannot place units inside base camp.", 2000);
            return;
        }

        if (!isEdgePlaceable(closestEdgeKey)) {
            showInstruction("Cannot place a unit on this edge.", 1500);
            return;
        }

        const edge = engine.state.edges.get(closestEdgeKey);
        if (edge.units.length > 0 && edge.units[0].player !== brush.player) {
            showInstruction("Cannot place on an edge occupied by the enemy.", 2000);
            return;
        }
        if (edge.units.length >= 2) {
            showInstruction("This edge is full.", 1500);
            return;
        }
        
        const totalPlayerUnits = engine.state.units.filter(u => u.player === brush.player).length;
        const maxUnits = getMaxUnitsForCurrentMap(); 
        if (totalPlayerUnits >= maxUnits) {
            showInstruction(`P${brush.player} has reached the maximum of ${maxUnits} units.`, 2000);
            return;
        }
        const playerUnitCounts = getUnitCountsForPlayer(brush.player);
        const unitCap = UNIT_CAPS[brush.value.name];
        if (playerUnitCounts[brush.value.name] >= unitCap) {
            showInstruction(`P${brush.player} cannot have more than ${unitCap} ${brush.value.name}s.`, 2000);
            return;
        }

        const newUnit = createUnit(brush.player, brush.value, closestEdgeKey);
        engine.state.units.push(newUnit);
    }
    
    autoSaveMap();
    gameState.needsRedraw = true;
}

