// FortHex — Testament fixture harness (Track A4, guide §11)
//
// Drives every archived save file through the real migration chain and checks the
// result, rather than checking that nothing threw. Real fixtures are the primary
// verification tool for this track: unlike A1-A3, there is a decade of historical
// file shapes to be correct about and no harness can invent them.
//
//   node tools/testament-fixtures.js [fixtureDir]
//
// Exit code 0 = every fixture migrated to the current schema and passed its checks.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DEFAULT_FIXTURES = path.join(ROOT, '..', 'FortHex Archive', 'Saves');
const FIXTURE_DIR = process.argv[2] || DEFAULT_FIXTURES;

// config-data.js supplies TILE_TYPES/UNIT_TYPES (re-linking a type by name), and
// grid-math.js supplies getNeighbors/getEdgeKey (regenerating the edge set from the
// tiles). Both are shared root modules; testament.js is DOM-free and needs nothing
// else, which is the point of it living in /js alongside them.
const BUNDLE = ['js/config-data.js', 'js/grid-math.js', 'js/testament.js'];

const context = { console, module: {}, exports: {} };
vm.createContext(context);
BUNDLE.forEach(file => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
});

const { MigrateSave, DetectVersion, DescribeContent, ExpandSaveObject } = context;

// tiles/edges are pair arrays in some eras and plain objects in others.
function NormalizeEdgeEntries(raw) {
    if (Array.isArray(raw.edges)) return raw.edges;
    if (raw.edges && typeof raw.edges === 'object') return Object.entries(raw.edges);
    return [];
}
function NormalizeEdgeKeys(raw) {
    return NormalizeEdgeEntries(raw).map(([k]) => k);
}

// A top-level `const` in a classic script is a global lexical binding, not a
// property of the context object — so it has to be evaluated rather than read off
// `context`. In the browser both forms work; here only this one does.
const CURRENT_SCHEMA_VERSION = vm.runInContext('CURRENT_SCHEMA_VERSION', context);
const SAVE_UNIT_FIELDS = vm.runInContext('SAVE_UNIT_FIELDS', context);

// Warnings are expected output, not failures — the policy is warn-don't-refuse.
// Silence them per-fixture and report the count instead.
const realWarn = console.warn;

function CountEntries(collection) {
    if (Array.isArray(collection)) return collection.length;
    if (collection && typeof collection === 'object') return Object.keys(collection).length;
    return 0;
}

// Anything a JSON round trip would silently destroy. A Map becomes {} and a Set
// becomes {} — both look like "empty object" on the far side, which is exactly
// the class of bug that made rehydrateGameState rebuild the fine grid by hand.
function FindUnserializable(value, trail, found) {
    if (value === null || typeof value !== 'object') return found;
    if (value instanceof Map) { found.push(trail + ' (Map)'); return found; }
    if (value instanceof Set) { found.push(trail + ' (Set)'); return found; }
    if (Array.isArray(value)) {
        value.slice(0, 40).forEach((v, i) => FindUnserializable(v, trail + '[' + i + ']', found));
        return found;
    }
    Object.keys(value).slice(0, 60).forEach(k => FindUnserializable(value[k], trail + '.' + k, found));
    return found;
}

const files = fs.existsSync(FIXTURE_DIR)
    ? fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.fhsave') || f.endsWith('.fhmap'))
    : [];

if (files.length === 0) {
    console.error('No fixtures found in ' + FIXTURE_DIR);
    process.exit(1);
}

console.log('Testament — ' + files.length + ' fixtures, target schema v' + CURRENT_SCHEMA_VERSION);
console.log('');

const failures = [];
let totalBefore = 0;
let totalAfter = 0;

