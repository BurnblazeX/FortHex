// === Turn Lifecycle (MIXED functions split, client wrapper half — A1 step 8) ===
//
// Same pattern as js/client/actions.js (A1 step 7): each wrapper keeps the
// original name/signature so every existing call site keeps working, calls
// the pure function of the same name (capitalized) in
// js/server/turn-lifecycle.js, drains the engine's event queue via
// HandleActionEvents(), and does the DOM/UI/AI-scheduling work the original
// inline code did, driven by what the pure function returns.

function applyStartOfTurnZoCDamage() {
    const result = ApplyStartOfTurnZoCDamage();
    HandleActionEvents();
}

function applyMountainAttrition() {
    const result = ApplyMountainAttrition();
    HandleActionEvents();
}

function applyStartOfTurnHealing() {
    const result = ApplyStartOfTurnHealing();
    HandleActionEvents();
}

function logSiegeStatus() {
    const result = LogSiegeStatus();
    HandleActionEvents();
}

function handleRespawnQueue() {
    if (engine.state.gameMode === 'arcade') return;

    const result = ApplyRespawnQueueTick();
    if (!result.hasQueue) {
        updateRespawnQueueDisplay();
        return;
    }

    if (result.unitReady) {
        console.log(`[Respawn] Player ${result.player} unit ready.`);

        if (engine.state.isTrainingMode || (engine.state.gameMode === 'singleplayer' && result.player !== engine.state.playerSide)) {
            updateRespawnQueueDisplay();
            return;
        }

        try {
            showRespawnModal(result.player);
        } catch (e) {
            console.error("Failed to open Respawn Modal:", e);
        }
    }

    updateRespawnQueueDisplay();
}

// AI population bookkeeping for a finished match. This lived inside
// CheckVictoryCondition until the js/server/ purge - it has to be client-side
// because the brain population is localStorage-backed (see §7 of the A1 guide),
// and reaching for it from the engine made js/server/ unrunnable in a Worker.
function ApplyTrainingMatchOutcome(result) {
    if (!gameState.matchBrains) return;

    if (result.winningPlayer) {
        const losingPlayer = result.winningPlayer === 1 ? 2 : 1;
        const winnerBrain = gameState.matchBrains[`player${result.winningPlayer}`];
        const loserBrain = gameState.matchBrains[`player${losingPlayer}`];

        winnerBrain.matchesPlayed++;
        winnerBrain.wins++;
        loserBrain.matchesPlayed++;
        loserBrain.losses++;

        evolveBrain(winnerBrain, true, result.victoryText, result.winningPlayer, engine.state.matchHistory);
        evolveBrain(loserBrain, false, result.victoryText, losingPlayer, engine.state.matchHistory);

        finalizeTrainingSamples(result.winningPlayer, 1);
        finalizeTrainingSamples(losingPlayer, 0);
    } else if (result.isDraw) {
        const brainA = gameState.matchBrains.player1;
        const brainB = gameState.matchBrains.player2;

        [brainA, brainB].forEach(brain => {
            brain.matchesPlayed++;
            brain.draws = (brain.draws || 0) + 1;
            applyDrawPenalty(brain);
        });

        finalizeTrainingSamples(1, 0.5);
        finalizeTrainingSamples(2, 0.5);
    }
}

// Champion-brain update for a finished singleplayer match, hoisted out of
// CheckVictoryCondition for the same reason as ApplyTrainingMatchOutcome.
function ApplySingleplayerMatchOutcome(result) {
    const championBrain = getChampionBrain();
    championBrain.matchesPlayed++;
    if (result.aiVictory) championBrain.wins++; else championBrain.losses++;
    evolveBrain(championBrain, result.aiVictory, result.victoryText, result.aiPlayerNum, engine.state.matchHistory);
    finalizeTrainingSamples(result.aiPlayerNum, result.aiVictory ? 1 : 0);
}

// Shared tail of both victory paths: block further interaction, run out the
// confetti window, then wait for a click to restart. checkVictoryCondition and
// checkArcadeVictoryCondition carried byte-identical copies of this.
// The rest of the two victory screens still differs on purpose - arcade sets
// gameOver itself and skips the newMapButton/actionsPanel bits - so only the
// genuinely identical part is shared here.
function AwaitVictoryRestart() {
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
}

