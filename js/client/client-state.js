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

    // The press-and-hold that has not become a drag yet. dragPendingUnit is what the
    // finger is resting on; dragHoldTimer is the timeout that promotes it.
    dragPendingUnit: null, dragHoldTimer: null,

    // True from a mouse-down that selected a unit until the click it produces has been
    // swallowed. Without it that click runs handleUnitSelectionClick, which toggles, and
    // undoes the selection the press just made.
    pressSelectedUnit: false,
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

// === Who this client is allowed to move (B2) ===
//
// Every one of these checks used to be written as `gameMode === 'singleplayer' &&
// unit.player !== playerSide`, which was correct while singleplayer was the only mode
// that bound a client to ONE side. Online does the same thing - the seat you took is
// the side you play - but the mode string is different, so every one of those tests
// silently evaluated false and both players could drag both armies around. The server
// refused the illegal ones, so nothing desynced; it just made the two sides pointless.
//
// The real predicate was never the mode. It is whether this client is bound to a side
// at all, which is exactly what playerSide records: a number in singleplayer and
// online, and null in local and arcade hotseat, where controlling both sides is the
// entire idea.

// True when this client plays one specific side rather than both.
// Is an action animation still playing?
//
// While one is, the board is showing something that has already happened on the
// server, and a unit's drawn position is not where it is. Picking up or tapping
// a unit in that window acts on a board the player is not looking at.
//
// MEASURED BY WALL CLOCK, not by whether the animation is still in the array,
// and that is deliberate. gameState.activeAnimations is only drained inside
// drawAnimations, so a frame that never lands - a hidden tab, a throw inside an
// onComplete - would leave an entry there forever and lock input permanently.
// Every animation carries startTime and duration, so asking whether it COULD
// still be running cannot deadlock: the lock expires on its own even if nothing
// ever cleans the array up. A safety harness that can brick the game is worse
// than the problem it solves.
function IsAnimationPlaying() {
    const animations = gameState.activeAnimations;
    if (!animations || animations.length === 0) return false;
    const now = Date.now();
    return animations.some(anim =>
        anim
        && typeof anim.startTime === 'number'
        && typeof anim.duration === 'number'
        && (now - anim.startTime) < anim.duration);
}

function IsBoundToOneSide() {
    return engine.state.playerSide === 1 || engine.state.playerSide === 2;
}

// True when a unit belongs to the side this client does NOT play. False in hotseat,
// where nothing is foreign.
function IsForeignUnit(unit) {
    if (!unit) return false;
    if (!IsBoundToOneSide()) return false;
    return unit.player !== engine.state.playerSide;
}

// What to say when someone grabs a unit that is not theirs. The old wording assumed
// the only opponent that could exist was an AI, which is wrong the moment a real person
// is on the other side of a socket.
function ForeignUnitMessage() {
    return engine.state.gameMode === 'online'
        ? "That is your opponent's unit."
        : 'That is an AI unit.';
}

// True when the turn belongs to the other side, so this client should not be offering
// actions at all.
function IsOpponentsTurn() {
    if (!IsBoundToOneSide()) return false;
    return engine.state.currentPlayer !== engine.state.playerSide;
}
