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

// A returning client can't be caught up from the event queue - that queue holds
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
        this.connections = [];
        this.stateVersion = 0;
        this.connected = false;
    }

    // Client side: listen for server -> client messages.
    //
    // An OnMessage subscriber is OMNISCIENT - it receives the unfiltered event
    // stream. That is correct for the one case it serves: local pass-device play,
    // where a single browser draws the board for both humans and the handover is
    // covered by showPassDeviceOverlay. Filtering here would blank out the player
    // whose turn it is not, which is not a thing local play wants.
    OnMessage(handler) {
        return this.AddConnection(null, handler);
    }

    // B2: a recipient that IS a specific player. Everything it receives is passed
    // through A2's filters first, and it gets a board view attached to each sync so
    // it can actually draw the result rather than being told about it in prose.
    //
    // This is where A2's deferral comes due. FilterStateForPlayer and
    // FilterEventsForPlayer were written in A2 and deliberately left unwired,
    // because with one local recipient there was nothing to filter FROM. A remote
    // player is that missing recipient.
    AddConnection(player, handler) {
        const connection = { player, handler };
        this.connections.push(connection);
        return () => {
            this.connections = this.connections.filter(existing => existing !== connection);
        };
    }

    // Unconditional fan-out, for messages that are already addressed - a resync is
    // built for one player and delivered as-is. Per-recipient work happens in Flush.
    Deliver(message) {
        this.connections.forEach(connection => connection.handler(message));
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
        // A TAKEOVER is not a return, and does not go looking for one. Somebody with
        // no history in this match is sitting down in an absent player's chair, so
        // there is no profile to match against and asking for one would refuse every
        // hot join. The seat is named explicitly because only the HOST knows which one
        // was on offer - it applied the room's policy (public only, and only after the
        // seat's own player has had a head start) before letting this message be sent.
        //
        // Trusting `message.player` here is safe for the same reason every other seat
        // number is: host/server.js stamps it from what it recorded at join time, and a
        // client cannot reach this code path by asking for it.
        const takeover = message.takeover === true
            && (message.player === 1 || message.player === 2);

        const claim = takeover
            ? { player: message.player, refused: null }
            : FindReturningPlayerSlot(message.profileId);
        let resync = null;

        if (claim.refused) {
            // Came back after the window already resolved the match. Say so
            // rather than quietly reattaching them to a match that moved on.
            console.warn('[Server] Reconnect refused: ' + claim.refused);
        } else if (claim.player !== null) {
            const outcome = takeover
                ? TakeOverPlayer(claim.player, message.profileId, message.name)
                : ReconnectPlayer(claim.player, message.profileId);
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

        // One player dropped. The transport itself stays up - the other client
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

    // Drain the engine's queue and push it out as a state-sync. This is the single
    // drain point in the app: "drain and render" for a local subscriber, "drain,
    // filter and send over the wire" for a player-scoped one, same call.
    //
    // The queue is drained ONCE and then shaped per recipient. Draining per
    // connection would hand the first one everything and the rest an empty queue.
    Flush() {
        const events = this.engine.DrainEvents();
        if (events.length === 0) return null;

        this.stateVersion++;
        const fog = this.engine.settings.fogOfWarEnabled;
        let localSync = null;

        this.connections.forEach(connection => {
            if (connection.player === null) {
                const sync = MakeStateSyncMessage(events, this.stateVersion);
                localSync = localSync || sync;
                connection.handler(sync);
                return;
            }

            const sync = MakeStateSyncMessage(
                FilterEventsForPlayer(events, connection.player, fog),
                this.stateVersion
            );

            // The renderable half. Events say what happened; this says what the board
            // now looks like from where this player is standing. A remote client that
            // received only events could not draw a move - ApplyMoveAction emits LOG
            // lines and nothing positional.
            //
            // A whole filtered view per action rather than a true diff: the board is
            // small, the game is turn-based, and a snapshot cannot drift out of sync
            // with the server the way an accumulated diff can. Revisit if it ever
            // measures as a problem.
            sync.view = BuildResyncSnapshot(connection.player);

            connection.handler(sync);
        });

        // The return value is for the caller that triggered this, which is always
        // the local side; a remote player's copy went out through their handler.
        return localSync || MakeStateSyncMessage(events, this.stateVersion);
    }
}

function CreateLocalTransport(engineInstance) {
    return new LocalTransport(engineInstance);
}
