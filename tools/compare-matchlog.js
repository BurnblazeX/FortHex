// FortHex - semantic diff for two match logs captured by ExportMatchHistory().
//
//   node tools/compare-matchlog.js tools/reference/default-opening.a2.json after.json
//
// A plain text diff of two captures is useless: timestamps and ids differ every
// run. This compares the things that would actually indicate a rules change -
// the ordered ledger, the numbers inside each entry, and the final board.
//
// Intended use: play the same scripted opening before and after a risky change
// (Track C's fine-grid migration, a movement-cost rebalance, a validation
// rewrite) and run this. Silence means the rules behaved identically. Any
// divergence is either a real change or a mistake, and the output says which
// entry to look at.

const fs = require('fs');

const [, , pathA, pathB] = process.argv;
if (!pathA || !pathB) {
    console.error('usage: node tools/compare-matchlog.js <before.json> <after.json>');
    process.exit(2);
}

const A = JSON.parse(fs.readFileSync(pathA, 'utf8'));
const B = JSON.parse(fs.readFileSync(pathB, 'utf8'));

const problems = [];
const notes = [];

// --- setup: a mismatch here makes the rest of the comparison meaningless -----

for (const key of ['gameMode', 'gridRadius', 'fogOfWarEnabled', 'playerSide']) {
    if (JSON.stringify(A.setup[key]) !== JSON.stringify(B.setup[key])) {
        problems.push(`setup.${key}: ${JSON.stringify(A.setup[key])} -> ${JSON.stringify(B.setup[key])}` +
                      '  (different scenario - the rest of this diff means nothing)');
    }
}
if (JSON.stringify(A.setup.baseCampPositions) !== JSON.stringify(B.setup.baseCampPositions)) {
    problems.push('setup.baseCampPositions differ - different map layout');
}
if (A.build !== B.build) notes.push(`build ${A.build} -> ${B.build}`);

// --- the ledger -------------------------------------------------------------
// Fields worth comparing per entry type. Anything not listed (unit ids, which
// vary per run only if the opening was played differently) is compared via the
// entry's shape rather than its exact value.

const FIELDS = {
    MOVE:               ['from', 'to', 'cost'],
    ATTACK:             ['targetType', 'damageDealt', 'isKill', 'targetId', 'modifiers'],
    FORTIFY:            ['tile', 'relativeLocation'],
    UNFORTIFY:          ['fromTile', 'toEdge', 'relativeLocation'],
    FORTIFY_ZOC_BLAST:  ['hits'],
    TURN_START_ZOC:     ['events'],
    MOVEMENT_ZOC_HIT:   ['location', 'damage', 'isFatal'],
};

const describe = (e, i) => `#${i} ${e.type} t${e.turn} p${e.player}${e.actorId ? ' ' + e.actorId : ''}`;

if (A.matchHistory.length !== B.matchHistory.length) {
    problems.push(`ledger length: ${A.matchHistory.length} -> ${B.matchHistory.length} entries`);
}

const pairs = Math.min(A.matchHistory.length, B.matchHistory.length);
let firstDivergence = -1;

for (let i = 0; i < pairs; i++) {
    const a = A.matchHistory[i];
    const b = B.matchHistory[i];

    if (a.type !== b.type || a.turn !== b.turn || a.player !== b.player) {
        problems.push(`${describe(a, i)}  ->  ${describe(b, i)}   (sequence diverged)`);
        if (firstDivergence < 0) firstDivergence = i;
        break; // everything after a sequence break is noise
    }

    for (const field of (FIELDS[a.type] || [])) {
        const av = JSON.stringify(a.payload ? a.payload[field] : undefined);
        const bv = JSON.stringify(b.payload ? b.payload[field] : undefined);
        if (av !== bv) {
            problems.push(`${describe(a, i)}  ${field}: ${av} -> ${bv}`);
            if (firstDivergence < 0) firstDivergence = i;
        }
    }

    // The per-entry unit snapshot is the strongest signal: same action, same
    // inputs, different resulting hp/mp means a rule changed underneath.
    for (const snap of ['unitState', 'attackerState', 'targetState']) {
        const as = a.payload && a.payload[snap];
        const bs = b.payload && b.payload[snap];
        if (!as || !bs) continue;
        for (const f of ['hp', 'mp', 'pos', 'isFortified']) {
            if (JSON.stringify(as[f]) !== JSON.stringify(bs[f])) {
                problems.push(`${describe(a, i)}  ${snap}.${f}: ${JSON.stringify(as[f])} -> ${JSON.stringify(bs[f])}`);
                if (firstDivergence < 0) firstDivergence = i;
            }
        }
    }
}

// --- final board ------------------------------------------------------------

const board = (log) => Object.fromEntries(log.outcome.units.map(u => [u.id, u]));
const bA = board(A), bB = board(B);

for (const id of Object.keys(bA)) {
    if (!bB[id]) { problems.push(`final board: ${id} survived before, gone after`); continue; }
    for (const f of ['hp', 'pos', 'fortified', 'type']) {
        if (JSON.stringify(bA[id][f]) !== JSON.stringify(bB[id][f])) {
            problems.push(`final board: ${id}.${f}: ${JSON.stringify(bA[id][f])} -> ${JSON.stringify(bB[id][f])}`);
        }
    }
}
for (const id of Object.keys(bB)) {
    if (!bA[id]) problems.push(`final board: ${id} appeared, wasn't there before`);
}
const reachA = LoggedReach(A.outcome);
const reachB = LoggedReach(B.outcome);
for (const p of ['player1', 'player2']) {
    if (reachA[p] !== reachB[p]) {
        problems.push(`final reach ${p}: ${reachA[p]} -> ${reachB[p]}`);
    }
}

// A log's recorded reach, whatever it is called in the file.
//
// Logs captured before the C2 supply overhaul record it as `supplyPoints`; newer ones
// record `reach`, which is the same fact renamed. Normalised HERE rather than by
// rewriting the logs, for the reason set out in js/testament.js: a record quietly
// edited to match today's vocabulary is worth less as evidence than an honestly mixed
// one. Same policy that keeps matchHistory positions in their original spelling.
function LoggedReach(outcome) {
    if (!outcome) return {};
    return outcome.reach || outcome.supplyPoints || {};
}

// --- report -----------------------------------------------------------------

console.log(`before: ${pathA}  (${A.label}, ${A.entryCount} entries)`);
console.log(`after : ${pathB}  (${B.label}, ${B.entryCount} entries)`);
notes.forEach(n => console.log(`note  : ${n}`));
console.log('');

if (problems.length === 0) {
    console.log('IDENTICAL - same ledger, same numbers, same final board.');
    process.exit(0);
}

console.log(`${problems.length} DIVERGENCE(S):`);
problems.slice(0, 40).forEach(p => console.log('  ' + p));
if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
if (firstDivergence >= 0) {
    console.log(`\nFirst divergence at ledger entry #${firstDivergence}. Everything after it may be`);
    console.log('consequence rather than cause - start there.');
}
process.exit(1);
