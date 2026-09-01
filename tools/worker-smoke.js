// FortHex — headless acceptance harness for js/server/  (Track A1, guide §5.3 + §9)
//
// Loads the shared + server modules inside a bare Node worker_thread — no
// document, no window, no localStorage — and runs real game logic through them.
// This is the actual proof of "DOM-free": a visual code read is not sufficient,
// because canvas/window references hide in rarely-hit branches.
//
//   node tools/worker-smoke.js
//
// Exit code 0 = pass. Any client-global or DOM reference that leaks back into
// js/server/ will fail this loudly, with the step name it died on.

const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Load order matters only in that everything must be present; these are the
// files index.html loads before the client, minus anything client-side.
const SERVER_BUNDLE = [
    'js/config-data.js',
    'js/grid-math.js',
    'js/server/engine.js',
    'js/server/rules.js',
    'js/server/actions.js',
    'js/server/turn-lifecycle.js',
    'js/server/match-setup.js',
    'js/server/map-generation.js',
    'js/transport.js',
];

const HARNESS = `
(async () => {
    const { parentPort } = require('worker_threads');
    const trace = [];
    const step = async (name, fn) => { trace.push(name); return await fn(); };
    try {
        if (typeof document !== 'undefined')     throw new Error('document exists in worker');
        if (typeof window !== 'undefined')       throw new Error('window exists in worker');
        if (typeof localStorage !== 'undefined') throw new Error('localStorage exists in worker');

        // --- guide §5.3: instances must be independent ---
        const a = CreateEngineInstance();
        const b = CreateEngineInstance();
        a.state.currentPlayer = 2;
        a.state.supplyPoints.player1 = 99;
        if (b.state.currentPlayer !== 1 || b.state.supplyPoints.player1 !== 10) {
            throw new Error('engine instances share state');
        }
        a.state.currentPlayer = 1;
        a.state.supplyPoints.player1 = 10;

        globalThis.engine = a;
        await step('InitializeGrid', () => InitializeGrid());
        if (a.state.units.length === 0) throw new Error('no units placed');

        // --- rules that used to reach for the client's gameState ---
        await step('getPossibleMoves',              () => getPossibleMoves(a.state.units[0]));
        await step('computePlayerVision',           () => computePlayerVision(1));
        await step('recalculatePlayerSupplyNetwork',() => recalculatePlayerSupplyNetwork(1));
        await step('SpawnUnit',                     () => SpawnUnit(1, UNIT_TYPES.MELEE));

        // --- turn lifecycle ---
        await step('CheckVictoryCondition',      () => CheckVictoryCondition());
        await step('ApplyStartOfTurnZoCDamage',  () => ApplyStartOfTurnZoCDamage());
        await step('ApplyMountainAttrition',     () => ApplyMountainAttrition());
        await step('ApplyStartOfTurnHealing',    () => ApplyStartOfTurnHealing());
        await step('LogSiegeStatus',             () => LogSiegeStatus());
        await step('ApplyRespawnQueueTick',      () => ApplyRespawnQueueTick());

        // --- guide §6/§11: one real action through all four message shapes ---
        const received = [];
        const transport = CreateLocalTransport(a);
        transport.OnMessage(m => received.push(m));

        const connectAck = await step('connect', () => transport.Send(MakeConnectMessage('smoke-test')));
        if (!connectAck.ok) throw new Error('connect rejected');

        const mover = a.state.units.find(u => u.player === 1 && u.positionType === 'edge');
        const moves = getPossibleMoves(mover);
        if (moves.size === 0) throw new Error('no legal move to test with');
        const [dest, info] = moves.entries().next().value;
        const from = mover.position;

        const moveAck = await step('action:move', () => transport.Send(
            MakeActionMessage('move', { unit: mover, targetEdgeKey: dest, cost: info.cost, path: info.path })));
        if (mover.position !== dest) throw new Error('engine state did not change');

        const sync = received.find(m => m.type === 'state-sync');
        if (!sync) throw new Error('no state-sync came back');

        const badAck = await step('action:unknown', () => transport.Send(MakeActionMessage('not-a-real-action', {})));
        if (badAck.ok) throw new Error('unknown action was not rejected');

        const byeAck = await step('disconnect', () => transport.Send(MakeDisconnectMessage('smoke_done')));

        // async action (animation-delayed path) through the same seam
        a.settings.animationsEnabled = false;
        await step('action:end-turn', () => transport.Send(MakeActionMessage('end-turn', {})));
        if (a.state.currentPlayer !== 2) throw new Error('turn did not advance');
        if (a.pendingEvents.length !== 0) throw new Error('event queue not drained by Flush');

        parentPort.postMessage({
            ok: true,
            steps: trace.length,
            moved: from + ' -> ' + mover.position,
            stateSync: { stateVersion: sync.stateVersion, eventTypes: sync.events.map(e => e.type) },
            syncsDelivered: received.filter(m => m.type === 'state-sync').length,
            turnAdvancedTo: a.state.currentPlayer,
        });
    } catch (err) {
        parentPort.postMessage({
            ok: false,
            failedAfter: trace[trace.length - 1] || '(startup)',
            error: err.message,
            stack: err.stack.split(String.fromCharCode(10)).slice(0, 5),
        });
    }
})();
`;

const missing = SERVER_BUNDLE.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
    console.error('Missing files:', missing.join(', '));
    process.exit(1);
}

const source = SERVER_BUNDLE.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + HARNESS;

const worker = new Worker(source, { eval: true });
worker.on('message', (m) => {
    if (m.ok) {
        console.log('PASS — js/server/ loads and runs with no DOM, no client globals');
        console.log('  steps run       :', m.steps);
        console.log('  unit moved      :', m.moved);
        console.log('  state-sync      : v' + m.stateSync.stateVersion, '[' + m.stateSync.eventTypes.join(', ') + ']');
        console.log('  syncs delivered :', m.syncsDelivered);
        console.log('  turn advanced to:', m.turnAdvancedTo);
    } else {
        console.error('FAIL after step:', m.failedAfter);
        console.error('  ' + m.error);
        m.stack.forEach(l => console.error('  ' + l));
    }
    process.exit(m.ok ? 0 : 1);
});
worker.on('error', (e) => {
    console.error('WORKER LOAD ERROR — something in js/server/ throws at parse/load time');
    console.error(e.stack);
    process.exit(1);
});
