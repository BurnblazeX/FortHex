// === The room's map actually reaches the board (B2) ===
//
//   node tools/map-setup-smoke.js
//
// Until rooms could pick a map, every hosted match called InitializeGrid with nothing and
// got the default radius-3 board. Choosing a map is only real if the WORKER builds the
// right one, and the failure mode if it does not is quiet: a radius-4 map poured into a
// radius-3 grid loses every tile outside the smaller ring and still starts a playable
// match, on a board nobody picked.
//
// So this drives the real match worker, in the real bundle, and checks the board that
// comes out - tile count, radius, and mode - rather than checking that a name was passed
// along.

const vm = require('vm');
const { BuildWorkerSource } = require('../host/server-bundle.js');

let failures = 0;
function Check(label, condition, detail) {
    if (condition) { console.log('  ok   ' + label); return; }
    failures++;
    console.log('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
}

// A worker, without the worker: the driver takes parentPort and workerData from
// globalThis.FORTHEX_WORKER_HOST when one is installed, which is the same seam the
// browser uses.
function StartWorker() {
    const posted = [];
    const context = vm.createContext({ console });
    context.globalThis = context;

    let drive = null;
    context.FORTHEX_WORKER_HOST = {
        workerData: { matchId: 'smoke', players: [1, 2], settings: {} },
        parentPort: {
            postMessage: (message) => posted.push(message),
            on: (event, handler) => { if (event === 'message') drive = handler; },
        },
    };

    vm.runInContext(BuildWorkerSource(), context);

    return {
        posted,
        Send: (envelope) => { posted.length = 0; drive(envelope); },
        Read: (expression) => vm.runInContext(expression, context),
        Started: () => posted.find(m => m.type === 'started') || null,
        Error: () => posted.find(m => m.type === 'host-error') || null,
    };
}

console.log('\n[1] every preset map builds, at its own size');

// name -> [tiles, units, radius, mode]. Written out rather than computed, so a map that
// silently changes shape is a failure here instead of a surprise in a match.
const EXPECTED = {
    'Standard':       [37, 8, 3, 'local'],
    'Alpha Grounds':  [19, 4, 2, 'arcade'],
    'River Fork':     [37, 8, 3, 'local'],
    'Volcano Island': [61, 12, 4, 'local'],
};

Object.entries(EXPECTED).forEach(([name, [tiles, units, radius, mode]]) => {
    const worker = StartWorker();
    worker.Send({ kind: 'start-match', mapName: name });

    const error = worker.Error();
    if (error) { Check(name + ' builds', false, error.where + ': ' + error.error); return; }

    const started = worker.Started();
    Check(name + ' builds a board', !!started);
    if (!started) return;

    Check(name + ' has ' + tiles + ' tiles', started.tiles === tiles, 'got ' + started.tiles);
    Check(name + ' has ' + units + ' units', started.units === units, 'got ' + started.units);
    Check(name + ' is radius ' + radius, worker.Read('engine.state.gridRadius') === radius,
        'got ' + worker.Read('engine.state.gridRadius'));

    // Radius 2 IS arcade: SetGridMode clears the flags and base camps for it, and no
    // other part of the game has ever run a non-arcade match at that size.
    Check(name + ' is ' + mode, worker.Read('engine.state.gameMode') === mode,
        'got ' + worker.Read('engine.state.gameMode'));
});

console.log('\n[2] the sizes are actually different, so a pass is not a coincidence');

// The bug this file exists to catch is every map quietly becoming the default one. If the
// expectations above ever collapse onto a single tile count, the checks would all pass
// while proving nothing.
const counts = Object.values(EXPECTED).map(entry => entry[0]);
Check('the presets do not all have the same tile count',
    new Set(counts).size > 1, JSON.stringify(counts));

const defaultWorker = StartWorker();
defaultWorker.Send({ kind: 'start-match', mapName: 'Volcano Island' });
const bigTiles = defaultWorker.Started().tiles;

const plainWorker = StartWorker();
plainWorker.Send({ kind: 'start-match' });
const plainTiles = plainWorker.Started().tiles;

Check('a named map differs from the default board', bigTiles !== plainTiles,
    'both produced ' + bigTiles + ' tiles, which is what a map that was never applied looks like');

console.log('\n[3] an unknown map name falls back rather than failing');

const unknown = StartWorker();
unknown.Send({ kind: 'start-match', mapName: 'A Map From The Future' });
Check('an unrecognised name still starts a match', !unknown.Error() && !!unknown.Started());
Check('and lands on the default board', unknown.Started().tiles === plainTiles);

console.log('\n[4] a map loaded from a file is built from what it carries');

// The shape ReadMapFileForRoom (js/client/save.js) produces: tiles as pairs, units keyed
// by typeName. InitializeGrid accepts both, which is why nothing reshapes it in between.
const custom = StartWorker();
custom.Send({
    kind: 'start-match',
    customMap: {
        name: 'Smoke Custom',
        radius: 2,
        tiles: [
            ['0,0', { type: { name: 'Mountain' } }],
            ['1,0', { type: { name: 'Forest' } }],
            ['0,1', { type: { name: 'Water' } }],
        ],
        units: null,
        baseCampPositions: null,
    },
});

Check('a custom map starts without error', !custom.Error(),
    custom.Error() ? custom.Error().error : '');
Check('it is built at the FILE\'s radius, not the default',
    custom.Read('engine.state.gridRadius') === 2,
    'got ' + custom.Read('engine.state.gridRadius'));
Check('its tiles are on the board',
    custom.Read("engine.state.tiles.get('0,0') && engine.state.tiles.get('0,0').type.name") === 'Mountain',
    'got ' + custom.Read("JSON.stringify(engine.state.tiles.get('0,0') || null)"));

// A custom map wins even when a name is also present: the name is what the room falls
// back to, not an override.
const both = StartWorker();
both.Send({
    kind: 'start-match',
    mapName: 'Volcano Island',
    customMap: { name: 'Wins', radius: 3, tiles: [['0,0', { type: { name: 'Water' } }]], units: null },
});
Check('a loaded file takes precedence over a preset name',
    both.Read('engine.state.gridRadius') === 3
    && both.Read("engine.state.tiles.get('0,0').type.name") === 'Water');

console.log('\n[5] a saved match resumes as the same match');

// Build a real board, move it along, save it the way a client would, and resume it in a
// fresh worker. Perturbed first ON PURPOSE: a resume that quietly rebuilt a default board
// would pass every check against an unmodified match, which is how a parity test ends up
// proving nothing (see tools/state-parity.js for the time that actually happened).
const origin = StartWorker();
origin.Send({ kind: 'start-match', mapName: 'Volcano Island' });

origin.Read('engine.state.globalTurnNumber = 7');
origin.Read('engine.state.currentPlayer = 2');
origin.Read('engine.state.units[0].stats.hp = 3');

const woundedId = origin.Read('engine.state.units[0].id');
const originUnits = origin.Read('engine.state.units.length');
const originTiles = origin.Read('engine.state.tiles.size');

// The save format doubles as the wire format, and BuildSaveObject is the one serializer
// already asserted JSON-safe. Round-tripped through JSON here because that is what
// actually happens between the uploader and the host.
origin.Send({ kind: 'snapshot', requestId: 'resume' });
const snapshot = origin.posted.find(m => m.type === 'snapshot');
Check('a live match can be snapshotted', !!snapshot);

if (snapshot) {
    const save = JSON.parse(JSON.stringify(snapshot.save));

    const resumed = StartWorker();
    resumed.Send({ kind: 'start-match', resumeSave: save });

    const error = resumed.Error();
    Check('resuming does not error', !error, error ? error.where + ': ' + error.error : '');

    if (!error) {
        Check('it reports itself as a resume', resumed.Started().resumed === true);

        Check('the board is the SAVE\'s, not a fresh default',
            resumed.Read('engine.state.tiles.size') === originTiles
            && resumed.Read('engine.state.gridRadius') === 4,
            resumed.Read('engine.state.tiles.size') + ' tiles at radius '
            + resumed.Read('engine.state.gridRadius'));

        Check('the turn number survives', resumed.Read('engine.state.globalTurnNumber') === 7,
            'got ' + resumed.Read('engine.state.globalTurnNumber'));
        Check('whose turn it is survives', resumed.Read('engine.state.currentPlayer') === 2,
            'got ' + resumed.Read('engine.state.currentPlayer'));
        Check('every unit survives', resumed.Read('engine.state.units.length') === originUnits);
        Check('a wounded unit is still wounded',
            resumed.Read("(engine.state.units.find(u => u.id === '" + woundedId + "') || { stats: {} }).stats.hp") === 3);

        // playerSide binds a client to one army. A local save records the device that
        // wrote it; carrying that into a hosted match would bind BOTH clients to the
        // same side, which is the singleplayer-means-online trap wearing a new hat.
        Check('playerSide is cleared, so the SEATS decide sides',
            resumed.Read('engine.state.playerSide') === null,
            'got ' + JSON.stringify(resumed.Read('engine.state.playerSide')));

        // Who WROTE the file is not a fact about the match.
        Check('the uploader\'s profile is not adopted',
            !resumed.Read('engine.state.profile'));

        console.log('\n[6] and the resumed board is actually usable');

        // A board can hold every correct field and still answer nothing, which is what
        // a missing fineGrid index did to attack range once.
        Check('type getters are back', !!resumed.Read('engine.state.units[0].type'));
        Check('and survive being spread',
            resumed.Read('!!({ ...engine.state.units[0] }).type'));

        // Enumerable would serialise every unit on the board straight past fog
        // redaction. That has happened once already.
        Check('edge.units is a NON-enumerable getter', resumed.Read(
            "(() => { const d = Object.getOwnPropertyDescriptor("
            + "engine.state.edges.get(engine.state.units[0].edgeKey), 'units');"
            + " return !!(d && d.get) && d.enumerable === false; })()"));
        Check('edges find their units',
            resumed.Read('engine.state.edges.get(engine.state.units[0].edgeKey).units.length') > 0);

        Check('the fine grid was rebuilt', resumed.Read('engine.state.fineGrid.size') > 0,
            'size ' + resumed.Read('engine.state.fineGrid.size'));

        // The question the UI actually asks. Zero everywhere is what a board that looks
        // fine and cannot be played looks like.
        const totalMoves = resumed.Read(
            'engine.state.units.reduce((sum, u) => sum + getPossibleMoves(u).size, 0)');
        Check('units have legal moves', totalMoves > 0, 'total legal moves: ' + totalMoves);
    }
}


console.log('\n[7] a resumed board rebuilds its OWN edges, not the grid it was poured into');

// The check that actually distinguishes. The lean schema does not store edges - it
// regenerates them from the tiles - so a resume that keeps whatever
// InitializeGridDimensions built is wrong. It is invisible for a map that FILLS its grid,
// because the fresh edges are then exactly the right ones; a small custom map is what
// separates the two. This case produced 2 tiles and 90 edges before it was fixed.
const smallOrigin = StartWorker();
smallOrigin.Send({
    kind: 'start-match',
    customMap: {
        name: 'Three Tiles',
        radius: 3,
        tiles: [
            ['0,0', { type: { name: 'Plains' } }],
            ['1,0', { type: { name: 'Plains' } }],
            ['0,1', { type: { name: 'Plains' } }],
        ],
        units: null,
    },
});

const smallTiles = smallOrigin.Read('engine.state.tiles.size');
const smallEdges = smallOrigin.Read('engine.state.edges.size');

// A full radius-3 grid, for contrast: if the resume below matches THIS instead, it kept
// the scaffolding rather than the board.
const fullGrid = StartWorker();
fullGrid.Send({ kind: 'start-match' });
const fullEdges = fullGrid.Read('engine.state.edges.size');

Check('the small map really is smaller than its grid', smallEdges < fullEdges,
    smallEdges + ' vs ' + fullEdges + ' edges - this case cannot distinguish anything');

smallOrigin.Send({ kind: 'snapshot', requestId: 'small' });
const smallSnap = smallOrigin.posted.find(m => m.type === 'snapshot');

if (smallSnap) {
    const smallResume = StartWorker();
    smallResume.Send({ kind: 'start-match', resumeSave: JSON.parse(JSON.stringify(smallSnap.save)) });

    Check('a lean save (no edge list) still resumes', !smallResume.Error(),
        smallResume.Error() ? smallResume.Error().error : '');
    Check('the tile count is the save\'s', smallResume.Read('engine.state.tiles.size') === smallTiles,
        'got ' + smallResume.Read('engine.state.tiles.size') + ', expected ' + smallTiles);
    Check('the EDGE count is the save\'s, not the empty grid\'s',
        smallResume.Read('engine.state.edges.size') === smallEdges,
        'got ' + smallResume.Read('engine.state.edges.size') + ', expected ' + smallEdges
        + ' (an empty radius-3 grid has ' + fullEdges + ')');
}

console.log('');
if (failures) {
    console.log('FAILED - ' + failures + ' check(s)\n');
    process.exit(1);
}
console.log('map-setup-smoke: all checks passed\n');
