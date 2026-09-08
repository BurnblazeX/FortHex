// FortHex - is the fine grid really the whole address space?  (Track C)
//
//   node tools/board-space-smoke.js
//   node tools/board-space-smoke.js --verbose
//
// Burn's model says every position a unit can occupy is a fine-grid cell, so the
// fine grid can replace the current two-part scheme (a tile key OR a two-tile
// edge key, told apart by positionType). Before unit.position is changed to hold
// a fine coordinate - which moves the save schema to v11 and changes the wire
// format - that claim has to be true of every unit on every board, not just the
// ones a quick look happened to cover.
//
// Three things are checked, and the third is the one that would be expensive to
// discover later:
//
//   1. ROUND TRIP. Every unit's board-space key resolves back to exactly the
//      position it came from. If this fails, the new addressing loses
//      information and no migration can be written.
//
//   2. CELL TYPE AGREES WITH positionType. A unit that says 'center' must land
//      on a hexCenter and one that says 'edge' must land on a hexPath.
//
//   3. FORTIFICATION IS DERIVABLE. Standing on a hexCenter must mean exactly
//      isFortified. This is what lets the flag be deleted rather than
//      transmitted, and a single counterexample anywhere means it cannot be.
//
// Units are FORTIFIED for real here, through the action path, because a board at
// turn one has no fortified units at all and every one of these checks would
// pass while testing only half of what it claims to.
//
// Exit code 0 = pass.

const vm = require('vm');
const { ReadBundle } = require('../host/server-bundle.js');

const verbose = process.argv.includes('--verbose');
const failures = [];

const BOARDS = [
    { kind: 'preset', name: 'Standard' },
    { kind: 'preset', name: 'Alpha Grounds' },
    { kind: 'preset', name: 'River Fork' },
    { kind: 'preset', name: 'Volcano Island' },
    { kind: 'generated', radius: 2, seed: 1001 },
    { kind: 'generated', radius: 3, seed: 1002 },
    { kind: 'generated', radius: 4, seed: 1003 },
];

const PROBE = `
function AuditUnits(tag) {
    const problems = [];
    let checked = 0, fortifiedSeen = 0, unfortifiedSeen = 0;

    for (const unit of engine.state.units) {
        checked++;
        if (unit.isFortified) fortifiedSeen++; else unfortifiedSeen++;

        const key = BoardSpaceKeyOfUnit(unit);
        if (!key) { problems.push({ tag, id: unit.id, why: 'no board-space key' }); continue; }

        const cell = ResolveBoardSpaceKey(key);
        if (!cell) { problems.push({ tag, id: unit.id, why: 'key resolves to nothing', key }); continue; }

        // 1. round trip
        if (cell.key !== unit.position) {
            problems.push({ tag, id: unit.id, why: 'round trip lost the position',
                key, resolvedTo: cell.key, actual: unit.position });
        }

        // 2. cell type agrees with the stored positionType
        const expected = unit.positionType === 'center' ? 'tile' : 'edge';
        if (cell.type !== expected) {
            problems.push({ tag, id: unit.id, why: 'cell type disagrees with positionType',
                positionType: unit.positionType, cellType: cell.type });
        }

        // 3. fortification derivable from position alone
        if (IsUnitFortifiedByPosition(unit) !== !!unit.isFortified) {
            problems.push({ tag, id: unit.id, why: 'fortification not derivable',
                derived: IsUnitFortifiedByPosition(unit), stored: !!unit.isFortified,
                positionType: unit.positionType });
        }
    }
    return { problems, checked, fortifiedSeen, unfortifiedSeen };
}

// Vision must only ever name things that are on the board.
//
// computePlayerVision used to force all six geometric edges around every base
// tile and every fortified unit visible, to paper over boundary fog from before
// the fine grid had cells for borders. It SPELLED those edge keys rather than
// looking them up, so at the rim it named edges that do not exist. Harmless in
// practice - nothing matches a key for a thing that is not there - but it meant
// the vision set was not a set of board entities, and anything downstream that
// iterated it rather than testing membership would have been reading fiction.
function AuditVisionKeys() {
    const problems = [];
    for (const player of [1, 2]) {
        const vis = computePlayerVision(player);
        vis.edges.forEach(edgeKey => {
            if (!engine.state.edges.has(edgeKey)) {
                problems.push({ player, why: 'vision names an edge that does not exist', key: edgeKey });
            }
        });
        vis.tiles.forEach(tileKey => {
            if (!engine.state.tiles.has(tileKey)) {
                problems.push({ player, why: 'vision names a tile that does not exist', key: tileKey });
            }
        });
    }
    return problems;
}

async function FortifySome() {
    const fortified = [];
    for (const player of [1, 2]) {
        for (const unit of engine.state.units.filter(u => u.player === player)) {
            const targets = [].concat(GetValidFortifyTargets(unit) || []);
            if (!targets.length) continue;
            await engine.actionManager.SubmitAction({
                type: 'action', action: 'fortify',
                payload: { unitId: unit.id, targetTileKey: targets[0] },
            });
            if (unit.isFortified) fortified.push(unit.id);
            if (fortified.length >= 2) break;
        }
    }
    return fortified;
}
`;

