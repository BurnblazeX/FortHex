function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function checkArcadeVictoryCondition() {
    const p1HP = gameState.units.filter(u => u.player === 1).reduce((sum, u) => sum + u.hp, 0);
    const p2HP = gameState.units.filter(u => u.player === 2).reduce((sum, u) => sum + u.hp, 0);
    
    let victoryText = "";
    if (p1HP > p2HP) victoryText = "Time Limit! Player 1 Wins by Health!";
    else if (p2HP > p1HP) victoryText = "Time Limit! Player 2 Wins by Health!";
    else victoryText = "Time Limit! It's a Draw!";
    
    ui.victoryMessage.textContent = victoryText;
    ui.victoryMessage.style.display = 'block';
    gameState.gameOver = true;
    ui.endTurnButton.disabled = true;
    triggerConfetti();
    
    // Block interaction immediately
    const interactionBlocker = document.getElementById('victoryInteractionBlocker');
    interactionBlocker.style.display = 'block';
    
    const CONFETTI_DURATION = 7000;
    new Promise(resolve => setTimeout(resolve, CONFETTI_DURATION)).then(() => {
        const restartGameOnClick = () => {
            window.removeEventListener('click', restartGameOnClick);
            window.removeEventListener('touchend', restartGameOnClick);
            interactionBlocker.style.display = 'none';
            location.reload();
        };
        window.addEventListener('click', restartGameOnClick);
        window.addEventListener('touchend', restartGameOnClick);
        showInstruction("Click anywhere to play again.", CONFETTI_DURATION);
    });

    return true;
}

function checkVictoryCondition() {
    if (gameState.gameOver) return true;
    let victoryText = null;

    if (gameState.gameMode === 'arcade') {
        const player1Units = gameState.units.filter(u => u.player === 1);
        const player2Units = gameState.units.filter(u => u.player === 2);
        
        if (gameState.tiles.size > 0) { 
            if (player1Units.length === 0 && player2Units.length > 0) {
                victoryText = "Player 2 Wins by Annihilation!";
            } else if (player2Units.length === 0 && player1Units.length > 0) {
                victoryText = "Player 1 Wins by Annihilation!";
            } else if (player1Units.length === 0 && player2Units.length === 0) {
                victoryText = "It's a Draw!";
            }
        }
    } else {
        // Standard Flag Check
        for (const unit of gameState.units) {
            if (unit.isCarryingFlag) {
                const carrierPlayer = unit.player;
                const carrierHomeBaseData = gameState.baseCampPositions[`player${carrierPlayer}`];
                let isHome = false;

                if (Array.isArray(carrierHomeBaseData)) {
                    // Expansive Mode (Radius 4): Base is a list of tiles.
                    if (unit.positionType === 'center') {
                        // WIN: Fortified directly on one of the home base tiles
                        if (carrierHomeBaseData.includes(unit.position)) {
                            isHome = true;
                        }
                    } else {
                        // WIN: Unit is on an edge connecting two of these tiles (Internal Edge).
                        const [h1, h2] = parseEdgeKey(unit.position);
                        if (!isNaN(h1.q) && !isNaN(h2.q)) {
                            const t1 = getTileKey(h1.q, h1.r);
                            const t2 = getTileKey(h2.q, h2.r);
                            if (carrierHomeBaseData.includes(t1) && carrierHomeBaseData.includes(t2)) {
                                isHome = true;
                            }
                        }
                    }
                } else {
                    // Standard Mode (Radius 3): Base is a specific edge key string.
                    if (unit.position === carrierHomeBaseData) {
                        isHome = true;
                    } else if (unit.positionType === 'center') {
                        // WIN: Fortified directly on one of the tiles touching the home edge
                        const [h1, h2] = parseEdgeKey(carrierHomeBaseData);
                        const t1 = getTileKey(h1.q, h1.r);
                        const t2 = getTileKey(h2.q, h2.r);
                        if (unit.position === t1 || unit.position === t2) {
                            isHome = true;
                        }
                    }
                }

                if (isHome) {
                    victoryText = `Player ${carrierPlayer} captured the flag and wins!`;
                    break;
                }
            }
        }
        
        // Standard Annihilation Check
        if (!victoryText) {
            const player1Units = gameState.units.filter(u => u.player === 1);
            const player2Units = gameState.units.filter(u => u.player === 2);
            
            if (gameState.tiles.size > 0) { 
                if (player1Units.length === 0 && player2Units.length > 0) {
                    victoryText = "Player 2 Wins by Annihilation!";
                } else if (player2Units.length === 0 && player1Units.length > 0) {
                    victoryText = "Player 1 Wins by Annihilation!";
                } else if (player1Units.length === 0 && player2Units.length === 0) {
                    victoryText = "It's a Draw!";
                }
            }
        }
    }

    if (victoryText) {
        ui.victoryMessage.textContent = victoryText;
        ui.victoryMessage.style.display = 'block';
        triggerConfetti();
        gameState.gameOver = true;
        gameState.currentActionState = ACTION_STATES.IDLE;
        ui.endTurnButton.disabled = true;
        document.getElementById('newMapButton').disabled = false; 
        if (gameState.selectedUnit) {
            ui.actionsPanel.style.display = 'none';
        }
        canvas.style.cursor = 'default'; 
        gameState.selectedUnit = null;
        gameState.currentReachableMoves.clear(); 
        updateSelectedUnitInfoPanel();

        // VICTORY SCREEN LOGIC
        const interactionBlocker = document.getElementById('victoryInteractionBlocker');
        interactionBlocker.style.display = 'block'; // Block interactions immediately

        const CONFETTI_DURATION = 7000;
        new Promise(resolve => setTimeout(resolve, CONFETTI_DURATION)).then(() => {
            
            const restartGameOnClick = () => {
                window.removeEventListener('click', restartGameOnClick);
                window.removeEventListener('touchend', restartGameOnClick);
                interactionBlocker.style.display = 'none'; 
                location.reload();
            };

            window.addEventListener('click', restartGameOnClick);
            window.addEventListener('touchend', restartGameOnClick);

            showInstruction("Click anywhere to play again.", CONFETTI_DURATION);
        });

        return true; // VICTORY!
    }

    // No victory condition met
    document.getElementById('newMapButton').disabled = false;
    return false;
}

        ui.fortifyUnfortifyButton.addEventListener('click', handleFortifyUnfortifyButtonClick);
        ui.buildBridgeButton.addEventListener('click', handleBuildBridgeAction);
        ui.attackButton.addEventListener('click', handleAttackAction);

function proceedToEndTurn() {
    if (gameState.isDragging || gameState.gameOver) return;
    
    // --- ARCADE PHASE CHECK (Block if swap is needed) ---
    if (gameState.gameMode === 'arcade') {
        // Only enforce swap requirement if we are past Turn 1
        if (gameState.globalTurnNumber >= 2) {
            if (gameState.swapState === 'selecting_unit' || gameState.swapState === 'selecting_class') {
                showInstruction("You must swap a unit first!", 2000);
                return; // STOP: Player tried to skip swap
            }
        }
        
        // Check Arcade Turn Limit Victory
        if (gameState.currentPlayer === 2) { // End of round
            gameState.arcadeTotalTurns++;
            if (gameState.arcadeTotalTurns >= ARCADE_MAX_TURNS) {
                checkArcadeVictoryCondition();
                return;
            }
        }
    }

    // --- SWITCH PLAYER ---
    const previousPlayer = gameState.currentPlayer;
    gameState.playerActionTaken[`player${previousPlayer}`] = false;

    gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
    gameState.playerActionTaken[`player${gameState.currentPlayer}`] = false;

    if (previousPlayer === 2 && gameState.currentPlayer === 1) { 
        gameState.globalTurnNumber++;
        updateGlobalTurnDisplay();
    }
    
    // --- RESET SELECTIONS & MOUSE ---
    gameState.selectedUnit = null; 
    gameState.currentReachableMoves.clear();
    gameState.hoveredUnitId = null; 
    canvas.style.cursor = 'default';
    resetActionSelectionStates();
    
    // --- RESET UNITS FOR NEW TURN ---
    gameState.units.forEach(unit => {
        if (unit.player === gameState.currentPlayer) {
            unit.hasPerformedMajorAction = false; 
            
            // UPDATE: Use unit.stats.speed instead of type.baseMove
            let baseMoveForTurn = unit.stats.speed;
            
            if (unit.isCarryingFlag) { baseMoveForTurn -= 1; }
            unit.currentMove = Math.max(0, baseMoveForTurn); 
            
            if (unit.isFortified) {
                unit.turnsFortified++;
            } else {
                unit.turnsFortified = 0;
                if (unit.fortifyCooldown > 0) unit.fortifyCooldown = Math.max(0, unit.fortifyCooldown - 5);
            }

            // Check Cowardice (Fortified at base too long)
            const playerBaseTiles = getBaseCampTiles(gameState.baseCampPositions[`player${unit.player}`]);
            
            if (unit.isFortified && playerBaseTiles.includes(unit.fortifiedTileKey)) {
                unit.turnsFortifiedAtBase++;
                if (unit.turnsFortifiedAtBase > MAX_BASE_CAMP_TURNS) {
                    handleUnitDeath(unit, "cowardice");
                }
            }
        }
    });
    
    handleRespawnQueue();
    applyStartOfTurnZoCDamage(); 
    logSiegeStatus();
    applyStartOfTurnHealing(); 
    updateTurnDisplay();
    updateSelectedUnitInfoPanel(); 
    
    // CRITICAL FIX: Update HP display after turn start effects
    updateSupplyPointsDisplay();
    
    // --- ARCADE TIMER RESET & STATE SETUP ---
    if (gameState.gameMode === 'arcade') {
        // 1. RESET THE TIMER
        gameState.arcadeTurnTimer = ARCADE_TURN_TIME_SEC;
        gameState.hasSwappedThisTurn = false; // Reset swap flag

        // 2. SET SWAP PHASE (Only for Turn 2+)
        if (gameState.globalTurnNumber >= 2) {
            gameState.swapState = 'selecting_unit';
            showInstruction(`Player ${gameState.currentPlayer}'s Turn. SELECT UNIT TO SWAP.`, 4000);
        } else {
            gameState.swapState = 'none'; // Turn 1: No swap needed
            showInstruction(`Player ${gameState.currentPlayer}'s turn.`);
        }
    } else {
        showInstruction(`Player ${gameState.currentPlayer}'s turn.`);
    }
    
    logAction(`Player ${gameState.currentPlayer}'s Turn Begins`, gameState.currentPlayer);
    autoSaveGame(true);
    checkVictoryCondition();

    // AI Handling (Singleplayer)
    if (!gameState.gameOver && gameState.gameMode === 'singleplayer' && gameState.currentPlayer !== gameState.playerSide) {
        ui.endTurnButton.disabled = true;
        setTimeout(() => { executeAITurn(); }, 1500);
    } else {
        ui.endTurnButton.disabled = false;
    }
}

function handleGenerateNewMap() {
             gameState.isDragging = false; 
             gameState.draggingUnit = null;
            
            // 1. Generate the map tiles
            const newLayout = generateImprovedMap(gameState.gridRadius);
            
            // 2. Initialize the grid with these tiles
            initializeGrid(newLayout); 
            
            // 3. Explicitly update base camp positions based on the current slider and radius
            // This ensures the game logic matches the visual map size.
            const sliderVal = document.getElementById('baseCampSlider').value;
            updateBaseCampLocations(sliderVal);
            
            showInstruction("New map generated. Player 1's Turn.", 3000);
        }

function startSingleplayerGame(playerSide) {
    exitMapMakerMode(); 
    hideAllModals(); 
    
    // Set the game mode state
    gameState.gameMode = 'singleplayer';
    gameState.playerSide = playerSide;

    // --- FIX: Reset Map Dimensions for Standard Play ---
    gameState.gridRadius = 3;
    gameState.renderScale = 1.0;
    gameState.renderOffset = { x: 0, y: 0 };
    // ---------------------------------------------------

    // Force the default map for singleplayer
    initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3);
    showInstruction(`Singleplayer game started. You are Player ${playerSide}.`, 3000);
    // If the human chose to be P2, the AI (P1) must take the first turn.
    if (gameState.playerSide === 2) {
        console.log("Player is P2, triggering AI's first turn.");
        ui.endTurnButton.disabled = true; // Disable button during AI turn
        setTimeout(() => {
            executeAITurn();
        }, 1500); // Wait a moment before AI starts
    }
}

