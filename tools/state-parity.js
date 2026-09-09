// FortHex - does a client rebuilt from a view actually match the server?  (B2)
//
//   node tools/state-parity.js            report differences
//   node tools/state-parity.js --verbose  show the values too
//
// Written after the same bug arrived four times in a row: the board is transmitted,
// the client draws something plausible, and then some query returns the wrong answer
// because one field never made the trip. Attack range was the expensive one - the
// fine-grid index was simply absent, so an enemy on the adjacent edge was unattackable
// and the Attack button greyed itself out with no error anywhere.
//
// Spot-checking each field as its bug surfaced was the wrong method. This compares the
// WHOLE of engine.state between a real server board and a client rebuilt from that
// board's view, and reports everything that differs - including the fields nobody has
// thought to look at yet.
//
// Fog is OFF here on purpose. Under fog the two are SUPPOSED to differ, and that is
// tested in replication-smoke; mixing the two would mean every real gap could be
// waved away as redaction.
//
// Exit code 0 = pass.

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { ReadBundle } = require('../host/server-bundle.js');

const ROOT = path.join(__dirname, '..');
const verbose = process.argv.includes('--verbose');

// Fields that legitimately differ, each with the reason. Anything NOT in here that
// differs is a transmission gap.
const EXPECTED = {
    matchHistory: 'the authoritative ledger stays on the host; A6 archives it there',
    unitIdCounter: 'server-only bookkeeping - a client never mints unit ids',
    gameMode: "the client deliberately sets 'online' to describe its own situation",
    playerSide: 'the client sets this to its seat; the host has no single side',
    isTrainingMode: 'training never runs in a hosted match',
    mapMakerMode: 'there is no hosted map editing',
    actionLog: 'rebuilt on the client from the event stream, not copied wholesale',
    reach: 'fog - a client is sent only its OWN budget, so the opponent key is absent',
    rations: 'fog - a client is sent only its OWN pool, so the opponent key is absent',
};

function Boot() {
    const ctx = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    return ctx;
}

// A canonical, order-independent string for any state value, so two Maps built in a
// different order still compare equal.
function Canon(value) {
    if (value instanceof Map) {
        return JSON.stringify([...value.entries()]
            .map(([k, v]) => [k, Canon(v)])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    }
    if (value instanceof Set) {
        return JSON.stringify([...value].sort());
    }
    if (Array.isArray(value)) return JSON.stringify(value.map(Canon));
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => { out[k] = Canon(value[k]); });
        return JSON.stringify(out);
    }
    return JSON.stringify(value === undefined ? null : value);
}

// --- a server board with some history on it --------------------------------
// A fresh board exercises almost nothing. Playing a few real actions populates the
// fields that only appear once something has happened - supply lines, the action log,
// playerActionTaken, the respawn queue.
const server = Boot();
vm.runInContext('globalThis.engine = CreateEngineInstance();'
    + ' engine.settings.fogOfWarEnabled = false; InitializeGrid();', server);

vm.runInContext([
    "const mover = engine.state.units.find(u => u.player === 1);",
    "const dest = [...getPossibleMoves(mover).keys()][0];",
    "engine.actionManager.SubmitAction({ type: 'action', action: 'move', payload: { unitId: mover.id, targetEdgeKey: dest } });",
    "engine.actionManager.SubmitAction({ type: 'action', action: 'end-turn', payload: {} });",
].join('\n'), server);

// Push every plain-data field OFF its default before taking the view.
//
// Without this the comparison lies: both engines start from CreateEngineInstance(), so
// a field that is never transmitted still matches as long as neither side has changed
// it. The first run of this tool reported three gaps and looked reassuring; it was
// only measuring the fields that happened to have moved.
vm.runInContext([
    "engine.state.gridRadius = 4;",
    "engine.state.playerColorSelections = { player1: 3, player2: 5 };",
    "engine.state.respawnQueue = { player1: [{ typeName: 'ARCHER', turnsRemaining: 2 }], player2: [] };",
    "engine.state.playerActionTaken = { player1: true, player2: false };",
    "engine.state.arcadeTotalTurns = 7;",
    "engine.state.matchId = 'parity-test-match';",
    "engine.state.unitCounts = { player1: { SWORDSMAN: 2 }, player2: { ARCHER: 1 } };",
    "engine.state.reach = { player1: 11, player2: 2 };",
    "engine.state.rations = { player1: 4, player2: 9 };",
    "engine.state.baseCampPositions = { player1: ['1,2'], player2: ['-1,-2'] };",
    "engine.state.gameOver = false;",
].join('\n'), server);

