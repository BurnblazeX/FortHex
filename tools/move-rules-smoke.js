// FortHex - map-size movement pools and the overrun rule  (Track C, C1b)
//
//   node tools/move-rules-smoke.js
//   node tools/move-rules-smoke.js --verbose
//
// Two rules landed together and neither is visible to move-parity, for opposite
// reasons - which is exactly why they need their own file.
//
//   MOVEMENT-POOL PRESETS. A match runs on Normal (Horseman 6, Swordsman 5,
//   Archer and Pikeman 4) or Faster (9 / 7 / 5 / 5), chosen in the lobby and fixed
//   for the match. move-parity DOES see a pool change - 176 of its 1280 cases moved
//   when the smaller numbers first landed - but it can only report that something
//   changed, not that the change was the intended one, and re-recording its
//   baseline erases the evidence either way. The numbers are pinned here by value
//   instead.
//
//   OVERRUN. A unit that has spent nothing this turn may step onto a hexPath it
//   cannot afford, for the price of its entire pool. move-parity is BLIND to
//   this: not one of its 1280 cases grew by a single edge, because a cost-5
//   hexPath needs mountain touching mountain and no unit in that corpus starts
//   next to one. A rule that never fires in the corpus that is supposed to
//   cover it is a rule with no test at all, so this file builds the board that
//   makes it fire.
//
// The overrun board is all mountain but one plains tile. The archer stands on
// the plains-to-mountain hexPath beside it - cost 3, affordable - and every
// hexPath one step away is mountain-to-mountain, cost 5. An archer's pool on
// that board is 4, so without overrun that ring is a permanent wall no matter
// how many turns the archer waits.
//
// Exit code 0 = pass.

const vm = require('vm');
const { ReadBundle } = require('../host/server-bundle.js');

const verbose = process.argv.includes('--verbose');
const failures = [];

