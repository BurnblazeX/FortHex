// === FortHexEngine — the authoritative, DOM-free engine shell ===
//
// Field list mirrors §5.1 plus gameOver (reclassified engine-owned in step 8,
// once real victory-check logic needed to set it authoritatively).
// mustUnfortify/playerActionTaken/selectedUnit/currentActionState/the
// valid*TargetKeys/currentReachableMoves highlight caches stayed client-owned
// per the guide's fallback rule — they never got forced onto the engine side
// the way gameOver did.
//
// This is genuinely live now (see js/main.js) — as of the engine.state
// cutover, every js/server/ pure function reads/writes this instance's state
// directly, not a bare gameState global. gameState (js/client/client-state.js) now holds
// only client-owned fields.
//
// NOTE: this file must stay zero-DOM/window/canvas — it needs to load cleanly
// in a bare Web Worker (§9's "Worker smoke test").

class FortHexEngine {
    constructor() {
        this.state = {
            gameMode: 'local',
            playerSide: null,
            gridRadius: 3,
            playerColorSelections: { player1: 2, player2: 2 },
            tiles: new Map(),
            edges: new Map(),
            units: [],
            currentPlayer: 1,
            globalTurnNumber: 1,
            actionLog: [],
            matchHistory: [],
            unitIdCounter: 0,
            flags: null,
            respawnQueue: { player1: [], player2: [] },
            unitCounts: null,
            supplyPoints: { player1: 10, player2: 10 },
            fineGrid: new Map(),
            baseCampPositions: JSON.parse(JSON.stringify(DEFAULT_FLAG_HOME_POSITIONS)),
            gameOver: false,

            // Moved off the client's gameState during the js/server/ purge.
            // Each of these changes a rule or is authoritative match data, so
            // the engine has to own it or it can't run without a client:
            //   playerActionTaken - gates end-turn, written by server actions
            //   arcadeTotalTurns  - drives the arcade turn cap
            //   isTrainingMode    - changes the victory rule (30-turn cap)
            //   mapMakerMode      - suppresses movement rules while editing
            playerActionTaken: { player1: false, player2: false },
            arcadeTotalTurns: 0,
            isTrainingMode: false,
            mapMakerMode: false,
        };

        // Everything else in today's gameSettings is presentation-only and
        // stays client-side. fogOfWarEnabled is the one exception: it's not
        // cosmetic, it gates what state the server is allowed to send a given
        // client (A2 security requirement).
        this.settings = {
            fogOfWarEnabled: false,

            // Server-owned per the animation design: the engine waits out the
            // animation's duration before applying a mutation, so it needs to
            // know whether animations are on. The client still persists this
            // as a user preference and pushes it in (see save.js).
            animationsEnabled: true,
        };

        this.actionManager = new ActionManager(this);

        this.pendingEvents = [];

        // Derived, not match state - deliberately outside `state` so it never
        // reaches a save file. Recomputable at any time via computePlayerVision.
        // The engine needs its own copy because fog gates a real movement rule
        // (an unseen enemy doesn't block a path), not just what gets drawn.
        this.visionCache = null;
        this.visionDirty = true;

        // Optional client hook. The edge `units` accessor hides whatever unit
        // the player is currently dragging, so it renders lifted off the board
        // and doesn't block its own move. That is a client concern, but ~90
        // call sites read edge.units and rely on the filtered view, so rather
        // than reaching for the client's gameState.draggingUnit from inside the
        // engine, the client installs a predicate here (see js/main.js).
        // Stays null headless, which is why js/server/ now runs in a Worker.
        // Transitional: A2 makes dragging a pure client-side prediction that
        // never touches engine state, at which point this can go.
        this.unitVisibilityFilter = null;
    }

    Emit(event) {
        this.pendingEvents.push(event);
    }

    DrainEvents() {
        const events = this.pendingEvents;
        this.pendingEvents = [];
        return events;
    }
}

// The legacy global `ActionManager` object (state.js) is retired now that the
// actions it guarded live in js/server/actions.js/turn-lifecycle.js — this is
// the only ActionManager, instance-owned per §5.2.
class ActionManager {
    constructor(engineInstance) {
        this.engine = engineInstance;
    }

    SubmitAction(action) {
        const historyEntry = JSON.parse(JSON.stringify(action));
        this.engine.state.matchHistory.push(historyEntry);
    }
}

function CreateEngineInstance() {
    return new FortHexEngine();
}
