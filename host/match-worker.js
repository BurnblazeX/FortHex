// === One match, running the real engine in a bare-Node worker (B2 groundwork) ===
//
// Appended after the js/server bundle by host/server-bundle.js and evaluated as one
// source string, so everything above is already in this worker's global scope.
//
// WHY A WORKER PER MATCH, and not many matches in one process:
//
// A1 made engine STATE per-instance - CreateEngineInstance() genuinely returns
// independent state, and worker-smoke.js asserts two instances don't share it. But
// the ~440 call sites across js/server/ all read an AMBIENT global `engine`, not an
// argument. worker-smoke.js sets `globalThis.engine = a` for exactly that reason.
//
// So two concurrent matches in one process would trample each other. Threading an
// engine parameter through every call site is a large refactor with no gameplay
// payoff; a worker thread has its own globals for free, and A1 specified a
// Worker-based server anyway. One worker per match is therefore the design, not a
// workaround - but it is a real constraint on how many matches one box can hold,
// and it should be measured before anyone promises a number.

// TWO HOSTS, ONE DRIVER. This file runs unchanged in a Node worker_threads worker
// (host/server.js) and in a browser Web Worker (js/client/p2p-worker.js, the P2P host
// peer). Both are "a worker that owns one engine and talks to a parent over messages",
// which is the entire contract below - so they share the driver rather than keeping two
// copies that would drift. Drift between the server's match rules and a P2P host's is
// the worst possible place for it: the same game would be two games.
//
// The browser has no worker_threads, so it installs the same two bindings itself
// before importScripts()ing this file. Everything past this line is identical.
const { parentPort, workerData } = (typeof globalThis.FORTHEX_WORKER_HOST === 'object'
    && globalThis.FORTHEX_WORKER_HOST !== null)
    ? globalThis.FORTHEX_WORKER_HOST
    : require('worker_threads');

globalThis.engine = CreateEngineInstance();
engine.state.matchId = workerData.matchId;

// A hosted match has no local profile and no consent of its own - those are
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

// A hosted match has real, separate recipients - which is the whole difference
// between this and a browser running LocalTransport for one device. Each player
// gets their own connection, so each gets A2's filters applied and their own board
// view attached (js/transport.js Flush).
//
// Falling back to the omniscient OnMessage when no players are named keeps the
// original A1 behaviour for anything that just wants the raw stream.
const hostedPlayers = Array.isArray(workerData.players) ? workerData.players : null;

// One report per lapse - 'tick' runs every second and the state persists.
let reportedLapse = false;

// Same shape, for the match ENDING. The parent has no other way to learn it: it sees
// wire bytes it does not decode and acks it does not read, so a match that reached a
// verdict looked identical to one still in progress. That is why a finished room sat
// there listed as live, holding its ~12.4 MB worker until the abandonment sweep
// eventually noticed nobody was connected.
let reportedMatchOver = false;