function Check(label, condition, detail) {
    if (condition) {
        if (verbose) console.log('  ok   ' + label);
    } else {
        failures.push(label);
        console.error('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
    }
}

function Fresh() {
    const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    return ctx;
}

const Run = (ctx, src) => vm.runInContext(src, ctx);

// --- 1. the pools each preset hands out -------------------------------------
//
// Asserted by value, not by re-deriving them from UNIT_SPEED_PRESETS - a test that
// recomputes the table it is checking passes no matter what the table says.
const EXPECTED_POOLS = {
    normal: { HORSEMAN: 6, SWORDSMAN: 5, ARCHER: 4, PIKEMAN: 4 },
    faster: { HORSEMAN: 9, SWORDSMAN: 7, ARCHER: 5, PIKEMAN: 5 },
};

{
    const ctx = Fresh();
    const drift = [];
    for (const preset of Object.keys(EXPECTED_POOLS)) {
        for (const type of Object.keys(EXPECTED_POOLS[preset])) {
            const got = Run(ctx, 'SpeedForPreset(' + JSON.stringify(type) + ', ' + JSON.stringify(preset) + ')');
            const want = EXPECTED_POOLS[preset][type];
            if (got !== want) drift.push(preset + ' ' + type + ': want ' + want + ' got ' + got);
            if (verbose) console.log('       ' + preset.padEnd(7) + ' ' + type.padEnd(9) + ' ' + got);
        }
    }
    Check('every preset hands out the pools it is supposed to', drift.length === 0, drift.join('; '));

    // UNIT_TYPES.speed still carries the Faster numbers, and several places read the
    // template directly (Testament's fallbacks, the stat card's defaults). Two tables
    // holding the same four numbers is two chances to edit one of them.
    const drifted = Run(ctx,
        "['HORSEMAN','SWORDSMAN','ARCHER','PIKEMAN'].filter(k => SpeedForPreset(k, 'faster') !== UNIT_TYPES[k].speed)");
    Check('the Faster preset still matches UNIT_TYPES exactly', drifted.length === 0, drifted.join(', '));

    // Normal has to actually be slower. Equal rows would pass the check above while
    // meaning the toggle does nothing.
    const same = Run(ctx,
        "['HORSEMAN','SWORDSMAN','ARCHER','PIKEMAN'].filter(k => SpeedForPreset(k, 'normal') >= SpeedForPreset(k, 'faster'))");
    Check('Normal really is slower than Faster, for every unit', same.length === 0, same.join(', '));

    // An unrecognised or absent preset must not silently hand out the faster pools.
    const fallback = Run(ctx,
        "SpeedForPreset('HORSEMAN', undefined) === SpeedForPreset('HORSEMAN', 'normal')"
        + " && SpeedForPreset('HORSEMAN', 'nonsense') === SpeedForPreset('HORSEMAN', 'normal')");
    Check('an unknown preset falls back to Normal, never to Faster', fallback === true);

    // The recommendation the lobby seeds itself from. Only Expansive gets Faster;
    // src/ui/screens/RoomScreen.jsx keeps its own copy of this rule for the lobby
    // bundle, so a change here has to be made there too.
    const rec = Run(ctx, "[2, 3, 4].map(r => RecommendedUnitSpeedPreset(r)).join(',')");
    Check('only the Expansive board recommends Faster', rec === 'normal,normal,faster', 'got ' + rec);
}

// --- 1b. the preset is a MATCH setting, and it reaches the units -------------
//
// The table being right proves nothing if the engine never reads it. This builds the
// same board twice under the two presets and reads the pools off the units that
// actually got created.
{
    const built = {};
    for (const preset of ['normal', 'faster', null]) {
        const ctx = Fresh();
        Run(ctx, 'globalThis.engine = CreateEngineInstance();'
            + ' engine.settings.fogOfWarEnabled = false; engine.settings.animationsEnabled = false;'
            + ' engine.settings.unitSpeedPreset = ' + JSON.stringify(preset) + ';'
            + " const m = FindSelectableMap('Standard');"
            + ' SetGridMode(m.radius); InitializeGridDimensions(m.radius);'
            + ' InitializeGrid(m.tiles, m.units, null);');
        built[String(preset)] = JSON.parse(Run(ctx,
            "JSON.stringify(engine.state.units.map(u => u.typeId + ':' + u.stats.speed).sort())"));
        if (verbose) console.log('       preset ' + String(preset) + ' -> ' + built[String(preset)].join(' '));
    }

    Check('choosing Faster actually builds faster units',
        JSON.stringify(built.normal) !== JSON.stringify(built.faster),
        'both presets produced identical pools; the setting is not reaching createUnit');

    // Standard is radius 3, so "auto" must resolve to Normal there - and it must do so
    // by the recommendation, not by luck.
    Check('an unset preset on the Standard board resolves to Normal',
        JSON.stringify(built['null']) === JSON.stringify(built.normal),
        'auto gave ' + built['null'].join(' '));
}

// --- 2. overrun --------------------------------------------------------------
const BOARD = `
function BuildOverrunBoard() {
    const R = 3;
    const tiles = new Map();
    for (let q = -R; q <= R; q++) {
        for (let r = -R; r <= R; r++) {
            if (Math.abs(q + r) <= R) tiles.set(q + ',' + r, TILE_TYPES.MOUNTAIN);
        }
    }
    // The ONE plains tile on the board. The archer stands on the hexPath between
    // it and a mountain - cost 3, affordable - and every hexPath rotating away
    // from that one is mountain to mountain, cost 5. That adjacency is the whole
    // point: overrun is a FIRST-STEP rule, so a cost-5 hexPath two steps out
    // would prove nothing. It has to be the very next cell.
    tiles.set('0,0', TILE_TYPES.PLAINS);

    SetGridMode(R);
    InitializeGridDimensions(R);
    InitializeGrid(tiles, [{ player: 1, typeName: 'ARCHER', position: getEdgeKey(0, 0, 1, 0) }], null);
    return engine.state.units[0];
}

// What getPossibleMoves offers, alongside what each destination REALLY costs, so
// an overrun cell can be told apart from an ordinary cheap one.
function Offer(unit) {
    const out = [];
    getPossibleMoves(unit).forEach((data, key) => {
        out.push({ key: key, charged: data.cost, raw: getEdgeCost(unit, key) });
    });
    return out;
}
`;

{
    const ctx = Fresh();
    Run(ctx, 'globalThis.engine = CreateEngineInstance();'
        + ' engine.settings.fogOfWarEnabled = false;'
        + ' engine.settings.animationsEnabled = false;');
    Run(ctx, BOARD);
    Run(ctx, 'globalThis.archer = BuildOverrunBoard();');

    const pool = Run(ctx, 'archer.currentMove');
    Check('the archer on this Normal board has a pool of 4', pool === 4, 'pool is ' + pool);

    // The board has to actually contain the wall, or everything below passes by
    // testing nothing.
    const wallCount = Run(ctx,
        "[...engine.state.edges.keys()].filter(k => getEdgeCost(archer, k) === 5).length");
    Check('the board contains cost-5 hexPaths at all', wallCount > 0, 'found ' + wallCount);

    const full = Run(ctx, 'JSON.stringify(Offer(archer))');
    const offered = JSON.parse(full);
    const overrun = offered.filter(o => o.raw > pool);

    Check('a full-tank archer is offered a hexPath that costs more than its whole pool',
        overrun.length > 0,
        'nothing unaffordable was offered; the rule did not fire on a board built for it');

    Check('an overrun step is charged the entire pool, not its face cost',
        overrun.every(o => o.charged === pool),
        overrun.map(o => o.key + ' raw ' + o.raw + ' charged ' + o.charged).join(', '));

    // Terminal by construction: charging the whole pool leaves nothing to spend,
    // so no cell may be offered at a cost ABOVE the pool.
    Check('nothing is offered beyond the pool, so overrun cannot be chained',
        offered.every(o => o.charged <= pool),
        offered.filter(o => o.charged > pool).map(o => o.key).join(', '));

    // Water is impassable, not merely expensive, and overrun must not launder it
    // into a legal move.
    const wet = Run(ctx, 'IsTraversableCost(Infinity) === false && CanOverrunHexPath(archer, 0, Infinity) === false');
    Check('overrun does not make an impassable hexPath crossable', wet === true);

    if (verbose) {
        console.log('       offered ' + offered.length + ' cells, ' + overrun.length + ' of them overrun');
    }

    // Spend a single point and the offer must vanish - this is the "has not acted
    // this turn" half of the rule, and it is the half that stops overrun being a
    // free extra move tacked onto an attack.
    Run(ctx, 'archer.currentMove -= 1;');
    const afterSpend = JSON.parse(Run(ctx, 'JSON.stringify(Offer(archer))'));
    Check('an archer that has already spent a point is offered no overrun',
        afterSpend.every(o => o.charged >= o.raw),
        afterSpend.filter(o => o.charged < o.raw).map(o => o.key + ' raw ' + o.raw + ' charged ' + o.charged).join(', '));
    Check('and the cost-5 ring is genuinely closed to it',
        afterSpend.every(o => o.raw < 5),
        afterSpend.filter(o => o.raw >= 5).map(o => o.key).join(', '));
}

if (failures.length) {
    console.error('\nmove-rules-smoke: ' + failures.length + ' failure(s)');
    process.exit(1);
}
console.log('move-rules-smoke: ok - the speed presets are what they say and reach the units, and a full-tank unit can always take one step');
