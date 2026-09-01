// === FortHexEngine — the authoritative, DOM-free engine shell (A1 step 4) ===
//
// This is a SHAPE ONLY right now — no rules logic lives here yet (that starts
// in A1 step 5+). Its job at this point is just to prove state can be
// instance-owned instead of a global singleton. See
// FortHex_A1_Server_Core_Guide.md §5.
//
// Field list mirrors §5.1 exactly. Several fields in today's global `gameState`
// (gameOver, mustUnfortify, playerActionTaken, selectedUnit, currentActionState,
// the valid*TargetKeys/currentReachableMoves highlight caches) aren't in the
// guide's explicit engine-owned list, so per its own fallback rule ("everything
// not in this list stays client-side") they're left client-owned for now. Some
// of those look arguably authoritative (gameOver, mustUnfortify,
// playerActionTaken gate what actions are legal) — worth a second look once the
// turn-lifecycle MIXED-function migration (step 8) forces the question, but not
// decided here.
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
        };

        // Everything else in today's gameSettings is presentation-only and
        // stays client-side. fogOfWarEnabled is the one exception: it's not
        // cosmetic, it gates what state the server is allowed to send a given
        // client (A2 security requirement).
        this.settings = {
            fogOfWarEnabled: false,
        };

        this.actionManager = new EngineActionManager(this);

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

// Named EngineActionManager, not ActionManager, to avoid colliding with the
// still-active global `ActionManager` object in state.js (core.js/main.js call
// it directly today). Once the legacy global is retired — when the actions it
// guards actually get migrated into js/server/actions.js — this should be
// renamed back to ActionManager and become the only one.
class EngineActionManager {
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
