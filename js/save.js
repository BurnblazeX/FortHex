function saveSettings() {
    try {
        const settingsString = JSON.stringify(gameSettings);
        localStorage.setItem(SETTINGS_STORAGE_KEY, settingsString);
    } catch (error) {
        console.error("Could not save settings:", error);
    }
}

function loadSettings() {
    try {
        const savedSettingsString = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (savedSettingsString) {
            const loadedSettings = JSON.parse(savedSettingsString);
            gameSettings = Object.assign({}, gameSettings, loadedSettings);
        }
    } catch (error) {
        console.error("Could not load settings:", error);
    }
}

function saveColorPreferences() {
    try {
        const prefsString = JSON.stringify(gameState.playerColorSelections);
        localStorage.setItem(COLOR_PREF_STORAGE_KEY, prefsString);
    } catch (error) {
        console.error("Could not save color preferences:", error);
    }
}

function loadColorPreferences() {
    try {
        const savedPrefsString = localStorage.getItem(COLOR_PREF_STORAGE_KEY);
        if (savedPrefsString) {
            const loadedPrefs = JSON.parse(savedPrefsString);
            gameState.playerColorSelections = Object.assign({}, gameState.playerColorSelections, loadedPrefs);

            TEAM_COLORS.player1 = { ...COLOR_THEMES[gameState.playerColorSelections.player1].player1 };
            TEAM_COLORS.player2 = { ...COLOR_THEMES[gameState.playerColorSelections.player2].player2 };
        }
    } catch (error) {
        console.error("Could not load color preferences:", error);
    }
}

function autoSaveGame(isSilent = false) {
    if (gameState.isDragging) {
        // console.log("[Autosave] Skipped: Unit is dragging."); // Optional spam reduction
        if (!isSilent) showInstruction("Cannot save while dragging.", 2000);
        return;
    }
    if (gameState.isTestingMap) {
        return; 
    }

    try {
        console.groupCollapsed("[Autosave] Saving Game State...");
        console.log("Current Mode:", gameState.gameMode);
        console.log("Current Radius:", gameState.gridRadius);
        console.log("Turn:", gameState.globalTurnNumber);
        
        if (gameState.gameMode === 'arcade') {
            console.log("Arcade Timer:", gameState.arcadeTurnTimer);
            console.log("Swap State:", gameState.swapState);
        }

        // Create a temporary, serializable version of the game state
        const serializableState = { ...gameState };
        
        // Manually convert Map objects to arrays for JSON compatibility
        serializableState.tiles = Array.from(gameState.tiles.entries());
        serializableState.edges = Array.from(gameState.edges.entries());
        serializableState.currentReachableMoves = Array.from(gameState.currentReachableMoves.entries());

        serializableState.saveVersion = BUILD_VERSION; 

        const gameStateString = JSON.stringify(serializableState);
        const saveKey = gameState.gameMode === 'singleplayer' ? 'forthexSaveGame_sp' : 'forthexSaveGame';
        
        console.log(`Saving to key: ${saveKey}`);
        console.log("Serialized Length:", gameStateString.length);

        localStorage.setItem(saveKey, gameStateString);
        
        if (!isSilent) { showInstruction("Game Saved!", 2000); }
        console.log("Autosave successful.");
        console.groupEnd();
    } catch (error) {
        console.error("[Autosave] CRITICAL ERROR:", error);
        showInstruction("Could not save game. See console.", 3000);
        console.groupEnd();
    }
}

