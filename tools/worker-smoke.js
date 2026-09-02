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
    'js/testament.js',
    'js/server/engine.js',
    'js/server/rules.js',
    'js/server/actions.js',
    'js/server/turn-lifecycle.js',
    'js/server/match-setup.js',
    'js/server/map-generation.js',
    'js/server/validation.js',
    'js/server/state-filter.js',
    'js/server/session.js',
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

        // Session actions, on an engine where nobody is absent: a heartbeat with
        // no deadline to check is a no-op, and a resolution nobody asked for is
        // refused. The real flow is exercised further down.
        await drive('heartbeat', {});
        await drive('resolve-disconnect', { player: 1, choice: 'save' });

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

        // --- regression guard: arriving units take zone-of-control damage ---
        // engine.unitVisibilityFilter used to let the client hide a dragged unit
        // from edge.units. That leaked into isZoCSuppressed: an arriving unit
        // suppressed the zone that should have damaged it, EXCEPT while dragging,
        // where the filter hid it and the damage landed. Same move, different
        // outcome by input method. The filter is gone and the rule is explicit
        // now; this guards the rule itself.
        const zocOnArrival = await step('ZoC on arrival', async () => {
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
            ApplyFortificationDamageOnMove(h, '0,1_1,0');
            const taken = hpStart - h.hp;

            globalThis.engine = saved;
            if (taken === 0) {
                throw new Error('an arriving unit took no ZoC damage - it is suppressing the zone it walked into');
            }
            if (probe.unitVisibilityFilter !== undefined) {
                throw new Error('engine.unitVisibilityFilter is back - rendering concerns must not sit on the engine');
            }
            return { taken };
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

        // --- A3: disconnect / reconnect / timeout resolution ---
        // Own probe engine, same pattern as the ZoC guard above: this walks a
        // match through turn changes and a resolved timeout, and doing that to
        // the shared instance would poison every assertion after it.
        const sessionFlow = await step('A3 session flow', async () => {
            const probe = CreateEngineInstance();
            const saved = globalThis.engine;
            globalThis.engine = probe;
            probe.settings.animationsEnabled = false;
            InitializeGrid();

            const seen = [];
            const t = CreateLocalTransport(probe);
            t.OnMessage(m => seen.push(m));
            t.Send(MakeConnectMessage('p-local'));

            const events = () => seen.filter(m => m.type === 'state-sync').flatMap(m => m.events);
            const countOf = (type) => events().filter(e => e.type === type).length;
            const probeEdge = [...probe.state.edges.keys()][0];

            // --- a player goes absent ---
            const askedAt = Date.now();
            const bye = t.Send(MakeDisconnectMessage('smoke', { player: 2 }));
            if (!bye.ok) throw new Error('disconnect rejected: ' + bye.error);
            if (countOf('PLAYER_DISCONNECTED') !== 1) throw new Error('PLAYER_DISCONNECTED did not fire exactly once');

            const dcEvent = events().find(e => e.type === 'PLAYER_DISCONNECTED');
            if (dcEvent.player !== 2) throw new Error('disconnect event names the wrong player');
            if (dcEvent.deadline < askedAt + DISCONNECT_TIMEOUT_MS) throw new Error('deadline is less than the full window');
            if (probe.playerSessions.player2.connected) throw new Error('absence was not recorded');
            if (!probe.playerSessions.player1.connected) throw new Error('per-player tracking marked the wrong slot');

            // DoD: absence is instance state, never match state.
            if ('playerSessions' in probe.state) throw new Error('absence leaked into engine.state');

            // --- §6: turn-gating alone produces the freeze, with no new code ---
            // It is still player 1's turn, and they are present: play continues.
            const mine = probe.state.units.find(u =>
                u.player === 1 && u.positionType === 'edge' && getPossibleMoves(u).size > 0);
            const dest = getPossibleMoves(mine).keys().next().value;
            const duringWindow = t.Send(MakeActionMessage('move', { unitId: mine.id, targetEdgeKey: dest }));
            if (!duringWindow.ok) throw new Error('present player was blocked during the window: ' + duringWindow.error);

            // Hand the turn to the absent player. Nothing anyone can send is legal now.
            t.Send(MakeActionMessage('end-turn', {}));
            if (probe.state.currentPlayer !== 2) throw new Error('turn did not reach the absent player');
            const frozen = t.Send(MakeActionMessage('move', { unitId: mine.id, targetEdgeKey: probeEdge }));
            if (frozen.ok) throw new Error('the present player acted on the absent player turn');
            if (frozen.error !== 'not_your_turn') throw new Error('freeze came from the wrong check: ' + frozen.error);

            // --- reconnect inside the window, fog off ---
            const back = t.Send(MakeConnectMessage('p-local'));
            if (back.reconnected !== 2) throw new Error('reconnect did not claim the absent slot');
            if (!probe.playerSessions.player2.connected) throw new Error('absence was not cleared');
            if (probe.playerSessions.player2.deadline !== null) throw new Error('deadline was not cancelled');
            if (countOf('PLAYER_RECONNECTED') !== 1) throw new Error('PLAYER_RECONNECTED did not fire exactly once');

            const resyncMsg = seen.find(m => m.type === 'state-resync');
            if (!resyncMsg) throw new Error('no resync was delivered');
            if (resyncMsg.snapshot.units.length !== probe.state.units.length) throw new Error('resync is not a complete view');
            if (resyncMsg.snapshot.filtered !== false) throw new Error('a fog-off resync should not be filtered');

            // --- reconnect with fog on: same path, filtered payload ---
            probe.settings.fogOfWarEnabled = true;
            t.Send(MakeDisconnectMessage('smoke-fog', { player: 2 }));
            const fogBack = t.Send(MakeConnectMessage('p-local'));
            const snap = fogBack.resync;
            if (!snap || !snap.filtered) throw new Error('a fog-on resync came back unfiltered');
            const leaked = snap.units.some(u => u.player !== 2 && !u.hidden &&
                !snap.visibleEdges.includes(u.position) && !snap.visibleTiles.includes(u.position));
            if (leaked) throw new Error('the resync leaked a fogged enemy position');
            const redacted = snap.units.filter(u => u.hidden).length;
            probe.settings.fogOfWarEnabled = false;

            // --- the deadline lapses ---
            t.Send(MakeDisconnectMessage('gone', { player: 2 }));
            t.Send(MakeActionMessage('heartbeat', {}));
            if (countOf('DISCONNECT_RESOLUTION_NEEDED') !== 0) throw new Error('resolution fired before the deadline');

            // Wind the SERVER's own stored deadline back. The comparison under
            // test is still server clock vs server deadline - only the thing it
            // is compared against moved, which is what waiting 100s would do.
            probe.playerSessions.player2.deadline -= DISCONNECT_TIMEOUT_MS + 1000;
            t.Send(MakeActionMessage('heartbeat', {}));
            t.Send(MakeActionMessage('heartbeat', {}));
            t.Send(MakeActionMessage('heartbeat', {}));
            const fired = countOf('DISCONNECT_RESOLUTION_NEEDED');
            if (fired !== 1) throw new Error('resolution fired ' + fired + ' times on repeated heartbeats, wanted 1');

            // --- resolving it: the rejections A2 would expect ---
            const spoofed = t.Send(MakeActionMessage('resolve-disconnect', { player: 2, choice: 'save' }));
            if (spoofed.ok) throw new Error('the absent player resolved their own disconnect');
            if (spoofed.error !== 'illegal_action') throw new Error('spoofed resolution gave ' + spoofed.error);

            const badChoice = t.Send(MakeActionMessage('resolve-disconnect', { player: 1, choice: 'delete-everything' }));
            if (badChoice.ok) throw new Error('an unknown resolution choice was accepted');
            if (badChoice.error !== 'malformed_payload') throw new Error('bad choice gave ' + badChoice.error);

            // ...and the accepted one. Note it is player 1 submitting while it is
            // player 2's turn - resolve-disconnect must not be turn-gated.
            const resolved = t.Send(MakeActionMessage('resolve-disconnect', { player: 1, choice: 'continue-locally' }));
            if (!resolved.ok) throw new Error('a legal resolution was rejected: ' + resolved.error + ' / ' + resolved.detail);
            if (probe.playerSessions.player2.resolutionState !== 'resolved') throw new Error('resolution state not closed out');

            // --- a late arrival must not resurrect a resolved match ---
            const late = t.Send(MakeConnectMessage('p-local'));
            if (late.reconnected !== null) throw new Error('a late reconnect resurrected a resolved match');
            if (late.refused !== 'resolution_resolved') throw new Error('late reconnect gave no refusal reason');

            // --- the ledger entries A6 will want ---
            const ledger = probe.state.matchHistory.map(e => e.type);
            ['PLAYER_DISCONNECTED', 'PLAYER_RECONNECTED', 'DISCONNECT_TIMEOUT', 'DISCONNECT_RESOLVED']
                .forEach(want => { if (!ledger.includes(want)) throw new Error('ledger missing ' + want); });
            if (ledger.filter(x => x === 'DISCONNECT_TIMEOUT').length !== 1) {
                throw new Error('the timeout was recorded more than once');
            }

            globalThis.engine = saved;
            return {
                window: Math.round(DISCONNECT_TIMEOUT_MS / 1000) + 's',
                resyncUnits: resyncMsg.snapshot.units.length,
                fogRedacted: redacted,
                resolutionsFired: fired,
                ledger: ledger.filter(x => x.startsWith('PLAYER_') || x.startsWith('DISCONNECT_')).join(' '),
            };
        });

        // --- A4: Testament round trip through the canonical save path ---
        // The disconnect resolution and a manual save must produce the same format,
        // and that format must survive a real JSON cycle and come back as the same
        // match. Own probe again, for the same reason the A3 block has one.
        const testament = await step('A4 save round trip', async () => {
            const probe = CreateEngineInstance();
            const saved = globalThis.engine;
            globalThis.engine = probe;
            probe.settings.animationsEnabled = false;
            InitializeGrid();

            const t = CreateLocalTransport(probe);
            t.Send(MakeConnectMessage('p-save'));

            // Give the match something to lose: a real move, and a held verdict.
            const mover = probe.state.units.find(u =>
                u.player === 1 && u.positionType === 'edge' && getPossibleMoves(u).size > 0);
            t.Send(MakeActionMessage('move', {
                unitId: mover.id, targetEdgeKey: getPossibleMoves(mover).keys().next().value }));
            probe.pendingVictory = { winner: 1, isDraw: false, text: 'smoke verdict' };

            const built = BuildSaveObject(probe);
            const save = built.save;

            if (save.schemaVersion !== CURRENT_SCHEMA_VERSION) {
                throw new Error('BuildSaveObject wrote schema v' + save.schemaVersion);
            }
            // A4 §7.1, Burn's call: the verdict is persisted, closing A2's known gap.
            if (!save.pendingVictory || save.pendingVictory.winner !== 1) {
                throw new Error('pendingVictory did not survive the save');
            }

            // The bloat the lean schema exists to drop must actually be absent.
            if (save.units.some(u => u.type !== undefined || u.hp !== undefined)) {
                throw new Error('lean save still carries derived unit fields');
            }
            // The edge set is regenerated from the tiles, not stored at all.
            if (save.edges !== undefined) throw new Error('lean save still stores an edge list');
            if (save.actionLog !== undefined) throw new Error('lean save still stores an action log');

            // A real JSON cycle, not a claim about one - this is where a stray Map
            // or Set silently becomes {}.
            const cycled = JSON.parse(JSON.stringify(save));
            if (cycled.units.length !== probe.state.units.length) {
                throw new Error('units lost across the JSON cycle');
            }

            // And back in through the same chain a historical file would take.
            const migrated = MigrateSave(cycled);
            if (migrated.report.toVersion !== CURRENT_SCHEMA_VERSION) {
                throw new Error('a current-version save did not stay current');
            }
            if (migrated.report.steps.length !== 0) {
                throw new Error('a current-version save was migrated: ' + migrated.report.steps.join(','));
            }

            const expanded = ExpandSaveObject(migrated.data, { forPlayer: 1 });
            if (expanded.tiles.length !== probe.state.tiles.size) throw new Error('tiles lost in round trip');
            // Regenerated from the tiles, so this proves the regeneration matches
            // the board the engine actually built.
            if (expanded.edges.length !== probe.state.edges.size) {
                throw new Error('regenerated ' + expanded.edges.length + ' edges, engine had ' + probe.state.edges.size);
            }
            probe.state.units.forEach(u => {
                if (u.positionType !== 'edge') return;
                if (!expanded.edges.some(([k]) => k === u.position)) {
                    throw new Error('unit ' + u.id + ' lost its edge ' + u.position);
                }
            });
            // The log is rebuilt from the ledger rather than stored.
            if (!expanded.actionLog || expanded.actionLog.length === 0) {
                throw new Error('action log was not rebuilt from matchHistory');
            }

            // Units omit default-valued fields; expansion must restore every one,
            // and re-leaning must reproduce exactly what was stored.
            expanded.units.forEach(u => {
                SAVE_UNIT_FIELDS.forEach(f => {
                    if (u[f] === undefined) throw new Error('unit ' + u.id + ' lost ' + f + ' expanding');
                });
                const stored = save.units.find(x => x.id === u.id);
                if (JSON.stringify(LeanUnit(u)) !== JSON.stringify(stored)) {
                    throw new Error('unit ' + u.id + ' is not stable across lean/expand/lean');
                }
            });
            const anyTile = expanded.tiles[0][1];
            if (!anyTile.type || anyTile.type.name === undefined) throw new Error('tile type not re-linked');
            if (anyTile.q === undefined || anyTile.r === undefined) throw new Error('tile coords not rebuilt from key');

            const content = DescribeContent(migrated.data);
            if (content.opensAs !== 'match') throw new Error('a real match was routed as a map');

            // A3's hook, now filled in: same canonical path, both choices.
            DisconnectPlayer(2, 'smoke-save');
            probe.playerSessions.player2.deadline -= DISCONNECT_TIMEOUT_MS + 1000;
            CheckDisconnectDeadlines();
            const ack = t.Send(MakeActionMessage('resolve-disconnect',
                { player: 1, choice: 'continue-locally' }));
            if (!ack.ok) throw new Error('resolution rejected: ' + ack.error);

            const outcome = ack.result && ack.result.outcome;
            if (!outcome || !outcome.save) throw new Error('ResolveDisconnectOutcome returned no save');
            if (outcome.disposition !== 'reload-local') {
                throw new Error("continue-locally gave disposition '" + outcome.disposition + "'");
            }
            if (outcome.save.schemaVersion !== CURRENT_SCHEMA_VERSION) {
                throw new Error('the disconnect save used a different schema');
            }

            globalThis.engine = saved;
            return {
                schema: 'v' + save.schemaVersion,
                bytes: JSON.stringify(save).length,
                units: save.units.length,
                disposition: outcome.disposition,
            };
        });


        // --- A5: the profile a save carries, and the identity seam it feeds ---
        //
        // Two things are under test and they are separate: that a save attaches a
        // profile WHEN ONE EXISTS and is unchanged when one does not, and that
        // IsReturningPlayer does the right thing now that a durable id flows into it.
        //
        // Running here is the point. This worker has no document, no window and no
        // localStorage - asserted at the top of this harness - so if testament.js
        // ever reached for GetProfile() directly instead of taking the profile off
        // the engine instance, this block is where that would blow up.
        const profileFlow = await step('A5 profile', async () => {
            const probe = CreateEngineInstance();
            const saved = globalThis.engine;
            globalThis.engine = probe;
            probe.settings.animationsEnabled = false;
            InitializeGrid();

            // savedAt is a timestamp, so two saves of the same match differ by it
            // alone. Strip it to compare the shape rather than the moment.
            const shapeOf = (save) => {
                const copy = { ...save };
                delete copy.savedAt;
                return JSON.stringify(copy);
            };

            // --- the majority case: no profile, nothing changes ---
            if (probe.localProfile !== undefined && probe.localProfile !== null) {
                throw new Error('a fresh engine instance already carried a profile');
            }
            const bare = BuildSaveObject(probe).save;
            if ('profile' in bare) {
                throw new Error('a save from a device with no profile carried a profile field');
            }

            // --- with a profile: attached, and nothing else moved ---
            probe.localProfile = { id: 'p-smoke-0001', name: 'Smoke' };
            const tagged = BuildSaveObject(probe).save;
            if (!tagged.profile) throw new Error('a save from a device with a profile carried none');
            if (tagged.profile.id !== 'p-smoke-0001') throw new Error('the save recorded the wrong id');
            if (tagged.profile.name !== 'Smoke') throw new Error('the save recorded the wrong name');
            if (tagged.profile.consent !== undefined) {
                throw new Error('consent leaked into a save - it is a device answer, not match data');
            }

            // The conditional must be a true no-op for the majority case, not
            // "usually empty": everything except the profile is byte-identical.
            const strippedTagged = { ...tagged };
            delete strippedTagged.profile;
            if (shapeOf(strippedTagged) !== shapeOf(bare)) {
                throw new Error('attaching a profile changed the rest of the save');
            }

            // ...and clearing it again returns to exactly the pre-A5 shape.
            probe.localProfile = null;
            if (shapeOf(BuildSaveObject(probe).save) !== shapeOf(bare)) {
                throw new Error('a save is not byte-identical to before once a profile is removed');
            }
            probe.localProfile = { id: 'p-smoke-0001', name: 'Smoke' };

            // --- through a real JSON cycle and the migration chain ---
            const cycled = JSON.parse(JSON.stringify(BuildSaveObject(probe).save));
            const migrated = MigrateSave(cycled);
            if (migrated.report.steps.length !== 0) {
                throw new Error('a current save was migrated: ' + migrated.report.steps.join(','));
            }
            if (!migrated.data.profile || migrated.data.profile.id !== 'p-smoke-0001') {
                throw new Error('the profile did not survive the chain');
            }
            const expandedA5 = ExpandSaveObject(migrated.data, { forPlayer: 1 });
            if (!expandedA5.profile || expandedA5.profile.name !== 'Smoke') {
                throw new Error('the profile did not survive expansion');
            }

            // --- the v8 file that predates all of this ---
            // Every archived fixture is this case. It must detect as v8, take the
            // one no-op step, and arrive at v9 with no invented profile.
            const asV8 = JSON.parse(JSON.stringify(bare));
            asV8.schemaVersion = 8;
            if (DetectVersion(asV8) !== 8) throw new Error('a v8 save did not detect as v8');
            const upgraded = MigrateSave(asV8);
            if (upgraded.report.toVersion !== CURRENT_SCHEMA_VERSION) throw new Error('v8 did not reach current');
            if (upgraded.report.steps.join(',') !== '8->9') {
                throw new Error('v8 took the wrong path: ' + upgraded.report.steps.join(','));
            }
            if ('profile' in upgraded.data) throw new Error('the v8->v9 step invented a profile');

            // Shape inference has no mark for a v9 without a profile, by design -
            // see MigrateAddProfile. Assert what it actually does rather than
            // pretending it can tell them apart.
            const unlabelled = JSON.parse(JSON.stringify(bare));
            delete unlabelled.schemaVersion;
            delete unlabelled.saveVersion;
            if (DetectVersion(unlabelled) !== 8) throw new Error('an unlabelled lean save did not infer as v8');
            const unlabelledTagged = JSON.parse(JSON.stringify(cycled));
            delete unlabelledTagged.schemaVersion;
            delete unlabelledTagged.saveVersion;
            if (DetectVersion(unlabelledTagged) !== 9) {
                throw new Error('an unlabelled save WITH a profile did not infer as v9');
            }

            // --- the identity seam, with a real durable id ---
            // A3 built IsReturningPlayer and A5 read it before touching it: it is a
            // plain equality check and needed no change. This proves that by test.
            const t = CreateLocalTransport(probe);
            t.Send(MakeConnectMessage('p-smoke-0001'));

            // 1. a slot that recorded a real id accepts that id back
            t.Send(MakeDisconnectMessage('a5', { player: 2, profileId: 'p-smoke-0001' }));
            if (probe.playerSessions.player2.profileId !== 'p-smoke-0001') {
                throw new Error('the disconnect did not record the profile id');
            }
            const rightId = t.Send(MakeConnectMessage('p-smoke-0001'));
            if (rightId.reconnected !== 2) throw new Error('a real profile id failed to reclaim its own slot');

            // 2. ...and refuses a different one
            t.Send(MakeDisconnectMessage('a5', { player: 2, profileId: 'p-smoke-0001' }));
            const wrongId = t.Send(MakeConnectMessage('p-smoke-9999'));
            if (wrongId.reconnected !== null) {
                throw new Error('a different profile id claimed a slot it does not own');
            }
            if (probe.playerSessions.player2.connected) {
                throw new Error('a refused claim reconnected the slot anyway');
            }
            // The rightful owner can still come back afterwards.
            if (t.Send(MakeConnectMessage('p-smoke-0001')).reconnected !== 2) {
                throw new Error('a failed claim by someone else locked the real owner out');
            }

            // 3. local pass-device play, unchanged from A3: a slot that recorded no
            //    id matches any returning client. This is the case that must NOT
            //    have changed, and it is the one most likely to have.
            probe.playerSessions.player2.profileId = null;
            t.Send(MakeDisconnectMessage('a5-local', { player: 2 }));
            if (probe.playerSessions.player2.profileId !== null) {
                throw new Error('a disconnect with no profileId stamped one anyway');
            }
            if (!IsReturningPlayer('anything-at-all', 2)) {
                throw new Error('A3 pass-device behaviour regressed: an unstamped slot refused a client');
            }
            const anyone = t.Send(MakeConnectMessage('some-other-client'));
            if (anyone.reconnected !== 2) throw new Error('an unstamped slot did not match a returning client');

            // --- the disconnect-resolution save takes the same one path ---
            DisconnectPlayer(2, 'a5-resolve');
            probe.playerSessions.player2.deadline -= DISCONNECT_TIMEOUT_MS + 1000;
            CheckDisconnectDeadlines();
            const ack = t.Send(MakeActionMessage('resolve-disconnect', { player: 1, choice: 'save' }));
            const outcome = ack.result && ack.result.outcome;
            if (!outcome || !outcome.save) throw new Error('resolution returned no save');
            if (!outcome.save.profile || outcome.save.profile.id !== 'p-smoke-0001') {
                throw new Error('the disconnect save skipped the profile - two save paths have diverged');
            }

            globalThis.engine = saved;
            return {
                bareBytes: JSON.stringify(bare).length,
                taggedBytes: JSON.stringify(tagged).length,
                v8Steps: upgraded.report.steps.join(',') || 'none',
            };
        });

        parentPort.postMessage({
            ok: true,
            sessionFlow,
            testament,
            profileFlow,
            steps: trace.length,
            moved: from + ' -> ' + mover.position,
            rejections,
            zocOnArrival,
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
        console.log('  ZoC on arrival  : ' + m.zocOnArrival.taken + ' damage, engine has no view filter');
        console.log('  legal fortify   :', m.fortifyOutcome);
        console.log('  every spec ran  :', Object.keys(m.specCoverage).length, 'actions ->',
                    Object.entries(m.specCoverage).map(([k, v]) => k + ':' + v).join(' '));
        console.log('  fog filter      :', m.filteredUnitsVisibleToP1 + '/' + m.totalUnits, 'units visible to P1');
        console.log('  A3 session      :', m.sessionFlow.window, 'window, resync', m.sessionFlow.resyncUnits, 'units,',
                    m.sessionFlow.fogRedacted, 'redacted under fog, resolution fired',
                    m.sessionFlow.resolutionsFired + 'x');
        console.log('  A3 ledger       :', m.sessionFlow.ledger);
        console.log('  A4 testament    :', m.testament.schema, 'save,', m.testament.units, 'units,',
                    m.testament.bytes + 'B, round-trips clean; disconnect ->', m.testament.disposition);
        console.log('  A5 profile      :', 'no-profile save ' + m.profileFlow.bareBytes + 'B, tagged ' +
                    m.profileFlow.taggedBytes + 'B; v8 file -> ' + m.profileFlow.v8Steps +
                    '; IsReturningPlayer unchanged (real id matches, wrong id refused, unstamped matches anyone)');
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