function applyStartOfTurnZoCDamage() {
    const activePlayer = gameState.currentPlayer;
    const enemyPlayer = activePlayer === 1 ? 2 : 1;
    let unitsToDestroy = [];
    let zocEvents = []; 

    const activePlayerBaseData = gameState.baseCampPositions[`player${activePlayer}`];
    let activePlayerBaseTiles = [];
    
    if (Array.isArray(activePlayerBaseData)) {
        activePlayerBaseTiles = activePlayerBaseData;
    } else if (typeof activePlayerBaseData === 'string') {
        // Splitting "1,2_2,1" safely gives us an array of the two tile keys: ['1,2', '2,1']
        activePlayerBaseTiles = activePlayerBaseData.split('_');
    }

    gameState.units.forEach(unit => {
        if (unit.player !== enemyPlayer) return;
        
        // --- 1. Edge ZoC (Original Logic) ---
        if (unit.positionType === 'edge' && !unit.isFortified) {
            const edgeKey = unit.position;
            const edgeTileCoords = parseEdgeKey(edgeKey);
            if (edgeTileCoords.some(coord => isNaN(coord.q))) return;

            const tile1Key = getTileKey(edgeTileCoords[0].q, edgeTileCoords[0].r);
            const tile2Key = getTileKey(edgeTileCoords[1].q, edgeTileCoords[1].r);
            const tile1 = gameState.tiles.get(tile1Key);
            const tile2 = gameState.tiles.get(tile2Key);
            
            const checkTileZoC = (tile, tKey) => {
                if (!tile) return false;
                if (activePlayerBaseTiles.includes(tKey)) return true; // Base Camp (Unsuppressable)

                if (tile.fortifiedByPlayer === activePlayer) {
                    const fortUnit = gameState.units.find(u => u.isFortified && u.position === tKey && u.player === activePlayer);
                    if (fortUnit && !isZoCSuppressed(fortUnit)) return true;
                }
                return false;
            };

            if (checkTileZoC(tile1, tile1Key) || checkTileZoC(tile2, tile2Key)) {
                unit.hp -= FORTIFICATION_DAMAGE;
                triggerDamageVisual(unit, 'normal'); // Added missing visual feedback
                
                zocEvents.push({
                    unitId: unit.id,
                    damage: FORTIFICATION_DAMAGE,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                logAction(`P${unit.player} ${unit.type.name} takes start-of-turn ZoC. HP: ${unit.hp}`, activePlayer, 3500);
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        }
        // --- 2. Center/Fortified Base Camp ZoC (NEW LOGIC) ---
        else if (unit.positionType === 'center' && unit.isFortified) {
            // If the enemy unit is fortified DIRECTLY ON the active player's base camp tile
            if (activePlayerBaseTiles.includes(unit.fortifiedTileKey)) {
                unit.hp -= FORTIFICATION_DAMAGE;
                triggerDamageVisual(unit, 'normal'); // Added visual feedback
                
                zocEvents.push({
                    unitId: unit.id,
                    damage: FORTIFICATION_DAMAGE,
                    remainingHp: unit.hp,
                    isFatal: unit.hp <= 0
                });

                logAction(`P${unit.player} ${unit.type.name} takes Base Camp ZoC. HP: ${unit.hp}`, activePlayer, 3500);
                if (unit.hp <= 0 && !unitsToDestroy.find(u => u.id === unit.id)) {
                    unitsToDestroy.push(unit);
                }
            }
        }
    });

    if (zocEvents.length > 0 && typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "TURN_START_ZOC",
            turn: gameState.globalTurnNumber,
            player: activePlayer,
            payload: { events: zocEvents }
        });
    }

    if (unitsToDestroy.length > 0) unitsToDestroy.forEach(u => handleUnitDeath(u, "zoc_turn_start"));
}

function updateAllHealingStatus() {
            if (gameState.gameMode === 'arcade') return;

            // Check flag status for both players
            const p1FlagStolen = gameState.flags.p1_flag.status === 'carried';
            const p2FlagStolen = gameState.flags.p2_flag.status === 'carried';

            gameState.units.forEach(unit => {
                if (unit.isFortified) {
                    if (unit.player === 1) {
                        unit.canHeal = !p1FlagStolen;
                    } else { // unit.player === 2
                        unit.canHeal = !p2FlagStolen;
                    }
                } else {
                    unit.canHeal = false; // Unfortified units can't heal anyway
                }
            });
            if (p1FlagStolen) { logAction(`P1's flag is stolen! Healing is disabled.`, 2, 3000); }
            if (p2FlagStolen) { logAction(`P2's flag is stolen! Healing is disabled.`, 1, 3000); }
        }

function applyStartOfTurnHealing() {
    // In Arcade mode, there are no base camps, so units cannot heal.
    if (gameState.gameMode === 'arcade') return;

    const playerFlag = gameState.flags[`p${gameState.currentPlayer}_flag`];
    if (playerFlag && playerFlag.status === 'carried') {
        return; // No healing for anyone if their flag is stolen.
    }

    let healingEvents = []; // --- NEW: Aggregate Healing Data ---

    gameState.units.forEach(unit => {
        if (unit.player !== gameState.currentPlayer || !unit.isFortified || unit.hp >= (unit.maxHp + 1)) {
            return;
        }

        const recentlyAttacked = gameState.globalTurnNumber < unit.lastAttackedByHostileOnTurn + 2;
        if (recentlyAttacked) {
            return;
        }
            
        let isSupplied = false;
        
        // --- Normalized Base Tiles Check ---
        const rawBaseData = gameState.baseCampPositions[`player${unit.player}`];
        let baseTiles = [];
        if (Array.isArray(rawBaseData)) {
            baseTiles = rawBaseData;
        } else if (typeof rawBaseData === 'string') {
            const [h1, h2] = parseEdgeKey(rawBaseData);
            if (!isNaN(h1.q)) baseTiles.push(getTileKey(h1.q, h1.r));
            if (!isNaN(h2.q)) baseTiles.push(getTileKey(h2.q, h2.r));
        }
        
        if (baseTiles.includes(unit.fortifiedTileKey)) {
            isSupplied = true;
        }

        if (!isSupplied && unit.supplyLine && unit.supplyLine.path) {
            const isIntercepted = unit.supplyLine.path.some(edgeKey => {
                const edge = gameState.edges.get(edgeKey);
                return edge && edge.units.some(u => u.player !== unit.player);
            });
            if (!isIntercepted) {
                isSupplied = true;
            }
        }

        if (isSupplied) {
            const oldHp = unit.hp;
            unit.hp++;
            const activePlayer = gameState.currentPlayer;
            
            // --- NEW: Track Event ---
            let type = 'HEAL';
            if (unit.hp === unit.maxHp + 1) type = 'SHIELD';
            
            healingEvents.push({
                unitId: unit.id,
                type: type,
                amount: 1,
                finalHp: unit.hp
            });
            // ------------------------

            if (oldHp < unit.maxHp && unit.hp === unit.maxHp) {
                logAction(`P${unit.player} ${unit.type.name} healed to full HP.`, activePlayer, 2500);
            } else if (unit.hp === unit.maxHp + 1) {
                logAction(`P${unit.player} ${unit.type.name} gained a shield!`, activePlayer, 2500);
                
                let targetX, targetY, targetRadius;
                const tile = gameState.tiles.get(unit.position);
                if (tile) { 
                    const center = axialToPixel(tile.q, tile.r);
                    targetX = center.x;
                    targetY = center.y;
                    targetRadius = FORTIFIED_UNIT_DRAW_SIZE;

                    gameState.visualEffects.push({
                        type: 'shield_ring',
                        x: targetX, y: targetY,
                        unitRadius: targetRadius,
                        startTime: Date.now(),
                        duration: 600 
                    });
                }
            } else {
                 logAction(`P${unit.player} ${unit.type.name} healed 1 HP.`, activePlayer, 2500);
            }
        }
    });

    // --- NEW: Submit Batch Log ---
    if (healingEvents.length > 0 && typeof ActionManager !== 'undefined') {
        ActionManager.submitAction({
            type: "TURN_START_HEAL",
            turn: gameState.globalTurnNumber,
            player: gameState.currentPlayer,
            payload: { events: healingEvents }
        });
    }
}

function logSiegeStatus() {
            if (gameState.gameMode === 'arcade' || !gameState.flags) return;

            const activePlayer = gameState.currentPlayer;
            const playerFlag = gameState.flags[`p${activePlayer}_flag`];

            if (playerFlag && playerFlag.status === 'carried') {
                const existingLog = gameState.actionLog[gameState.actionLog.length - 1];
                if (!existingLog || !existingLog.message.includes('Healing is disabled')) {
                    logAction(`P${activePlayer}'s flag is stolen! All healing is disabled.`, activePlayer);
                }
            }

            gameState.units.forEach(unit => {
                if (unit.player === activePlayer && unit.isFortified && unit.supplyLine && unit.supplyLine.path) {
                    const isIntercepted = unit.supplyLine.path.some(edgeKey => {
                        const edge = gameState.edges.get(edgeKey);
                        return edge && edge.units.some(u => u.player !== unit.player);
                    });

                    if (isIntercepted) {
                         logAction(`P${unit.player} ${unit.type.name} is under siege and cannot heal!`, activePlayer);
                    }
                }
            });
        }

        function handleRespawnQueue() {
            if (gameState.gameMode === 'arcade') return;

            const player = gameState.currentPlayer;
            const queueKey = `player${player}`;
            const queue = gameState.respawnQueue[queueKey];
    
            if (!queue || queue.length === 0) {
                updateRespawnQueueDisplay();
                return;
            }

            // Decrement timers
            queue.forEach(item => {
                if (item.turnsRemaining > 0) { 
                    item.turnsRemaining--;
                }
            });

            // Check front of queue
            const firstItem = queue[0];
            if (firstItem && firstItem.turnsRemaining <= 0) {
                console.log(`[Respawn] Player ${player} unit ready.`);
                try {
                    showRespawnModal(player);
                } catch (e) {
                    console.error("Failed to open Respawn Modal:", e);
                }
            }
    
            updateRespawnQueueDisplay();
        }
        
function triggerConfetti() {
    const container = document.getElementById('confettiContainer');
    if (!container) return;

    const confettiCount = 150;
    const colors = ['#FFC020', '#E04030', '#3090D0', '#2ecc71', '#F0F0F0'];

    for (let i = 0; i < confettiCount; i++) {
        const confettiPiece = document.createElement('div');
        confettiPiece.className = 'confetti-piece';
        
        // Randomize properties
        const x_start = Math.random() * 100; // % of screen width
        const y_start = -10 - Math.random() * 20; // Start off-screen
        const color = colors[Math.floor(Math.random() * colors.length)];
        const fall_duration = 3 + Math.random() * 4; // 3 to 7 seconds
        const rotation_start = Math.random() * 360;
        const rotation_end = rotation_start + 720 + Math.random() * 720;
        const sway = Math.random() * 150 - 75; // a horizontal sway of -75 to +75px

        confettiPiece.style.left = `${x_start}vw`;
        confettiPiece.style.top = `${y_start}px`;
        confettiPiece.style.backgroundColor = color;
        confettiPiece.style.transform = `rotate(${rotation_start}deg)`;
        
        container.appendChild(confettiPiece);

        // Animate using Web Animations API (clean and performant)
        confettiPiece.animate([
            { transform: `translate3d(0, 0, 0) rotate(${rotation_start}deg)` },
            { transform: `translate3d(${sway}px, 105vh, 0) rotate(${rotation_end}deg)` }
        ], {
            duration: fall_duration * 1000,
            easing: 'ease-in',
            iterations: 1
        });

        // Remove the element after it falls
        setTimeout(() => {
            confettiPiece.remove();
        }, fall_duration * 1000);
    }
}

function handleInteractionStart(x, y, isTouchEvent = false) {
            if (gameState.fillToolActive) {
                if (gameState.mapMakerBrush.type !== 'tile') {
                    showInstruction("Please select a tile type to fill with.", 2000);
                    return;
                }
                const coords = pixelToAxial(x, y);
                performFloodFill(coords.q, coords.r);
                return;
            }

            if (gameState.mapMakerMode) {
                gameState.isDragging = true;
                gameState.mapMakerLastPaintedHexKey = null;
                applyMapMakerBrush(x, y);
                return;
            }
            if (gameState.gameOver) return;

            // --- ARCADE TIMER TRIGGER ---
            // Timer starts only after P1 interacts on Turn 1
            if (gameState.gameMode === 'arcade' && !gameState.arcadeGameStartedInteraction) {
                gameState.arcadeGameStartedInteraction = true;
            }
            // ----------------------------

            // --- ARCADE SWAP INTERCEPTION ---
            if (gameState.gameMode === 'arcade' && gameState.swapState === 'selecting_unit') {
                const baseClickRadius = isTouchEvent ? UNIT_CLICK_RADIUS * 1.5 : UNIT_CLICK_RADIUS;
                const clickRadius = baseClickRadius * gameState.renderScale;
                
                // Simple finding logic for Swap Click
                let clickedUnit = null;
                const edgeUnits = [];
                gameState.edges.forEach(edge => edge.units.forEach(u => { if (u.positionType === 'edge') edgeUnits.push({unit:u, edge}); }));
                
                for (let i = edgeUnits.length - 1; i >= 0; i--) {
                     const {unit, edge} = edgeUnits[i];
                     if (unit.player !== gameState.currentPlayer) continue;
                     const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                     // (Simplified math from main handler for brevity, full implementation recommended in production)
                     if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < clickRadius) {
                         clickedUnit = unit;
                         break;
                     }
                }
                // Also check fortified units (though rare in arcade)
                if (!clickedUnit) {
                    for (const unit of gameState.units) {
                         if (unit.player === gameState.currentPlayer && unit.isFortified) {
                             const tile = gameState.tiles.get(unit.position);
                             if (tile) {
                                 const {x: tx, y: ty} = axialToPixel(tile.q, tile.r);
                                 if (Math.sqrt((x - tx)**2 + (y - ty)**2) < clickRadius) {
                                     clickedUnit = unit;
                                     break;
                                 }
                             }
                         }
                    }
                }

                if (clickedUnit) {
                    gameState.unitToSwap = clickedUnit;
                    gameState.swapState = 'selecting_class';
                    showSwapClassModal(clickedUnit);
                } else {
                    showInstruction("You must select a unit to SWAP!", 1500);
                }
                return; // Stop standard interaction
            }

            if (gameState.fillToolActive) {
                if (gameState.mapMakerBrush.type !== 'tile') {
                    showInstruction("Please select a tile type to fill with.", 2000);
                    return;
                }
                const coords = pixelToAxial(x, y);
                performFloodFill(coords.q, coords.r);
                return;
            }

            if (gameState.mapMakerMode) {
                gameState.isDragging = true;
                gameState.mapMakerLastPaintedHexKey = null;
                applyMapMakerBrush(x, y);
                return;
            }
            if (gameState.gameOver || gameState.currentActionState !== ACTION_STATES.IDLE && gameState.currentActionState !== ACTION_STATES.UNIT_SELECTED) return;

            dragOperationJustConcluded = false; 
            clearDebugPath();
            gameState.dragStartX = x; 
            gameState.dragStartY = y; 
            gameState.draggedDistance = 0;

            let unitToDrag = null;
            
            // --- FIX: Apply renderScale to click radius ---
            const baseClickRadius = isTouchEvent ? UNIT_CLICK_RADIUS * 1.5 : UNIT_CLICK_RADIUS;
            const clickRadius = baseClickRadius * gameState.renderScale;
            // ----------------------------------------------

            const edgeUnits = [];
            gameState.edges.forEach(edge => edge.units.forEach(u => { if (u.positionType === 'edge') edgeUnits.push({unit:u, edge}); }));
            
            for (let i = edgeUnits.length - 1; i >= 0; i--) {
                 const {unit, edge} = edgeUnits[i];
                 if (unit.player !== gameState.currentPlayer) continue;
                if (gameState.gameMode === 'singleplayer' && unit.player !== gameState.playerSide) continue; 
                if (unit.isFortified || unit.currentMove < 1) continue;
                 if (unit.hasPerformedMajorAction && !unit.type.canMoveAfterAttack) continue;
                 
                 const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                 let unitCenterX = mid.x, unitCenterY = mid.y;
                 const edgeUnitsOnly = edge.units.filter(u => u.positionType === 'edge');
                 const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === unit.id);
                 if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                    const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                    const p1 = axialToPixel(edge.q1, edge.r1); const p2 = axialToPixel(edge.q2, edge.r2);
                    let dx_val = p2.x - p1.x, dy_val = p2.y - p1.y; const len = Math.sqrt(dx_val*dx_val + dy_val*dy_val) || 1;
                    let perpX = -dy_val / len, perpY = dx_val / len;
                    
                    // --- FIX: Apply renderScale to visual offset calculation ---
                    unitCenterX += perpX * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5); 
                    unitCenterY += perpY * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5);
                 }
                 
                 if (Math.sqrt((x - unitCenterX)**2 + (y - unitCenterY)**2) < clickRadius) { 
                     unitToDrag = unit; 
                     break; 
                 }
            }

            if (unitToDrag) {
                gameState.isDragging = true; 
                gameState.dragStartTime = Date.now();
                gameState.draggingUnit = unitToDrag;
                gameState.dragUnitOriginalPosition = unitToDrag.position; 
                gameState.dragUnitOriginalType = unitToDrag.positionType;
                gameState.dragUnitRenderX = x; 
                gameState.dragUnitRenderY = y;
                if (!gameState.selectedUnit || gameState.selectedUnit.id !== unitToDrag.id) {
                    gameState.selectedUnit = unitToDrag;
                    gameState.currentActionState = ACTION_STATES.UNIT_SELECTED;
                    console.log(`[Selection] Dragged Unit: ${gameState.selectedUnit.id}`);
                    updateSelectedUnitInfoPanel();
                }
                gameState.currentReachableMoves = getPossibleMoves(unitToDrag);
                canvas.style.cursor = 'grabbing'; 
            }
        }

        function handleInteractionMove(x, y) {
            if (gameState.mapMakerMode && gameState.isDragging) {
                applyMapMakerBrush(x, y);
                return;
            }
             if (gameState.isDragging && gameState.draggingUnit) {
                gameState.dragUnitRenderX = x; 
                gameState.dragUnitRenderY = y;
                gameState.draggedDistance = Math.sqrt((x - gameState.dragStartX)**2 + (y - gameState.dragStartY)**2);
                
                // --- FIX: Scale the hover detection radius ---
                const scaledHighlightRadius = HIGHLIGHT_CLICK_RADIUS * gameState.renderScale;
                
                let foundPathUnderCursor = null;
                for (const [targetEdgeKey, moveData] of gameState.currentReachableMoves) {
                     const finalTargetEdgeData = gameState.edges.get(targetEdgeKey); if (!finalTargetEdgeData) continue;
                     const mid = getEdgeMidpoint(finalTargetEdgeData.q1, finalTargetEdgeData.r1, finalTargetEdgeData.q2, finalTargetEdgeData.r2);
                     if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < scaledHighlightRadius) { 
                        foundPathUnderCursor = moveData.path; 
                        break; 
                    }
                 }
                if (foundPathUnderCursor) {
                    const newPotentialPathKey = foundPathUnderCursor.join('-');
                    const currentPotentialPathKey = gameState.potentialDebugPathToDraw ? gameState.potentialDebugPathToDraw.join('-') : null;

                    if (newPotentialPathKey !== currentPotentialPathKey) {
                        gameState.potentialDebugPathToDraw = foundPathUnderCursor;
                        gameState.debugPathHoverStartTime = Date.now();
                        if (gameState.debugPathToDraw && gameState.debugPathToDraw.join('-') !== newPotentialPathKey) {
                            clearDebugPath(); 
                        }
                    }
                } else { 
                    if (gameState.potentialDebugPathToDraw) {
                       clearDebugPath(); 
                    }
                }
            }
        }

        function handleInteractionEnd(x, y, isTouchEvent = false) {
            if (gameState.mapMakerMode) {
                gameState.isDragging = false;
                gameState.mapMakerLastPaintedHexKey = null;
                return;
            }
            if (!gameState.isDragging || !gameState.draggingUnit) return;
            
            dragOperationJustConcluded = true;
            let droppedOnValidTarget = false;
            
            if (gameState.draggedDistance >= DRAGGED_DISTANCE_THRESHOLD) {
                // --- FIX: Scale the drop radius ---
                const dropRadius = (isTouchEvent ? HIGHLIGHT_CLICK_RADIUS * 1.2 : HIGHLIGHT_CLICK_RADIUS) * gameState.renderScale;
                
                for (const [targetEdgeKey, moveData] of gameState.currentReachableMoves) {
                    const finalTargetEdgeData = gameState.edges.get(targetEdgeKey); if (!finalTargetEdgeData) continue;
                    const mid = getEdgeMidpoint(finalTargetEdgeData.q1, finalTargetEdgeData.r1, finalTargetEdgeData.q2, finalTargetEdgeData.r2);
                    if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < dropRadius) {
                        const costToMove = moveData.cost; 
                        if (finalTargetEdgeData.units.some(u => u.player !== gameState.draggingUnit.player)) { showInstruction("Cannot move to enemy edge."); break; }
                        if (finalTargetEdgeData.units.filter(u => u.player === gameState.draggingUnit.player).length >= 2) { showInstruction("Target edge full."); break; }
                        if (costToMove <= gameState.draggingUnit.currentMove && costToMove !== Infinity) { 
                            handleMoveAction(gameState.draggingUnit, targetEdgeKey, costToMove); 
                            droppedOnValidTarget = true; 
                        }
                        else { showInstruction(`Cannot move. Cost: ${costToMove.toFixed(1)}, Have: ${gameState.draggingUnit.currentMove.toFixed(1)}`); }
                        break;
                    }
                }
            }
            
            if (!droppedOnValidTarget) {
                 const unit = gameState.draggingUnit;
                if (unit) {
                    if (gameState.dragUnitOriginalType === 'edge' && gameState.dragUnitOriginalPosition) {
                         unit.position = gameState.dragUnitOriginalPosition; unit.positionType = 'edge';
                     }
                     if (gameState.draggedDistance >= DRAGGED_DISTANCE_THRESHOLD) showInstruction("Invalid drop. Unit returned.", 2000);
                     gameState.selectedUnit = unit;
                     gameState.currentActionState = ACTION_STATES.UNIT_SELECTED; 
                      if(unit && !unit.isFortified && unit.hp > 0 && !unit.hasPerformedMajorAction && unit.currentMove >=1) gameState.currentReachableMoves = getPossibleMoves(unit);
                      else gameState.currentReachableMoves.clear();
                }
            }
            
            gameState.isDragging = false; 
            gameState.dragStartTime = null;
            gameState.draggingUnit = null; 
            gameState.dragUnitOriginalPosition = null; 
            gameState.dragUnitOriginalType = null;
            clearDebugPath(); 
            canvas.style.cursor = gameState.hoveredUnitId ? 'pointer' : 'default'; 
            updateSelectedUnitInfoPanel(); 
        }

        function handleInteractionCancel() {
            dragOperationJustConcluded = true;
            clearDebugPath();
            if (gameState.isDragging && gameState.draggingUnit) {
                 const unit = gameState.draggingUnit;
                 if (gameState.dragUnitOriginalType === 'edge' && gameState.dragUnitOriginalPosition) {
                     unit.position = gameState.dragUnitOriginalPosition; unit.positionType = 'edge';
                 }
                gameState.isDragging = false; 
                gameState.dragStartTime = null;
                gameState.draggingUnit = null; 
                gameState.dragUnitOriginalPosition = null; 
                gameState.dragUnitOriginalType = null;
                showInstruction("Drag cancelled. Unit returned.", 2500);
                gameState.selectedUnit = unit; 
                gameState.currentActionState = ACTION_STATES.UNIT_SELECTED;
                if(unit && !unit.isFortified && unit.hp > 0 && !unit.hasPerformedMajorAction && unit.currentMove >=1) gameState.currentReachableMoves = getPossibleMoves(unit);
                else gameState.currentReachableMoves.clear();
                updateSelectedUnitInfoPanel();
            }
        }    

        function handleTapLogic(x, y) {
            if (gameState.mapMakerMode) return; 

            if (gameState.mustUnfortify) {
                // allow clicking an action target
                if (!handleActionTargetSelectionClick(x, y)) {
                    showInstruction("You MUST select an edge to retreat to!", 2000);
                }
                return; // Block all other canvas interactions
            }

            // --- DEBUG: Flag Selection ---
            if (gameSettings.debugModeEnabled) {
                let clickedFlagPlayer = null;
                const checkFlagClick = (player) => {
                    let flagX, flagY;
                    const baseData = gameState.baseCampPositions[`player${player}`];
                    
                    if (gameState.gridRadius === 4 && Array.isArray(baseData)) {
                        const pos = calculateBaseCentroid(baseData);
                        if (pos) { flagX = pos.x; flagY = pos.y; }
                    } else if (gameState.gridRadius !== 4 && typeof baseData === 'string') {
                        const edge = gameState.edges.get(baseData);
                        if (edge) {
                            const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                            flagX = mid.x; flagY = mid.y;
                        }
                    }

                    if (flagX !== undefined) {
                        const dist = Math.sqrt((x - flagX)**2 + (y - flagY)**2);
                        if (dist < (HEX_SIZE * gameState.renderScale * 0.5)) {
                            return true;
                        }
                    }
                    return false;
                };

                if (checkFlagClick(1)) clickedFlagPlayer = 1;
                else if (checkFlagClick(2)) clickedFlagPlayer = 2;

                if (clickedFlagPlayer) {
                    clearSelectionAndDebugState(); // Clear previous selection first
                    gameState.debugSelectedBasePlayer = clickedFlagPlayer;
                    showInstruction(`Debug: P${clickedFlagPlayer} Base Selected`, 1500);
                    // updateSelectedUnitInfoPanel is called in clearSelectionAndDebugState, 
                    // but we might want to refresh specific debug info here if we add a panel for it later.
                    return;
                }
            }
            // -----------------------------

            if (handleActionTargetSelectionClick(x, y)) { 
                // Click was handled by an action (e.g. Attack/Fortify confirmation)
                // Do not clear selection.
                return;
            } 
            
            if (handleUnitSelectionClick(x, y)) { 
                // A unit was selected or clicked.
                // handleUnitSelectionClick handles its own state setting,
                // but we ensure debug base selection is gone.
                gameState.debugSelectedBasePlayer = null; 
                return;
            }
            
            if (handleMoveClick(x, y)) { 
                // A move command was issued.
                return; 
            } 
            
            // If we reached here, the click was on empty space or invalid territory.
            if (gameState.selectedUnit || gameState.debugSelectedBasePlayer) {
                 clearSelectionAndDebugState();
            }
        }




        function handleMoveClick(x, y) {
    const { selectedUnit } = gameState;
    if (!selectedUnit || selectedUnit.isFortified || selectedUnit.currentMove < 1) {
        return false;
    }
    if (gameState.gameMode === 'singleplayer' && selectedUnit.player !== gameState.playerSide) {
        return false;
    }
    if (selectedUnit.hasPerformedMajorAction && !selectedUnit.type.canMoveAfterAttack) {
        return false;
    }
    
    // --- FIX: Scale the click radius ---
    const scaledClickRadius = HIGHLIGHT_CLICK_RADIUS * gameState.renderScale;

    for (const [targetEdgeKey, moveData] of gameState.currentReachableMoves) {
        const finalTargetEdgeData = gameState.edges.get(targetEdgeKey); if (!finalTargetEdgeData) continue;
        const mid = getEdgeMidpoint(finalTargetEdgeData.q1, finalTargetEdgeData.r1, finalTargetEdgeData.q2, finalTargetEdgeData.r2);
        
        if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < scaledClickRadius) {
            const costToMove = moveData.cost;
            if (finalTargetEdgeData.units.some(u => u.player !== selectedUnit.player)) { showInstruction("Cannot move to enemy edge."); return true; }
            if (finalTargetEdgeData.units.filter(u => u.player === selectedUnit.player).length >= 2) { showInstruction("Target edge full."); return true; }
            if (costToMove <= selectedUnit.currentMove && costToMove !== Infinity) handleMoveAction(selectedUnit, targetEdgeKey, costToMove);
            else showInstruction(`Cannot move. Cost: ${costToMove.toFixed(1)}, Have: ${selectedUnit.currentMove.toFixed(1)}`);
            return true;
        }
    }
     return false;
}

