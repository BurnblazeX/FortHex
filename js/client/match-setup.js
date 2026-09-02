// === Match Setup (MIXED function split, client wrapper half — A1 step 8/12) ===
//
// Keeps the original name/signature so every existing call site keeps
// working unchanged. All the client-owned state resets and DOM/UI calls that
// used to be interleaved throughout the original initializeGrid now run
// before/after the pure InitializeGrid call instead — see
// js/server/match-setup.js's header comment for why that reordering is safe.

function initializeGrid(tileLayoutMap = null, customUnits = null, baseCampData = null) {
    // Canvas & UI sizing
    canvas.width = CANVAS_WIDTH_NORMAL;
    canvas.height = CANVAS_HEIGHT_NORMAL;
    document.querySelectorAll('.ui-panel').forEach(panel => {
        panel.style.minHeight = canvas.height + 'px';
    });

    // Client-owned state resets
    ui.victoryMessage.style.display = 'none';
    ui.endTurnButton.disabled = false;
    gameState.selectedUnit = null;
    gameState.hoveredUnitId = null;
    engine.visionCache = null;
    gameState.fogAnimState = null;
    engine.visionDirty = true;
    gameState.isPassDeviceTransition = false;
    gameState.isDragging = false;
    gameState.draggingUnit = null;
    gameState.currentReachableMoves.clear();
    resetActionSelectionStates();

    gameState.arcadeTurnTimer = ARCADE_TURN_TIME_SEC;
    gameState.swapState = 'none';
    gameState.unitToSwap = null;
    gameState.arcadeGameStartedInteraction = false;

    ui.endTurnButton.classList.remove('arcade-timer-active');
    ui.endTurnButton.style.background = '';
    ui.endTurnButton.textContent = "End Turn";

    if (engine.state.gameMode === 'arcade') {
        ui.endTurnButton.classList.add('arcade-timer-active');
    }
    document.getElementById('supplyPointsContainer').style.display = 'block';

    InitializeGrid(tileLayoutMap, customUnits, baseCampData);

    updateGlobalTurnDisplay();
    updateActionLogDisplay();
    updateRespawnQueueDisplay();
    updateTurnDisplay();
    updateSelectedUnitInfoPanel();
    checkVictoryCondition();
    updateSupplyPointsDisplay();

    // A6. Remember where this match started, without writing anything yet. The
    // record appears at the first turn end; a completed record needs the opening
    // board because its own `latest` is the FINAL board, with nothing to replay
    // forward from.
    //
    // A match that gains consent mid-way through has no captured start, so its
    // "opening" is wherever the recording began. Honest, and the alternative would
    // be inventing a start nobody witnessed.
    if (typeof CaptureArchiveOpening === 'function') CaptureArchiveOpening();
}
