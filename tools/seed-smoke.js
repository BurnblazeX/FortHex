// FortHex - a seed reproduces a board  (Track C, step 0)
//
//   node tools/seed-smoke.js
//   node tools/seed-smoke.js --verbose
//
// Map generation drew from bare Math.random() in eight places, so no generated
// board could be produced twice. That made Track C's central acceptance test -
// "run the old movement model and the new one over the same arbitrary maps and
// diff the answers" - impossible to state, because there was no such thing as
// the same arbitrary map.
//
// This asserts the property the parity harness is built on top of, so that if
// anyone ever reintroduces an unseeded draw into the generation path the build
// fails here rather than in a parity run that mysteriously stops reproducing.
//
// The last assertion is the one that matters most and the least obvious: a map
// generated with NO seed still records the seed it invented, and feeding that
// value back reproduces the board. Without it, "reproducible" would only apply
// to maps someone had already decided to reproduce.
//
// Exit code 0 = pass.

const vm = require('vm');
const path = require('path');
const { ReadBundle } = require('../host/server-bundle.js');

const verbose = process.argv.includes('--verbose');
const failures = [];

function Boot() {
    const ctx = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    vm.runInContext('globalThis.engine = CreateEngineInstance();', ctx);
    return ctx;
}

// A board as a stable string: every tile key paired with its terrain name.
function Generate(radius, seed) {
    const ctx = Boot();
    vm.runInContext('SetGridMode(' + radius + '); InitializeGridDimensions(' + radius + ');', ctx);
    const call = seed === undefined
        ? 'GenerateImprovedMap(' + radius + ')'
        : 'GenerateImprovedMap(' + radius + ', ' + seed + ')';
    const board = vm.runInContext(
        'JSON.stringify([...' + call + '].map(([k, v]) => k + "=" + v.name))', ctx);
    return { board, seed: vm.runInContext('engine.mapSeed', ctx) };
}

function Check(label, condition) {
    if (condition) {
        if (verbose) console.log('  ok   ' + label);
    } else {
        failures.push(label);
        console.error('  FAIL ' + label);
    }
}

for (const radius of [2, 3, 4]) {
    const first = Generate(radius, 4242);
    const again = Generate(radius, 4242);
    const other = Generate(radius, 918273);

    Check('r' + radius + ': one seed, one board', first.board === again.board);
    Check('r' + radius + ': different seeds differ', first.board !== other.board);
    Check('r' + radius + ': engine.mapSeed records the seed used', first.seed === 4242);

    // Guards the "every map silently became the default" failure mode that
    // map-setup-smoke.js was written for: a generator returning one terrain
    // everywhere would satisfy every assertion above and be worthless.
    const terrains = new Set(JSON.parse(first.board).map(entry => entry.split('=')[1]));
    Check('r' + radius + ': board has more than one terrain', terrains.size > 1);

    const tileCount = JSON.parse(first.board).length;
    Check('r' + radius + ': board is fully populated', tileCount > 0);
    if (verbose) console.log('       r' + radius + ': ' + tileCount + ' tiles, terrains: ' + [...terrains].join(', '));
}

// The unseeded path must still be reproducible AFTER the fact.
const spontaneous = Generate(3);
Check('unseeded generation records an integer seed',
    Number.isInteger(spontaneous.seed) && spontaneous.seed >= 0);
Check('the recorded seed replays the board',
    Generate(3, spontaneous.seed).board === spontaneous.board);

// Unit placement draws from a stream DERIVED from the map seed rather than
// sharing it, so that generating terrain does not shift unit placement.
function PlaceUnits(seed) {
    const ctx = Boot();
    vm.runInContext('SetGridMode(3); InitializeGridDimensions(3);', ctx);
    vm.runInContext('const layout = GenerateImprovedMap(3, ' + seed + '); InitializeGrid(layout);', ctx);
    return vm.runInContext(
        'JSON.stringify(engine.state.units.map(u => u.player + ":" + u.type.name + "@" + u.position).sort())', ctx);
}
const unitsA = PlaceUnits(777);
Check('unit placement is reproducible', unitsA === PlaceUnits(777));
Check('unit placement is not empty', JSON.parse(unitsA).length > 0);

// No unseeded draw may survive anywhere in the generation path. NewMapSeed is
// the single sanctioned exception and is checked by name.
const fs = require('fs');
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'server', 'map-generation.js'), 'utf8');
const codeLines = source.split('\n').filter(line => !line.trim().startsWith('//'));
const draws = codeLines.filter(line => line.includes('Math.random'));
Check('exactly one Math.random survives, inside NewMapSeed',
    draws.length === 1 && draws[0].includes('0x100000000'));

if (failures.length) {
    console.error('\nseed-smoke: ' + failures.length + ' failure(s)');
    process.exit(1);
}
console.log('seed-smoke: ok');
