// FortHex - the edge cost model after C1  (Track C)
//
//   node tools/cost-model-smoke.js
//   node tools/cost-model-smoke.js --verbose
//
// getEdgeCost used to branch on terrain: water special-cased in front of a
// mountain-then-forest-then-plains cascade. Track C replaced that with one
// number per terrain (TILE_TYPES[x].moveWeight) and a combine function
// (EDGE_COST_MODEL.combine), which is what makes adding a terrain cost one
// number instead of a new row and column in a matrix.
//
// This file checks two things that are easy to get quietly wrong:
//
//   1. THE ACTIVE MODEL IS THE ROADMAP C1 TABLE, terrain pair by terrain pair.
//      move-parity checks real boards, but it can only see pairs those boards
//      happen to contain; this enumerates all sixteen.
//
//   2. IT NO LONGER MATCHES THE PRE-C1 CASCADE. That cascade is kept here as a
//      historical oracle, and asserting the active model DIFFERS from it is what
//      proves the rebalance actually landed rather than silently no-opping.
//
//   3. THE CAP AND THE POOLS MOVED WITH IT. MAX_MOVEMENT_COST at 3 would have
//      flattened every cost of 3, 4 and 5 into 3 and thrown the whole rebalance
//      away with no error anywhere.
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

const ctx = { console: { log() {}, warn() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(ReadBundle(), ctx);

const TERRAINS = ['PLAINS', 'FOREST', 'MOUNTAIN', 'WATER'];

// The cascade exactly as it read before Track C, kept here as the oracle.
const LEGACY = `
function LegacyBaseCost(aName, bName) {
    const a = TILE_TYPES[aName], b = TILE_TYPES[bName];
    const isAWater = a === TILE_TYPES.WATER;
    const isBWater = b === TILE_TYPES.WATER;
    if (isAWater && isBWater) return 'Inf';
    if (isAWater || isBWater) return 3;
    if (a === TILE_TYPES.MOUNTAIN || b === TILE_TYPES.MOUNTAIN) return 3;
    if (a === TILE_TYPES.FOREST || b === TILE_TYPES.FOREST) return 2;
    return 1;
}

function ActiveBaseCost(aName, bName) {
    const a = TILE_TYPES[aName], b = TILE_TYPES[bName];
    if (a.crossable === false && b.crossable === false) return 'Inf';
    return EDGE_COST_MODEL.combine(a.moveWeight, b.moveWeight);
}

// C1's proposal, computed but never installed.
const C1_WEIGHTS = { PLAINS: 1, FOREST: 3, MOUNTAIN: 5, WATER: 5 };
function C1BaseCost(aName, bName) {
    const a = TILE_TYPES[aName], b = TILE_TYPES[bName];
    if (a.crossable === false && b.crossable === false) return 'Inf';
    return (C1_WEIGHTS[aName] + C1_WEIGHTS[bName]) / 2;
}
`;
vm.runInContext(LEGACY, ctx);

const Cost = (fn, a, b) => vm.runInContext(fn + '(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')', ctx);

// --- 1. the active model against the cascade it replaced --------------------
let pairs = 0, drift = [];
for (const a of TERRAINS) {
    for (const b of TERRAINS) {
        pairs++;
        const legacy = Cost('LegacyBaseCost', a, b);
        const active = Cost('ActiveBaseCost', a, b);
        if (String(legacy) !== String(active)) drift.push(a + '+' + b + ': cascade ' + legacy + ' vs model ' + active);
        if (verbose) console.log('       ' + (a + '+' + b).padEnd(20) + ' cascade ' + String(legacy).padStart(3) + '   model ' + String(active).padStart(3));
    }
}
// C1 CHANGED THESE NUMBERS ON PURPOSE. Before C1 the active model reproduced
// the cascade exactly and this asserted equality; now it must DIFFER, or the
// rebalance silently did not land. Keeping the cascade as the historical oracle
// is what makes that a real check rather than a comment.
Check('the active cost model NO LONGER matches the pre-C1 cascade - the rebalance landed',
    drift.length > 0, 'active model is still identical to the old max-based cascade');

// Symmetry is not automatic - the cascade was written as an ordered chain of
// tests, so it could in principle have disagreed with itself on order.
let asym = [];
for (const a of TERRAINS) for (const b of TERRAINS) {
    if (String(Cost('ActiveBaseCost', a, b)) !== String(Cost('ActiveBaseCost', b, a))) asym.push(a + '/' + b);
}
Check('edge cost is symmetric in its two tiles', asym.length === 0, asym.join(', '));

// --- 2. the C1 configuration against the roadmap's table --------------------
// From FortHex_B30_Candidates_Roadmap.md, section C1. Water has no column
// because water-to-water is impassable without a bridge.
const ROADMAP_C1 = {
    'PLAINS+PLAINS': 1, 'PLAINS+FOREST': 2, 'PLAINS+MOUNTAIN': 3,
    'FOREST+FOREST': 3, 'FOREST+MOUNTAIN': 4,
    'MOUNTAIN+MOUNTAIN': 5,
    'WATER+PLAINS': 3, 'WATER+FOREST': 4, 'WATER+MOUNTAIN': 5,
};
let c1drift = [];
for (const key of Object.keys(ROADMAP_C1)) {
    const [a, b] = key.split('+');
    const got = Cost('C1BaseCost', a, b);
    if (got !== ROADMAP_C1[key]) c1drift.push(key + ': roadmap ' + ROADMAP_C1[key] + ' vs scalars ' + got);
    if (verbose) console.log('       C1 ' + key.padEnd(20) + ' roadmap ' + ROADMAP_C1[key] + '   scalars ' + got);
}
Check('the C1 weights 1/3/5/5 reproduce every cell of the roadmap cost table',
    c1drift.length === 0, c1drift.join('; '));

// And the ACTIVE model must now BE that table, not merely be capable of it.
const activeDrift = [];
for (const key of Object.keys(ROADMAP_C1)) {
    const [a, b] = key.split('+');
    const got = Cost('ActiveBaseCost', a, b);
    if (got !== ROADMAP_C1[key]) activeDrift.push(key + ': want ' + ROADMAP_C1[key] + ' got ' + got);
}
Check('the ACTIVE cost model IS the roadmap C1 table', activeDrift.length === 0, activeDrift.join('; '));

// Every C1 weight is odd, so every pair sums to an even number and halves to an
// integer. If a future weight breaks that, costs become fractional and the MP
// pools stop meaning what they say.
const oddness = vm.runInContext('Object.keys(C1_WEIGHTS).filter(k => C1_WEIGHTS[k] % 2 === 0)', ctx);
Check('every C1 weight is odd, so no pair produces a fractional cost',
    oddness.length === 0, 'even weights: ' + oddness.join(', '));

// --- 3. the cap that would silently eat the rebalance -----------------------
const cap = vm.runInContext('MAX_MOVEMENT_COST', ctx);
const worstC1 = 5;
// The cap was 3 while the weights were 1/2/3/3. Under C1 costs run to 5, so a
// cap left at 3 would have flattened every cost of 3, 4 and 5 into 3 and thrown
// the rebalance away with no error anywhere.
Check('MAX_MOVEMENT_COST (' + cap + ') does not clamp the worst C1 cost of ' + worstC1,
    cap >= worstC1, 'cap ' + cap + ' would flatten every cost above it');

// Unit pools, rescaled (x * 2) - 1. Asserted by value, because these are the
// numbers the whole terrain rebalance is calibrated against.
const POOLS = { HORSEMAN: 9, SWORDSMAN: 7, ARCHER: 5, PIKEMAN: 5 };
const poolDrift = Object.keys(POOLS).filter(
    k => vm.runInContext('UNIT_TYPES.' + k + '.speed', ctx) !== POOLS[k]);
Check('unit movement pools are Horseman 9, Swordsman 7, Archer 5, Pikeman 5',
    poolDrift.length === 0,
    poolDrift.map(k => k + '=' + vm.runInContext('UNIT_TYPES.' + k + '.speed', ctx)).join(', '));

Check('the speed upgrade is worth +1 per point',
    vm.runInContext('UPGRADE_CONSTANTS.BOOST_VALUES.speed', ctx) === 1);

if (failures.length) {
    console.error('\ncost-model-smoke: ' + failures.length + ' failure(s)');
    process.exit(1);
}
console.log('cost-model-smoke: ok - active model is the C1 table, cap and pools rescaled with it');