function handleActionTargetSelectionClick(x, y) {
    const { selectedUnit, currentActionState } = gameState;
    if (!selectedUnit) return false;

    let clickHandled = true;
    let clickedValidTarget = false;

    switch (currentActionState) {
        case ACTION_STATES.SELECTING_FORTIFY_TILE:
            const clickedAxial = pixelToAxial(x, y);
            const clickedTileKey = getTileKey(clickedAxial.q, clickedAxial.r);
            if (gameState.validFortifyTargetTileKeys.includes(clickedTileKey)) {
                completeFortify(selectedUnit, clickedTileKey);
                clickedValidTarget = true;
            }
            break;

            case ACTION_STATES.SELECTING_UNFORTIFY_EDGE:
            // --- FIX: Scale radius for unfortify selection ---
            const scaledUnfortifyRadius = HIGHLIGHT_CLICK_RADIUS * gameState.renderScale;
            
            for (const edgeKey of gameState.validUnfortifyTargetEdgeKeys) {
                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    if (Math.sqrt((x - mid.x)**2 + (y - mid.y)**2) < scaledUnfortifyRadius) {
                        completeUnfortify(selectedUnit, edgeKey);
                        clickedValidTarget = true;
                        break;
                    }
                }
            }
            break;

        case ACTION_STATES.SELECTING_BRIDGE_EDGE:
            for (const edgeKey of gameState.validBridgeTargetEdgeKeys) {
                const edge = gameState.edges.get(edgeKey);
                if (edge) {
                    const p = { x, y };
                    const p1_center = axialToPixel(edge.q1, edge.r1);
                    const p2_center = axialToPixel(edge.q2, edge.r2);

                    // --- Define the line segment endpoints for the edge ---
                    const edgeMidX = (p1_center.x + p2_center.x) / 2;
                    const edgeMidY = (p1_center.y + p2_center.y) / 2;
                    let perp_dx = -(p2_center.y - p1_center.y);
                    let perp_dy = p2_center.x - p1_center.x;
                    const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                    if (len_perp_vec > 0) {
                        const scale = HEX_SIZE / 2;
                        perp_dx = (perp_dx / len_perp_vec) * scale;
                        perp_dy = (perp_dy / len_perp_vec) * scale;
                        const v = { x: edgeMidX + perp_dx, y: edgeMidY + perp_dy };
                        const w = { x: edgeMidX - perp_dx, y: edgeMidY - perp_dy };

                        // --- Check distance from click to the line segment ---
                        if (distToSegmentSquared(p, v, w) < (BRIDGE_CLICK_TOLERANCE * 2)**2) {
                            completeBuildBridge(edgeKey);
                            clickedValidTarget = true;
                            break;
                        }
                    }
                }
            }
            break;
        
        case ACTION_STATES.SELECTING_ATTACK_TARGET:
            const currentAttackTargets = selectedUnit.type.attackType === 'melee' 
                ? gameState.validMeleeAttackTargets 
                : gameState.validArcherAttackTargets;
            const attackType = selectedUnit.type.attackType === 'melee' ? 'Melee' : 'Archer';

            for (const targetInfo of currentAttackTargets) {
                if (targetInfo.isBridgeTarget && targetInfo.edgeKey) {
                    const edge = gameState.edges.get(targetInfo.edgeKey);
                    if (edge && edge.bridge) {
                        const p = { x, y };
                        const p1_center = axialToPixel(edge.q1, edge.r1); const p2_center = axialToPixel(edge.q2, edge.r2);
                        const edgeMidX = (p1_center.x + p2_center.x) / 2; const edgeMidY = (p1_center.y + p2_center.y) / 2;
                        let perp_dx = -(p2_center.y - p1_center.y); let perp_dy = p2_center.x - p1_center.x;
                        const len_perp_vec = Math.sqrt(perp_dx * perp_dx + perp_dy * perp_dy);

                        if (len_perp_vec > 0) {
                            const scale = HEX_SIZE / 2;
                            perp_dx = (perp_dx / len_perp_vec) * scale;
                            perp_dy = (perp_dy / len_perp_vec) * scale;
                            const v = { x: edgeMidX + perp_dx, y: edgeMidY + perp_dy };
                            const w = { x: edgeMidX - perp_dx, y: edgeMidY - perp_dy };

                            if (distToSegmentSquared(p, v, w) < (BRIDGE_CLICK_TOLERANCE * 2)**2) {
                                completeAttack(selectedUnit, targetInfo, attackType);
                                clickedValidTarget = true;
                                break;
                            }
                        }
                    }
                } else if (targetInfo.unit) {
                    const targetUnit = targetInfo.unit; let unitX_val, unitY_val, clickRadius = UNIT_CLICK_RADIUS;
                    if (targetUnit.isFortified && targetUnit.positionType === 'center' && targetInfo.tileKeyForTarget) {
                        const tile = gameState.tiles.get(targetInfo.tileKeyForTarget);
                        if (tile) { const centerPixel = axialToPixel(tile.q, tile.r); unitX_val = centerPixel.x; unitY_val = centerPixel.y; clickRadius = FORTIFIED_UNIT_DRAW_SIZE * 1.5; }
                        else continue;
                    } else if (targetInfo.edgeKey) {
                        const edgeOfTarget = gameState.edges.get(targetInfo.edgeKey); if (!edgeOfTarget) continue;
                        const mid = getEdgeMidpoint(edgeOfTarget.q1, edgeOfTarget.r1, edgeOfTarget.q2, edgeOfTarget.r2); unitX_val = mid.x; unitY_val = mid.y;
                        const edgeUnitsOnly = edgeOfTarget.units.filter(u => u.positionType === 'edge');
                        const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === targetUnit.id);
                        if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                            const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                            const p1 = axialToPixel(edgeOfTarget.q1, edgeOfTarget.r1); const p2 = axialToPixel(edgeOfTarget.q2, edgeOfTarget.r2);
                            let dx_val = p2.x - p1.x, dy_val = p2.y - p1.y; const len = Math.sqrt(dx_val*dx_val + dy_val*dy_val) || 1;
                            let perpX = -dy_val / len, perpY = dx_val / len;
                            unitX_val += perpX * UNIT_ON_EDGE_OFFSET * offsetSign * (0.5); unitY_val += perpY * UNIT_ON_EDGE_OFFSET * offsetSign * (0.5);
                        }
                    } else continue;
                    if (Math.sqrt((x - unitX_val)**2 + (y - unitY_val)**2) < clickRadius) { 
                        completeAttack(selectedUnit, targetInfo, attackType); 
                        clickedValidTarget = true; 
                        break; 
                    }
                }
            }
            if (clickedValidTarget) break; 
            break; 

        default:
            clickHandled = false;
            break;
    }

    if (clickHandled && !clickedValidTarget) {
        showInstruction("Invalid selection. Click a highlighted target or Cancel.", 2000);
    }
    return clickHandled;
}