function checkVictoryCondition() {
    const result = CheckVictoryCondition();

    if (result.alreadyOver) return true;

    if (!result.victory) {
        document.getElementById('newMapButton').disabled = false;
        return false;
    }

    HandleActionEvents();

    if (result.isTrainingMode) {
        console.log(`[TRAINING] ${result.victoryText}`);
        ApplyTrainingMatchOutcome(result);
        if (result.needsPopulationMaintenance) {
            // localStorage-touching — must stay client-side (see
            // js/server/turn-lifecycle.js header comment).
            maybeEvolvePopulation();
            savePopulation();
        }
        startNewTrainingMatch();
        setTimeout(() => { executeAITurn(); }, 0);
        return true;
    }

    if (result.isSingleplayerVictory) {
        ApplySingleplayerMatchOutcome(result);
    }

    if (result.needsSavePopulation) {
        console.log("Singleplayer match finished. Updating AI Brain...");
        savePopulation();
    }

    // --- STANDARD VICTORY LOGIC ---
    ui.victoryMessage.textContent = result.victoryText;
    ui.victoryMessage.style.display = 'block';
    triggerConfetti();
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

    AwaitVictoryRestart();

    return true;
}

async function proceedToEndTurn() {
    if (gameState.isDragging || engine.state.gameOver) return;

    // A pending forced retreat must be resolved before the turn can end.
    if (gameState.mustUnfortify) {
        showInstruction("You MUST select an edge to retreat to first!", 2500);
        return;
    }

    // Arcade swap-pending guard — client-owned swapState, checked before any
    // engine-state mutation happens.
    if (engine.state.gameMode === 'arcade' && engine.state.globalTurnNumber >= 2) {
        if (gameState.swapState === 'selecting_unit' || gameState.swapState === 'selecting_class') {
            showInstruction("You must swap a unit first!", 2000);
            return;
        }
    }

    const outcome = await SendAction('end-turn', {});
    if (!outcome.ok) return;
    const result = outcome.result;

    if (result.arcadeMaxTurnsReached) {
        // Drain before bailing out: AdvanceTurn may have queued logs before it
        // hit the turn cap, and this path never reaches the drain below.
        HandleActionEvents();
        checkArcadeVictoryCondition();
        return;
    }

    if (result.turnNumberAdvanced) {
        updateGlobalTurnDisplay();
    }

    // --- RESET SELECTIONS (client-owned) ---
    gameState.selectedUnit = null;
    gameState.currentReachableMoves.clear();
    gameState.hoveredUnitId = null;
    canvas.style.cursor = 'default';
    resetActionSelectionStates();

    // Fires immediately, before any pass-device overlay — matches original
    // timing (ZoC/attrition/healing/siege/resupply logs all fired inline,
    // before the overlay-vs-finalizeVisuals branch).
    HandleActionEvents();

    // Respawn queue UI decision, using the tick AdvanceTurn already
    // performed (must not call handleRespawnQueue here — it would tick the
    // timers a second time).
    if (result.respawnResult.hasQueue && result.respawnResult.unitReady) {
        console.log(`[Respawn] Player ${result.respawnResult.player} unit ready.`);
        const suppressModal = engine.state.isTrainingMode ||
            (engine.state.gameMode === 'singleplayer' && result.respawnResult.player !== engine.state.playerSide);
        if (!suppressModal) {
            try {
                showRespawnModal(result.respawnResult.player);
            } catch (e) {
                console.error("Failed to open Respawn Modal:", e);
            }
        }
    }
    updateRespawnQueueDisplay();

    // --- VISUAL REVEAL CALLBACK (Runs after overlay clears) ---
    const finalizeVisuals = () => {
        updateTurnDisplay();
        updateSelectedUnitInfoPanel();
        updateSupplyPointsDisplay();

        if (engine.state.gameMode === 'arcade') {
            gameState.arcadeTurnTimer = ARCADE_TURN_TIME_SEC;
            gameState.hasSwappedThisTurn = false;

            if (engine.state.globalTurnNumber >= 2) {
                gameState.swapState = 'selecting_unit';
                showInstruction(`Player ${engine.state.currentPlayer}'s Turn. SELECT UNIT TO SWAP.`, 4000);
            } else {
                gameState.swapState = 'none';
                showInstruction(`Player ${engine.state.currentPlayer}'s turn.`);
            }
        } else {
            showInstruction(`Player ${engine.state.currentPlayer}'s turn.`);
        }

        logAction(`Player ${engine.state.currentPlayer}'s Turn Begins`, engine.state.currentPlayer);
        autoSaveGame(true);
        checkVictoryCondition();

        if (!engine.state.gameOver && engine.state.gameMode === 'singleplayer' && engine.state.currentPlayer !== engine.state.playerSide) {
            ui.endTurnButton.disabled = true;
            if (!engine.state.isTrainingMode) {
                setTimeout(() => { executeAITurn(); }, 1500);
            }
        } else {
            ui.endTurnButton.disabled = false;
        }
    };

    // --- TRIGGER OVERLAY IF ENABLED ---
    if (engine.state.gameMode === 'local' && gameSettings.passDeviceBlurEnabled) {
        showPassDeviceOverlay(engine.state.currentPlayer, finalizeVisuals);
    } else {
        finalizeVisuals();
    }
}

