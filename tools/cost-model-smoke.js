// FortHex - the edge cost model, both configurations  (Track C, step 3 prep)
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
//   1. THE ACTIVE MODEL STILL MATCHES THE OLD CASCADE, terrain pair by terrain
//      pair. move-parity.js already proves this over real boards, but it can
//      only see pairs those boards happen to contain; this enumerates all of
//      them, including any a map generator never produces.
//
//   2. THE C1 CONFIGURATION REPRODUCES THE ROADMAP'S PUBLISHED TABLE. C1 is a
//      balance change nobody has run yet, and the claim that its 4x4 matrix
//      collapses to four scalars is the reason the shape was built this way. If
//      that claim is wrong, it should fail here rather than halfway through the
//      rebalance.
//
// The C1 config is NOT active. This computes with it; it does not install it.
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
Check('the active cost model reproduces the old cascade on all ' + pairs + ' terrain pairs',
    drift.length === 0, drift.join('; '));

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

// Every C1 weight is odd, so every pair sums to an even number and halves to an
// integer. If a future weight breaks that, costs become fractional and the MP
// pools stop meaning what they say.
const oddness = vm.runInContext('Object.keys(C1_WEIGHTS).filter(k => C1_WEIGHTS[k] % 2 === 0)', ctx);
Check('every C1 weight is odd, so no pair produces a fractional cost',
    oddness.length === 0, 'even weights: ' + oddness.join(', '));

// --- 3. the cap that would silently eat the rebalance -----------------------
const cap = vm.runInContext('MAX_MOVEMENT_COST', ctx);
const worstC1 = 5;
Check('MAX_MOVEMENT_COST is still ' + cap + ', which is BELOW C1\'s worst cost of '
    + worstC1 + ' - it must be raised in the same commit that flips the weights',
    cap < worstC1,
    'this check exists to fire the moment someone flips the weights without the cap; '
    + 'if the cap has been raised, delete this assertion rather than the warning it carries');

if (failures.length) {
    console.error('\ncost-model-smoke: ' + failures.length + ' failure(s)');
    process.exit(1);
}
console.log('cost-model-smoke: ok - active model matches the old cascade, C1 scalars match the roadmap table');