function Boot(board) {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, Promise,
    };
    vm.createContext(ctx);
    vm.runInContext(ReadBundle(), ctx);
    vm.runInContext(PROBE, ctx);
    const setup = board.kind === 'preset'
        ? 'const m = FindSelectableMap(' + JSON.stringify(board.name) + ');'
          + ' SetGridMode(m.radius); InitializeGridDimensions(m.radius);'
          + ' const bc = m.baseCampPositions;'
          + ' InitializeGrid(m.tiles, m.units, (bc && (bc.player1 || bc.player2)) ? bc : null);'
        : 'SetGridMode(' + board.radius + '); InitializeGridDimensions(' + board.radius + ');'
          + ' InitializeGrid(GenerateImprovedMap(' + board.radius + ', ' + board.seed + '));';
    vm.runInContext('globalThis.engine = CreateEngineInstance();'
        + ' engine.settings.fogOfWarEnabled = false;'
        + ' engine.settings.animationsEnabled = false;' + setup, ctx);
    return ctx;
}

function Check(label, condition, detail) {
    if (condition) {
        if (verbose) console.log('  ok   ' + label);
    } else {
        failures.push(label);
        console.error('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
    }
}

(async () => {
    let totalUnits = 0, totalFortified = 0;

    for (const board of BOARDS) {
        const label = board.kind === 'preset' ? board.name : ('generated r' + board.radius + ' s' + board.seed);
        const ctx = Boot(board);

        const opening = vm.runInContext('JSON.stringify(AuditUnits("opening"))', ctx);
        const openingResult = JSON.parse(opening);
        Check(label + ' (opening): every unit round-trips through board space',
            openingResult.problems.length === 0,
            openingResult.problems.length ? JSON.stringify(openingResult.problems[0]) : null);
        Check(label + ' (opening): the board actually has units', openingResult.checked > 0);

        // Now fortify for real, so hexCenter occupancy is exercised at all.
        vm.runInContext('globalThis.__fortified = FortifySome();', ctx);
        const fortifiedIds = await ctx.__fortified;

        const after = JSON.parse(vm.runInContext('JSON.stringify(AuditUnits("fortified"))', ctx));
        Check(label + ' (fortified): every unit still round-trips',
            after.problems.length === 0,
            after.problems.length ? JSON.stringify(after.problems[0]) : null);

        // Fog on, so the vision path actually runs, and with units fortified so
        // the branch that used to force-add edges is exercised.
        vm.runInContext('engine.settings.fogOfWarEnabled = true;', ctx);
        const visionProblems = JSON.parse(vm.runInContext('JSON.stringify(AuditVisionKeys())', ctx));
        vm.runInContext('engine.settings.fogOfWarEnabled = false;', ctx);
        Check(label + ': vision names only edges and tiles that exist on the board',
            visionProblems.length === 0,
            visionProblems.length ? JSON.stringify(visionProblems[0]) + ' (' + visionProblems.length + ' total)' : null);

        totalUnits += after.checked;
        totalFortified += after.fortifiedSeen;

        if (verbose) {
            console.log('       ' + label + ': ' + after.checked + ' units, '
                + after.fortifiedSeen + ' fortified, ' + after.unfortifiedSeen + ' not');
        }
    }

    // The point of fortifying was to put units on hexCenters. If none ever got
    // there, checks 2 and 3 only ever saw hexPaths and prove nothing about the
    // half of the model that matters.
    Check('units were actually placed on hexCenters, so the fortified half was tested',
        totalFortified > 0, 'no unit anywhere ended up fortified');

    if (failures.length) {
        console.error('\nboard-space-smoke: ' + failures.length + ' failure(s)');
        process.exit(1);
    }
    console.log('board-space-smoke: ok - ' + totalUnits + ' unit positions across '
        + BOARDS.length + ' boards, ' + totalFortified
        + ' on hexCenters, all round-trip and all derive fortification from position');
})();