function handleUnitSelectionClick(x, y) {
            let clickedOnUnit = null;
            for (const unit of gameState.units) {
                if (unit.isFortified && unit.positionType === 'center') {
                    const tile = gameState.tiles.get(unit.position);
                    if (tile) {
                        const {x: tileCenterX, y: tileCenterY} = axialToPixel(tile.q, tile.r);
                        if (Math.sqrt((x - tileCenterX)**2 + (y - tileCenterY)**2) < (FORTIFIED_UNIT_DRAW_SIZE * gameState.renderScale) * 1.5) {
                             if (unit.player === gameState.currentPlayer) {
                                if (gameState.gameMode === 'singleplayer' && unit.player !== gameState.playerSide) {
                                    showInstruction(`That is an AI unit.`);
                                    return true;
                                }
                                clickedOnUnit = unit;
                                break;
                            } else { showInstruction(`Enemy ${unit.type.name} fortified.`); return true; }
                        }
                    }
                }
            }
            if (!clickedOnUnit) {
                 const unitEdgePairs = [];
                 gameState.edges.forEach((edge, edgeKey) => { edge.units.forEach(u => { if (u.positionType === 'edge') unitEdgePairs.push({ unit: u, edge: edge }); }); });
                for (let i = unitEdgePairs.length - 1; i >= 0; i--) {
                    const {unit, edge} = unitEdgePairs[i]; const mid = getEdgeMidpoint(edge.q1, edge.r1, edge.q2, edge.r2);
                    let unitX = mid.x, unitY = mid.y;
                    const edgeUnitsOnly = edge.units.filter(u => u.positionType === 'edge');
                    const unitIndexOnEdge = edgeUnitsOnly.findIndex(u => u.id === unit.id);
                    if (edgeUnitsOnly.length > 1 && unitIndexOnEdge !== -1) {
                        const offsetSign = (unitIndexOnEdge % 2 === 0) ? -1 : 1;
                        const p1 = axialToPixel(edge.q1, edge.r1); const p2 = axialToPixel(edge.q2, edge.r2);
                        let dx_val = p2.x - p1.x, dy_val = p2.y - p1.y; const len = Math.sqrt(dx_val*dx_val + dy_val*dy_val) || 1;
                        let perpX = -dy_val / len, perpY = dx_val / len;
                        unitX += perpX * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5); unitY += perpY * (UNIT_ON_EDGE_OFFSET * gameState.renderScale) * offsetSign * (0.5);
                    }
                    if (Math.sqrt((x - unitX)**2 + (y - unitY)**2) < (UNIT_CLICK_RADIUS * gameState.renderScale)) {
                       if (unit.player === gameState.currentPlayer) {
                            if (gameState.gameMode === 'singleplayer' && unit.player !== gameState.playerSide) {
                                showInstruction(`That is an AI unit.`);
                                return true;
                            }
                            clickedOnUnit = unit;
                            break;
                        } else { showInstruction(`Enemy ${unit.type.name} on edge.`); return true; }
                    }
                }
            }

            if (clickedOnUnit) {
                if (gameState.selectedUnit && gameState.selectedUnit.id === clickedOnUnit.id) {
                    gameState.selectedUnit = null; 
                    gameState.currentReachableMoves.clear();
                    resetActionSelectionStates(); 
                } else {
                    gameState.selectedUnit = clickedOnUnit;
                    console.log(`[Selection] Unit Selected: ${gameState.selectedUnit.id}`);
                    resetActionSelectionStates();
                    const unit = gameState.selectedUnit;
                    const canPhysicallyMove = !unit.isFortified && unit.positionType === 'edge' && unit.currentMove >= 1;
                    const isAllowedToMove = !unit.hasPerformedMajorAction || unit.type.canMoveAfterAttack;
                    if (canPhysicallyMove && isAllowedToMove) {
                        gameState.currentReachableMoves = getPossibleMoves(unit);
                    } else {
                        gameState.currentReachableMoves.clear();
                    }
                }
                updateSelectedUnitInfoPanel(); 
                return true;
            }
            return false;
        }
    
        function handleFortifyActionLogic() {
            const { selectedUnit } = gameState;
            if (!selectedUnit || selectedUnit.hasPerformedMajorAction || selectedUnit.isFortified || selectedUnit.positionType !== 'edge') { 
                showInstruction("Cannot fortify.", 2000); 
                return; 
            }
            
            const edgeCoords = parseEdgeKey(selectedUnit.position);
            if (!edgeCoords || edgeCoords.length !== 2 || isNaN(edgeCoords[0].q)) { 
                showInstruction("Unit not on valid edge.", 2000); 
                return; 
            }

            const enemyPlayer = selectedUnit.player === 1 ? 2 : 1;
            const enemyBaseData = gameState.baseCampPositions[`player${enemyPlayer}`];
            const enemyBaseTileKeys = new Set();
            
            if (Array.isArray(enemyBaseData)) {
                enemyBaseData.forEach(k => enemyBaseTileKeys.add(k));
            } else if (typeof enemyBaseData === 'string') {
                const [h1, h2] = parseEdgeKey(enemyBaseData);
                if (!isNaN(h1.q)) enemyBaseTileKeys.add(getTileKey(h1.q, h1.r));
                if (!isNaN(h2.q)) enemyBaseTileKeys.add(getTileKey(h2.q, h2.r));
            }

            const myFlagTileKey = getFlagTileKey(selectedUnit.player);
            const enemyFlagTileKey = getFlagTileKey(enemyPlayer);

            const tile1Key = getTileKey(edgeCoords[0].q, edgeCoords[0].r); 
            const tile2Key = getTileKey(edgeCoords[1].q, edgeCoords[1].r);
            const tile1 = gameState.tiles.get(tile1Key); 
            const tile2 = gameState.tiles.get(tile2Key);
            
            gameState.validFortifyTargetTileKeys = [];

            if (tile1 && tile1.type.canFortify && tile1.fortifiedByPlayer === null && (tile1Key !== myFlagTileKey || selectedUnit.isCarryingFlag) && (!enemyBaseTileKeys.has(tile1Key) || tile1Key === enemyFlagTileKey)) {
                gameState.validFortifyTargetTileKeys.push(tile1Key);
            }
            if (tile2 && tile2.type.canFortify && tile2.fortifiedByPlayer === null && (tile2Key !== myFlagTileKey || selectedUnit.isCarryingFlag) && (!enemyBaseTileKeys.has(tile2Key) || tile2Key === enemyFlagTileKey)) {
                gameState.validFortifyTargetTileKeys.push(tile2Key);
            }

            if (gameState.validFortifyTargetTileKeys.length === 0) { 
                showInstruction("No valid adjacent tile to fortify.", 2000); 
                return; 
            }
            
            if (gameState.validFortifyTargetTileKeys.length === 1) {
                completeFortify(selectedUnit, gameState.validFortifyTargetTileKeys[0]);
            } else { 
                gameState.currentActionState = ACTION_STATES.SELECTING_FORTIFY_TILE;
                showInstruction("Select tile to fortify.", 3000); 
            }
            updateSelectedUnitInfoPanel();
        }
        
        function handleUnfortifyActionLogic() {
            const { selectedUnit } = gameState;
            if (!selectedUnit || !selectedUnit.isFortified || selectedUnit.hasPerformedMajorAction) { showInstruction("Cannot unfortify.", 2000); return; }
            gameState.validUnfortifyTargetEdgeKeys = getPotentialUnfortifyTargets(selectedUnit);
            if (gameState.validUnfortifyTargetEdgeKeys.length === 0) { showInstruction("No valid edge to unfortify to.", 2500); return; }
            
            gameState.currentActionState = ACTION_STATES.SELECTING_UNFORTIFY_EDGE;
            showInstruction("Select edge to move to.", 3000); 
            updateSelectedUnitInfoPanel();
        }

        function handleFortifyUnfortifyButtonClick() {
            if (gameState.gameMode === 'singleplayer' && gameState.selectedUnit && gameState.selectedUnit.player !== gameState.playerSide) return;
            if (gameState.isDragging) return; 
            const { selectedUnit } = gameState; 
            if (!selectedUnit) return;

            if (gameState.currentActionState === ACTION_STATES.SELECTING_FORTIFY_TILE || gameState.currentActionState === ACTION_STATES.SELECTING_UNFORTIFY_EDGE) {
                const message = gameState.currentActionState === ACTION_STATES.SELECTING_FORTIFY_TILE ? "Fortify cancelled." : "Unfortify cancelled.";
                resetActionSelectionStates();
                showInstruction(message, 1500);
            } else if (selectedUnit.isFortified) {
                handleUnfortifyActionLogic();
            } else {
                handleFortifyActionLogic();
            }
            updateSelectedUnitInfoPanel();
        }

        function handleBuildBridgeAction() {
            if (gameState.gameMode === 'singleplayer' && gameState.selectedUnit && gameState.selectedUnit.player !== gameState.playerSide) return;
            if (gameState.isDragging) return; 
            const { selectedUnit } = gameState;

            if (gameState.currentActionState === ACTION_STATES.SELECTING_BRIDGE_EDGE) {
                resetActionSelectionStates();
                showInstruction("Bridge selection cancelled.", 1500);
                updateSelectedUnitInfoPanel(); 
                return;
            }
            if (!selectedUnit || !selectedUnit.type.canBuildBridge || selectedUnit.isFortified || selectedUnit.hasPerformedMajorAction) {
                showInstruction(selectedUnit && selectedUnit.hasPerformedMajorAction ? "Unit acted." : "Cannot build bridge.", 2000); 
                return;
            }
            gameState.validBridgeTargetEdgeKeys = getPotentialBridgeTargets(selectedUnit);
            if (gameState.validBridgeTargetEdgeKeys.length === 0) {
                showInstruction("No valid water edge for bridge.", 2000);
            } else { 
                gameState.currentActionState = ACTION_STATES.SELECTING_BRIDGE_EDGE;
                showInstruction("Select water edge for bridge.", 3000); 
            }
            updateSelectedUnitInfoPanel();
        }

        function handleAttackAction() {
            if (gameState.gameMode === 'singleplayer' && gameState.selectedUnit && gameState.selectedUnit.player !== gameState.playerSide) return;
            if (gameState.isDragging) return; 
            const { selectedUnit } = gameState;
            
            if (gameState.currentActionState === ACTION_STATES.SELECTING_ATTACK_TARGET) {
                 resetActionSelectionStates(); 
                 showInstruction("Attack cancelled.", 1500); 
                 updateSelectedUnitInfoPanel(); 
                 return;
            }

             if (!selectedUnit || selectedUnit.currentMove < ATTACK_COST || selectedUnit.hasPerformedMajorAction) {
                showInstruction(selectedUnit && selectedUnit.hasPerformedMajorAction ? "Unit acted." : "Cannot attack.", 2500); return;
            }

            gameState.debugAttackRangeHighlights = []; 

            if (selectedUnit.type.attackType === 'melee') {
                gameState.validMeleeAttackTargets = getValidMeleeAttackTargets(selectedUnit);
                gameState.debugAttackRangeHighlights = gameState.validMeleeAttackTargets
                    .filter(t => t.edgeKey && !t.isBridgeTarget)
                    .map(t => t.edgeKey);

                if (gameState.validMeleeAttackTargets.length === 0) {
                    showInstruction("No valid melee targets.", 2000);
                } else {
                    gameState.currentActionState = ACTION_STATES.SELECTING_ATTACK_TARGET;
                    showInstruction("Select target to attack.", 3000);
                }
            } else if (selectedUnit.type.attackType === 'ranged') {
                gameState.validArcherAttackTargets = getValidArcherAttackTargets(selectedUnit);
                gameState.debugAttackRangeHighlights = gameState.validArcherAttackTargets
                    .filter(t => t.edgeKey && !t.isBridgeTarget)
                    .map(t => t.edgeKey);

                if (gameState.validArcherAttackTargets.length === 0) {
                    showInstruction("No valid archer targets.", 2000);
                } else {
                    gameState.currentActionState = ACTION_STATES.SELECTING_ATTACK_TARGET;
                    showInstruction("Select target to attack.", 3000);
                }
            }
            updateSelectedUnitInfoPanel();
        }

        function initializeGrid(tileLayoutMap = null, customUnits = null, baseCampData = null) {
    // 1. Setup Base Camp Defaults if needed
    if (baseCampData) {
        gameState.baseCampPositions = JSON.parse(JSON.stringify(baseCampData));
    } else if (!tileLayoutMap && !customUnits) {
        gameState.baseCampPositions = JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS));
    } else if (tileLayoutMap === DEFAULT_MAP_LAYOUT_RADIUS_3) {
        // --- FIX: Force base camps to reset if we switch from a custom map to Singleplayer ---
        gameState.baseCampPositions = JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS));
    }

    // 2. Setup Canvas & UI
    canvas.width = CANVAS_WIDTH_NORMAL;
    canvas.height = CANVAS_HEIGHT_NORMAL;
    document.querySelectorAll('.ui-panel').forEach(panel => {
        panel.style.minHeight = canvas.height + 'px';
    });

    // 3. Reset Game State
    gameState.tiles.clear();
    gameState.edges.clear();
    gameState.units = [];
    gameState.gameOver = false;
    ui.victoryMessage.style.display = 'none';
    ui.endTurnButton.disabled = false;
    gameState.selectedUnit = null;
    gameState.hoveredUnitId = null;
    gameState.currentPlayer = 1;
    gameState.globalTurnNumber = 1;
    updateGlobalTurnDisplay();
    gameState.isDragging = false;
    gameState.draggingUnit = null;
    gameState.currentReachableMoves.clear();
    resetActionSelectionStates();
    gameState.actionLog = [];
    gameState.respawnQueue = { player1: [], player2: [] };
    updateActionLogDisplay();
    updateRespawnQueueDisplay();

    // 4. Initialize Unit Counts
    gameState.unitCounts = {
        player1: { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 },
        player2: { Melee: 0, Archer: 0, Pikeman: 0, Horseman: 0 }
    };

    // 5. Initialize Mode Specifics
    gameState.arcadeTurnTimer = ARCADE_TURN_TIME_SEC;
    gameState.swapState = 'none';
    gameState.unitToSwap = null;
    gameState.arcadeTotalTurns = 0;
    gameState.arcadeGameStartedInteraction = false; 

    ui.endTurnButton.classList.remove('arcade-timer-active');
    ui.endTurnButton.style.background = '';
    ui.endTurnButton.textContent = "End Turn";

    if (gameState.gameMode === 'arcade') {
        gameState.supplyPoints = { player1: 0, player2: 0 };
        document.getElementById('supplyPointsContainer').style.display = 'block';
        ui.endTurnButton.classList.add('arcade-timer-active');
        gameState.flags = null; 
    } else {
        gameState.supplyPoints = { player1: 10, player2: 10 };
        document.getElementById('supplyPointsContainer').style.display = 'block';
    }

    // 6. Load Tiles
    if (tileLayoutMap) {
        const standardizedMap = (tileLayoutMap instanceof Map) ? tileLayoutMap : new Map(tileLayoutMap);
        const firstValue = standardizedMap.values().next().value;
        const isComplexObject = firstValue && (firstValue.type !== undefined) && (firstValue.type.name !== undefined);

        standardizedMap.forEach((value, key) => {
            const keyStr = String(key); 
            const [q, r] = keyStr.split(',').map(Number);
            
            // Filter out messy Volcano Island configs so the renderer doesn't get confused
            let finalType = value;
            if (value && value.name === 'Plains' && value.isBaseCampTile !== undefined) {
                finalType = TILE_TYPES.PLAINS;
            }

            if (isComplexObject) {
                if (finalType.type && finalType.type.name) {
                    const typeName = finalType.type.name.toUpperCase();
                    const rehydratedType = TILE_TYPES[typeName] || TILE_TYPES.PLAINS;
                    gameState.tiles.set(keyStr, { q, r, type: rehydratedType, fortifiedByPlayer: null, isBaseCampTile: false });
                }
            } else {
                gameState.tiles.set(keyStr, { q, r, type: finalType, fortifiedByPlayer: null, isBaseCampTile: false });
            }
        });
    } else {
        DEFAULT_MAP_LAYOUT_RADIUS_3.forEach((type, key) => {
            const [q, r] = key.split(',').map(Number);
            gameState.tiles.set(key, { q, r, type, fortifiedByPlayer: null, isBaseCampTile: false });
        });
    }

    // BASE CAMP FLAGGING
    if (gameState.gridRadius !== 2) { 
        const p1Tiles = getBaseCampTiles(gameState.baseCampPositions?.player1);
        const p2Tiles = getBaseCampTiles(gameState.baseCampPositions?.player2);
        
        [...p1Tiles, ...p2Tiles].forEach(key => {
            const tile = gameState.tiles.get(key);
            if (tile) {
                tile.type = TILE_TYPES.PLAINS; 
                tile.isBaseCampTile = true;    
            }
        });
    }

    // 7. Generate Edges
    gameState.tiles.forEach(tile => {
        getNeighbors(tile.q, tile.r).forEach(n_coord => {
            if (gameState.tiles.has(getTileKey(n_coord.q, n_coord.r))) {
                const edgeKey = getEdgeKey(tile.q, tile.r, n_coord.q, n_coord.r);
                if (!gameState.edges.has(edgeKey)) {
                    gameState.edges.set(edgeKey, {
                        q1: tile.q, r1: tile.r, q2: n_coord.q, r2: n_coord.r,
                        get units() { 
                            return gameState.units.filter(u => u.positionType === 'edge' && u.position === edgeKey && (!gameState.draggingUnit || u.id !== gameState.draggingUnit.id)); 
                        },
                        bridge: false, bridgeHp: null, isPathway: true
                    });
                }
            }
        });
    });

    // 8. Place Units
    if (customUnits) {
        customUnits.forEach(unitInfo => {
            if (!unitInfo || !unitInfo.typeName) return;
            const typeName = unitInfo.typeName.toUpperCase();
            const type = UNIT_TYPES[typeName]; 
            
            if (type && gameState.edges.has(unitInfo.position)) {
                const newUnit = createUnit(unitInfo.player, type, unitInfo.position);
                gameState.units.push(newUnit);
            }
        });
    } else if (tileLayoutMap && tileLayoutMap !== DEFAULT_MAP_LAYOUT_RADIUS_3) {
        const limit = getMaxUnitsForCurrentMap();
        placeUnitsOnNewGeneratedMap(limit);
    } else {
        // Default Starting Units
        if (gameState.gameMode === 'arcade') {
            gameState.units.push(createUnit(1, 'MELEE', getEdgeKey(1, -2, 0, -2)));
            gameState.units.push(createUnit(1, 'ARCHER', getEdgeKey(-2, 0, -1, -1)));
            gameState.units.push(createUnit(2, 'MELEE', getEdgeKey(-1, 2, 0, 2)));
            gameState.units.push(createUnit(2, 'ARCHER', getEdgeKey(1, 1, 2, 0)));
        } else {
            gameState.units.push(createUnit(1, 'MELEE', getEdgeKey(1, -2, 0, -2)));
            gameState.units.push(createUnit(1, 'ARCHER', getEdgeKey(-2, 0, -1, -1)));
            gameState.units.push(createUnit(1, 'PIKEMAN', getEdgeKey(-1, -1, 0, -2)));
            gameState.units.push(createUnit(1, 'HORSEMAN', getEdgeKey(-2, 0, -2, 1)));
            
            gameState.units.push(createUnit(2, 'MELEE', getEdgeKey(-1, 2, 0, 2)));
            gameState.units.push(createUnit(2, 'ARCHER', getEdgeKey(1, 1, 2, 0)));
            gameState.units.push(createUnit(2, 'PIKEMAN', getEdgeKey(0, 2, 1, 1)));
            gameState.units.push(createUnit(2, 'HORSEMAN', getEdgeKey(2, 0, 2, -1)));
        }
    }

    // 9. Initialize Unit State
    gameState.units.forEach(unit => {
        unit.currentMove = unit.stats.speed; 
        unit.hasPerformedMajorAction = false;
    });

    // 10. Initialize Flags
    if (gameState.gameMode !== 'arcade') {
        if (gameState.baseCampPositions.player1 && gameState.baseCampPositions.player2) {
            gameState.flags = {
                'p1_flag': { id: 'p1_flag', player: 1, homePosition: gameState.baseCampPositions.player1, status: 'at_base', carrierId: null },
                'p2_flag': { id: 'p2_flag', player: 2, homePosition: gameState.baseCampPositions.player2, status: 'at_base', carrierId: null }
            };
        }
    }

    updateTurnDisplay();
    updateSelectedUnitInfoPanel();
    checkVictoryCondition();
    updateSupplyPointsDisplay();
}

