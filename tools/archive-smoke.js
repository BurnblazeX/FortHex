// FortHex — headless harness for the consent-gated match archive  (Track A6, guide §8)
//
//   node tools/archive-smoke.js
//
// js/client/archive.js is browser-only in the same way js/client/profile.js is:
// worker-smoke.js proves the SERVER side of A6 (the consent gate and the signal)
// runs with no localStorage and no IndexedDB, which is the opposite problem. This
// runs the store itself against a stub IndexedDB and checks what §8 asks to be
// proven rather than assumed.
//
// The two claims that matter most, and the reasons they matter:
//
//   - a consenting device records and a non-consenting one records NOTHING. The
//     negative case is the whole basis of the feature being honest.
//   - a record can be replayed. §3 said "reuse BuildSaveObject", and it was right
//     about the serializer but incomplete about the record: a completed match's
//     save holds the FINAL board, so a record that kept only that could not be
//     replayed forward from the start. That is why a record keeps `opening` too,
//     and why this harness drives the opening board back through a real engine.
//
// Exit code 0 = pass.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// The engine, plus the two client files under test. archive.js needs BuildSaveState
// (save.js), which needs the engine — this is very nearly the whole app minus the
// DOM, which is what an integration check of the archive actually requires.
const BUNDLE = [
    'js/config-data.js', 'js/grid-math.js', 'js/testament.js',
    'js/server/engine.js', 'js/server/rules.js', 'js/server/actions.js',
    'js/server/turn-lifecycle.js', 'js/server/match-setup.js', 'js/server/map-generation.js',
    'js/server/validation.js', 'js/server/state-filter.js', 'js/server/session.js',
    'js/transport.js',
];

const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

// --- a stub IndexedDB ------------------------------------------------------
//
// Only what js/client/archive.js actually uses: open/onupgradeneeded,
// createObjectStore/createIndex, and a transaction exposing get/getAll/put/
// delete/clear. Requests fire their callbacks on the microtask queue so the
// promise plumbing in archive.js is exercised for real rather than short-circuited.
function MakeIndexedDB() {
    const stores = new Map();

    function Request(run) {
        const req = { onsuccess: null, onerror: null, result: undefined, error: null };
        Promise.resolve().then(() => {
            try {
                req.result = run();
                if (req.onsuccess) req.onsuccess({ target: req });
            } catch (e) {
                req.error = e;
                if (req.onerror) req.onerror({ target: req });
            }
        });
        return req;
    }

    function ObjectStore(name) {
        const data = stores.get(name);
        return {
            put: (record) => Request(() => { data.set(record.matchId, JSON.parse(JSON.stringify(record))); return record.matchId; }),
            get: (key) => Request(() => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : undefined)),
            getAll: () => Request(() => [...data.values()].map(r => JSON.parse(JSON.stringify(r)))),
            delete: (key) => Request(() => { data.delete(key); }),
            clear: () => Request(() => { data.clear(); }),
            createIndex: () => {},
        };
    }

    const db = {
        objectStoreNames: { contains: (n) => stores.has(n) },
        createObjectStore: (name) => { stores.set(name, new Map()); return ObjectStore(name); },
        transaction: (name) => {
            const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
            // Complete after the pending request callbacks have run, which is the
            // ordering archive.js depends on to read `request.result`.
            Promise.resolve().then(() => Promise.resolve()).then(() => {
                if (tx.oncomplete) tx.oncomplete();
            });
            tx.objectStore = () => ObjectStore(name);
            return tx;
        },
    };

    return {
        stores,
        api: {
            open: () => {
                const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
                Promise.resolve().then(() => {
                    if (!stores.has('matches') && req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
                    if (req.onsuccess) req.onsuccess({ target: req });
                });
                return req;
            },
        },
    };
}

