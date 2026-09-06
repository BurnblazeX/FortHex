// === The match worker, in a browser (B2) ===
//
// Loaded as `new Worker('js/client/p2p-worker.js')` by the P2P host peer. Its whole job
// is to turn a browser Web Worker into the environment host/match-worker.js already
// expects, and then get out of the way.
//
// WHY THIS EXISTS AT ALL - the trap it is here to avoid:
//
// The obvious way to host a P2P match is to let the host's page run the engine it
// already has. That is wrong, and quietly so. Every call site in js/server/ reads an
// AMBIENT global `engine` (see host/match-worker.js for the count), so a page has
// exactly one. If that one engine is both the authority AND the thing the host's
// renderer draws, then ApplyRemoteView writes a FOG-FILTERED view straight onto the
// authoritative board - the host would delete the enemy units it cannot see, from the
// real match, for both players.
//
// Avoiding that by simply not filtering the host's own view is worse: the host would
// see through fog by construction. "A P2P host is authoritative and could cheat if
// they tried" is an accepted trade; "the host sees everything by default" is a broken
// game.
//
// A worker has its own globals, so it gets its own engine for free. The result is that
// the P2P host has the SAME topology as the real server - a worker owns the match, the
// page is a client of it - and the host peer's browser is a remote client of itself.
// Both players go down one code path, which is the only reason to trust that they see
// the same game.
//
// Nothing in here is P2P-specific. The data channel lives in js/client/rtc-transport.js;
// this file has never heard of WebRTC.

// The js/server bundle, in index.html's order minus everything client-side.
//
// This list MIRRORS SERVER_BUNDLE in host/server-bundle.js and must stay identical -
// the two hosts running different game code is the one failure this whole design is
// arranged to prevent. It cannot be imported from there (that is a CommonJS module and
// this is a browser worker), so tools/p2p-smoke.js asserts the two lists match and
// fails the suite if they drift. Do not edit one without the other.
//
// Paths are relative to THIS file, which is how importScripts resolves them.
const P2P_SERVER_BUNDLE = [
    '../config-data.js',
    '../grid-math.js',
    '../testament.js',
    '../server/engine.js',
    '../server/rules.js',
    '../server/actions.js',
    '../server/turn-lifecycle.js',
    '../server/match-setup.js',
    '../server/map-generation.js',
    '../server/validation.js',
    '../server/state-filter.js',
    '../server/session.js',
    '../transport.js',
];

const P2P_MATCH_DRIVER = '../../host/match-worker.js';

// Messages that arrive before the driver is loaded. The host peer posts `init` and then
// immediately starts posting work; importScripts is synchronous but the init round trip
// is not, so there is a real window here and dropping what lands in it would lose the
// opening board.
let pending = [];
let driverHandler = null;
let started = false;

function DeliverToDriver(envelope) {
    if (driverHandler) driverHandler(envelope);
    else pending.push(envelope);
}

self.onmessage = (event) => {
    const data = event.data;

    if (!started && data && data.kind === 'init') {
        started = true;
        Boot(data.workerData || {});
        return;
    }

    DeliverToDriver(data);
};

function Boot(workerData) {
    // The two bindings host/match-worker.js destructures out of `worker_threads`. In a
    // browser there is no such module, so they are installed by hand and the driver
    // picks them up from globalThis instead of requiring.
    globalThis.FORTHEX_WORKER_HOST = {
        workerData,
        parentPort: {
            postMessage: (message) => self.postMessage(message),
            // Node's EventEmitter surface, narrowed to the one event the driver uses.
            on: (eventName, handler) => {
                if (eventName !== 'message') return;
                driverHandler = handler;
                const queued = pending;
                pending = [];
                queued.forEach(handler);
            },
        },
    };

    try {
        importScripts(...P2P_SERVER_BUNDLE, P2P_MATCH_DRIVER);
    } catch (error) {
        // A failed import means there is no engine, so nothing downstream can work.
        // Say which file rather than letting the host peer see a silent dead worker.
        self.postMessage({
            type: 'host-error',
            where: 'importScripts',
            error: error && error.message ? error.message : String(error),
        });
    }
}
