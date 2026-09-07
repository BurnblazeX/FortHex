// FortHex - a hosted match that ENDS, and everybody being told  (B5)
//
//   node tools/victory-smoke.js
//
// The bug this exists to stop coming back: an online capture-the-flag win fired no
// victory screen at all. The host decided correctly, emitted VICTORY, and set
// gameOver in every board view it sent - and no client did anything with either, so
// the match simply stopped responding and both players sat looking at a frozen board
// (Burn, playtest 2026-09-07).
//
// It was invisible to every existing test because each half looked right on its own.
// The server emitted the event; the client had a handler for it. The handler's body
// was a comment saying a remote client would need this one day. So this file asserts
// the JOIN between them, in three places it can actually be checked:
//
//   1. a real worker, driven to a real win, must tell both players and must tell its
//      parent that the room is over,
//   2. the verdict must still be readable AFTER the first client has consumed it -
//      that is the whole of how a rejoining player is told who won,
//   3. the client wiring must exist, checked as source, because a victory screen is
//      DOM and cannot be exercised here.
//
// Exit code 0 = pass.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Worker } = require('worker_threads');
const { ReadBundle, BuildWorkerSource, ROOT } = require('../host/server-bundle.js');

const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

function Read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

const Settle = (predicate, ms = 8000, label = 'the worker') => new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() > deadline) return reject(new Error('timed out waiting for ' + label));
        setTimeout(tick, 10);
    };
    tick();
});

// A board one move away from being over: player 2 has no army left, so the next
// accepted action from player 1 settles as annihilation. Built here rather than
// hand-written because a save has to survive Testament's own validation, and the
// only thing that reliably produces one is the code that writes them.
function BuildAlmostWonSave() {
    const mirror = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(mirror);
    vm.runInContext(ReadBundle(), mirror);
    return JSON.parse(vm.runInContext([
        'globalThis.engine = CreateEngineInstance();',
        'InitializeGrid();',
        // Straight to the interesting state. Playing an actual match to annihilation
        // would test the rules, which is rules.js's job, not this file's.
        'engine.state.units = engine.state.units.filter(u => u.player === 1);',
        'JSON.stringify(BuildSaveObject(engine, {}).save);',
    ].join('\n'), mirror));
}

// The legal move that ends it, computed the way a real client computes one: against
// its own copy of the same engine, from the same board.
function PlanFinishingMove(save) {
    const mirror = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(mirror);
    vm.runInContext(ReadBundle(), mirror);
    mirror.__save = save;
    return JSON.parse(vm.runInContext([
        'globalThis.engine = CreateEngineInstance();',
        'ResumeMatchFromSave(__save);',
        'const unit = engine.state.units.find(u => u.player === 1 && getPossibleMoves(u).size > 0);',
        'JSON.stringify(unit ? { unitId: unit.id, targetEdgeKey: [...getPossibleMoves(unit).keys()][0] } : null);',
    ].join('\n'), mirror));
}

