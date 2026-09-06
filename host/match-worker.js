// === One match, running the real engine in a bare-Node worker (B2 groundwork) ===
//
// Appended after the js/server bundle by host/server-bundle.js and evaluated as one
// source string, so everything above is already in this worker's global scope.
//
// WHY A WORKER PER MATCH, and not many matches in one process:
//
// A1 made engine STATE per-instance — CreateEngineInstance() genuinely returns
// independent state, and worker-smoke.js asserts two instances don't share it. But
// the ~440 call sites across js/server/ all read an AMBIENT global `engine`, not an
// argument. worker-smoke.js sets `globalThis.engine = a` for exactly that reason.
//
// So two concurrent matches in one process would trample each other. Threading an
// engine parameter through every call site is a large refactor with no gameplay
// payoff; a worker thread has its own globals for free, and A1 specified a
// Worker-based server anyway. One worker per match is therefore the design, not a
// workaround — but it is a real constraint on how many matches one box can hold,
// and it should be measured before anyone promises a number.

const { parentPort, workerData } = require('worker_threads');

globalThis.engine = CreateEngineInstance();
engine.state.matchId = workerData.matchId;

// A hosted match has no local profile and no consent of its own — those are
// device-scoped facts about a browser (A5/A6), and this process is not a device.
// Archiving on the server is an unclaimed decision; leaving it false means the host
// records nothing and each client keeps archiving its own view, which is the
// behaviour that already exists.
engine.localProfile = null;
engine.archiveConsent = false;

// Match settings come from whoever created the room. fogOfWarEnabled is the one that
// matters to a hosted match: it decides whether outgoing state is redacted per player
// (js/server/state-filter.js), so it is a property of the match, not of a device.
if (workerData.settings) Object.assign(engine.settings, workerData.settings);

const transport = CreateLocalTransport(engine);

// Everything the engine emits goes to the parent, which fans it out to sockets.
// JSON.stringify is done HERE, not in the parent, so a payload carrying something
// unserializable (a Map, a live unit reference, a circular link) fails inside the
// match that produced it and names itself, rather than silently arriving empty.
//
// This is the check transport.js's header predicted would be needed: LocalTransport
// deliberately passes live references because an in-process call can, and a real
// wire cannot.
function SendToParent(message, player) {
    let encoded;
    try {
        encoded = JSON.stringify(message);
    } catch (error) {
        parentPort.postMessage({
            type: 'host-error',
            where: 'serialize:' + message.type,
            error: error.message,
        });
        return;
    }
    // `player` is who this copy is addressed to, so the parent can put it on the
    // right socket. null means the omniscient stream, which only local play uses.
    parentPort.postMessage({ type: 'wire', encoded, player: player === undefined ? null : player });
}

// A hosted match has real, separate recipients — which is the whole difference
// between this and a browser running LocalTransport for one device. Each player
// gets their own connection, so each gets A2's filters applied and their own board
// view attached (js/transport.js Flush).
//
// Falling back to the omniscient OnMessage when no players are named keeps the
// original A1 behaviour for anything that just wants the raw stream.
const hostedPlayers = Array.isArray(workerData.players) ? workerData.players : null;

if (hostedPlayers && hostedPlayers.length) {
    hostedPlayers.forEach(player => {
        transport.AddConnection(player, (message) => SendToParent(message, player));
    });
} else {
    transport.OnMessage((message) => SendToParent(message, null));
}

parentPort.on('message', (envelope) => {
    try {
        switch (envelope.kind) {
            case 'client-message': {
                // The four shapes, unchanged. The worker does not interpret them —
                // SubmitAction validates, the engine decides, the transport replies.
                const outcome = transport.Send(envelope.message);
                const settle = (value) => parentPort.postMessage({
                    type: 'ack',
                    requestId: envelope.requestId,
                    outcome: Sanitize(value),
                });
                if (outcome && typeof outcome.then === 'function') outcome.then(settle);
                else settle(outcome);
                break;
            }

            case 'start-match': {
                // Radius and layout come from whoever created the room. A hosted match
                // starts on the default board until the menu can express anything else.
                InitializeGrid(envelope.tiles || null, envelope.units || null, envelope.baseCamps || null);
                transport.Flush();
                parentPort.postMessage({
                    type: 'started',
                    matchId: engine.state.matchId,
                    units: engine.state.units.length,
                    tiles: engine.state.tiles.size,
                });
                break;
            }

            case 'resync': {
                // A full board per player, pushed on demand.
                //
                // This exists because of an ordering problem that cannot be solved by
                // moving code around: the worker flushes the opening board as part of
                // start-match, but a client does not subscribe to match traffic until
                // it is told the match started — which is necessarily afterwards. The
                // opening board was therefore emitted into a void, and the first thing
                // a player saw was a blank canvas that stayed blank until somebody
                // moved. Asking for a fresh view AFTER everyone is listening removes
                // the race rather than narrowing it.
                (hostedPlayers || []).forEach(player => {
                    SendToParent(MakeResyncMessage(player, BuildResyncSnapshot(player), 0), player);
                });
                break;
            }

            case 'snapshot': {
                // The save format doubles as the wire format for "give me everything":
                // BuildSaveObject is already asserted JSON-safe by the A4 smoke test,
                // which is exactly the property needed here.
                const { save } = BuildSaveObject(engine, {});
                parentPort.postMessage({ type: 'snapshot', requestId: envelope.requestId, save });
                break;
            }

            default:
                parentPort.postMessage({
                    type: 'host-error',
                    where: 'envelope',
                    error: 'unknown kind: ' + envelope.kind,
                });
        }
    } catch (error) {
        parentPort.postMessage({
            type: 'host-error',
            where: envelope.kind,
            error: error.message,
            stack: (error.stack || '').split('\n').slice(0, 6),
        });
    }
});

// An outcome may carry live engine objects (LocalTransport returns whatever
// SubmitAction did). Anything that will not survive JSON is dropped rather than
// throwing, because an ack is a courtesy — the authoritative answer is the
// state-sync that follows it.
function Sanitize(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return { ok: !!(value && value.ok), unserializable: true };
    }
}

parentPort.postMessage({ type: 'ready', matchId: engine.state.matchId });