// === Match/Turn DOM Orchestration (client-only — A1 step 8/12) ===
//
// Pure relocation from main.js — these were already correctly classified as
// client-side (DOM/UI, victory-screen presentation, confetti, pass-device
// overlay), matching the guide's explicit destination for this content
// (§4's main.js entry names showPassDeviceOverlay/triggerConfetti/the
// victory-screen DOM block as game-flow.js content). No logic changes.
//
// checkArcadeVictoryCondition is a near-duplicate of checkVictoryCondition's
// victory-screen tail (js/client/game-flow.js) — flagging as a
// simplification candidate, not merging it as part of this relocation.

// Client half of the arcade forced swap; the pick itself is PickForcedSwap in
// js/server/turn-lifecycle.js.
function handleForcedSwap() {
    const choice = PickForcedSwap();
    if (!choice.applicable) return;

    if (!choice.victim) {
        proceedToEndTurn();
        return;
    }

    hideRespawnModal();
    performSwap(choice.victim, choice.newType);
    proceedToEndTurn();
}

function checkArcadeVictoryCondition() {
    // Who won and the gameOver flag are the server's call (see
    // CheckArcadeTimeLimitVictory in js/server/turn-lifecycle.js). This half only
    // renders the result.
    const result = CheckArcadeTimeLimitVictory();

    ui.victoryMessage.textContent = result.victoryText;
    ui.victoryMessage.style.display = 'block';
    gameState.currentActionState = ACTION_STATES.IDLE;
    gameState.selectedUnit = null;
    gameState.currentReachableMoves.clear();
    ui.endTurnButton.disabled = true;
    canvas.style.cursor = 'default';
    triggerConfetti();
    
    // Block interaction immediately
    AwaitVictoryRestart();

    return true;
}

// Global reference to prevent overlapping timers
window.resolvePassDeviceOverlay = null;

function showPassDeviceOverlay(nextPlayer, callback) {
    console.trace("[Handoff] showPassDeviceOverlay triggered. Next player:", nextPlayer);

    let overlay = document.getElementById('passDeviceOverlay');
    if (!overlay) {
        console.log("[Handoff] Creating overlay DOM element.");
        overlay = document.createElement('div');
        overlay.id = 'passDeviceOverlay';
        document.body.appendChild(overlay);
    }
    
    // --- FIX: Change 'fixed' to 'absolute' so it scrolls with the page! ---
    overlay.style.cssText = `
        display: none; position: absolute; z-index: 2147483647; 
        background-color: rgba(24, 40, 48, 0.6); 
        backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); 
        align-items: center; justify-content: center; flex-direction: column; 
        cursor: pointer; border-radius: 10px; pointer-events: auto;
    `;
    
    overlay.innerHTML = `
        <h2 id="passDeviceText" style="font-family: 'Geostar', cursive; font-size: clamp(2em, 6vw, 3.5em); margin-bottom: 10px; text-align: center; text-shadow: 0 4px 10px rgba(0,0,0,0.9); font-weight: bold;">Pass to Player X</h2>
        <div id="passDeviceCountdown" style="font-size: clamp(3em, 8vw, 5em); font-weight: bold; color: #FFFFFF; margin-bottom: 20px; text-shadow: 0 4px 10px rgba(0,0,0,0.9);">5</div>
        <p style="font-size: clamp(1.2em, 4vw, 1.5em); color: #FFFFFF; opacity: 0.9; text-align: center; text-shadow: 0 2px 5px rgba(0,0,0,0.9);">Tap anywhere to continue</p>
    `;

    // --- SPAM FIX: FORCE RESOLVE EXISTING OVERLAY ---
    if (window.resolvePassDeviceOverlay) {
        console.log("[Handoff] Force-resolving previous overlay due to rapid click.");
        window.resolvePassDeviceOverlay(true); 
    }

    const countdownEl = document.getElementById('passDeviceCountdown');
    const textEl = document.getElementById('passDeviceText');
    const canvasEl = document.getElementById('gameCanvas'); 
    
    if (!canvasEl) {
        console.error("[Handoff] Canvas missing! Aborting transition.");
        if (callback) callback();
        return;
    }

    // --- FORCE FULL MAP FOG ---
    gameState.isPassDeviceTransition = true;
    gameState.needsRedraw = true;
    
    // --- FIX: Inject window.scrollY to pin it to the document instead of the camera ---
    const syncOverlaySize = () => {
        const rect = canvasEl.getBoundingClientRect();
        overlay.style.top = (rect.top + window.scrollY) + 'px';
        overlay.style.left = (rect.left + window.scrollX) + 'px';
        overlay.style.width = rect.width + 'px';
        overlay.style.height = rect.height + 'px';
    };
    
    syncOverlaySize();
    window.addEventListener('resize', syncOverlaySize);
    
    textEl.textContent = `Pass to Player ${nextPlayer}`;
    textEl.style.color = nextPlayer === 1 ? 'var(--p1-color-primary)' : 'var(--p2-color-primary)';
    
    let timeLeft = 5;
    countdownEl.textContent = timeLeft;
    overlay.style.display = 'flex';

    if (engine.settings.animationsEnabled) {
        overlay.animate([
            { opacity: 0 },
            { opacity: 1 }
        ], {
            duration: 400,
            easing: 'ease-out'
        });
    }
    
    let intervalId = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            resolveOverlay();
        } else {
            countdownEl.textContent = timeLeft;
        }
    }, 1000);
    
    let isResolving = false; 
    
    const resolveOverlay = (isForceAbort = false) => {
        if (isResolving) return;
        isResolving = true;
        
        window.resolvePassDeviceOverlay = null; 
        
        console.trace("[Handoff] resolveOverlay triggered. Clearing overlay and lifting fog.");
        clearInterval(intervalId);
        overlay.removeEventListener('click', overlayClickHandler);
        window.removeEventListener('resize', syncOverlaySize);
        
        gameState.isPassDeviceTransition = false;
        engine.visionDirty = true;
        gameState.needsRedraw = true;
        
        const finishResolve = () => {
            overlay.style.display = 'none';
            if (callback) callback();
        };

        if (engine.settings.animationsEnabled && !isForceAbort) {
            const anim = overlay.animate([
                { opacity: 1 },
                { opacity: 0 }
            ], {
                duration: 300,
                easing: 'ease-in'
            });
            anim.onfinish = finishResolve;
        } else {
            finishResolve();
        }
    };

    window.resolvePassDeviceOverlay = resolveOverlay;
    
    const overlayClickHandler = () => resolveOverlay(false);
    overlay.addEventListener('click', overlayClickHandler);
}

