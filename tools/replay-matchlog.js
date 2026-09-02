// FortHex — replay a captured match log through the engine, headlessly.
//
//   node tools/replay-matchlog.js tools/reference/default-opening-annihilation.a2.json
//
// This turns a played match into an automated regression test. It re-submits
// every player-initiated action from the log through the real validation and
// dispatch path, then checks that the engine reproduces the same numbers.
//
// Only PLAYER actions are replayed. Zone-of-control blasts, turn-start healing,
// movement ZoC hits and the like are consequences the server decides on - they
// must REGENERATE on their own. If they don't, that's exactly the drift worth
// catching, and it shows up as a unit-state mismatch.
//
// Why this works: unit ids are derived from player/type/turn/counter, so a
// default radius-3 grid produces the same ids and starting positions every
// time. A log captured on that setup replays deterministically.
//
// Exit 0 = the engine reproduced the match. Exit 1 = it diverged, and the
// output names the first entry where it did.

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
const logPath = process.argv[2];

if (!logPath) {
    console.error('usage: node tools/replay-matchlog.js <matchlog.json>');
    process.exit(2);
}

const BUNDLE = [
    'js/config-data.js', 'js/grid-math.js', 'js/testament.js',
    'js/server/engine.js', 'js/server/rules.js', 'js/server/actions.js',
    'js/server/turn-lifecycle.js', 'js/server/match-setup.js',
    'js/server/map-generation.js', 'js/transport.js',
    'js/server/validation.js', 'js/server/state-filter.js', 'js/server/session.js',
];

// Actions a player initiates, and how to rebuild the payload from the ledger.
// Anything not listed is a server-decided consequence and is skipped as input.
const REPLAYABLE = {
    MOVE:         (e) => ['move',         { unitId: e.actorId, targetEdgeKey: e.payload.to }],
    FORTIFY:      (e) => ['fortify',      { unitId: e.actorId, targetTileKey: e.payload.tile }],
    UNFORTIFY:    (e) => ['unfortify',    { unitId: e.actorId, targetEdgeKey: e.payload.toEdge }],
    UNIT_UPGRADE: (e) => ['upgrade-unit', { unitId: e.actorId, statType: e.payload.stat }],
    BUILD_BRIDGE: (e) => ['build-bridge', { unitId: e.actorId, targetEdgeKey: e.payload.targetEdge }],
    ATTACK:       (e) => ['attack', e.payload.targetType === 'BRIDGE'
        ? { unitId: e.actorId, targetEdgeKey: e.payload.targetEdge, isBridgeTarget: true, attackType: null }
        : { unitId: e.actorId, targetUnitId: e.payload.targetId, attackType: null }],
};

const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));

