// === Transport-agnostic message interface + local adapter (A1 step 11) ===
//
// The guide's §6 asks for two things: the SHAPE of the four messages any
// transport carries, and one working local in-process adapter that uses them.
// This file is both. Real networking (UPnP/WebRTC/WebSocket) is Track B, and
// each of those adapters replaces LocalTransport while keeping these shapes.
//
// Why this file sits directly in /js rather than under client/ or server/:
// it is the seam between them and is imported by both sides, which is the same
// reason config-data.js and grid-math.js live here. §4.0 asks that any
// additional shared file be flagged rather than added quietly - consider this
// the flag.
//
// What the local adapter does NOT do, deliberately: serialize. An in-process
// call can pass live object references (a unit, a Map of moves), and doing so
// keeps A1 a refactor rather than a rewrite. A real transport has to JSON these
// payloads, which is exactly where A2's server-side validation belongs - the
// action table below is the single choke point where that will go.

const TRANSPORT_PROTOCOL_VERSION = 1;

// --- Client -> Server ---

function MakeConnectMessage(profileId, options = {}) {
    return { type: 'connect', profileId, protocolVersion: TRANSPORT_PROTOCOL_VERSION, ...options };
}

function MakeActionMessage(action, payload = {}) {
    return { type: 'action', action, payload };
}

function MakeDisconnectMessage(reason = 'client_closed') {
    return { type: 'disconnect', reason };
}

// --- Server -> Client ---

function MakeStateSyncMessage(events, stateVersion) {
    return { type: 'state-sync', events, stateVersion };
}

// The server's action table: the only place an action name maps to an engine
// function. A2 adds "is this legal, is it this player's turn" in front of each
// entry; A1 just needs the indirection to exist so there's somewhere to put it.
const SERVER_ACTION_HANDLERS = {
    'move':         (p) => ApplyMoveAction(p.unit, p.targetEdgeKey, p.cost, p.path),
    'attack':       (p) => ApplyAttack(p.attackingUnit, p.targetUnitInfo, p.attackType, p.duration),
    'fortify':      (p) => ApplyFortify(p.unit, p.targetTileKey, p.duration),
    'unfortify':    (p) => ApplyUnfortify(p.unit, p.targetEdgeKey, p.duration),
    'build-bridge': (p) => ApplyBuildBridge(p.unit, p.targetEdgeKey, p.duration),
    'upgrade-unit': (p) => ApplyUnitUpgrade(p.unit, p.statType),
    'swap-class':   (p) => ApplyClassSwap(p.unit, p.newType),
    'spawn-unit':   (p) => SpawnUnit(p.player, p.unitType),
    'end-turn':     () => AdvanceTurn(),
};

class LocalTransport {
    constructor(engineInstance) {
        this.engine = engineInstance;
        this.subscribers = new Set();
        this.stateVersion = 0;
        this.connected = false;
    }

    // Client side: listen for server -> client messages.
    OnMessage(handler) {
        this.subscribers.add(handler);
        return () => this.subscribers.delete(handler);
    }

    Deliver(message) {
        this.subscribers.forEach(handler => handler(message));
    }

    // Client side: send a client -> server message.
    Send(message) {
        switch (message.type) {
            case 'connect':    return this.HandleConnect(message);
            case 'action':     return this.HandleAction(message);
            case 'disconnect': return this.HandleDisconnect(message);
            default:
                console.warn('[Transport] Unknown message type:', message.type);
                return { ok: false, error: 'unknown_message_type' };
        }
    }

    HandleConnect(message) {
        this.connected = true;
        // A real transport would send a full state snapshot here. In-process
        // there's nothing to snapshot - the client reads engine.state directly -
        // so this just flushes anything already queued.
        this.Flush();
        return { ok: true, connected: true, profileId: message.profileId };
    }

    HandleDisconnect(message) {
        this.connected = false;
        // The 100-second reconnect countdown is A3's job, not A1's. The message
        // shape exists so A3 has something to hang it on.
        return { ok: true, connected: false, reason: message.reason };
    }

    HandleAction(message) {
        const handler = SERVER_ACTION_HANDLERS[message.action];
        if (!handler) {
            console.warn('[Transport] Unknown action:', message.action);
            return { ok: false, error: 'unknown_action' };
        }

        const outcome = handler(message.payload || {});

        // The animation-delayed actions (fortify/unfortify/bridge/attack) and
        // end-turn are async; flush only once they've actually finished.
        if (outcome && typeof outcome.then === 'function') {
            return outcome.then(result => ({ ok: true, result, sync: this.Flush() }));
        }
        return { ok: true, result: outcome, sync: this.Flush() };
    }

    // Drain the engine's queue and push it out as a state-sync. This is the
    // single drain point in the app: "drain and render" here, "drain and send
    // over the wire" in Track B's adapters, same call.
    Flush() {
        const events = this.engine.DrainEvents();
        if (events.length === 0) return null;

        this.stateVersion++;
        const sync = MakeStateSyncMessage(events, this.stateVersion);
        this.Deliver(sync);
        return sync;
    }
}

function CreateLocalTransport(engineInstance) {
    return new LocalTransport(engineInstance);
}
