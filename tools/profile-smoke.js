// FortHex — headless harness for the local player profile  (Track A5, guide §8)
//
//   node tools/profile-smoke.js
//
// js/client/profile.js is the one file this track adds that no existing harness
// reaches: worker-smoke.js proves the SERVER side runs without localStorage, which
// is the opposite problem. So this runs profile.js against a fake localStorage and
// checks the things §8 asks to be proven rather than assumed — most of all that a
// profile survives a reload, since a profile that doesn't defeats the whole track.
//
// What it deliberately cannot cover: the consent screen (DOM) and the Online click
// (DOM). Those are the browser pass, and are listed as such in the A5 handoff.
// Exit code 0 = pass.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const BUNDLE = ['js/client/storage-keys.js', 'js/client/profile.js'];

const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

// A localStorage that behaves like the real one in the ways that matter: string
// values, null for a missing key, and contents that persist across a "reload".
function MakeStore(seed) {
    const data = { ...(seed || {}) };
    return {
        data,
        api: {
            getItem: (k) => (k in data ? data[k] : null),
            setItem: (k, v) => { data[k] = String(v); },
            removeItem: (k) => { delete data[k]; },
        },
    };
}

// One page load. Fresh globals every time, which is exactly what makes the reload
// test real: nothing is carried over in memory, only what is in the store.
function LoadPage(store, engineStub) {
    const context = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: store.api,
        crypto: require('crypto').webcrypto,
        navigator: {
            storage: {
                persistCalls: 0,
                persist() { this.persistCalls++; return Promise.resolve(true); },
            },
        },
        engine: engineStub,
        module: {}, exports: {},
    };
    vm.createContext(context);
    BUNDLE.forEach(file => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
    });
    return {
        context,
        call: (expr) => vm.runInContext(expr, context),
    };
}

// --- 1. nothing exists until something explicitly asks for it ---------------
// "Never at first launch, never for Singleplayer or Local Multiplayer" is the
// requirement, and reading must not be what creates one.
{
    const store = MakeStore();
    const page = LoadPage(store, {});
    check('a fresh device reports no profile', page.call('GetProfile()') === null);
    check('GetProfileId() is null with no profile', page.call('GetProfileId()') === null);
    check('HasArchiveConsent() is false with no profile', page.call('HasArchiveConsent()') === false);
    check('merely reading wrote nothing to storage', Object.keys(store.data).length === 0);
}

// --- 2. creation, and what it puts in the store -----------------------------
let firstId = null;
const persistentStore = MakeStore();
{
    const engineStub = {};
    const page = LoadPage(persistentStore, engineStub);
    const made = page.call("CreateProfile('Burn', true)");

    check('a created profile has a name', made.name === 'Burn');
    check('consent is captured at creation, not afterwards', made.consent === true);
    check('a created profile has a string id', typeof made.id === 'string' && made.id.length > 0);
    check('the id is a v4 UUID',
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(made.id));
    check('exactly one key was written', Object.keys(persistentStore.data).length === 1);
    check('persistent storage was requested at creation',
        page.context.navigator.storage.persistCalls === 1);
    check('the engine instance was handed the profile',
        engineStub.localProfile && engineStub.localProfile.id === made.id);
    check('consent does not travel with the engine copy',
        engineStub.localProfile.consent === undefined);
    firstId = made.id;
}

// --- 3. the core claim: it survives a reload -------------------------------
// Fresh context, fresh globals, same store. If the id changes here the track has
// no point.
{
    const page = LoadPage(persistentStore, {});
    const after = page.call('GetProfile()');
    check('a profile survives a reload', after !== null);
    check('the id is stable across a reload', after && after.id === firstId);
    check('the name survives a reload', after && after.name === 'Burn');
    check('consent survives a reload', after && after.consent === true);

    // GetOrCreateProfile must return the existing one, not mint a second.
    const again = page.call("GetOrCreateProfile('SomeoneElse')");
    check('GetOrCreateProfile returns the existing profile', again.id === firstId);
    check('GetOrCreateProfile does not rename an existing profile', again.name === 'Burn');
    check('no second profile was written', Object.keys(persistentStore.data).length === 1);
    check('a second call does not re-request persistent storage',
        page.context.navigator.storage.persistCalls === 0);
}