const HARNESS = `
(async () => {
    const { parentPort } = require('worker_threads');
    const log = ${JSON.stringify(log)};
    const process = { env: ${JSON.stringify({FH_DUMP_AT: process.env.FH_DUMP_AT})} };
    const REPLAYABLE_TYPES = ${JSON.stringify(Object.keys(REPLAYABLE))};
    const problems = [];
    const skipped = {};
    let applied = 0, turnsAdvanced = 0;

    try {
        const engineInstance = CreateEngineInstance();
        globalThis.engine = engineInstance;

        // Match the captured setup before building the board.
        engine.state.gameMode = log.setup.gameMode;
        engine.state.playerSide = log.setup.playerSide;
        engine.state.gridRadius = log.setup.gridRadius;
        engine.settings.fogOfWarEnabled = log.setup.fogOfWarEnabled;
        engine.settings.animationsEnabled = false;   // no waiting in replay

        InitializeGrid();

        const transport = CreateLocalTransport(engine);
        transport.Send(MakeConnectMessage('replay'));

        const attackTypeFor = (unitId) => {
            const u = engine.state.units.find(x => x.id === unitId);
            return u && u.type.attackType === 'melee' ? 'Melee' : 'Archer';
        };

        for (let i = 0; i < log.matchHistory.length; i++) {
            const entry = log.matchHistory[i];

            if (!REPLAYABLE_TYPES.includes(entry.type)) {
                skipped[entry.type] = (skipped[entry.type] || 0) + 1;
                continue;
            }

            // The log records turn + player per entry but never an explicit
            // end-turn, so infer it: advance until the engine is on the same
            // (turn, player) the entry was played on.
            let guard = 0;
            while ((engine.state.globalTurnNumber !== entry.turn ||
                    engine.state.currentPlayer !== entry.player) && guard++ < 4) {
                if (engine.state.gameOver) break;
                await transport.Send(MakeActionMessage('end-turn', {}));
                turnsAdvanced++;
            }
            if (engine.state.globalTurnNumber !== entry.turn || engine.state.currentPlayer !== entry.player) {
                problems.push('#' + i + ' ' + entry.type + ': could not reach turn ' + entry.turn +
                              ' player ' + entry.player + ' (engine is on turn ' +
                              engine.state.globalTurnNumber + ' player ' + engine.state.currentPlayer + ')');
                break;
            }

            let action, payload;
            switch (entry.type) {
                case 'MOVE':         action = 'move';         payload = { unitId: entry.actorId, targetEdgeKey: entry.payload.to }; break;
                case 'FORTIFY':      action = 'fortify';      payload = { unitId: entry.actorId, targetTileKey: entry.payload.tile }; break;
                case 'UNFORTIFY':    action = 'unfortify';    payload = { unitId: entry.actorId, targetEdgeKey: entry.payload.toEdge }; break;
                case 'UNIT_UPGRADE': action = 'upgrade-unit'; payload = { unitId: entry.actorId, statType: entry.payload.stat }; break;
                case 'BUILD_BRIDGE': action = 'build-bridge'; payload = { unitId: entry.actorId, targetEdgeKey: entry.payload.targetEdge }; break;
                case 'ATTACK':
                    action = 'attack';
                    payload = entry.payload.targetType === 'BRIDGE'
                        ? { unitId: entry.actorId, targetEdgeKey: entry.payload.targetEdge, isBridgeTarget: true, attackType: attackTypeFor(entry.actorId) }
                        : { unitId: entry.actorId, targetUnitId: entry.payload.targetId, attackType: attackTypeFor(entry.actorId) };
                    break;
            }

            if (process.env.FH_DUMP_AT !== undefined && Number(process.env.FH_DUMP_AT) === i) {
                problems.push('DUMP before #' + i + ' ' + entry.type + ' ' + entry.actorId +
                    ' -> ' + JSON.stringify(payload));
                problems.push('  board: ' + engine.state.units.map(u =>
                    u.id + '(p' + u.player + ' hp' + u.hp + ' mp' + Number(u.currentMove.toFixed(1)) +
                    (u.isFortified ? " FORT@" : " @") + u.position + ')').join(' | '));
                const legal = getPossibleMoves(engine.state.units.find(u => u.id === entry.actorId));
                problems.push('  legal moves: ' + [...legal.entries()].map(([k,v]) => k + '(c' + v.cost + ')').join(' '));
            }
            const ack = await transport.Send(MakeActionMessage(action, payload));
            if (!ack.ok) {
                problems.push('#' + i + ' ' + entry.type + ' (t' + entry.turn + ' p' + entry.player + ' ' +
                              entry.actorId + ') REJECTED: ' + ack.error +
                              (ack.detail ? ' — ' + ack.detail : ''));
                break;
            }
            applied++;

            // The client wrappers (handleMoveAction, completeAttack, ...) call
            // checkVictoryCondition after every action - the server never decides
            // on its own that a match is over. Mirror that here, or a replayed
            // flag capture or annihilation never ends. See the A2 progress notes:
            // making victory server-authoritative is an open item.
            CheckVictoryCondition();

            // Compare the actor's post-action state against what the log recorded.
            const snap = entry.payload.unitState || entry.payload.attackerState;
            if (snap) {
                const live = engine.state.units.find(u => u.id === snap.id);
                if (!live) {
                    problems.push('#' + i + ' ' + entry.type + ': ' + snap.id + ' vanished after its own action');
                } else {
                    for (const f of ['hp', 'pos', 'isFortified']) {
                        const want = f === 'pos' ? snap.pos : snap[f];
                        const got  = f === 'pos' ? live.position : (f === 'hp' ? live.hp : !!live.isFortified);
                        if (JSON.stringify(want) !== JSON.stringify(got)) {
                            problems.push('#' + i + ' ' + entry.type + ' ' + snap.id + '.' + f +
                                          ': log ' + JSON.stringify(want) + ' vs replay ' + JSON.stringify(got));
                        }
                    }
                }
            }
            if (entry.payload.targetState) {
                const t = entry.payload.targetState;
                const live = engine.state.units.find(u => u.id === t.id);
                const gotHp = live ? live.hp : 'dead';
                const wantHp = t.hp > 0 ? t.hp : 'dead';
                if (String(gotHp) !== String(wantHp)) {
                    problems.push('#' + i + ' ATTACK target ' + t.id + '.hp: log ' + wantHp + ' vs replay ' + gotHp);
                }
            }

            if (problems.length >= 12) break;
        }

        const finalBoard = engine.state.units.map(u => ({
            id: u.id, hp: u.hp, pos: u.position, fortified: !!u.isFortified
        })).sort((a, b) => a.id.localeCompare(b.id));

        const expected = [...log.outcome.units].map(u => ({
            id: u.id, hp: u.hp, pos: u.pos, fortified: u.fortified
        })).sort((a, b) => a.id.localeCompare(b.id));

        if (JSON.stringify(finalBoard) !== JSON.stringify(expected)) {
            problems.push('final board differs:');
            problems.push('  log   : ' + JSON.stringify(expected));
            problems.push('  replay: ' + JSON.stringify(finalBoard));
        }

        // Units alone are not the whole outcome. A flag-capture win looks like an
        // ordinary set of moves in the ledger - nothing records the pickup or the
        // victory - so without these three checks a replay that failed to trigger
        // the win would still report REPRODUCED.
        if (engine.state.gameOver !== log.outcome.gameOver) {
            problems.push('gameOver: log ' + log.outcome.gameOver + ' vs replay ' + engine.state.gameOver +
                          (log.outcome.gameOver ? '  (the match-ending condition did not fire on replay)' : ''));
        }
        for (const p of ['player1', 'player2']) {
            if (engine.state.supplyPoints[p] !== log.outcome.supplyPoints[p]) {
                problems.push('supply ' + p + ': log ' + log.outcome.supplyPoints[p] +
                              ' vs replay ' + engine.state.supplyPoints[p] +
                              '  (0 means that flag is being carried)');
            }
        }
        if (engine.state.globalTurnNumber !== log.outcome.turn) {
            problems.push('final turn: log ' + log.outcome.turn + ' vs replay ' + engine.state.globalTurnNumber);
        }

        const flags = engine.state.flags ? Object.values(engine.state.flags)
            .map(f => f.id + ':' + f.status).join(' ') : '(none)';
        parentPort.postMessage({ ok: problems.length === 0, applied, turnsAdvanced, skipped, problems,
                                 survivors: finalBoard.length, expectedSurvivors: expected.length,
                                 gameOver: engine.state.gameOver, flags,
                                 supply: engine.state.supplyPoints });
    } catch (err) {
        parentPort.postMessage({ ok: false, applied, turnsAdvanced, skipped,
                                 problems: ['THREW: ' + err.message, ...err.stack.split(String.fromCharCode(10)).slice(1, 4)] });
    }
})();
`;

const source = BUNDLE.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n') + HARNESS;
const worker = new Worker(source, { eval: true });

worker.on('message', (m) => {
    console.log(`replaying: ${path.basename(logPath)}  (${log.entryCount} ledger entries)`);
    console.log(`  actions applied : ${m.applied}`);
    console.log(`  turns advanced  : ${m.turnsAdvanced}`);
    console.log(`  regenerated     : ${Object.entries(m.skipped || {}).map(([k, v]) => k + 'x' + v).join(' ') || '(none)'}`);
    if (m.survivors !== undefined) console.log(`  survivors       : ${m.survivors} (log says ${m.expectedSurvivors})`);
    if (m.gameOver !== undefined) console.log(`  match ended     : ${m.gameOver}   flags: ${m.flags}   supply: ${JSON.stringify(m.supply)}`);
    console.log('');
    if (m.ok) {
        console.log('REPRODUCED — the engine replayed this match to the same final board.');
        process.exit(0);
    }
    console.log(`${m.problems.length} DIVERGENCE(S):`);
    m.problems.forEach(p => console.log('  ' + p));
    process.exit(1);
});

worker.on('error', (e) => {
    console.error('WORKER ERROR:', e.message);
    console.error(e.stack);
    process.exit(1);
});