function handleGenerateNewMap() {
            gameState.isDragging = false; 
            gameState.draggingUnit = null;
            
            // 1. Generate the map tiles
            const newLayout = GenerateImprovedMap(engine.state.gridRadius);
            
            // 2. Resolve the correct base camps for the current slider/radius BEFORE placing
            // units, so procedural placement lines up with the actual bases instead of
            // whatever a previously-loaded preset (River Fork/Volcano Island - which put P1/P2
            // on opposite hemispheres) left behind in engine.state.baseCampPositions.
            const sliderEl = document.getElementById('baseCampSlider');
            const sliderVal = sliderEl ? sliderEl.value : '3';
            
            const correctedBaseCamps = ComputeRotatedBaseCampPositions(engine.state.gridRadius, sliderVal);

            // 3. Initialize the grid with these tiles and the corrected base camps
            initializeGrid(newLayout, null, correctedBaseCamps);
            
            showInstruction("New map generated. Player 1's Turn.", 3000);
        }

function startSingleplayerGame(playerSide) {
    exitMapMakerMode(); 
    hideAllModals(); 
    
    // Set the game mode state
    engine.state.gameMode = 'singleplayer';
    engine.state.playerSide = playerSide;

    // --- FIX: Reset Map Dimensions for Standard Play ---
    engine.state.gridRadius = 3;
    gameState.renderScale = 1.0;
    gameState.renderOffset = { x: 0, y: 0 };
    // ---------------------------------------------------

    // Force the default map for singleplayer
    initializeGrid(DEFAULT_MAP_LAYOUT_RADIUS_3);
    showInstruction(`Singleplayer game started. You are Player ${playerSide}.`, 3000);
    // If the human chose to be P2, the AI (P1) must take the first turn.
    if (engine.state.playerSide === 2) {
        console.log("Player is P2, triggering AI's first turn.");
        ui.endTurnButton.disabled = true; // Disable button during AI turn
        setTimeout(() => {
            executeAITurn();
        }, 1500); // Wait a moment before AI starts
    }
}

// Thin wrapper — the actual unit.canHeal mutation lives in
// js/server/actions.js's RecalculateHealingEligibility. Client-side files
// must not mutate gameState directly.
function updateAllHealingStatus() {
            const result = RecalculateHealingEligibility();
            HandleActionEvents();
        }

// Archers holding a mountain peak bleed HP unless they are BOTH supplied and their
// player's flag is safely at base — a stolen flag cuts the peak off just as surely as a
// severed supply line. The damage escalates 1, 2, 3... for each consecutive turn the
// hold is unsupported, and resets the moment support is restored (or when the unit
// unfortifies off the peak).



        

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
