// --- Live Engine Instance ---
// Genuinely separate state, not an alias of gameState — engine-owned fields
// (tiles/edges/units/currentPlayer/etc.) live here now, not in gameState. See
// [[project_forthex_a1_track]] for why: the user explicitly rejected aliasing
// gameState to engine.state in favor of a real cutover.
const engine = CreateEngineInstance();

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
    mapMakerMode: false,
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
    playerActionTaken: { player1: false, player2: false },
    isTestingMap: false,
    fillToolActive: false,
    needsRedraw: true,
    visionCache: { player: null, tiles: new Set(), edges: new Set() },
    visionDirty: true,
    isPassDeviceTransition: false
};

let currentDrawingColors = JSON.parse(JSON.stringify(TEAM_COLORS));

let gameSettings = {
    animationsEnabled: true,
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
