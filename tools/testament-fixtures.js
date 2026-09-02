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
const UNIT_TYPES = vm.runInContext('UNIT_TYPES', context);

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

// The last fixture to migrate cleanly, kept so the A5 section below has a REAL
// current-schema file to work from rather than a hand-written approximation of one.
let lastMigrated = null;

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

    // A5. Every fixture here predates the local profile, so none may arrive with
    // one. This is the "known version, expected field missing" case the chain has
    // always handled, and the v8->v9 step is a no-op precisely so it stays that way:
    // an absent profile is the normal state, not a gap for a migration to fill.
    if (data.profile !== undefined) {
        problems.push('migration invented a profile on a pre-A5 file');
    }

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

    // REGRESSION GUARD (A4). A unit restored from a save must stay SPREADABLE.
    // ai.js scores hypothetical moves by building `{ ...unit, position }` and then
    // reading ghostUnit.type.attackType, so type/hp/maxHp have to survive a spread.
    //
    // They only do if rehydrateGameState defines them enumerable. That used to
    // happen by accident — the old format stored them, so defineProperty was
    // modifying an existing enumerable property and kept the flag. The lean schema
    // stopped saving them, which made them new (and non-enumerable by default) and
    // broke every ghost unit. This mirrors save.js:396 so the invariant is checked
    // headlessly rather than only by playing a singleplayer save.
    expanded.units.forEach(u => {
        const unit = { ...u };
        Object.defineProperty(unit, 'type', {
            get() { return UNIT_TYPES[this.typeId]; }, configurable: true, enumerable: true });
        Object.defineProperty(unit, 'hp', {
            get() { return this.stats.hp; }, configurable: true, enumerable: true });
        Object.defineProperty(unit, 'maxHp', {
            get() { return this.stats.maxHp; }, configurable: true, enumerable: true });

        const ghost = { ...unit, position: 'ghost' };
        if (!ghost.type) problems.push('unit ' + u.id + ': type lost when spread (ghost units break)');
        else if (ghost.type.attackType === undefined) problems.push('unit ' + u.id + ': type has no attackType');
        if (ghost.hp === undefined) problems.push('unit ' + u.id + ': hp lost when spread');
        if (ghost.maxHp === undefined) problems.push('unit ' + u.id + ': maxHp lost when spread');
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
    if (!problems.length) lastMigrated = data;

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


// --- A5: the with-profile and without-profile cases -------------------------
//
// Every archived fixture above is the without-profile case and always will be —
// they were all written before a profile could exist. So the with-profile case
// needs a v9 file, and there is no such thing in the archive to load. Rather than
// invent a save shape by hand (which would test the harness's idea of the format
// instead of the format), take a real migrated fixture, attach a profile, and put
// it back through the same chain.
//
// What is being proved here is narrow and worth stating: the field survives a
// round trip, its absence survives one too, and adding it changes nothing else.
if (lastMigrated) {
    const a5 = [];

    const shapeOf = (obj) => {
        const copy = { ...obj };
        delete copy.profile;
        return JSON.stringify(copy);
    };

    const withoutProfile = JSON.parse(JSON.stringify(lastMigrated));
    const withProfile = JSON.parse(JSON.stringify(lastMigrated));
    withProfile.profile = { id: 'fixture-profile-0001', name: 'Fixture' };

    console.warn = () => {};
    const bare = MigrateSave(withoutProfile);
    const tagged = MigrateSave(withProfile);
    console.warn = realWarn;

    // A current-version file migrates zero steps either way.
    if (bare.report.steps.length !== 0) a5.push('a v9 file without a profile was migrated');
    if (tagged.report.steps.length !== 0) a5.push('a v9 file with a profile was migrated');

    if (bare.data.profile !== undefined) a5.push('a profile appeared on a file that had none');
    if (!tagged.data.profile) a5.push('the profile did not survive the chain');
    else {
        if (tagged.data.profile.id !== 'fixture-profile-0001') a5.push('the profile id changed in migration');
        if (tagged.data.profile.name !== 'Fixture') a5.push('the profile name changed in migration');
    }

    // The conditional must be a true no-op, not "usually empty": with the profile
    // removed the two files are identical.
    if (shapeOf(tagged.data) !== shapeOf(bare.data)) {
        a5.push('attaching a profile changed the rest of the file');
    }

    // And it survives expansion, which is what a load actually calls.
    const expanded = ExpandSaveObject(tagged.data, { forPlayer: 1 });
    if (!expanded.profile || expanded.profile.id !== 'fixture-profile-0001') {
        a5.push('the profile did not survive ExpandSaveObject');
    }
    const expandedBare = ExpandSaveObject(bare.data, { forPlayer: 1 });
    if (expandedBare.profile !== undefined) a5.push('expansion invented a profile');

    // Detection: a v9 file that names its author can be told apart by shape; one
    // that does not cannot, and reports v8. That is by design — see
    // MigrateAddProfile — and is asserted so it is a decision, not a surprise.
    const strip = (o) => { const c = { ...o }; delete c.schemaVersion; delete c.saveVersion; return c; };
    if (DetectVersion(strip(tagged.data)) !== 9) a5.push('an unlabelled file with a profile did not infer as v9');
    if (DetectVersion(strip(bare.data)) !== 8) a5.push('an unlabelled file without a profile did not infer as v8');

    console.log('');
    if (a5.length) {
        console.log('FAIL A5 profile round trip');
        a5.forEach(p => { console.log('       !!  ' + p); failures.push('A5: ' + p); });
    } else {
        console.log('ok   A5 profile   with-profile and without-profile both round-trip; ' +
                    'absent stays absent; v9-with-profile infers by shape, v9-without reports v8 by design');
    }
}

console.log('');
console.log('total ' + Math.round(totalBefore / 1024) + 'K -> ' + Math.round(totalAfter / 1024) + 'K' +
            '  (-' + Math.round((1 - totalAfter / totalBefore) * 100) + '%)');

if (failures.length) {
    console.log('');
    console.error('FAIL — ' + failures.length + ' problem(s)');
    process.exit(1);
}
console.log('PASS — every fixture migrated to v' + CURRENT_SCHEMA_VERSION);