ui.endTurnButton.addEventListener('click', () => {
    if (gameState.mapMakerMode) {
        // --- Clear Map Functionality ---
        document.getElementById('customConfirmMessage').textContent = 'Are you sure you want to clear the entire map? This cannot be undone.';
        currentConfirmAction = clearMapForMaker;
        
        if (ui.customConfirmModal) {
            ui.customConfirmModal.style.display = 'flex';
            setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
        }
    } else {
        // --- Original End Turn Functionality ---
        const playerHasActed = gameState.playerActionTaken[`player${gameState.currentPlayer}`];

        if (playerHasActed || !gameSettings.passTurnConfirmationEnabled || gameState.gameOver) {
            proceedToEndTurn();
        } else {
            document.getElementById('customConfirmMessage').textContent = 'You have not performed any actions. Are you sure you want to end your turn?';
            currentConfirmAction = proceedToEndTurn;
            
            if (ui.customConfirmModal) {
                ui.customConfirmModal.style.display = 'flex';
                setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
            }
        }
    }
});

document.getElementById('customMapButton').addEventListener('click', () => {
    hideNewMapModal();

    if (gameState.mapMakerMode) {
        setTimeout(() => {
            exitMapMakerMode();
            resizeMapGrid(3); 
            initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3); 
            showInstruction("New Local Multiplayer game started.", 3000);
        }, 350); 
    } else {
        setTimeout(() => {
            enterMapMakerMode();
        }, 350);
    }
});