async function Main() {
    // === 1. a real worker, driven to a real win =============================
    const save = BuildAlmostWonSave();
    const plan = PlanFinishingMove(save);
    check('a finishing move could be computed', plan !== null && !!plan.targetEdgeKey);
    if (!plan) throw new Error('no legal move on the prepared board - the fixture is wrong');

    const worker = new Worker(BuildWorkerSource(), {
        eval: true,
        workerData: { matchId: 'victory-smoke', players: [1, 2], settings: { fogOfWarEnabled: false } },
    });

    const wire = [];
    const errors = [];
    const matchOver = [];
    let ready = false;
    let started = null;

    worker.on('message', (m) => {
        switch (m.type) {
            case 'ready':      ready = true; break;
            case 'started':    started = m; break;
            case 'match-over': matchOver.push(m); break;
            case 'host-error': errors.push(m); break;
            case 'wire':       wire.push({ player: m.player, message: JSON.parse(m.encoded) }); break;
        }
    });

    await Settle(() => ready);
    worker.postMessage({ kind: 'start-match', resumeSave: save });
    await Settle(() => started !== null, 8000, 'the match to start');

    const before = wire.length;
    worker.postMessage({
        kind: 'client-message',
        requestId: 'finish',
        message: { type: 'action', action: 'move', payload: plan, player: 1 },
    });
    await Settle(() => wire.length > before, 8000, 'the move to be answered');

    // The parent has to be TOLD. It sees bytes it does not decode and acks it does not
    // read, so without this message a finished room stayed 'in-progress' forever,
    // holding its ~12.4 MB worker until the abandonment sweep eventually noticed.
    await Settle(() => matchOver.length > 0, 4000, 'the worker to report the match over');
    check('the worker reports a finished match to its parent', matchOver.length === 1);
    check('and reports it exactly once, however many messages follow',
        matchOver.length === 1);
    check('the report carries the verdict, not just the fact',
        !!(matchOver[0] && matchOver[0].verdict && matchOver[0].verdict.text));

    const syncs = wire.slice(before).filter(w => w.message.type === 'state-sync');
    const forP1 = syncs.filter(w => w.player === 1);
    const forP2 = syncs.filter(w => w.player === 2);

    const HasVictory = (rows) => rows.some(w =>
        (w.message.events || []).some(e => e.type === 'VICTORY'));

    check('the winner is told the match is over', HasVictory(forP1));
    // The one that actually matters. A player who is about to be told they lost is
    // exactly the player whose screen must not silently freeze.
    check('the loser is told the match is over', HasVictory(forP2));

    const views = syncs.map(w => w.message.view).filter(Boolean);
    check('the final board views report gameOver', views.some(v => v.gameOver === true));
    check('the final board views carry the verdict text', views.some(v => v.victory && v.victory.text));

    const verdict = views.map(v => v.victory).filter(Boolean).pop();
    const event = syncs
        .flatMap(w => w.message.events || [])
        .find(e => e.type === 'VICTORY');
    check('the view and the event agree on who won',
        !!verdict && !!event && verdict.text === event.text);

    check('the worker raised no errors: ' + errors.map(e => e.where + ' ' + e.error).join('; '),
        errors.length === 0);

    // === 2. the verdict outlives being consumed ============================
    //
    // pendingVictory is a ONE-SHOT handoff: the first caller of CheckVictoryCondition
    // takes it and leaves null behind. That is right for a local match and exactly
    // wrong for a hosted one, where the clients who need the verdict are not the thing
    // that asked for it and may not have been connected when it was decided. A player
    // rejoining a finished match has ONLY the board view to learn from.
    {
        const mirror = { console: { log() {}, warn() {}, error() {} } };
        vm.createContext(mirror);
        vm.runInContext(ReadBundle(), mirror);
        mirror.__save = save;

        const result = JSON.parse(vm.runInContext([
            'globalThis.engine = CreateEngineInstance();',
            'ResumeMatchFromSave(__save);',
            'const t = CreateLocalTransport(engine);',
            't.AddConnection(1, () => {});',
            't.AddConnection(2, () => {});',
            'const unit = engine.state.units.find(u => u.player === 1 && getPossibleMoves(u).size > 0);',
            "t.Send({ type: 'action', action: 'move', player: 1,",
            '  payload: { unitId: unit.id, targetEdgeKey: [...getPossibleMoves(unit).keys()][0] } });',
            // A client asking for the verdict CONSUMES pendingVictory. This is the
            // exact sequence that used to leave a late arrival with nothing.
            'const first = CheckVictoryCondition();',
            'JSON.stringify({',
            '  gameOver: engine.state.gameOver,',
            '  firstText: first.victoryText || null,',
            '  pendingAfter: engine.pendingVictory,',
            '  verdictAfter: engine.matchVerdict,',
            '  lateView: BuildResyncSnapshot(2).victory,',
            '});',
        ].join('\n'), mirror));

        check('the match really ended', result.gameOver === true);
        check('the first caller still gets the full verdict', !!result.firstText);
        check('pendingVictory is consumed, as it always was', result.pendingAfter === null);
        check('the kept verdict survives that consumption', !!(result.verdictAfter && result.verdictAfter.text));
        check('so a board view built LATER still names the winner',
            !!(result.lateView && result.lateView.text));
        check('and it is the same verdict, not a second opinion',
            !!result.lateView && result.lateView.text === result.firstText);
    }

    // === 3. the client actually does something with it =====================
    //
    // Source checks, because a victory screen is DOM. Each one names a specific line
    // whose absence WAS the bug or would silently restore it - a handler whose body is
    // a comment passes every test that only asks whether the handler exists.
    {
        const actions = Read('js/client/actions.js');
        const remote = Read('js/client/remote-state.js');
        const flow = Read('js/client/game-flow.js');
        const worker = Read('host/match-worker.js');
        const host = Read('host/server.js');

        check('game-flow.js defines the online victory screen',
            /function ShowRemoteVictory\s*\(/.test(flow));
        check('game-flow.js defines the screen it draws',
            /function ShowVictoryScreen\s*\(/.test(flow));
        check('game-flow.js can clear it again between matches',
            /function ResetVictoryScreen\s*\(/.test(flow));

        // THE regression. The VICTORY handler was a comment saying a remote client
        // would need this - the case existed, so nothing noticed it did nothing.
        const victoryCase = actions.slice(actions.indexOf("case 'VICTORY':"),
                                          actions.indexOf("case 'ARCHIVE_DUE':"));
        check("actions.js's VICTORY case draws something for a remote match",
            /ShowRemoteVictory\s*\(/.test(victoryCase));

        // The second entry point, and the only one a rejoining player ever reaches.
        check('remote-state.js draws the verdict when a view arrives already over',
            /gameOver\s*&&[\s\S]{0,80}ShowRemoteVictory/.test(remote));
        check('remote-state.js keeps the verdict off the view',
            /remoteVerdict\s*=\s*view\.victory/.test(remote));
        check('remote-state.js clears the screen when a match begins',
            /ResetVictoryScreen/.test(remote));

        check('the worker reports the end of a match',
            /type:\s*'match-over'/.test(worker));
        check('and the host acts on that report',
            /case 'match-over'/.test(host));
        // EndMatch tears the client's board down, and the board is what the victory
        // screen is drawn over. A completed match must not go through it.
        //
        // Comments are stripped first, because the code says WHY it does not call
        // EndMatch and a naive search finds that sentence and passes.
        const overCase = host.slice(host.indexOf("case 'match-over':"),
                                    host.indexOf("case 'resolution-needed':"));
        const overCode = overCase.replace(/\/\/.*$/gm, '');
        check('a completed match is not torn down with EndMatch',
            overCase.length > 0 && !/\bEndMatch\s*\(/.test(overCode));
        check('a completed match stops being listed',
            /room\.state = 'finished'/.test(overCode));
    }

    await worker.terminate();

    if (failures.length) {
        console.error('FAIL - ' + failures.length + ' check(s)');
        failures.forEach(f => console.error('  !! ' + f));
        process.exit(1);
    }

    console.log('PASS - a hosted match that ends says so');
    console.log('  event     : both players receive VICTORY, the loser included');
    console.log('  view      : gameOver and the verdict text ride in the board view');
    console.log('  kept      : the verdict outlives pendingVictory being consumed');
    console.log('  late      : a view built afterwards still names the winner');
    console.log('  worker    : the parent is told the room is over, once, with the verdict');
    console.log('  client    : both draw paths are wired, and neither tears the board down');
    process.exit(0);
}

Main().catch((error) => {
    if (failures.length) {
        console.error(failures.length + ' check(s) had already failed:');
        failures.forEach(f => console.error('  !! ' + f));
    }
    console.error('FAIL -', error.message);
    process.exit(1);
});