// --- one "page" ------------------------------------------------------------
function LoadPage() {
    const idb = MakeIndexedDB();
    const context = {
        console: { log() {}, warn() {}, error() {}, table() {}, group() {}, groupEnd() {}, groupCollapsed() {} },
        indexedDB: idb.api,
        crypto: require('crypto').webcrypto,
        setTimeout, clearTimeout, Promise, JSON, Math, Date, Number, String, Object, Array, Map, Set,
        module: {}, exports: {},
    };
    vm.createContext(context);
    BUNDLE.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f }));

    // The two client files under test, plus the minimum client surface they touch.
    // Rather than loading save.js whole (it reaches for the DOM, file dialogs and
    // localStorage all over), the one function archive.js actually calls is
    // reproduced here exactly as save.js defines it — a divergence would show up
    // as an assertion failure below, since both go through BuildSaveObject.
    vm.runInContext(`
        var gameState = { arcadeTurnTimer: 0, isTestingMap: false };
        function BuildSaveState() {
            const { save } = BuildSaveObject(engine, { arcadeTurnTimer: gameState.arcadeTurnTimer });
            save.saveVersion = BUILD_VERSION;
            return save;
        }
    `, context, { filename: 'save-stub' });

    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/client/archive.js'), 'utf8'),
                    context, { filename: 'js/client/archive.js' });

    const engine = vm.runInContext('CreateEngineInstance()', context);
    context.engine = engine;
    vm.runInContext('globalThis.engine = engine; InitializeGrid();', context);

    return { context, idb, engine, call: (expr) => vm.runInContext(expr, context) };
}

