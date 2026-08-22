// --- Game State ---
let gameState = {
    gameMode: 'local', 
    playerSide: null, 
    gridRadius: 3,
    renderScale: 1.0,
    renderOffset: { x: 0, y: 0 },
    playerColorSelections: { player1: 2, player2: 2 },
    colorTransition: { active: false, startTime: 0, from: {}, to: {} },
    tiles: new Map(),
    edges: new Map(),
    units: [],
    currentPlayer: 1,
    globalTurnNumber: 1,
    selectedUnit: null,
    hoveredUnitId: null,
    currentReachableMoves: new Map(),
    gameOver: false,
    actionLog: [], 
    matchHistory: [], 
    unitIdCounter: 0,
    flags: null,
    respawnQueue: { player1: [], player2: [] },
    unitCounts: null,
    supplyPoints: { player1: 10, player2: 10 },
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
    baseCampPositions: JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS)),

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
    fineGrid: new Map(),
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
    fogOfWarEnabled: false,
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

const ActionManager = {

    submitAction: function(action) {

        console.groupCollapsed(`[ActionManager] ${action.type} (Turn ${action.turn})`);
        console.log("Payload:", action);

        try {
            const historyEntry = JSON.parse(JSON.stringify(action));
            gameState.matchHistory.push(historyEntry);
            console.log(`History Ledger Size: ${gameState.matchHistory.length}`);
        } catch (e) {
            console.error("Failed to serialize action for history:", e);
        }
        
        console.groupEnd();
    }
};







