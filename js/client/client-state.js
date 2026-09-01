// === Client-owned state ===
//
// The engine instance and its unitVisibilityFilter used to be created here as a
// module-load side effect. They moved to js/main.js's composition root, which
// is where object creation and wiring belong - this file is just the client's
// own state now.

// --- Game State (client-owned only, as of the engine.state cutover) ---
let gameState = {
    renderScale: 1.0,
    renderOffset: { x: 0, y: 0 },
    colorTransition: { active: false, startTime: 0, from: {}, to: {} },
    selectedUnit: null,
    hoveredUnitId: null,
    currentReachableMoves: new Map(),
    activeAnimations: [],

    // Physical UI states
    isDragging: false,
    draggingUnit: null,
    dragStartX: 0, dragStartY: 0,
    dragUnitRenderX: 0, dragUnitRenderY: 0,
    dragUnitOriginalPosition: null, dragUnitOriginalType: null,
    draggedDistance: 0,
    dragStartTime: null,

    // Logical Game State
    currentActionState: ACTION_STATES.IDLE,
    mustUnfortify: false,
    mapMakerBrush: { type: 'tile', value: TILE_TYPES.PLAINS, player: null },
    mapMakerLastPaintedHexKey: null,

    // Data for actions
    validFortifyTargetTileKeys: [],
    validUnfortifyTargetEdgeKeys: [],
    validBridgeTargetEdgeKeys: [],
    validMeleeAttackTargets: [],
    validArcherAttackTargets: [],

    // Debug / Animation data
    potentialDebugPathToDraw: null,
    debugPathHoverStartTime: null,
    debugPathToDraw: null,
    debugPathAnimationStartTime: null,
    debugPathPauseStartTime: null,
    lastDebugPathKey: null,
    debugAttackRangeHighlights: [],
    visualEffects: [],
    isTestingMap: false,
    fillToolActive: false,
    needsRedraw: true,
    isPassDeviceTransition: false
};

let currentDrawingColors = JSON.parse(JSON.stringify(TEAM_COLORS));

let gameSettings = {
    fancyVisualsEnabled: true,
    passTurnConfirmationEnabled: true,
    tooltipsEnabled: true,
    debugModeEnabled: false,
    passDeviceBlurEnabled: false,
    uiScale: 1.0
};

let currentConfirmAction = null;
let mapMakerStateBackup = null;
let currentCancelAction = null;

let dragOperationJustConcluded = false;
let lastTap = 0;
let lastTapPosition = { x: 0, y: 0 };
let lastTouchInteractionTime = 0;
let fileLoadContext = 'game_save';