function saveGameToFile() {

    if (gameState.isTestingMap) {
        showInstruction("Cannot download saves while testing a map.", 2500);
        return;
    }

    // --- Create the custom filename ---
    const now = new Date();
    const day = padZero(now.getDate());
    const month = padZero(now.getMonth() + 1); // JS months are 0-indexed
    const year = now.getFullYear();
    const hours = padZero(now.getHours());
    const minutes = padZero(now.getMinutes());
    const seconds = padZero(now.getSeconds());
    const modePrefix = gameState.gameMode === 'singleplayer' ? 'SP-' : '';
    const fileName = `FortHex-${BUILD_VERSION}-${modePrefix}SaveGame-${day}.${month}.${year}-${hours}:${minutes}:${seconds}.fhsave`;

    try {
        // --- Serialize the game state (same as autosave) ---
        const serializableState = { ...gameState };
        serializableState.tiles = Array.from(gameState.tiles.entries());
        serializableState.edges = Array.from(gameState.edges.entries());
        serializableState.currentReachableMoves = Array.from(gameState.currentReachableMoves.entries());
        serializableState.saveVersion = BUILD_VERSION;
        const gameStateString = JSON.stringify(serializableState, null, 2); // Using indentation for readability

        // --- Trigger the file download ---
        const blob = new Blob([gameStateString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showInstruction("Save file downloaded!", 2500);

    } catch (error) {
        console.error("Error saving game to file:", error);
        showInstruction("Could not create save file. See console.", 3000);
    }
}

function attemptLegacyConversion(data) {
    console.groupCollapsed(`[Converter] Checking Save (v: ${data.saveVersion || "Old"})...`);
    
    // We attempt conversion on anything that looks like a save file
    const converted = { ...data };
    converted.saveVersion = BUILD_VERSION; // Update version tag

    // 1. Default Game Mode & Radius
    if (!converted.gameMode) converted.gameMode = 'local';
    if (!converted.gridRadius) {
        let maxDist = 0;
        const tilesIter = Array.isArray(converted.tiles) ? converted.tiles : Object.entries(converted.tiles || {});
        tilesIter.forEach(([k]) => {
            const [q, r] = k.split(',').map(Number);
            const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q-r));
            if (dist > maxDist) maxDist = dist;
        });
        converted.gridRadius = maxDist || 3;
    }

    // 2. State Normalization
    if (converted.currentPlayer === undefined) converted.currentPlayer = 1;
    if (converted.globalTurnNumber === undefined) converted.globalTurnNumber = 1;
    if (!converted.playerColorSelections) converted.playerColorSelections = { player1: 2, player2: 2 };
    if (!converted.colorTransition) converted.colorTransition = { active: false, startTime: 0, from: {}, to: {} };

    // 3. UNIT CONVERSION (The Fix for 0 Movement)
    if (Array.isArray(converted.units)) {
        converted.units = converted.units.map(u => {
            // Determine Type
            let tName = u.typeName || u.typeId || (u.type ? u.type.name : 'MELEE');
            tName = tName.toUpperCase();
            // Validate Type
            const template = UNIT_TYPES[tName] || UNIT_TYPES.MELEE;
            
            // Build new 'stats' object if missing
            if (!u.stats) {
                console.log(`[Converter] Upgrading unit ${u.id} to new Stats system.`);
                u.stats = {
                    hp: u.hp !== undefined ? u.hp : template.hp,
                    maxHp: u.maxHp !== undefined ? u.maxHp : template.hp,
                    // Map old 'baseMove' or template 'speed'
                    speed: (u.type && u.type.baseMove) ? u.type.baseMove : template.speed,
                    damage: (u.type && u.type.damage) ? u.type.damage : template.damage,
                    defense: (u.type && u.type.fortificationBonus) ? u.type.fortificationBonus : template.defense,
                    range: template.attackType === 'ranged' ? 2 : 1
                };
            }

            // Ensure TypeID is set
            u.typeId = tName;
            
            // Ensure essential flags exist
            if (u.turnsFortifiedAtBase === undefined) u.turnsFortifiedAtBase = 0;
            if (u.mountainAttritionTurns === undefined) u.mountainAttritionTurns = 0;
            if (u.fortifyCooldown === undefined) u.fortifyCooldown = 0;
            if (u.level === undefined) u.level = 0;
            if (u.spearWalled === undefined) u.spearWalled = false;
            if (!u.upgrades) u.upgrades = { health: 0, speed: 0, damage: 0, defense: 0 };

            return u;
        });
    }

    // 4. Tile Normalization (Re-hydrating objects)
    let tileEntries = [];
    if (Array.isArray(converted.tiles)) {
        tileEntries = converted.tiles;
    } else if (typeof converted.tiles === 'object') {
        tileEntries = Object.entries(converted.tiles);
    }

    converted.tiles = tileEntries.map(([key, value]) => {
        let tileObj = value;
        // Handle raw string types (Old saves)
        if (typeof value === 'string') {
            const [q, r] = key.split(',').map(Number);
            tileObj = { q, r, type: TILE_TYPES[value] || TILE_TYPES.PLAINS };
        } else {
            // Re-link Tile Type Object
            let typeName = 'PLAINS';
            if (typeof tileObj.type === 'string') typeName = tileObj.type;
            else if (tileObj.type && tileObj.type.name) typeName = tileObj.type.name;
            tileObj.type = TILE_TYPES[typeName.toUpperCase()] || TILE_TYPES.PLAINS;
        }
        // Ensure coords
        if (tileObj.q === undefined) {
            const [q, r] = key.split(',').map(Number);
            tileObj.q = q; tileObj.r = r;
        }
        if (tileObj.isBaseCampTile === undefined) tileObj.isBaseCampTile = false; 
        if (tileObj.fortifiedByPlayer === undefined) tileObj.fortifiedByPlayer = null;
        
        // Add Visibility property if missing (B29 feature)
        if (tileObj.type.visibility === undefined) {
             const freshType = TILE_TYPES[tileObj.type.name.toUpperCase()];
             tileObj.type.visibility = freshType ? freshType.visibility : 3;
        }

        return [key, tileObj];
    });

    console.log("Conversion Complete.");
    console.groupEnd();
    return converted;
}

