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

// `options` may name the player who dropped (and their profileId). A disconnect
// with no player is the whole local client going away, which is all A1 could
// express; A3 needs the per-player form because absence is tracked per slot.
function MakeDisconnectMessage(reason = 'client_closed', options = {}) {
    return { type: 'disconnect', reason, ...options };
}

// --- Server -> Client ---

function MakeStateSyncMessage(events, stateVersion) {
    return { type: 'state-sync', events, stateVersion };
}

// A returning client can't be caught up from the event queue — that queue holds
// "since the last flush", not "everything since you left". This carries a whole
// filtered view instead, built by BuildResyncSnapshot (js/server/session.js).
function MakeResyncMessage(player, snapshot, stateVersion) {
    return { type: 'state-resync', player, snapshot, stateVersion };
}

// The action table moved to ACTION_SPECS in js/server/validation.js during A2,
// where each entry now carries its validation contract alongside its Apply*
// function. Dispatch goes through ActionManager.SubmitAction (js/server/engine.js),
// which is the sole path from a client request to a mutation.

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

        // A1 noted that a real transport would send a state snapshot here and
        // that in-process there was nothing to snapshot. That holds for a first
        // connect, but not for a RECONNECT: a returning player needs a complete
        // filtered view, so one gets built and delivered for that case only.
        const claim = FindReturningPlayerSlot(message.profileId);
        let resync = null;

        if (claim.refused) {
            // Came back after the window already resolved the match. Say so
            // rather than quietly reattaching them to a match that moved on.
            console.warn('[Server] Reconnect refused: ' + claim.refused);
        } else if (claim.player !== null) {
            const outcome = ReconnectPlayer(claim.player, message.profileId);
            if (outcome.ok) {
                resync = outcome.resync;
                this.stateVersion++;
                this.Deliver(MakeResyncMessage(claim.player, resync, this.stateVersion));
            }
        }

        // Flush after the snapshot: the snapshot is the new baseline, the
        // PLAYER_RECONNECTED event queued behind it is the notification.
        this.Flush();

        return {
            ok: true,
            connected: true,
            profileId: message.profileId,
            reconnected: claim.player,
            refused: claim.refused || null,
            resync,
        };
    }

    HandleDisconnect(message) {
        // No player named: the whole local client is closing, which is the only
        // thing A1's message shape could express. Nobody is "absent" in the A3
        // sense, so there is no countdown to start.
        if (message.player === undefined || message.player === null) {
            this.connected = false;
            return { ok: true, connected: false, reason: message.reason };
        }

        // One player dropped. The transport itself stays up — the other client
        // is still here, and per §6 keeps playing until the turn reaches the
        // absent player.
        const outcome = DisconnectPlayer(message.player, message.reason, message.profileId);
        return { ...outcome, reason: message.reason, sync: this.Flush() };
    }

    HandleAction(message) {
        // Everything - resolution, turn checks, rule legality, the Apply* call,
        // and the matchHistory write - happens inside submitAction. The transport
        // does not know or care which actions exist; it just carries messages.
        const outcome = this.engine.actionManager.SubmitAction(message);

        if (outcome && typeof outcome.then === 'function') {
            return outcome.then(settled => ({ ...settled, sync: this.Flush() }));
        }
        return { ...outcome, sync: this.Flush() };
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
