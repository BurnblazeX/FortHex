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

        // Who is currently connected, and if not, how long they have to come
        // back (A3). Same category as pendingVictory: session truth, not match
        // truth, so it sits on the instance and never reaches a save file.
        // See js/server/session.js — including the note there for A4.
        this.playerSessions = {
            player1: MakePlayerSession(),
            player2: MakePlayerSession(),
        };

        // Who is playing at this device, when they have a local profile (A5).
        // Null is the normal state: a profile is created lazily on first entry
        // into Online multiplayer and most players never make one.
        //
        // Declared here so the field is discoverable rather than appearing from
        // outside, and set by the composition root (js/main.js) - the engine is
        // handed plain data and never learns that localStorage exists. Unlike
        // the two fields above it DOES reach a save file: BuildSaveObject
        // (js/testament.js) attaches it as `profile`, which is a record of who
        // wrote the file rather than anything about the board.
        //
        // Track B note: a second concurrent match means a second instance, and
        // whoever creates it owns setting this on it.
        this.localProfile = null;

        // Whether this device has agreed to match archiving (A6). Separate from
        // localProfile on purpose: A5 decided consent never travels into a save
        // file, so ProfileForSave strips it and localProfile carries { id, name }
        // only. Mirroring it here rather than putting it back on that object keeps
        // A5's decision intact and keeps BuildSaveObject unable to leak it by
        // accident.
        //
        // Set by the composition root and kept current by js/client/profile.js,
        // exactly like localProfile. Server-side code reads this boolean and never
        // calls HasArchiveConsent(), which is client-side and needs localStorage.
        //
        // Defaults FALSE. Nothing is archived until somebody has said yes.
        this.archiveConsent = false;
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

    // The ONE path from a client-requested action to a mutation (A2 §3).
    // Nothing else may call an Apply* function for something a client asked for;
    // server-decided cascades (DestroyUnit, SeverSupplyLinesForPlayer, the
    // turn-lifecycle sub-steps) are the deliberate carve-out and never came
    // through here in the first place.
    //
    //   turn check -> id resolution -> rule legality -> Apply* -> history -> events
    //
    // A rejection at any step returns { ok:false, error } and writes NO history:
    // an action that was refused did not happen, so it is not part of the match
    // record. Returns a promise for the async (animation-delayed) actions.
    SubmitAction(message) {
        const spec = ACTION_SPECS[message.action];
        if (!spec) {
            return this.Reject(message, 'unknown_action');
        }

        const verdict = ValidateAction(spec, message);
        if (!verdict.ok) {
            return this.Reject(message, verdict.error, verdict.detail);
        }

        const outcome = spec.Apply(verdict.resolved);

        if (outcome && typeof outcome.then === 'function') {
            return outcome.then(result => {
                this.RecordAccepted(message, verdict);
                this.SettleMatchState(spec);
                return { ok: true, result };
            });
        }
        this.RecordAccepted(message, verdict);
        this.SettleMatchState(spec);
        return { ok: true, result: outcome };
    }

    // Hook for "a client asked for this and we allowed it". Empty from A2 through
    // A5, and this is A6 filling it in - the dispatch point it was left here to
    // mark.
    //
    // What it does NOT do is write anything. A Worker has no IndexedDB any more
    // than it has a disk, so this raises a signal and js/client/archive.js does
    // the storing - the same division ResolveDisconnectOutcome uses, where the
    // server produces a save object and the client decides what happens to it.
    //
    // Turn end is the snapshot point (Burn's call): one write per turn loses at
    // most a turn if a match is abandoned, against one write per action which
    // would mean an IndexedDB write per move for a gap this already closes.
    RecordAccepted(message, verdict) {
        if (!message || message.action !== 'end-turn') return;
        SignalArchiveDue(this.engine, false);
    }

    // The server decides when a match is over, rather than waiting to be asked.
    // Before this, CheckVictoryCondition was called only from the client
    // wrappers - a client that simply never called it would play on forever,
    // which is precisely the hole server authority exists to close. Editor
    // actions are exempt: a map maker has no victory condition.
    //
    // Training is unaffected: it bypasses the transport entirely and calls core
    // logic directly, so it never reaches this dispatch point.
    SettleMatchState(spec) {
        if (spec.editor) return;
        if (this.engine.state.gameOver) return;
        CheckVictoryCondition();
    }

    Reject(message, error, detail) {
        console.warn('[Server] Rejected ' + message.action + ': ' + error + (detail ? ' (' + detail + ')' : ''));
        this.engine.Emit({
            type: 'ACTION_REJECTED',
            action: message.action,
            error,
            detail: detail || null,
            player: this.engine.state.currentPlayer
        });
        return { ok: false, error, detail: detail || null };
    }

    // The A1-era job: append to matchHistory. Called from inside Apply* functions
    // for the fine-grained ledger entries (MOVEMENT_ZOC_HIT, etc.).
    RecordHistory(action) {
        const historyEntry = JSON.parse(JSON.stringify(action));
        this.engine.state.matchHistory.push(historyEntry);
    }
}

// A6. The one place that decides whether a match moment is worth archiving, so
// the turn-end and match-complete triggers cannot drift apart.
//
// Consent is read off the engine instance rather than through profile.js's
// HasArchiveConsent(), which is client-side and needs localStorage - the exact
// constraint that made A5 mirror the profile onto the instance in the first place.
// This function runs inside tools/worker-smoke.js's bare Worker, where reaching for
// a browser API would fail loudly, and that is the point.
//
// Training never reaches here (it bypasses the transport entirely), but it is
// checked anyway: this function is also called from CheckVictoryCondition, which
// training DOES reach.
function SignalArchiveDue(engineInstance, complete) {
    if (!engineInstance || !engineInstance.archiveConsent) return;
    if (engineInstance.state.isTrainingMode) return;
    if (engineInstance.state.mapMakerMode) return;
    if (!engineInstance.state.matchId) return;

    engineInstance.Emit({
        type: 'ARCHIVE_DUE',
        matchId: engineInstance.state.matchId,
        turn: engineInstance.state.globalTurnNumber,
        complete: !!complete,
    });
}

function CreateEngineInstance() {
    return new FortHexEngine();
}