files.sort().forEach(file => {
    const full = path.join(FIXTURE_DIR, file);
    const rawText = fs.readFileSync(full, 'utf8');
    let raw;
    try {
        raw = JSON.parse(rawText);
    } catch (err) {
        failures.push(file + ': not valid JSON — ' + err.message);
        return;
    }

    const before = {
        units: CountEntries(raw.units),
        tiles: CountEntries(raw.tiles),
        edges: CountEntries(raw.edges),
        label: raw.saveVersion || '(none)',
    };

    const detected = DetectVersion(raw);

    console.warn = () => {};
    let result;
    try {
        result = MigrateSave(raw);
    } catch (err) {
        console.warn = realWarn;
        failures.push(file + ': MigrateSave THREW — ' + err.message);
        return;
    }
    console.warn = realWarn;

    const { data, report } = result;
    const after = {
        units: CountEntries(data.units),
        tiles: CountEntries(data.tiles),
        edges: CountEntries(data.edges),
    };

    const problems = [];

    if (report.toVersion !== CURRENT_SCHEMA_VERSION) {
        problems.push('ended on v' + report.toVersion + ', not v' + CURRENT_SCHEMA_VERSION);
    }
    // Migration reshapes; it must never lose a unit, tile or edge.
    if (after.units !== before.units) problems.push('unit count ' + before.units + ' -> ' + after.units);
    if (after.tiles !== before.tiles) problems.push('tile count ' + before.tiles + ' -> ' + after.tiles);
    // Edges are deliberately not carried; the regeneration check below covers them.

    // Every unit must arrive in the current model, whatever era it came from.
    (data.units || []).forEach(u => {
        if (!u.typeId) problems.push('unit ' + u.id + ' has no typeId');
        if (!u.stats) problems.push('unit ' + u.id + ' has no stats');
        else if (u.stats.speed === undefined || u.stats.damage === undefined) {
            problems.push('unit ' + u.id + ' has incomplete stats');
        }
        if (u.type !== undefined) problems.push('unit ' + u.id + ' still carries an embedded type object');
    });

    // NO BACKPORTING (guide §5). A stat the old file recorded must survive, even
    // where the current template disagrees — migration reshapes data, it does not
    // re-judge it. Real case: every Archer B20-B28 carried attack:3, while today's
    // ARCHER template says damage:2. Migrating to 2 would be rewriting history.
    let preserved = 0;
    (raw.units || []).forEach(rawUnit => {
        const oldAttack = rawUnit.type && rawUnit.type.attack;
        if (oldAttack === undefined) return;
        const migrated = (data.units || []).find(u => u.id === rawUnit.id);
        if (!migrated) { problems.push('unit ' + rawUnit.id + ' vanished in migration'); return; }
        if (migrated.stats.damage !== oldAttack) {
            problems.push('backported ' + rawUnit.id + ': attack ' + oldAttack +
                          ' became damage ' + migrated.stats.damage);
        } else {
            preserved++;
        }
    });

    // The edge set is no longer saved — it is regenerated from the tiles. That is
    // only safe if the regenerated set is IDENTICAL to what the file recorded, and
    // if every unit standing on an edge still finds one.
    if (data.edges !== undefined) problems.push('lean save still stores an edge list');

    const expanded = ExpandSaveObject(data, { forPlayer: data.currentPlayer });
    const rebuiltKeys = new Set(expanded.edges.map(([k]) => k));
    if (rebuiltKeys.size !== before.edges) {
        problems.push('regenerated ' + rebuiltKeys.size + ' edges, file had ' + before.edges);
    }
    NormalizeEdgeKeys(raw).forEach(key => {
        if (!rebuiltKeys.has(key)) problems.push('regeneration lost edge ' + key);
    });
    (data.units || []).forEach(u => {
        if (u.positionType === 'edge' && !rebuiltKeys.has(u.position)) {
            problems.push('unit ' + u.id + ' stands on missing edge ' + u.position);
        }
    });
    // Bridges are the one thing a rebuild can't know, so they must be carried.
    NormalizeEdgeEntries(raw).forEach(([key, edge]) => {
        if (!edge || !edge.bridge) return;
        const rebuilt = expanded.edges.find(([k]) => k === key);
        if (!rebuilt || !rebuilt[1].bridge) problems.push('bridge on ' + key + ' was lost');
    });

    // Units omit any field holding its default. That is only safe if expansion is
    // the EXACT inverse: every field must come back, and re-leaning the expanded
    // unit must reproduce the stored one byte for byte.
    expanded.units.forEach(u => {
        SAVE_UNIT_FIELDS.forEach(f => {
            if (u[f] === undefined) problems.push('unit ' + u.id + ' lost ' + f + ' through expansion');
        });
        const stored = (data.units || []).find(x => x.id === u.id);
        const releaned = context.LeanUnit(u);
        if (JSON.stringify(releaned) !== JSON.stringify(stored)) {
            problems.push('unit ' + u.id + ' is not stable across lean/expand/lean');
        }
    });

    // The action log is rebuilt from the ledger, not stored.
    if (data.actionLog && Array.isArray(raw.matchHistory) && raw.matchHistory.length) {
        problems.push('lean save stored an action log despite having a ledger');
    }
    const logLines = expanded.actionLog ? expanded.actionLog.length : 0;

    const unserializable = FindUnserializable(data, 'save', []);
    if (unserializable.length) problems.push('unserializable: ' + unserializable.slice(0, 3).join(', '));

    // A real round trip, not a claim about one.
    let roundTripped = false;
    try {
        roundTripped = JSON.parse(JSON.stringify(data)).units.length === after.units;
    } catch (err) {
        problems.push('JSON round trip failed: ' + err.message);
    }
    if (!roundTripped) problems.push('JSON round trip lost units');

    const sizeBefore = Buffer.byteLength(rawText, 'utf8');
    const sizeAfter = Buffer.byteLength(JSON.stringify(data), 'utf8');
    totalBefore += sizeBefore;
    totalAfter += sizeAfter;

    const content = DescribeContent(data);
    const shrink = Math.round((1 - sizeAfter / sizeBefore) * 100);

    const status = problems.length ? 'FAIL' : 'ok  ';
    console.log(
        status + ' ' + before.label.padEnd(9) +
        ' v' + detected + '->v' + report.toVersion +
        '  ' + String(report.steps.length).padStart(2) + ' steps' +
        '  ' + String(after.units).padStart(2) + 'u/' + String(after.tiles).padStart(2) + 't/' + String(after.edges).padStart(3) + 'e' +
        '  ' + String(Math.round(sizeBefore / 1024)).padStart(3) + 'K->' + String(Math.round(sizeAfter / 1024)).padStart(2) + 'K (-' + shrink + '%)' +
        '  ' + content.opensAs +
        '  ' + String(logLines).padStart(2) + ' log' +
        (preserved ? '  ' + preserved + ' stats kept' : '') +
        (report.warnings.length ? '  ' + report.warnings.length + 'w' : '') +
        (report.corrections.length ? '  ' + report.corrections.length + ' fixed' : '')
    );

    report.corrections.forEach(c => console.log('       fix: ' + c));
    problems.forEach(p => {
        console.log('       !!  ' + p);
        failures.push(file + ': ' + p);
    });
});

console.log('');
console.log('total ' + Math.round(totalBefore / 1024) + 'K -> ' + Math.round(totalAfter / 1024) + 'K' +
            '  (-' + Math.round((1 - totalAfter / totalBefore) * 100) + '%)');

if (failures.length) {
    console.log('');
    console.error('FAIL — ' + failures.length + ' problem(s)');
    process.exit(1);
}
console.log('PASS — every fixture migrated to v' + CURRENT_SCHEMA_VERSION);
