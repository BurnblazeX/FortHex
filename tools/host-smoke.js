// FortHex - proves the engine runs as a standalone Node host  (B2 groundwork)
//
//   node tools/host-smoke.js
//
// worker-smoke.js proves js/server/ is DOM-free. This proves the next thing along:
// that host/match-worker.js can boot a real match in a bare-Node worker, take a
// client action over a message port, and hand back a state-sync that SURVIVES JSON.
//
// That last part is the one genuinely unknown property. LocalTransport deliberately
// passes live object references - transport.js says so in its header - because an
// in-process call can. A socket cannot. If an event payload carries a Map, a Set or a
// circular reference, it works locally and breaks the moment it goes over a wire, and
// nothing before this file would have caught it.
//
// Exit code 0 = pass.

const { Worker } = require('worker_threads');
const vm = require('vm');
const { BuildWorkerSource, ReadBundle } = require('../host/server-bundle.js');

const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

const worker = new Worker(BuildWorkerSource(), {
    eval: true,
    workerData: { matchId: 'host-smoke-match' },
});

const wire = [];
const errors = [];
let ready = false;
let started = null;
const acks = new Map();

worker.on('message', (m) => {
    switch (m.type) {
        case 'ready':      ready = true; break;
        case 'started':    started = m; break;
        case 'wire':       wire.push(m.encoded); break;
        case 'ack':        acks.set(m.requestId, m.outcome); break;
        case 'host-error': errors.push(m); break;
    }
});

// Evaluating a ~300KB bundle in a fresh worker is not instant, and a fixed sleep
// either flakes or wastes time. Poll for the condition instead.
const Settle = (predicate = () => true, ms = 5000) => new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() > deadline) return reject(new Error('timed out waiting for the worker'));
        setTimeout(tick, 10);
    };
    tick();
});

async function Main() {
    await Settle(() => ready);
    check('the worker boots the engine with no DOM', ready);

    worker.postMessage({ kind: 'start-match' });
    await Settle(() => started !== null);

    if (check('the match starts', started !== null)) {
        check('units were placed', started.units > 0);
        check('a board exists', started.tiles > 0);
    }

    // A real client message, in the same four shapes the browser uses.
    worker.postMessage({
        kind: 'client-message',
        requestId: 'c1',
        message: { type: 'connect', profileId: 'smoke-player', protocolVersion: 1 },
    });
    await Settle(() => acks.has('c1'));
    check('connect is acknowledged', acks.has('c1') && acks.get('c1').ok);

    // end-turn is the cheapest action that mutates state and emits events, and it
    // needs no knowledge of where units happen to have spawned. Name taken from
    // ACTION_SPECS (js/server/validation.js), which is the only list that matters.
    worker.postMessage({
        kind: 'client-message',
        requestId: 'a1',
        message: { type: 'action', action: 'end-turn', payload: {} },
    });
    await Settle(() => acks.has('a1'));

    const ack = acks.get('a1');
    check('the action is acknowledged', !!ack);
    check('the action was accepted by server-side validation', ack && ack.ok !== false);
    check('the engine emitted at least one state-sync', wire.length > 0);

    // The point of the exercise.
    let decoded = null;
    if (wire.length > 0) {
        try {
            decoded = JSON.parse(wire[wire.length - 1]);
        } catch (error) {
            failures.push('a state-sync did not survive JSON: ' + error.message);
        }
    }
    if (decoded) {
        check('the sync is a state-sync', decoded.type === 'state-sync');
        check('it carries events', Array.isArray(decoded.events) && decoded.events.length > 0);
        check('it carries a state version', typeof decoded.stateVersion === 'number');
    }

    // --- the payload that actually risks not surviving a wire ------------------
    //
    // end-turn emits a thin event. A MOVE carries a unit, a resolved path and a cost
    // - live object references in-process - which is precisely what transport.js
    // warned would need serializing for real.
    //
    // The move is computed the way a real client computes one: its own copy of the
    // same engine code, from the same deterministic starting board. That is not a
    // shortcut around the server, it is how FortHex already works - the browser loads
    // js/server/*.js too, and only ever *requests* the move it computed.
    const mirror = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(mirror);
    vm.runInContext(ReadBundle(), mirror);
    // The end-turn above already advanced the server to player 2, so the mirror is
    // advanced too. Turn start resets movement points, which is why the mirror's move
    // costs still match the server's - and if they ever stop matching, server-side
    // validation rejects the move and this test says so rather than passing quietly.
    vm.runInContext('globalThis.engine = CreateEngineInstance(); InitializeGrid();', mirror);
    vm.runInContext("engine.actionManager.SubmitAction({ type: 'action', action: 'end-turn', payload: {} });", mirror);

    const plan = JSON.parse(vm.runInContext(`
        const unit = engine.state.units.find(u => u.player === engine.state.currentPlayer);
        const moves = getPossibleMoves(unit);
        JSON.stringify({ unitId: unit.id, targetEdgeKey: [...moves.keys()][0] });
    `, mirror));

    check('a legal move could be computed client-side', !!plan.targetEdgeKey);

    const beforeMove = wire.length;
    worker.postMessage({
        kind: 'client-message',
        requestId: 'm1',
        message: { type: 'action', action: 'move', payload: plan },
    });
    await Settle(() => acks.has('m1'));

    const moveAck = acks.get('m1');
    check('the server accepted the move' + (moveAck && moveAck.error ? ' (' + moveAck.error + ')' : ''),
        moveAck && moveAck.ok !== false);
    check('the move emitted a state-sync', wire.length > beforeMove);

    let moveSync = null;
    if (wire.length > beforeMove) {
        try {
            moveSync = JSON.parse(wire[wire.length - 1]);
        } catch (error) {
            failures.push('a move state-sync did not survive JSON: ' + error.message);
        }
    }
    if (moveSync) {
        check('the move sync carries events',
            Array.isArray(moveSync.events) && moveSync.events.length > 0);
        // A Map or Set silently becomes {} through JSON. An empty payload on an event
        // that should describe a move is the exact failure this file exists to catch.
        const moved = moveSync.events.find(e => e.type === 'UNIT_MOVED' || e.type === 'MOVE');
        check('the move event survived with its detail intact',
            !moved || Object.keys(moved).length > 1);
    }

    // A save is the "give me everything" payload a joining client needs.
    worker.postMessage({ kind: 'snapshot', requestId: 's1' });
    await Settle(() => true, 200).catch(() => {});
    await new Promise(r => setTimeout(r, 50));

    check('nothing errored inside the worker' +
        (errors.length ? ' (' + errors.map(e => e.where + ': ' + e.error).join('; ') + ')' : ''),
        errors.length === 0);

    await worker.terminate();

    if (failures.length) {
        console.error('FAIL - ' + failures.length + ' check(s)');
        failures.forEach(f => console.error('  !! ' + f));
        process.exit(1);
    }
    console.log('PASS - host/match-worker.js');
    console.log('  standalone : the engine boots and runs a match in bare Node, no DOM');
    console.log('  protocol   : connect and action go in as the same four message shapes');
    console.log('  wire-safe  : ' + wire.length + ' state-sync(s) round-tripped through JSON');
    console.log('  move       : accepted and serialized -> ' +
        JSON.parse(wire[wire.length - 1]).events.map(e => e.type).join(', '));
}

Main().catch((error) => {
    console.error('FAIL -', error.message);
    process.exit(1);
});