const view = JSON.parse(vm.runInContext('JSON.stringify(BuildResyncSnapshot(1))', server));

// --- a client that has never seen this match --------------------------------
const client = Boot();
vm.runInContext('globalThis.engine = CreateEngineInstance();'
    + ' globalThis.gameState = { needsRedraw: false };', client);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/client/remote-state.js'), 'utf8'), client);
vm.runInContext('globalThis.incoming = ' + JSON.stringify(view) + ';', client);
vm.runInContext('BeginRemoteMatch(1); ApplyRemoteView(incoming);', client);

// --- compare every field ----------------------------------------------------
const keys = vm.runInContext('JSON.stringify(Object.keys(engine.state))', server);
const gaps = [];
const explained = [];

JSON.parse(keys).forEach(key => {
    const read = 'engine.state[' + JSON.stringify(key) + ']';
    const onServer = Canon(vm.runInContext(read, server));
    const onClient = Canon(vm.runInContext(read, client));
    if (onServer === onClient) return;

    if (EXPECTED[key]) { explained.push(key); return; }

    gaps.push({ key, server: onServer, client: onClient });
});

// --- and compare what the board can ANSWER, not just what it holds ----------
// A field can be present and still be unusable. These are the questions the UI asks.
const questions = [
    ['legal moves for every unit',
     "engine.state.units.map(u => u.id + ':' + getPossibleMoves(u).size).sort().join(',')"],
    ['melee attack targets',
     "engine.state.units.map(u => u.id + ':' + getValidMeleeAttackTargets(u).length).sort().join(',')"],
    ['archer attack targets',
     "engine.state.units.map(u => u.id + ':' + getValidArcherAttackTargets(u).length).sort().join(',')"],
    ['fine grid size', 'String(engine.state.fineGrid.size)'],
    ['edge count', 'String(engine.state.edges.size)'],
    ['tile count', 'String(engine.state.tiles.size)'],
];

const behaviour = [];
questions.forEach(([label, expr]) => {
    let a; let b;
    try { a = String(vm.runInContext(expr, server)); } catch (e) { a = 'THREW: ' + e.message; }
    try { b = String(vm.runInContext(expr, client)); } catch (e) { b = 'THREW: ' + e.message; }
    if (a !== b) behaviour.push({ label, server: a, client: b });
});

// --- report -----------------------------------------------------------------
// An exemption is a place a test stops looking, so the two added for the supply pools
// pay for themselves with assertions. "Only your own travels" has two halves, and a
// filter that sent nothing at all would satisfy the first one on its own.
[['reach', 11], ['rations', 4]].forEach(([field, mineValue]) => {
    const seen = vm.runInContext('JSON.stringify(engine.state.' + field + ')', client);
    const parsed = JSON.parse(seen || 'null') || {};
    if (parsed.player1 !== mineValue) {
        gaps.push(field + ': the client did not receive its OWN value (got ' + seen + ')');
    }
    if ('player2' in parsed) {
        gaps.push(field + ': the OPPONENT value travelled to the client (' + seen + ')');
    }
});

if (gaps.length || behaviour.length) {
    console.error('FAIL - the client does not match the server.');
    console.error('');

    if (gaps.length) {
        console.error('Fields that did not make the trip:');
        gaps.forEach(g => {
            console.error('  !! ' + g.key);
            if (verbose) {
                console.error('       server: ' + g.server.slice(0, 160));
                console.error('       client: ' + g.client.slice(0, 160));
            }
        });
        console.error('');
        console.error('  Fix by carrying them in BuildResyncSnapshot (js/server/session.js)');
        console.error('  and applying them in ApplyRemoteView (js/client/remote-state.js) -');
        console.error('  or, if derived, by rebuilding them there like buildFineGridIndex().');
        console.error('');
    }

    if (behaviour.length) {
        console.error('Questions the two boards answer differently:');
        behaviour.forEach(b => {
            console.error('  !! ' + b.label);
            console.error('       server: ' + b.server.slice(0, 160));
            console.error('       client: ' + b.client.slice(0, 160));
        });
        console.error('');
    }

    process.exit(1);
}

console.log('PASS - server/client state parity');
console.log('  fields    : every engine.state field matches, or is listed as deliberately different');
console.log('  explained : ' + explained.join(', '));

console.log('  behaviour : moves, attack targets, fine grid and board size all agree');