// --- 4. consent is a plain boolean, and it persists -------------------------
{
    const page = LoadPage(persistentStore, {});
    page.call('SetConsent(false)');
    const reloaded = LoadPage(persistentStore, {}).call('GetProfile()');
    if (check('the profile is still there after SetConsent', reloaded !== null)) {
        check('SetConsent(false) persists', reloaded.consent === false);
        check('SetConsent left the id alone', reloaded.id === firstId);
    }

    const back = LoadPage(persistentStore, {});
    back.call('SetConsent(true)');
    const reBack = LoadPage(persistentStore, {}).call('GetProfile()');
    check('SetConsent(true) persists', reBack !== null && reBack.consent === true);

    // §6.1, Burn's call: one toggle. Not an object of per-purpose flags.
    check('consent is a plain boolean', reBack !== null && typeof reBack.consent === 'boolean');
}

// --- 5. GetOrCreateProfile from nothing, unconsented by default ------------
// The console command path. A profile made without saying yes must not claim yes:
// only the consent screen captures a real agreement.
{
    const store = MakeStore();
    const page = LoadPage(store, {});
    const made = page.call("GetOrCreateProfile('NoConsent')");
    check('a profile created without an answer is unconsented', made.consent === false);
    check('an unconsented profile still gets an id', typeof made.id === 'string');
    check('ids are unique across devices', made.id !== firstId);
}

// --- 6. a corrupt or truncated store is treated as "no profile" ------------
// Worse than no profile is a half-parsed one: the id is the only thing that
// matters and a broken one is not trustworthy.
{
    const key = 'forthex_local_profile';
    ['not json at all', '{}', '{"name":"NoId"}', '{"id":""}', 'null'].forEach(bad => {
        const store = MakeStore({ [key]: bad });
        const got = LoadPage(store, {}).call('GetProfile()');
        check('a corrupt profile (' + bad.slice(0, 18) + ') reads as absent', got === null);
    });
}

// --- 7. ClearProfile returns the device to the majority case ---------------
{
    const store = MakeStore();
    const engineStub = {};
    const page = LoadPage(store, engineStub);
    page.call("CreateProfile('Temp', true)");
    page.call('ClearProfile()');
    check('ClearProfile empties the store', Object.keys(store.data).length === 0);
    check('ClearProfile clears the cached value', page.call('GetProfile()') === null);
    check('ClearProfile clears the engine copy', engineStub.localProfile === null);
}

// --- 8. no crypto.randomUUID (plain http on a LAN) -------------------------
// randomUUID is secure-context only. The fallback must still produce a real v4
// from the same CSPRNG rather than failing profile creation outright.
{
    const store = MakeStore();
    const webcrypto = require('crypto').webcrypto;
    const context = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: store.api,
        crypto: { getRandomValues: (a) => webcrypto.getRandomValues(a) },
        navigator: {},
        module: {}, exports: {},
    };
    vm.createContext(context);
    BUNDLE.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f }));

    const made = vm.runInContext("CreateProfile('Insecure', false)", context);
    check('a profile is still created without crypto.randomUUID', typeof made.id === 'string');
    check('the fallback id is a real v4 UUID',
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(made.id));
    check('a missing navigator.storage is not an error', Object.keys(store.data).length === 1);
}

// --- report ----------------------------------------------------------------
if (failures.length) {
    console.error('FAIL — ' + failures.length + ' check(s)');
    failures.forEach(f => console.error('  !! ' + f));
    process.exit(1);
}
console.log('PASS — js/client/profile.js');
console.log('  created lazily  : reading never writes; nothing exists until asked for');
console.log('  survives reload : same id across a fresh page context');
console.log('  idempotent      : GetOrCreateProfile returns the existing profile');
console.log('  consent         : plain boolean, captured at creation, persists both ways');
console.log('  degrades        : corrupt store reads as absent; no randomUUID still works');