function createMapDataObject() {
    const mapData = {
        saveVersion: BUILD_VERSION,
        radius: gameState.gridRadius,
        tiles: Array.from(gameState.tiles.entries()),
        units: gameState.units.map(u => ({
            id: u.id,
            player: u.player,
            typeName: (u.type && u.type.name) ? u.type.name.toUpperCase() : (u.typeId || 'MELEE'),
            position: u.position
        })),
        baseCampPositions: gameState.baseCampPositions
    };
    return mapData;
}

function loadAutoSave() {
    console.group("[LoadAutosave] Process Started");

    if (gameState.mapMakerMode) {
        const savedMapString = localStorage.getItem(MAP_MAKER_AUTOSAVE_KEY);
        if (!savedMapString) {
            showInstruction("No autosaved map found.", 2000);
            console.groupEnd();
            return;
        }
        try {
            let mapData = JSON.parse(savedMapString);
            loadMapFromDataObject(mapData);
        } catch (error) {
            console.error(error);
            showInstruction("Map Load Error.", 3000);
        }
    } else {
        const saveKey = gameState.gameMode === 'singleplayer' ? 'forthexSaveGame_sp' : 'forthexSaveGame';
        console.log("Loading key:", saveKey);
        
        const savedStateString = localStorage.getItem(saveKey);
        if (!savedStateString) {
            showInstruction("No saved game found.", 2000);
            console.groupEnd();
            return;
        }

        try {
            let loadedState = JSON.parse(savedStateString);
            
            // 1. Convert
            loadedState = attemptLegacyConversion(loadedState);

            // 2. Resize Environment (Calculates renderScale global)
            const radiusToLoad = loadedState.gridRadius || 3;
            console.log(`Resizing grid to Radius ${radiusToLoad}`);
            resizeMapGrid(radiusToLoad);
            
            // CAPTURE THE CORRECT SCALE calculated by resizeMapGrid
            const correctScale = gameState.renderScale;
            const correctOffset = gameState.renderOffset;

            // 3. Apply State
            console.log("Applying State...");
            gameState = loadedState;
            
            // RESTORE THE CORRECT SCALE (In case loadedState had undefined/wrong scale)
            gameState.renderScale = correctScale;
            gameState.renderOffset = correctOffset;
            console.log(`Forced Render Scale to: ${gameState.renderScale}`);

            // 4. Rehydrate
            rehydrateGameState();
            
            // 5. Restore UI
            if (gameState.gameMode === 'arcade') {
                ui.endTurnButton.classList.add('arcade-timer-active');
                const timerVal = gameState.arcadeTurnTimer || 0;
                const pct = Math.max(0, (timerVal / ARCADE_TURN_TIME_SEC) * 100);
                const activeColor = '#E04030'; 
                const emptyColor = '#C03020';
                ui.endTurnButton.style.background = `linear-gradient(to right, ${activeColor} ${pct}%, ${emptyColor} ${pct}%)`;
                ui.endTurnButton.textContent = `End Turn (${Math.ceil(timerVal)}s)`;
                
                const supplyContainer = document.getElementById('supplyPointsContainer');
                if (supplyContainer) supplyContainer.style.display = 'block';
            } else {
                ui.endTurnButton.classList.remove('arcade-timer-active');
                ui.endTurnButton.style.background = '';
                ui.endTurnButton.textContent = "End Turn";
            }

            fullGameRedraw();
            showInstruction("Game Loaded.", 2000);
        } catch (error) {
            console.error("Load Critical Failure:", error);
            showInstruction("Save File Corrupted.", 3000);
        }
    }
    console.groupEnd();
}

