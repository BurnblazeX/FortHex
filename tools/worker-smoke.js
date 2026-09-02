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
    'js/server/validation.js',
    'js/server/state-filter.js',
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

        // --- A1 §6/§11: one real action through all four message shapes ---
        const received = [];
        const transport = CreateLocalTransport(a);
        transport.OnMessage(m => received.push(m));

        const connectAck = await step('connect', () => transport.Send(MakeConnectMessage('smoke-test')));
        if (!connectAck.ok) throw new Error('connect rejected');

        const mover = a.state.units.find(u => u.player === 1 && u.positionType === 'edge');
        const moves = getPossibleMoves(mover);
        if (moves.size === 0) throw new Error('no legal move to test with');
        const [dest] = moves.entries().next().value;
        const from = mover.position;

        // Payload is ids and keys only; the server recomputes cost and path.
        const moveAck = await step('action:move', () => transport.Send(
            MakeActionMessage('move', { unitId: mover.id, targetEdgeKey: dest })));
        if (!moveAck.ok) throw new Error('legal move rejected: ' + moveAck.error);
        if (mover.position !== dest) throw new Error('engine state did not change');

        const sync = received.find(m => m.type === 'state-sync');
        if (!sync) throw new Error('no state-sync came back');

        // --- A2 §11: the unhappy paths validation exists to catch ---
        const historyBefore = a.state.matchHistory.length;
        const rejections = {};
        const expectReject = async (name, msg, wanted) => {
            const before = JSON.stringify({ p: a.state.currentPlayer, u: a.state.units.length });
            const ack = await step('reject:' + name, () => transport.Send(msg));
            if (ack.ok) throw new Error(name + ' was ACCEPTED but should have been rejected');
            if (ack.error !== wanted) throw new Error(name + ' gave ' + ack.error + ', wanted ' + wanted);
            const after = JSON.stringify({ p: a.state.currentPlayer, u: a.state.units.length });
            if (before !== after) throw new Error(name + ' mutated state despite rejection');
            rejections[name] = ack.error;
        };

        const enemy = a.state.units.find(u => u.player === 2 && u.positionType === 'edge');
        const enemyMoves = getPossibleMoves(enemy);

        await expectReject('unknown_action',
            MakeActionMessage('fly-to-the-moon', { unitId: mover.id }), 'unknown_action');

        await expectReject('malformed_payload',
            MakeActionMessage('move', { unitId: mover.id }), 'malformed_payload');

        await expectReject('unit_not_found',
            MakeActionMessage('move', { unitId: 999999, targetEdgeKey: dest }), 'unit_not_found');

        await expectReject('not_your_turn',
            MakeActionMessage('move', { unitId: enemy.id,
                targetEdgeKey: enemyMoves.size ? enemyMoves.keys().next().value : dest }), 'not_your_turn');

        // A well-formed move to a destination that is not in this unit's legal set.
        const illegalDest = [...a.state.edges.keys()].find(k => !getPossibleMoves(mover).has(k) && k !== mover.position);
        await expectReject('illegal_action',
            MakeActionMessage('move', { unitId: mover.id, targetEdgeKey: illegalDest }), 'illegal_action');

        // A client lying about unit state must be ignored, not believed.
        const hpBefore = mover.hp;
        await step('action:spoofed-payload', () => transport.Send(MakeActionMessage('move', {
            unitId: mover.id, targetEdgeKey: dest,
            unit: { id: mover.id, hp: 9999, currentMove: 9999 }, cost: 0, path: []
        })));
        if (mover.hp !== hpBefore) throw new Error('client-supplied hp was trusted');

        if (a.state.matchHistory.length !== historyBefore) {
            throw new Error('a rejected action reached matchHistory');
        }

        const rejectEvents = received.filter(m => m.type === 'state-sync')
            .flatMap(m => m.events).filter(e => e.type === 'ACTION_REJECTED');
        if (rejectEvents.length === 0) throw new Error('no ACTION_REJECTED events emitted');

        // --- every action's Resolve() must at least RUN ---
        // The fortify spec shipped calling canUnitFortifyOnTile(unit, tileKey) when
        // that function takes a tile OBJECT - a crash, not a rejection, and invisible
        // because only the move action was being exercised. So: drive every spec through
        // validation and assert it returns a verdict rather than throwing. A clean
        // rejection is a pass here; the point is that the code path executes.
        const specCoverage = {};
        const drive = async (action, payload) => {
            let ack;
            try {
                ack = await step('spec:' + action, () => transport.Send(MakeActionMessage(action, payload)));
            } catch (err) {
                throw new Error('spec ' + action + ' THREW instead of returning a verdict: ' + err.message);
            }
            if (typeof ack.ok !== 'boolean') throw new Error('spec ' + action + ' returned no verdict');
            specCoverage[action] = ack.ok ? 'accepted' : ack.error;
        };

        const anyUnit = a.state.units.find(u => u.player === a.state.currentPlayer);
        const anyEdge = [...a.state.edges.keys()][0];
        const anyTile = [...a.state.tiles.keys()][0];

        await drive('fortify',      { unitId: anyUnit.id, targetTileKey: anyTile });
        await drive('unfortify',    { unitId: anyUnit.id, targetEdgeKey: anyEdge });
        await drive('build-bridge', { unitId: anyUnit.id, targetEdgeKey: anyEdge });
        await drive('upgrade-unit', { unitId: anyUnit.id, statType: 'damage' });
        const badStat = await step('spec:upgrade-unit(bad stat)', () => transport.Send(
            MakeActionMessage('upgrade-unit', { unitId: anyUnit.id, statType: 'not-a-stat' })));
        if (badStat.ok) throw new Error('an unknown statType was accepted');
        specCoverage['upgrade-unit(bad stat)'] = badStat.error;
        await drive('swap-class',   { unitId: anyUnit.id, newTypeName: 'ARCHER' });
        await drive('spawn-unit',   { player: a.state.currentPlayer, unitTypeName: 'MELEE' });
        await drive('attack',       { unitId: anyUnit.id, targetUnitId: 12345, attackType: 'Melee' });

        // Editor actions run on the lighter path.
        await drive('paint-tile',   { tileKey: anyTile, tileTypeName: 'FOREST' });
        await drive('erase-tile',   { tileKey: anyTile });
        await drive('flood-fill',   { startQ: 0, startR: 0, tileTypeName: 'PLAINS' });
        await drive('place-unit',   { player: 1, unitTypeName: 'MELEE', edgeKey: anyEdge });
        await drive('remove-unit',  { unitId: anyUnit.id });
        await drive('toggle-base-camp', { player: 1, tileKey: anyTile });
        await drive('set-base-camp-rotation', { rotation: '3' });

        // A genuinely legal fortify, so the happy path is proven and not just the
        // rejection path (this is the case that was crashing in the browser).
        const fortifier = a.state.units.find(u =>
            u.player === a.state.currentPlayer && u.positionType === 'edge' &&
            GetValidFortifyTargets(u).length > 0);
        let fortifyOutcome = 'no eligible unit on this generated map';
        if (fortifier) {
            const target = GetValidFortifyTargets(fortifier)[0];
            const ack = await step('action:fortify(legal)', () => transport.Send(
                MakeActionMessage('fortify', { unitId: fortifier.id, targetTileKey: target })));
            if (!ack.ok) throw new Error('a legal fortify was rejected: ' + ack.error + ' / ' + ack.detail);
            if (!fortifier.isFortified) throw new Error('fortify accepted but unit is not fortified');
            fortifyOutcome = 'fortified on ' + target;
        }

        // --- regression guard: rules must not depend on the drag filter ---
        // engine.unitVisibilityFilter hides the unit a player is dragging from
        // edge.units. That is a RENDERING concern, but it used to leak into
        // isZoCSuppressed: an arriving unit suppressed the zone that should have
        // been damaging it, unless the player happened to be dragging, in which
        // case the filter hid it and the damage landed. Same move, different
        // outcome depending on input method. Found by replaying a real match log.
        //
        // Any rule that reads edge.units must give the same answer with the
        // filter installed and without it.
        const dragParity = await step('drag/click parity', async () => {
            const probe = CreateEngineInstance();
            const saved = globalThis.engine;
            globalThis.engine = probe;
            probe.settings.animationsEnabled = false;
            InitializeGrid();

            const arch = probe.state.units.find(u => u.id === 'u_p2_ARCHER_t1_6');
            arch.position = '0,1'; arch.positionType = 'center'; arch.isFortified = true;
            probe.state.tiles.get('0,1').fortifiedByPlayer = 2;

            const [m, a2, h] = ['u_p1_MELEE_t1_1', 'u_p1_ARCHER_t1_2', 'u_p1_HORSEMAN_t1_4']
                .map(id => probe.state.units.find(u => u.id === id));
            m.position = '-1,1_0,1'; a2.position = '-1,1_0,1'; h.position = '0,1_1,0';
            [m, a2, h].forEach(u => { u.positionType = 'edge'; });

            const hpStart = h.hp;
            probe.unitVisibilityFilter = null;
            ApplyFortificationDamageOnMove(h, '0,1_1,0');
            const clicked = hpStart - h.hp;

            h.hp = hpStart;
            probe.unitVisibilityFilter = (u) => u.id !== h.id;
            ApplyFortificationDamageOnMove(h, '0,1_1,0');
            const dragged = hpStart - h.hp;
            probe.unitVisibilityFilter = null;

            globalThis.engine = saved;
            if (clicked !== dragged) {
                throw new Error('a rule changed with the drag filter: clicked took ' +
                                clicked + ' damage, dragged took ' + dragged);
            }
            if (dragged === 0) {
                throw new Error('an arriving unit took no ZoC damage - it is suppressing the zone it walked into');
            }
            return { clicked, dragged };
        });

        const byeAck = await step('disconnect', () => transport.Send(MakeDisconnectMessage('smoke_done')));

        // async action (animation-delayed path) through the same seam
        a.settings.animationsEnabled = false;
        await step('action:end-turn', () => transport.Send(MakeActionMessage('end-turn', {})));
        if (a.state.currentPlayer !== 2) throw new Error('turn did not advance');
        if (a.pendingEvents.length !== 0) throw new Error('event queue not drained by Flush');

        // --- A2 §5: per-recipient fog filtering ---
        a.settings.fogOfWarEnabled = true;
        const filtered = FilterStateForPlayer(a.state, 1, a.settings.fogOfWarEnabled);
        const hiddenLeak = filtered.units.some(u => u.player === 2 && u.hidden !== true && !filtered.visibleEdges.has(u.position));
        if (hiddenLeak) throw new Error('filtered payload leaked a fogged enemy position');

        parentPort.postMessage({
            ok: true,
            steps: trace.length,
            moved: from + ' -> ' + mover.position,
            rejections,
            dragParity,
            specCoverage,
            fortifyOutcome,
            rejectEvents: rejectEvents.length,
            filteredUnitsVisibleToP1: filtered.units.filter(u => !u.hidden).length,
            totalUnits: a.state.units.length,
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
        console.log('  rejections      :', Object.entries(m.rejections).map(([k, v]) => k + '=' + v).join(', '));
        console.log('  reject events   :', m.rejectEvents);
        console.log('  drag/click      : identical, ' + m.dragParity.clicked + ' ZoC damage either way');
        console.log('  legal fortify   :', m.fortifyOutcome);
        console.log('  every spec ran  :', Object.keys(m.specCoverage).length, 'actions ->',
                    Object.entries(m.specCoverage).map(([k, v]) => k + ':' + v).join(' '));
        console.log('  fog filter      :', m.filteredUnitsVisibleToP1 + '/' + m.totalUnits, 'units visible to P1');
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