function ReportMatchOver() {
    if (reportedMatchOver || !engine.state.gameOver) return;
    reportedMatchOver = true;
    // Posted AFTER whatever produced it: the wire messages carrying the VICTORY event
    // and the final board are already queued to the parent by the time this runs, and
    // postMessage preserves order. So both players are told they lost or won before
    // the parent is told to start winding the room down.
    parentPort.postMessage({ type: 'match-over', verdict: engine.matchVerdict || null });
}

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
                // The four shapes, unchanged. The worker does not interpret them -
                // SubmitAction validates, the engine decides, the transport replies.
                const outcome = transport.Send(envelope.message);
                const settle = (value) => parentPort.postMessage({
                    type: 'ack',
                    requestId: envelope.requestId,
                    outcome: Sanitize(value),
                });
                if (outcome && typeof outcome.then === 'function') {
                    outcome.then(value => { settle(value); ReportMatchOver(); });
                } else {
                    settle(outcome);
                    ReportMatchOver();
                }
                break;
            }

            case 'start-match': {
                // A SAVE takes precedence over any map: resuming means the board is
                // already decided, and a map choice alongside it is stale UI state, not
                // an instruction. Migration happened on the uploader's machine, where a
                // person could answer the modernisation question; what arrives here is
                // settled.
                if (envelope.resumeSave) {
                    const resumed = ResumeMatchFromSave(envelope.resumeSave);
                    if (!resumed.ok) {
                        parentPort.postMessage({
                            type: 'host-error', where: 'resume', error: resumed.error,
                        });
                        break;
                    }
                    transport.Flush();
                    parentPort.postMessage({
                        type: 'started',
                        matchId: engine.state.matchId,
                        units: resumed.units,
                        tiles: resumed.tiles,
                        resumed: true,
                    });
                    break;
                }

                // Radius and layout come from whoever created the room.
                //
                // A PRESET map arrives as a name and is looked up here, because this
                // worker has config-data.js and does not need a board posted to it. A map
                // loaded from a FILE has no name this side knows, so it arrives whole in
                // `customMap`.
                const custom = envelope.customMap || null;
                const map = custom || FindSelectableMap(envelope.mapName);

                // Tiles cross the wire as pairs, because a Map does not survive JSON.
                const tiles = Array.isArray(map.tiles) ? new Map(map.tiles) : (map.tiles || null);
                const radius = map.radius || 3;

                // THE ORDER MATTERS. SetGridMode writes gridRadius and gameMode (radius 2
                // is arcade and clears base camps), InitializeGridDimensions builds a grid
                // of that size, and only then does InitializeGrid have somewhere to put the
                // map. Skipping the first two built a radius-3 board and poured a radius-4
                // map into it, losing every tile outside the smaller ring.
                SetGridMode(radius);
                InitializeGridDimensions(radius);

                // An object of two nulls is truthy, and InitializeGrid tests for presence
                // rather than contents - passing one through would overwrite the camps
                // InitializeGridDimensions just placed. Same normalisation the client does
                // in StartMatchFromMenu, for the same reason.
                const camps = map.baseCampPositions;
                const hasOwnCamps = !!(camps && (camps.player1 || camps.player2));

                InitializeGrid(tiles, map.units || null, hasOwnCamps ? camps : null);

                // Preset maps carry their own camps, and the flags have to follow them or
                // a returned flag lands where the previous map's camp was.
                if (engine.state.flags && hasOwnCamps && camps.player1) {
                    engine.state.flags.p1_flag.homePosition = engine.state.baseCampPositions.player1;
                    engine.state.flags.p2_flag.homePosition = engine.state.baseCampPositions.player2;
                }
                transport.Flush();
                parentPort.postMessage({
                    type: 'started',
                    matchId: engine.state.matchId,
                    units: engine.state.units.length,
                    tiles: engine.state.tiles.size,
                });
                break;
            }

            case 'tick': {
                // A3 could only check the deadline when a client SENT something - the
                // engine had no way to speak unprompted, so the check rode along on a
                // heartbeat. That fails at exactly the moment it matters: the player
                // who dropped is not sending heartbeats, and if they were the only one
                // connected the deadline would never be examined at all.
                //
                // A hosted match has a real server process that can simply look at the
                // clock, so it does. Flush pushes whatever that produced.
                CheckDisconnectDeadlines();
                transport.Flush();

                // A match can end without a client message - the arcade turn cap and a
                // lapsed disconnect both settle on the clock. Cheap to ask, and it is
                // the only thing covering those paths.
                ReportMatchOver();

                // The engine raises DISCONNECT_RESOLUTION_NEEDED to the PLAYERS, but the
                // host process also has a decision to make - whether the room survives -
                // and it should not have to parse the wire stream to find out. Reported
                // once, the first time the state appears.
                const awaiting = FindPlayerAwaitingResolution();
                if (awaiting !== null && !reportedLapse) {
                    reportedLapse = true;
                    parentPort.postMessage({ type: 'resolution-needed', player: awaiting });
                }
                break;
            }

            case 'resync': {
                // A full board per player, pushed on demand.
                //
                // This exists because of an ordering problem that cannot be solved by
                // moving code around: the worker flushes the opening board as part of
                // start-match, but a client does not subscribe to match traffic until
                // it is told the match started - which is necessarily afterwards. The
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
// throwing, because an ack is a courtesy - the authoritative answer is the
// state-sync that follows it.
function Sanitize(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return { ok: !!(value && value.ok), unserializable: true };
    }
}

parentPort.postMessage({ type: 'ready', matchId: engine.state.matchId });