function rehydrateGameState() {
    console.groupCollapsed("[Rehydrate] Restoring Game Objects...");
    
    try {
        // 1. Restore Tiles
        if (Array.isArray(gameState.tiles)) {
            gameState.tiles = new Map(gameState.tiles);
        } else {
            gameState.tiles = new Map(Object.entries(gameState.tiles || {}));
        }

        // 2. Restore Edges
        if (Array.isArray(gameState.edges)) {
            gameState.edges = new Map(gameState.edges);
        } else {
            gameState.edges = new Map(Object.entries(gameState.edges || {}));
        }

        // 3. Restore Reachable Moves
        if (Array.isArray(gameState.currentReachableMoves)) {
            gameState.currentReachableMoves = new Map(gameState.currentReachableMoves);
        } else {
            gameState.currentReachableMoves = new Map();
        }

        // 3b. Rebuild the fine-grid index from the freshly restored tiles/edges.
        // It's derived data — never trust whatever the save serialised it into (a Map
        // becomes a plain {} through JSON, which would break resolveFineCoord()).
        buildFineGridIndex();

        // 4. Restore Global Color State
        if (gameState.playerColorSelections) {
            const p1Theme = COLOR_THEMES[gameState.playerColorSelections.player1];
            const p2Theme = COLOR_THEMES[gameState.playerColorSelections.player2];
            if (p1Theme && p2Theme) {
                TEAM_COLORS.player1 = { ...p1Theme.player1 };
                TEAM_COLORS.player2 = { ...p2Theme.player2 };
                currentDrawingColors.player1 = { ...TEAM_COLORS.player1 };
                currentDrawingColors.player2 = { ...TEAM_COLORS.player2 };
                updateCssVariables();
            }
        }

        gameState.activeAnimations = [];
        
        // --- TRANSIENT VISUAL STATE RESET ---
        // Prevents loaded JSON objects from breaking Map/Set functions
        gameState.fogAnimState = null;
        gameState.visionCache = null;
        gameState.visionDirty = true;
        gameState.isPassDeviceTransition = false;

        // 5. Restore Unit Logic (Getters & Stats)
        gameState.units.forEach(unit => {
            // Re-attach 'type' getter
            Object.defineProperty(unit, 'type', {
                get: function() { return UNIT_TYPES[this.typeId]; },
                configurable: true
            });

            // Re-attach legacy 'hp'/'maxHp' getters/setters for compatibility
            Object.defineProperty(unit, 'hp', {
                get: function() { return this.stats.hp; },
                set: function(val) { this.stats.hp = val; },
                configurable: true
            });
            Object.defineProperty(unit, 'maxHp', {
                get: function() { return this.stats.maxHp; },
                set: function(val) { this.stats.maxHp = val; },
                configurable: true
            });

            // Ensure Linkage
            if (!unit.typeId && unit.typeName) unit.typeId = unit.typeName;
            if (!unit.type) console.warn("Unknown Unit Type ID:", unit.typeId);
        });

        // 5b. Re-link unit REFERENCES to the real array members. JSON has no reference
        // sharing, so selectedUnit/draggingUnit/unitToSwap deserialise as detached clones
        // that the getter loop above never touched. Acting on a clone mutates the copy
        // while tile state mutates the real board, desyncing the game.
        const relinkUnitRef = (ref) => {
            if (!ref || !ref.id) return null;
            return gameState.units.find(u => u.id === ref.id) || null;
        };
        gameState.selectedUnit = relinkUnitRef(gameState.selectedUnit);
        gameState.draggingUnit = relinkUnitRef(gameState.draggingUnit);
        gameState.unitToSwap = relinkUnitRef(gameState.unitToSwap);

        // 6. Re-link Units to Edges (Re-attach Getters)
        gameState.edges.forEach((edge, edgeKey) => {
            Object.defineProperty(edge, 'units', {
                get: function() { 
                    return gameState.units.filter(u => u.positionType === 'edge' && u.position === edgeKey && u.id !== gameState.draggingUnit?.id); 
                },
                configurable: true,
                enumerable: false
            });
        });

        // 7. Clean Sweep / Sanity Checks
        console.log("Running post-load sanity checks...");
        
        // A. Fix illegally fortified units (Defense <= 0)
        // We clone the array because handleUnitDeath modifies gameState.units
        const unitsToCheck = [...gameState.units]; 
        for (const unit of unitsToCheck) {
            if (unit.isFortified && unit.stats.defense <= 0) {
                console.warn(`[Clean Sweep] Unit ${unit.id} illegally fortified. Evicting...`);
                const validTargets = getPotentialUnfortifyTargets(unit);
                
                if (validTargets.length === 0) {
                    handleUnitDeath(unit, "crushed");
                } else {
                    logAction(`P${unit.player} ${unit.type.name} was forced to retreat due to 0 defense.`, unit.player);
                    // This queues the unfortify animation to play as soon as the canvas loads!
                    completeUnfortify(unit, validTargets[0]); 
                }
            }
        }

        // B. Check for stuck Reinforcement Modals
        if (gameState.gameMode !== 'arcade') {
            const activePlayer = gameState.currentPlayer;
            const queueKey = `player${activePlayer}`;
            const queue = gameState.respawnQueue[queueKey];
            
            if (queue && queue.length > 0 && queue[0].turnsRemaining <= 0) {
                console.warn(`[Clean Sweep] P${activePlayer} has pending reinforcements. Opening modal...`);
                // We use a tiny timeout so it pops up AFTER fullGameRedraw() finishes setting up the UI
                setTimeout(() => showRespawnModal(activePlayer), 100);
            }
        }

    } catch (err) {
        console.error("[Rehydrate] Error:", err);
    }
    console.groupEnd();
}