document.getElementById('selectMapButton').addEventListener('click', showSelectMapView);

document.getElementById('newMapButton').addEventListener('click', () => {
    const generateButton = document.getElementById('generateMapFromModalButton');
    const customMapButton = document.getElementById('customMapButton');

    if (gameState.mapMakerMode || gameState.gameMode === 'singleplayer') {
        generateButton.disabled = true;
    } else {
        generateButton.disabled = false;
    }

    if (gameState.mapMakerMode) {
        customMapButton.textContent = 'Return to Game';
        customMapButton.classList.add('return-to-game-button');
    } else {
        customMapButton.textContent = 'Custom Map';
        customMapButton.classList.remove('return-to-game-button');
    }
    showNewMapModal();
});

const newMapModalOverlay = document.getElementById('newMapModal');
newMapModalOverlay.addEventListener('click', (event) => {
    if (event.target === newMapModalOverlay) {
        hideNewMapModal();
    }
});

document.getElementById('newMapModalCloseButton').addEventListener('click', hideNewMapModal);

document.getElementById('generateMapFromModalButton').addEventListener('click', () => {
    hideNewMapModal();

    const confirmModal = document.getElementById('customConfirmModal');
    const confirmMessage = document.getElementById('customConfirmMessage');
    const okButton = document.getElementById('customConfirmOkButton');
    const cancelButton = document.getElementById('customConfirmCancelButton');

    confirmMessage.textContent = 'Are you sure you want to generate a new map? This will reset the current game.';

    const onConfirm = () => {
        handleGenerateNewMap();
        confirmModal.classList.remove('modal-visible');
        setTimeout(() => confirmModal.style.display = 'none', 300);
        okButton.removeEventListener('click', onConfirm);
        cancelButton.removeEventListener('click', onCancel);
    };

    const onCancel = () => {
        confirmModal.classList.remove('modal-visible');
        setTimeout(() => confirmModal.style.display = 'none', 300);
        setTimeout(() => { showNewMapModal(); }, 350);
        okButton.removeEventListener('click', onConfirm);
        cancelButton.removeEventListener('click', onCancel);
    };

    okButton.addEventListener('click', onConfirm, { once: true });
    cancelButton.addEventListener('click', onCancel, { once: true });

    if (confirmModal) {
        confirmModal.style.display = 'flex';
        setTimeout(() => confirmModal.classList.add('modal-visible'), 10);
    }
});

ui.customConfirmOkButton.addEventListener('click', () => {
    if (ui.customConfirmModal) {
        ui.customConfirmModal.classList.remove('modal-visible');
        setTimeout(() => ui.customConfirmModal.style.display = 'none', 300); 
    }
    if (typeof currentConfirmAction === 'function') {
        currentConfirmAction();
        currentConfirmAction = null; 
    }
    currentCancelAction = null; 
});

ui.customConfirmCancelButton.addEventListener('click', () => {
     if (ui.customConfirmModal) {
        ui.customConfirmModal.classList.remove('modal-visible');
        setTimeout(() => ui.customConfirmModal.style.display = 'none', 300); 
    }
    if (typeof currentCancelAction === 'function') {
        currentCancelAction();
        currentCancelAction = null;
    }
});

