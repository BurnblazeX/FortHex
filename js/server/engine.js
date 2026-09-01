// === FortHexEngine — the authoritative, DOM-free engine shell ===
//
// Field list mirrors §5.1 plus gameOver (reclassified engine-owned in step 8,
// once real victory-check logic needed to set it authoritatively).
// mustUnfortify/playerActionTaken/selectedUnit/currentActionState/the
// valid*TargetKeys/currentReachableMoves highlight caches stayed client-owned
// per the guide's fallback rule — they never got forced onto the engine side
// the way gameOver did.
//
// This is genuinely live now (see js/state.js) — as of the engine.state
// cutover, every js/server/ pure function reads/writes this instance's state
// directly, not a bare gameState global. gameState (js/state.js) now holds
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
        };

        // Everything else in today's gameSettings is presentation-only and
        // stays client-side. fogOfWarEnabled is the one exception: it's not
        // cosmetic, it gates what state the server is allowed to send a given
        // client (A2 security requirement).
        this.settings = {
            fogOfWarEnabled: false,
        };

        this.actionManager = new ActionManager(this);

        this.pendingEvents = [];
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