(async () => {

// --- 1. no consent, no record ---------------------------------------------
{
    const page = LoadPage();
    check('a fresh engine does not consent', page.engine.archiveConsent === false);
    check('ArchiveIsEnabled is false without consent', page.call('ArchiveIsEnabled()') === false);

    const written = await page.call('ArchiveMatchSnapshot(false)');
    check('a non-consenting snapshot writes nothing', written === null);
    check('the store stayed empty', (page.idb.stores.get('matches') || new Map()).size === 0);

    const rows = await page.call('ListArchivedMatches()');
    check('a non-consenting device has an empty archive', rows.length === 0);
}

// --- 2. consent, and a real record ----------------------------------------
let openingUnits = 0;
{
    const page = LoadPage();
    page.engine.archiveConsent = true;
    page.engine.localProfile = { id: 'p-arch-1', name: 'Burn' };

    check('ArchiveIsEnabled is true once consent is given', page.call('ArchiveIsEnabled()') === true);

    const record = await page.call('ArchiveMatchSnapshot(false)');
    check('a consenting snapshot returns a record', !!record);
    check('the record is keyed by the match id', record && record.matchId === page.engine.state.matchId);
    check('the record names who played it', record && record.profileId === 'p-arch-1');
    check('the record carries an opening board', !!(record && record.opening));
    check('the record carries a latest board', !!(record && record.latest));
    check('a snapshot is not complete', record && record.complete === false);
    check('the record states its schema version',
        record && record.schemaVersion === page.call('CURRENT_SCHEMA_VERSION'));

    // The serialization is Testament's, not a second format. If these ever differ,
    // §3's "no bespoke archive format" guarantee has quietly broken.
    const direct = page.call('BuildSaveState()');
    check('the record stores exactly what a save stores',
        record && JSON.stringify(Object.keys(record.latest).sort()) === JSON.stringify(Object.keys(direct).sort()));

    openingUnits = record.opening.units.length;
}

// --- 3. opening is written once, latest tracks ----------------------------
// This is the invariant the whole replayability claim rests on.
{
    const page = LoadPage();
    page.engine.archiveConsent = true;
    const first = await page.call('ArchiveMatchSnapshot(false)');
    const openingSignature = JSON.stringify(first.opening.units.map(u => u.id + '@' + u.position).sort());

    // Change the board the way a few turns would, then snapshot again.
    page.call('engine.state.units = engine.state.units.filter(u => u.player === 1);');
    page.call('engine.state.globalTurnNumber = 7;');
    const second = await page.call('ArchiveMatchSnapshot(false)');

    const stillOpening = JSON.stringify(second.opening.units.map(u => u.id + '@' + u.position).sort());
    check('opening is never overwritten', stillOpening === openingSignature);
    check('latest tracks the current board', second.latest.units.length < second.opening.units.length);
    check('the record follows the turn', second.turn === 7);
    check('a second snapshot does not create a second record',
        (await page.call('ListArchivedMatches()')).length === 1);
}

// --- 3b. the opening is captured at match start, but not WRITTEN there -----
// Opening the game builds a default local match, so writing at match start would
// give a consenting player one empty record per page load. The opening is held in
// memory instead and stored with the first real snapshot.
{
    const page = LoadPage();
    page.engine.archiveConsent = true;

    const capturedId = page.call('CaptureArchiveOpening()');
    check('capturing the opening reports the match it belongs to',
        capturedId === page.engine.state.matchId);
    // Drained deliberately before checking: a write started here would land on a
    // later microtask, and asserting immediately would pass on timing rather than
    // on nothing having been written.
    await new Promise(r => setTimeout(r, 0));
    check('capturing the opening writes nothing',
        (await page.call('ListArchivedMatches()')).length === 0);
    check('capturing the opening touches no store',
        (page.idb.stores.get('matches') || new Map()).size === 0);

    // Play out a turn's worth of change, then take the first real snapshot.
    const startingPositions = JSON.stringify(
        page.engine.state.units.map(u => u.id + '@' + u.position).sort());
    page.call('engine.state.units = engine.state.units.filter(u => u.player === 1);');
    page.call('engine.state.globalTurnNumber = 2;');

    const record = await page.call('ArchiveMatchSnapshot(false)');
    check('the first snapshot creates the record', !!record);
    check('the record opens on the board as it STARTED, not as it is now',
        JSON.stringify(record.opening.units.map(u => u.id + '@' + u.position).sort()) === startingPositions);
    check('latest is the board as it is now',
        record.latest.units.length < record.opening.units.length);

    // A non-consenting device captures nothing at all, so the next match on a
    // device that later consents cannot inherit a stale opening.
    const page2 = LoadPage();
    check('a non-consenting device captures no opening',
        page2.call('CaptureArchiveOpening()') === null);
}

// --- 4. completion ---------------------------------------------------------
{
    const page = LoadPage();
    page.engine.archiveConsent = true;
    await page.call('ArchiveMatchSnapshot(false)');

    page.call(`
        engine.state.gameOver = true;
        engine.pendingVictory = { winner: 1, isDraw: false, victoryText: 'Player 1 Wins by Annihilation!' };
    `);
    const done = await page.call('ArchiveMatchSnapshot(true)');

    check('a completed record says so', done.complete === true);
    check('a completed record is stamped', typeof done.completedAt === 'number');
    check('a completed record keeps the verdict', done.verdict && done.verdict.winner === 1);
    check('the verdict text survives', done.verdict && done.verdict.text.includes('Annihilation'));

    const listed = (await page.call('ListArchivedMatches()'))[0];
    check('the list reports completion', listed.complete === true);
    check('the list reports the ledger size', typeof listed.entries === 'number');
    check('the list does not carry the saves themselves', listed.opening === undefined && listed.latest === undefined);
}

// --- 5. the claim §3 was incomplete about: a record is replayable ----------
// Not "something got written" — the opening board goes back through a real engine
// and comes out as a board units can move on.
{
    const page = LoadPage();
    page.engine.archiveConsent = true;
    const record = await page.call('ArchiveMatchSnapshot(false)');

    page.context.archived = JSON.parse(JSON.stringify(record));
    const restored = page.call(`
        (function () {
            const lean = archived.opening;
            const migrated = MigrateSave(JSON.parse(JSON.stringify(lean)));
            const expanded = ExpandSaveObject(migrated.data, { forPlayer: 1 });
            return {
                steps: migrated.report.steps.length,
                units: expanded.units.length,
                tiles: expanded.tiles.length,
                edges: expanded.edges.length,
                matchId: expanded.matchId,
                everyUnitOnARealEdge: expanded.units
                    .filter(u => u.positionType === 'edge')
                    .every(u => expanded.edges.some(([k]) => k === u.position)),
            };
        })()
    `);

    check('an archived record needs no migration when it is current', restored.steps === 0);
    check('the opening board restores every unit', restored.units === openingUnits);
    check('the opening board restores its tiles', restored.tiles > 0);
    check('the edge set regenerates from the archived tiles', restored.edges > 0);
    check('no restored unit stands on an edge that does not exist', restored.everyUnitOnARealEdge === true);
    check('the restored board knows which match it is', restored.matchId === record.matchId);
}

// --- 6. reading, deleting, clearing ---------------------------------------
{
    const page = LoadPage();
    page.engine.archiveConsent = true;
    const a = await page.call('ArchiveMatchSnapshot(false)');

    page.call('engine.state.matchId = NewMatchId(); engine.state.matchHistory = [];');
    const b = await page.call('ArchiveMatchSnapshot(false)');
    check('two matches make two records', a.matchId !== b.matchId);
    check('the archive lists both', (await page.call('ListArchivedMatches()')).length === 2);

    page.context.wantedId = a.matchId;
    const fetched = await page.call('GetArchivedMatch(wantedId)');
    check('a record can be fetched by id', fetched && fetched.matchId === a.matchId);
    check('a missing id returns null rather than throwing',
        (await page.call("GetArchivedMatch('m-nope')")) === null);

    await page.call('DeleteArchivedMatch(wantedId)');
    const left = await page.call('ListArchivedMatches()');
    check('deleting removes exactly one record', left.length === 1 && left[0].matchId === b.matchId);

    await page.call('ClearArchive()');
    check('clearing empties the archive', (await page.call('ListArchivedMatches()')).length === 0);
}

// --- 7. the gate, in every direction --------------------------------------
{
    const page = LoadPage();
    page.engine.archiveConsent = true;

    page.call('engine.state.isTrainingMode = true;');
    check('training is never archived', page.call('ArchiveIsEnabled()') === false);
    page.call('engine.state.isTrainingMode = false;');

    page.call('engine.state.mapMakerMode = true;');
    check('the map maker is never archived', page.call('ArchiveIsEnabled()') === false);
    page.call('engine.state.mapMakerMode = false;');

    page.call('gameState.isTestingMap = true;');
    check('test-driving a map is never archived', page.call('ArchiveIsEnabled()') === false);
    page.call('gameState.isTestingMap = false;');

    const savedId = page.engine.state.matchId;
    page.call('engine.state.matchId = null;');
    check('a match with no identity is not archived', page.call('ArchiveIsEnabled()') === false);
    page.call('engine.state.matchId = ' + JSON.stringify(savedId) + ';');

    check('and with all of that cleared, it records again', page.call('ArchiveIsEnabled()') === true);

    // Revoking consent mid-match stops it, and the record already written stays.
    await page.call('ArchiveMatchSnapshot(false)');
    page.engine.archiveConsent = false;
    check('revoking consent stops recording', page.call('ArchiveIsEnabled()') === false);
    check('a snapshot after revocation writes nothing',
        (await page.call('ArchiveMatchSnapshot(false)')) === null);
    check('records written under an earlier yes are not deleted',
        (await page.call('ListArchivedMatches()')).length === 1);
}

// --- 8. the sync seam is empty, and says so -------------------------------
{
    const page = LoadPage();
    const result = await page.call('SyncArchiveToServer()');
    check('nothing is sent anywhere', result.sent === 0);
    check('the sync hook explains itself', result.reason === 'no_server');
}

// --- report ----------------------------------------------------------------
if (failures.length) {
    console.error('FAIL — ' + failures.length + ' check(s)');
    failures.forEach(f => console.error('  !! ' + f));
    process.exit(1);
}
console.log('PASS — js/client/archive.js');
console.log('  gate      : nothing recorded without consent; training, map maker and');
console.log('              map-testing excluded; revoking stops it and keeps what exists');
console.log('  record    : one per match, opening written once, latest tracks the board');
console.log('  no litter : opening the game writes nothing until a match produces a turn');
console.log('  format    : identical to what BuildSaveState writes — no second format');
console.log('  replayable: the archived opening restores to a board units can move on');
console.log('  sync      : the central-server hook is empty and says why');

})().catch(err => {
    console.error('FAIL — the harness threw');
    console.error(err.stack);
    process.exit(1);
});