document.getElementById('saveGameButton').addEventListener('click', () => {
    if (gameState.mapMakerMode) {
        const mapData = createMapDataObject();
        const mapString = JSON.stringify(mapData, null, 2);
        const blob = new Blob([mapString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FortHex-Map-${Date.now()}.fhmap`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showInstruction("Map file saved!", 2500);
    } else {
        saveGameToFile();
    }
});

document.getElementById('loadGameButton').addEventListener('click', () => {
    fileLoadContext = gameState.mapMakerMode ? 'edit_map' : 'game_save';
    showLoadGameModal();
});

// PWA INSTALLATION LOGIC (Replaces old HTML download)
let deferredPrompt;

// 1. Catch the install prompt from the browser
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Prevent Chrome's default mini-infobar
    deferredPrompt = e; // Stash the event so we can trigger it later
    ui.downloadButton.style.display = 'flex'; // Show the button!
});

// 2. Bind the new install functionality to your Download Button
ui.downloadButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
        showInstruction("App cannot be installed right now.", 2000);
        return;
    }
    // Show the native browser install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        console.log('User installed FortHex');
        showInstruction('FortHex installed successfully!', 3000);
    }
    
    // We've used the prompt, throw it away and hide the button
    deferredPrompt = null;
    ui.downloadButton.style.display = 'none';
});

// 3. Hide button immediately if they install it successfully
window.addEventListener('appinstalled', () => {
    ui.downloadButton.style.display = 'none';
    deferredPrompt = null;
});

// 4. Register the Service Worker (Required for PWA to work)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('Service Worker Registration Failed:', err);
        });
    });
}

if (ui.tutorialButton) {
    ui.tutorialButton.addEventListener('click', () => {
        if (ui.tutorialModalOverlay) {
            ui.tutorialModalOverlay.style.display = 'flex'; 
            setTimeout(() => {
                ui.tutorialModalOverlay.classList.add('modal-visible');
            }, 10); 
        }
    });
}

function closeTutorialModal() {
    if (ui.tutorialModalOverlay) {
        ui.tutorialModalOverlay.classList.remove('modal-visible');
        setTimeout(() => {
            ui.tutorialModalOverlay.style.display = 'none';
        }, 300); 
    }
}

if (ui.tutorialCloseButton) {
    ui.tutorialCloseButton.addEventListener('click', closeTutorialModal);
}
if (ui.tutorialModalOverlay) {
    ui.tutorialModalOverlay.addEventListener('click', (event) => {
        if (event.target === ui.tutorialModalOverlay) { 
            closeTutorialModal();
        }
    });
}

if (ui.tutorialSectionHeaders) {
    ui.tutorialSectionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const arrow = header.querySelector('.tutorial-arrow');
            const isActive = header.classList.contains('active');

            ui.tutorialSectionHeaders.forEach(otherHeader => {
                if (otherHeader !== header) {
                    otherHeader.classList.remove('active');
                    otherHeader.nextElementSibling.classList.remove('open');
                    const otherArrow = otherHeader.querySelector('.tutorial-arrow');
                    if (otherArrow) otherArrow.innerHTML = '&#9658;'; 
                }
            });

            if (isActive) {
                header.classList.remove('active');
                content.classList.remove('open');
                if (arrow) arrow.innerHTML = '&#9658;'; 
            } else {
                header.classList.add('active');
                content.classList.add('open');
                if (arrow) arrow.innerHTML = '&#9660;'; 
            }
        });
    });
}

// CANVAS EVENT LISTENERS (CRITICAL)
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('mousedown', handleCanvasMouseDown);
canvas.addEventListener('mousemove', handleCanvasMouseMove);
canvas.addEventListener('mouseup', handleCanvasMouseUp);
window.addEventListener('mouseup', handleCanvasMouseUp);
canvas.addEventListener('mouseleave', handleCanvasMouseLeave);
canvas.addEventListener('touchstart', handleCanvasTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleCanvasTouchMove, { passive: false });
canvas.addEventListener('touchend', handleCanvasTouchEnd);
canvas.addEventListener('touchcancel', handleCanvasTouchCancel);
canvas.addEventListener('contextmenu', (event) => {
    if (gameState.mapMakerMode) {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const { x, y } = getRelativeCoordinates(event.clientX, event.clientY); 
        eraseAt(x, y);

    }
});

        window.onload = function () {

            function showCalibrationCard() {
                const dummyMaxUnit = {
                    player: 1,
                    typeId: 'MELEE',
                    type: { name: 'Melee' },
                    level: 3,
                    stats: { hp: 12, maxHp: 12, speed: 4, damage: 3, defense: 1 },
                    // Force 3 in all upgrades to fill every single pip slot visually
                    upgrades: { health: 3, speed: 3, damage: 3, defense: 3 }
                };

                const calibrationDiv = document.createElement('div');
                calibrationDiv.id = 'calibrationCardContainer';
                calibrationDiv.style.position = 'fixed';
                calibrationDiv.style.top = '20px';
                calibrationDiv.style.left = '20px';
                calibrationDiv.style.zIndex = '99999';
                calibrationDiv.style.backgroundColor = 'rgba(48, 64, 80, 0.95)';
                calibrationDiv.style.padding = '20px';
                calibrationDiv.style.borderRadius = '12px';
                calibrationDiv.style.border = '2px solid #FFC020';
                calibrationDiv.style.boxShadow = '0 10px 30px rgba(0,0,0,0.8)';
                calibrationDiv.style.cursor = 'move'; // Indicates it's draggable

                // Note: font-size is strictly locked to 10px here so 1em = exactly 10px for your math!
                calibrationDiv.innerHTML = `
                    <h3 style="color: #FFC020; margin-top: 0; margin-bottom: 15px; font-family: 'Geostar', cursive; text-align: center; pointer-events: none;">Card Calibrator</h3>
                    <div class="unit-card" style="font-size: 10px; margin: 0 auto; pointer-events: none;">
                        ${getUnitCardHTML(dummyMaxUnit, false)}
                    </div>
                `;

                document.body.appendChild(calibrationDiv);

                // Re-use your existing drag code to make it movable
                makeElementDraggable(calibrationDiv);
            }
            
            showCalibrationCard();

            // --- Initialize Debug Console System Immediately ---
            setupDebugConsoleSystem();

            document.getElementById('saveGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Game`;
            document.getElementById('loadGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Load Game`;
            document.getElementById('buildVersionDisplay').textContent = `FortHex Build ${BUILD_VERSION}`;
            
            loadSettings(); // Load settings from localStorage into the gameSettings object
            loadColorPreferences(); // Load color preferences


            // Sync UI checkboxes to match the loaded settings
            document.getElementById('settingAnimations').checked = gameSettings.animationsEnabled;
            document.getElementById('settingFancyVisuals').checked = gameSettings.fancyVisualsEnabled;
            document.getElementById('settingPassTurnConfirmation').checked = gameSettings.passTurnConfirmationEnabled;
            document.getElementById('settingTooltips').checked = gameSettings.tooltipsEnabled;

            // --- Connection Status Indicator ---
            const connectionIcon = document.getElementById('connectionStatusIcon');

            function updateConnectionStatus() {
                if (navigator.onLine) {
                    connectionIcon.classList.remove('status-offline');
                    connectionIcon.classList.add('status-online');
                } else {
                    connectionIcon.classList.remove('status-online');
                    connectionIcon.classList.add('status-offline');
                }
            }

            window.addEventListener('online', updateConnectionStatus);
            window.addEventListener('offline', updateConnectionStatus);

            // Set initial state on load
            updateConnectionStatus();

            // --- Main Menu System Listeners ---
            document.getElementById('gameIconLink').addEventListener('click', (event) => {
                event.preventDefault(); 
                document.getElementById('customConfirmMessage').textContent = 'Are you sure you want to restart? Any unsaved progress will be lost.';
                currentConfirmAction = () => {
                    location.reload();
                };
                if (ui.customConfirmModal) {
                    ui.customConfirmModal.style.display = 'flex';
                    setTimeout(() => ui.customConfirmModal.classList.add('modal-visible'), 10);
                }
            });

            document.getElementById('gameMenuTrigger').addEventListener('click', () => {
                clearSelectionAndDebugState(); // Clear state when opening menu
                const modal = document.getElementById('gameMenuModal');
                document.getElementById('mainMenuContent').style.display = 'block';
                document.getElementById('singleplayerMenuContent').style.display = 'none';
                document.getElementById('multiplayerMenuContent').style.display = 'none';
                modal.style.display = 'flex';
                setTimeout(() => modal.classList.add('modal-visible'), 10);
            });

            const mainMenuContent = document.getElementById('mainMenuContent');
            const spMenuContent = document.getElementById('singleplayerMenuContent');
            const mpMenuContent = document.getElementById('multiplayerMenuContent');

            document.getElementById('singleplayerButton').addEventListener('click', () => {
                mainMenuContent.style.display = 'none';
                spMenuContent.style.display = 'block';
            });

            document.getElementById('multiplayerButton').addEventListener('click', () => {
                mainMenuContent.style.display = 'none';
                mpMenuContent.style.display = 'block';
            });

            document.getElementById('playAsBlueButton').addEventListener('click', () => startSingleplayerGame(1));
            document.getElementById('playAsRedButton').addEventListener('click', () => startSingleplayerGame(2));

            document.getElementById('localMultiplayerButton').addEventListener('click', () => {
                // First, completely exit the map maker mode, which restores the UI.
                exitMapMakerMode(); 
                
                // Then, hide the menu modal.
                hideAllModals();
                
                gameState.gameMode = 'local';
                gameState.playerSide = null;

                // --- FIX: Reset Map Dimensions for Standard Play ---
                gameState.gridRadius = 3;
                gameState.renderScale = 1.0;
                gameState.renderOffset = { x: 0, y: 0 };
                // ---------------------------------------------------

                // Finally, initialize the new game grid.
                initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3); 
                
                // The initializeGrid function calls updateTurnDisplay, which will now
                // correctly set the canvas border for Player 1.
                showInstruction("New Local Multiplayer game started.", 3000);
            });

            document.getElementById('backToMainMenuButtonSP').addEventListener('click', () => {
                spMenuContent.style.display = 'none';
                mainMenuContent.style.display = 'block';
            });
            document.getElementById('backToMainMenuButtonMP').addEventListener('click', () => {
                mpMenuContent.style.display = 'none';
                mainMenuContent.style.display = 'block';
            });

            document.getElementById('gameMenuModal').addEventListener('click', (e) => {
                if (e.target.id === 'gameMenuModal') {
                    const modal = e.target;
                    modal.classList.remove('modal-visible');
                    setTimeout(() => modal.style.display = 'none', 300);
                }
            });

            document.getElementById('mainMenuCloseButton').addEventListener('click', () => {
                const modal = document.getElementById('gameMenuModal');
                if (modal) {
                    modal.classList.remove('modal-visible');
                    setTimeout(() => modal.style.display = 'none', 300);
                }
            });

            const settingsButton = document.getElementById('settingsButton');
            const settingsModal = document.getElementById('settingsModal');
            const settingsBackButton = document.getElementById('settingsBackButton');
            const gameMenuModal = document.getElementById('gameMenuModal');

            settingsButton.addEventListener('click', () => {
                clearSelectionAndDebugState();
                if (gameMenuModal) {
                    gameMenuModal.classList.remove('modal-visible');
                    setTimeout(() => { gameMenuModal.style.display = 'none'; }, 300);
                }
                if (settingsModal) {
                    setTimeout(() => {
                        settingsModal.style.display = 'flex';
                        setTimeout(() => settingsModal.classList.add('modal-visible'), 10);
                    }, 350);
                }
            });

            settingsBackButton.addEventListener('click', () => {
                if (settingsModal) {
                    settingsModal.classList.remove('modal-visible');
                    setTimeout(() => { settingsModal.style.display = 'none'; }, 300);
                }
                if (gameMenuModal) {
                     setTimeout(() => {
                        gameMenuModal.style.display = 'flex';
                        setTimeout(() => gameMenuModal.classList.add('modal-visible'), 10);
                    }, 350);
                }
            });

            settingsModal.addEventListener('click', (e) => {
                if (e.target.id === 'settingsModal') {
                    const modal = e.target;
                    modal.classList.remove('modal-visible');
                    setTimeout(() => modal.style.display = 'none', 300);
                }
            });

            // --- Changelog Modal Listeners ---
            const changelogButton = document.getElementById('changelogButton');
            const changelogModal = document.getElementById('changelogModal');
            const changelogBackButton = document.getElementById('changelogBackButton');

            changelogButton.addEventListener('click', () => {
                if (gameMenuModal) {
                    gameMenuModal.classList.remove('modal-visible');
                    setTimeout(() => { gameMenuModal.style.display = 'none'; }, 300);
                }
                if (changelogModal) {
                    setTimeout(() => {
                        changelogModal.style.display = 'flex';
                        setTimeout(() => changelogModal.classList.add('modal-visible'), 10);
                    }, 350);
                }
            });

            changelogBackButton.addEventListener('click', () => {
                if (changelogModal) {
                    changelogModal.classList.remove('modal-visible');
                    setTimeout(() => { changelogModal.style.display = 'none'; }, 300);
                }
                if (gameMenuModal) {
                     setTimeout(() => {
                        gameMenuModal.style.display = 'flex';
                        setTimeout(() => gameMenuModal.classList.add('modal-visible'), 10);
                    }, 350);
                }
            });

            changelogModal.addEventListener('click', (e) => {
                if (e.target.id === 'changelogModal') {
                    hideAllModals(); // Close all modals and return to the game
                }
            });

            const gameWrapper = document.getElementById('gameWrapper');
            const animationsCheckbox = document.getElementById('settingAnimations');
            const passTurnCheckbox = document.getElementById('settingPassTurnConfirmation');
            const fancyVisualsCheckbox = document.getElementById('settingFancyVisuals');
            const tooltipsCheckbox = document.getElementById('settingTooltips');
            const uiScaleSlider = document.getElementById('settingUiScale');
            const uiScaleValueLabel = document.getElementById('uiScaleValueLabel');

            function applyUiScale() {
                uiScaleSlider.value = gameSettings.uiScale;
                uiScaleValueLabel.textContent = `${Math.round(gameSettings.uiScale * 100)}%`;
                gameWrapper.style.transform = `scale(${gameSettings.uiScale})`;
            }

            // Sync settings logic
            animationsCheckbox.checked = gameSettings.animationsEnabled;
            passTurnCheckbox.checked = gameSettings.passTurnConfirmationEnabled;
            fancyVisualsCheckbox.checked = gameSettings.fancyVisualsEnabled;
            tooltipsCheckbox.checked = gameSettings.tooltipsEnabled;
            applyUiScale(); 

            animationsCheckbox.addEventListener('change', (e) => {
                gameSettings.animationsEnabled = e.target.checked;
                saveSettings();
                gameState.needsRedraw = true;
            });

            passTurnCheckbox.addEventListener('change', (e) => {
                gameSettings.passTurnConfirmationEnabled = e.target.checked;
                saveSettings();
            });
            
            fancyVisualsCheckbox.addEventListener('change', (e) => {
                gameSettings.fancyVisualsEnabled = e.target.checked;
                saveSettings();
                gameState.needsRedraw = true;
            });

            tooltipsCheckbox.addEventListener('change', (e) => {
                gameSettings.tooltipsEnabled = e.target.checked;
                saveSettings();
            });

            uiScaleSlider.addEventListener('input', (e) => {
                const scaleValue = parseFloat(e.target.value);
                gameSettings.uiScale = scaleValue;
                applyUiScale(); 
                saveSettings(); 
                gameState.needsRedraw = true;
            });

            // --- Debug Mode Toggle ---
            const debugModeCheckbox = document.getElementById('settingDebugMode');
            debugModeCheckbox.checked = gameSettings.debugModeEnabled;
            
            // Set initial console visibility based on loaded settings
            const consoleModal = document.getElementById('debugConsoleModal');
            if (gameSettings.debugModeEnabled) {
                consoleModal.style.display = 'flex';
                // Reset position to top-right default on load
                consoleModal.style.top = '10px';
                consoleModal.style.right = '10px';
                consoleModal.style.left = 'auto';
                
                toggleCalibrationCard(true); 
            } else {
                consoleModal.style.display = 'none';
                
                toggleCalibrationCard(false);
            }

            debugModeCheckbox.addEventListener('change', (e) => {
                gameSettings.debugModeEnabled = e.target.checked;
                saveSettings();
                if (!gameSettings.debugModeEnabled) {
                    clearSelectionAndDebugState(); 
                    consoleModal.style.display = 'none';
                    
                    toggleCalibrationCard(false); 
                } else {
                    consoleModal.style.display = 'flex';
                    // Reset position to top-right
                    consoleModal.style.top = '10px';
                    consoleModal.style.right = '10px';
                    consoleModal.style.left = 'auto';
                    
                    toggleCalibrationCard(true);
                }
                console.log(`Debug Mode: ${gameSettings.debugModeEnabled ? 'ON' : 'OFF'}`);
            });


            const customConfirmModalOverlay = document.getElementById('customConfirmModal');
            customConfirmModalOverlay.addEventListener('click', (event) => {
                if (event.target === customConfirmModalOverlay) {
                    if (ui.customConfirmModal) {
                        ui.customConfirmModal.classList.remove('modal-visible');
                        setTimeout(() => ui.customConfirmModal.style.display = 'none', 300);
                        currentConfirmAction = null; 
                    }
                }
            });

            const loadGameModalOverlay = document.getElementById('loadGameModal');
            loadGameModalOverlay.addEventListener('click', (event) => {
                if (event.target === loadGameModalOverlay) {
                    hideLoadGameModal();
                }
            });

            document.getElementById('loadGameModalCloseButton').addEventListener('click', hideLoadGameModal);

            document.getElementById('loadFromAutosaveButton').addEventListener('click', () => {
                if (localStorage.getItem('forthexSaveGame')) {
                    loadAutoSave();
                    hideLoadGameModal();
                } else {
                    showInstruction("No autosave found.", 2000);
                }
            });

            document.getElementById('loadFromFileButton').addEventListener('click', () => {
                document.getElementById('fileLoaderInput').click();
            });

            document.getElementById('fileLoaderInput').addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = function(e) {
                    console.group("[FileLoad] Loading external file...");
                    try {
                        let data = JSON.parse(e.target.result);

                        try {
                            data = attemptLegacyConversion(data);
                        } catch (convError) {
                            console.warn("Conversion Error:", convError);
                            showInstruction("File too old.", 3000);
                            console.groupEnd();
                            return;
                        }

                        switch(fileLoadContext) {
                            case 'game_save':
                                const radiusToLoad = data.gridRadius || 3;
                                resizeMapGrid(radiusToLoad);
                                
                                // Protect Scale
                                const correctScale = gameState.renderScale;
                                const correctOffset = gameState.renderOffset;

                                gameState = data;
                                
                                // Restore Scale
                                gameState.renderScale = correctScale;
                                gameState.renderOffset = correctOffset;

                                rehydrateGameState();
                                
                                if (gameState.gameMode === 'arcade') {
                                    ui.endTurnButton.classList.add('arcade-timer-active');
                                } else {
                                    ui.endTurnButton.classList.remove('arcade-timer-active');
                                    ui.endTurnButton.style.background = '';
                                }

                                fullGameRedraw();
                                hideLoadGameModal();
                                showInstruction("Game loaded from file!", 2000);
                                break;
                            
                            case 'edit_map':
                                if (loadMapFromDataObject(data)) {
                                    hideLoadGameModal();
                                }
                                break;

                            case 'play_map':
                                exitMapMakerMode();
                                hideAllModals();

                                let loadedRadius = data.radius || 3;
                                resizeMapGrid(loadedRadius);

                                const correctedUnits = data.units.map(unit => ({
                                    ...unit,
                                    typeName: unit.typeName 
                                }));
                                const tileMap = new Map(data.tiles);

                                initializeGrid(tileMap, correctedUnits);

                                gameState.baseCampPositions = JSON.parse(JSON.stringify(data.baseCampPositions));
                                if (gameState.flags) {
                                    gameState.flags.p1_flag.homePosition = gameState.baseCampPositions.player1;
                                    gameState.flags.p2_flag.homePosition = gameState.baseCampPositions.player2;
                                }

                                showInstruction(`Custom map '${file.name}' loaded.`, 4000);
                                break;
                        }
                    } catch (error) {
                        console.error("File Load Error:", error);
                        showInstruction("Error: Invalid file.", 3000);
                    }
                    console.groupEnd();
                };
                reader.readAsText(file);
                event.target.value = null; 
            });

const respawnChoicesDiv = document.getElementById('respawnChoices');
            if (respawnChoicesDiv) {
                respawnChoicesDiv.addEventListener('click', (event) => {
                    // FIX: Don't trigger respawn logic if in swap mode
                    const content = document.getElementById('respawnModalContent');
                    if (content.classList.contains('swap-mode')) return; 

                    const button = event.target.closest('.respawn-button');
                    if (button) {
                        const unitTypeName = button.dataset.unitType;
                        const unitType = UNIT_TYPES[unitTypeName];
                        
                        if (unitType) {
                            const spawnSuccess = spawnUnit(gameState.currentPlayer, unitType);

                            if (spawnSuccess) {
                                const queueKey = `player${gameState.currentPlayer}`;
                                gameState.respawnQueue[queueKey].shift(); 
                                updateRespawnQueueDisplay(); 
                                const queue = gameState.respawnQueue[queueKey];
                                const nextInQueue = queue.length > 0 ? queue[0] : null;

                                if (nextInQueue && nextInQueue.turnsRemaining <= 0) {
                                    showRespawnModal(gameState.currentPlayer);
                                } else {
                                    hideRespawnModal();
                                }
                            } else {
                                showInstruction("Could not spawn unit, base is blocked!", 3000);
                                hideRespawnModal();
                            }
                        }
                    }
                });
            }

            gameState.gridRadius = 3; // Use the default value directly
            initializeGrid();
            // This is the important call to our new function
            updateCssVariables(); 
            populateColorPickers();
            gameLoop();
            showInstruction("Project Hexblade Loaded. Player 1's Turn.", 3000);

            // --- Color Picker Drawer Logic ---
            const colorPickerDrawer = document.getElementById('colorPickerDrawer');
            const drawerHandle = document.getElementById('drawerHandle');
            const drawerTabs = document.getElementById('drawerTabs');
            const tabButtons = document.querySelectorAll('.drawer-tab-button');
            const drawerIcon = drawerHandle.querySelector('svg');
            const tabContent = document.getElementById('drawerTabContent');

            // This function now only CREATES the 5 circles once.
            function populateColorPickers() {
                const container = document.getElementById('color-options');
                if (!container) return;

                container.innerHTML = ''; // Clear any existing circles

                for (let i = 0; i < COLOR_THEMES.length; i++) {
                    const circle = document.createElement('div');
                    circle.className = 'color-option-circle';
                    circle.dataset.themeIndex = i;
                    // Player dataset is now set dynamically when tabs are switched
                    container.appendChild(circle);
                }

                // Set the initial colors and active state to Player 1's palette
                updateColorPickerCircles('player1');
            }

            // This function UPDATES the colors and active state of the 5 circles
            function updateColorPickerCircles(playerKey) {
                const container = document.getElementById('color-options');
                if (!container) return;
                const circles = container.querySelectorAll('.color-option-circle');
                const activeThemeIndex = gameState.playerColorSelections[playerKey];

                circles.forEach((circle, index) => {
                    const theme = COLOR_THEMES[index];
                    circle.style.backgroundColor = theme[playerKey].primary;
                    circle.dataset.player = playerKey.slice(-1); // Set player to '1' or '2'
                    
                    // Update which circle is highlighted as active
                    circle.classList.toggle('active', index === activeThemeIndex);
                });
            }

            // Helper function to update the drawer's border/icon colors based on the active tab
            function updateDrawerColors() {
                const activeTab = document.querySelector('.drawer-tab-button.active');
                if (!activeTab) return;

                const activePlayerKey = activeTab.dataset.tab === 'p1' ? 'player1' : 'player2';
                
                if (colorPickerDrawer.classList.contains('drawer-open')) {
                    colorPickerDrawer.style.borderColor = TEAM_COLORS[activePlayerKey].primary;
                    drawerHandle.style.borderColor = TEAM_COLORS[activePlayerKey].primary;
                    drawerIcon.style.stroke = TEAM_COLORS[activePlayerKey].accent;
                } else {
                    colorPickerDrawer.style.borderColor = '#F0F0F0';
                    drawerHandle.style.borderColor = '#F0F0F0';
                    drawerIcon.style.stroke = '#F0F0F0';
                }
            }

            // Event handler for clicking a color circle
            function handleColorSelection(event) {
                const circle = event.target.closest('.color-option-circle');
                if (!circle) return;

                const player = circle.dataset.player; // '1' or '2'
                const themeIndex = parseInt(circle.dataset.themeIndex, 10);
                const playerKey = `player${player}`;
                const otherPlayerKey = player === '1' ? 'player2' : 'player1';

                // --- Start the transition ---
                gameState.colorTransition.active = true;
                gameState.colorTransition.startTime = Date.now();
                
                // Store the 'from' and 'to' color objects for BOTH players
                gameState.colorTransition.from.player1 = { ...TEAM_COLORS.player1 };
                gameState.colorTransition.from.player2 = { ...TEAM_COLORS.player2 };
                gameState.colorTransition.to[playerKey] = { ...COLOR_THEMES[themeIndex][playerKey] };
                gameState.colorTransition.to[otherPlayerKey] = { ...TEAM_COLORS[otherPlayerKey] }; // The other player's color doesn't change

                // 1. Update the live TEAM_COLORS object for ONLY the selected player
                TEAM_COLORS[playerKey] = { ...COLOR_THEMES[themeIndex][playerKey] };
                gameState.playerColorSelections[playerKey] = themeIndex; // Remember this selection

                // 2. Update the active circle visuals
                const container = circle.parentElement;
                container.querySelectorAll('.color-option-circle').forEach(c => c.classList.remove('active'));
                circle.classList.add('active');

                // 3. Update all DOM UI elements instantly
                updateCssVariables();
                updateTurnDisplay();
                updateDrawerColors();
                saveColorPreferences();
            }

            // Open/Close the drawer
            drawerHandle.addEventListener('click', () => {
                colorPickerDrawer.classList.toggle('drawer-open');
                updateDrawerColors();
            });

            // Switch between P1 and P2 tabs
            drawerTabs.addEventListener('click', (e) => {
                const clickedButton = e.target.closest('.drawer-tab-button');
                if (!clickedButton) return;
                
                const targetTabId = clickedButton.dataset.tab;
                const playerKey = targetTabId === 'p1' ? 'player1' : 'player2';

                // Update button active state
                tabButtons.forEach(button => {
                    button.classList.toggle('active', button.dataset.tab === targetTabId);
                });

                // Update the circle colors and then the drawer border
                updateColorPickerCircles(playerKey);
                updateDrawerColors();
            });

            // Attach the click listener for selecting a color
            if (tabContent) {
                tabContent.addEventListener('click', handleColorSelection);
            }

            // Close drawer if clicking outside
            document.addEventListener('click', (e) => {
                if (colorPickerDrawer.classList.contains('drawer-open') && !colorPickerDrawer.contains(e.target)) {
                    colorPickerDrawer.classList.remove('drawer-open');
                    updateDrawerColors(); // Reset colors when closing
                }
            });

            // Prevent outside-click from firing on the handle itself
            drawerHandle.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // --- Scroll Fade Logic for Action Log ---
            const actionLogContent = document.getElementById('actionLogContent');
            const actionLogWrapper = document.getElementById('actionLogWrapper');
            if(actionLogContent && actionLogWrapper) {
                actionLogContent.addEventListener('scroll', () => {
                    if (actionLogContent.scrollTop > 0) {
                        actionLogWrapper.classList.add('is-scrolled');
                    } else {
                        actionLogWrapper.classList.remove('is-scrolled');
                    }
                });
            }

            // --- End of Color Picker Drawer Logic ---

// Tab Switching Logic
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', () => {
                // Toggle Buttons
                document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Toggle Views
                document.querySelectorAll('.tab-view').forEach(v => {
                    v.classList.remove('active');
                    v.style.display = 'none';
                });
                
                const tabName = btn.dataset.tab; // 'recruit' or 'promote'
                const targetView = document.getElementById(tabName === 'recruit' ? 'tabViewRecruit' : 'tabViewPromote');
                targetView.classList.add('active');
                targetView.style.display = tabName === 'recruit' ? 'block' : 'flex'; // Promote uses flex
            });
        });

document.querySelectorAll('.swap-choice').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const typeName = e.target.dataset.type;
        const newType = UNIT_TYPES[typeName];
        if (gameState.selectedUnit) {
            performSwap(gameState.selectedUnit, newType);
            // Restore UI
            document.getElementById('swapSelectionPanel').style.display = 'none';
            document.getElementById('actionsPanel').style.display = 'flex';
            ui.endTurnButton.disabled = false; // Allow end turn now
        }
    });
});



        }