function autoSaveMap() {
    if (!gameState.mapMakerMode) return;
    try {
        const mapData = createMapDataObject();
        localStorage.setItem(MAP_MAKER_AUTOSAVE_KEY, JSON.stringify(mapData));
        console.log("Map autosaved to localStorage.");
    } catch (error) {
        console.error("Error autosaving map:", error);
    }
}

function loadMapFromDataObject(mapData) {
    try {
        mapData = attemptLegacyConversion(mapData);
    } catch (error) {
        console.error("Conversion failed:", error);
        showInstruction(error.message, 3000);
        return false;
    }

    if (!mapData || mapData.saveVersion !== BUILD_VERSION) {
        showInstruction("Map data is invalid.", 3000);
        return false;
    }

    if (!gameState.mapMakerMode) {
        enterMapMakerMode();
    }

    let loadedRadius = mapData.radius || 3;
    resizeMapGrid(loadedRadius);

    gameState.units = [];
    gameState.tiles.clear();

    mapData.tiles.forEach(([key, tile]) => {
        const rehydratedTile = { ...tile,
            type: TILE_TYPES[tile.type.name.toUpperCase()]
        };
        gameState.tiles.set(key, rehydratedTile);
    });

    mapData.units.forEach(unitInfo => {
        // Map files store typeName; game saves store typeId. Accept either, or every
        // unit in a .fhsave opened through the map maker is silently dropped.
        const typeKey = (unitInfo.typeName || unitInfo.typeId || "").toUpperCase();
        const unitType = UNIT_TYPES[typeKey];
        
        if (unitType) {
            const newUnit = createUnit(unitInfo.player, unitType, unitInfo.position, unitInfo.id);
            gameState.units.push(newUnit);
            const edge = gameState.edges.get(unitInfo.position);
            if (edge) {
                edge.units.push(newUnit);
            }
        } else {
            console.warn(`Skipped unknown unit type: ${unitInfo.typeName}`);
        }
    });

    gameState.baseCampPositions = mapData.baseCampPositions || { player1: null, player2: null };

    // resizeMapGrid(2) nulls gameState.flags for arcade, so this must be guarded the same
    // way startMapTest does it — otherwise loading any Compact (radius 2) map throws.
    if (gameState.flags) {
        gameState.flags.p1_flag.homePosition = gameState.baseCampPositions.player1;
        gameState.flags.p2_flag.homePosition = gameState.baseCampPositions.player2;
    }

    const setBaseFlags = (baseData) => {
        if (!baseData) return;
        if (Array.isArray(baseData)) {
            baseData.forEach(k => {
                const tile = gameState.tiles.get(k);
                if (tile) { 
                    tile.type = TILE_TYPES.PLAINS; 
                    tile.isBaseCampTile = true; 
                }
            });
        } else if (typeof baseData === 'string') {
            const [h1, h2] = parseEdgeKey(baseData);
            [getTileKey(h1.q, h1.r), getTileKey(h2.q, h2.r)].forEach(k => {
                const tile = gameState.tiles.get(k);
                if (tile) { 
                    tile.type = TILE_TYPES.PLAINS; 
                    tile.isBaseCampTile = true; 
                }
            });
        }
    };
    setBaseFlags(gameState.baseCampPositions.player1);
    setBaseFlags(gameState.baseCampPositions.player2);

    const sliderToRotations = [3, 2, 1, 0, -1, -2];
    let matchingSliderValue = '3'; 

    if (mapData.baseCampPositions.player1 && typeof mapData.baseCampPositions.player1 === 'string') {
        for (let i = 0; i < sliderToRotations.length; i++) {
            const rotations = sliderToRotations[i];
            const p1_default = parseEdgeKey(DEFAULT_FLAG_HOME_POSITIONS.player1);
            const p1_h1_rotated = rotateAxial(p1_default[0].q, p1_default[0].r, rotations);
            const p1_h2_rotated = rotateAxial(p1_default[1].q, p1_default[1].r, rotations);
            const testEdgeKey = getEdgeKey(p1_h1_rotated.q, p1_h1_rotated.r, p1_h2_rotated.q, p1_h2_rotated.r);

            if (testEdgeKey === mapData.baseCampPositions.player1) {
                matchingSliderValue = i.toString();
                break; 
            }
        }
    }

    const bcSlider = document.getElementById('baseCampSlider');
    if (bcSlider) bcSlider.value = matchingSliderValue;

    // gameState.tiles was cleared and repopulated from mapData above, so the index
    // resizeMapGrid built no longer necessarily matches the board.
    buildFineGridIndex();

    showInstruction("Map loaded successfully!", 2000);
    return true;
}

