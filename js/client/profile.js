// === Local player profile (A5) ===
//
// A name, a stable id, and one consent flag. That is the whole of it. There is
// no authentication, no password, and no server-verified identity — deliberately,
// per the roadmap. This is device/browser-scoped: a cleared cache or a different
// browser is a different profile, and that is an accepted limitation rather than
// a gap to close here.
//
// Why this is client-side rather than shared: it is bound to browser storage APIs
// (localStorage, navigator.storage.persist), which a Worker does not have. Same
// reasoning A1 used to keep ai.js's population code client-side. The engine never
// needs to know how a profile is stored — only what its `id` is, as a string,
// which is exactly how it has treated `profileId` since A1.
//
// Created LAZILY. Nothing here runs at startup: the only things that create a
// profile are the Online multiplayer entry point (js/client/menu.js, via the
// consent screen in js/client/modals.js) and the FH console commands. A player who
// never goes online never has one, and never sees a prompt about it.
//
// What this file is NOT, by track boundary:
//   - the archive that reads `consent`   -> A6
//   - balance telemetry                  -> unnamed track (see the A5 handoff)
//   - anything that sends data anywhere  -> no central server exists yet
//   - cross-device sync / recovery       -> explicitly out of scope, roadmap A5

// Shape held in localStorage. `consent` is a plain boolean, not an object of
// per-purpose flags (Burn's call, guide §6.1): one blanket agreement covers both
// match archiving and balance telemetry. If those ever need separating, that is a
// future field plus a second checkbox, not something to build defensively now.
const PROFILE_VERSION = 1;

// Cached so repeated GetProfile() calls in a frame don't re-parse JSON. Set to
// undefined (not null) to mean "not read yet" — null is a real answer here, and
// the common one.
let cachedProfile = undefined;

// --- reads ------------------------------------------------------------------

// Returns the stored profile, or null if none exists. "No profile" is a normal,
// expected state — the majority state, in fact — and never an error.
function GetProfile() {
    if (cachedProfile !== undefined) return cachedProfile;

    cachedProfile = ReadProfileFromStorage();
    return cachedProfile;
}

// The id alone, for the places that only need a string to put in a message
// field: connect/disconnect (js/transport.js), and the composition root.
function GetProfileId() {
    const profile = GetProfile();
    return profile ? profile.id : null;
}

// Whether this device has agreed to match archiving / balance telemetry. A6 reads
// this before archiving anything; A5 only makes it settable and readable.
function HasArchiveConsent() {
    const profile = GetProfile();
    return !!(profile && profile.consent);
}

function ReadProfileFromStorage() {
    let raw = null;
    try {
        raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    } catch (e) {
        // Private-mode browsers can throw on access rather than returning null.
        // No profile is a valid state, so this degrades to "not online yet".
        console.warn('[Profile] localStorage unavailable:', e);
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
        return {
            version: Number.isInteger(parsed.version) ? parsed.version : PROFILE_VERSION,
            id: parsed.id,
            name: typeof parsed.name === 'string' ? parsed.name : '',
            consent: !!parsed.consent,
            createdAt: Number.isFinite(parsed.createdAt) ? parsed.createdAt : null,
        };
    } catch (e) {
        // A corrupt profile is worse than no profile: the id is the only thing
        // that matters and a half-parsed one is not trustworthy. Treat as absent.
        console.warn('[Profile] stored profile could not be parsed, ignoring it:', e);
        return null;
    }
}

// --- writes -----------------------------------------------------------------

// Creates and stores a new profile, replacing any existing one. Callers that want
// "create only if absent" want GetOrCreateProfile instead — this one is the
// unconditional form, and the console command that exposes it says so.
//
// `consent` is captured HERE rather than set afterwards (guide §6.2): the consent
// screen collects it and passes it in, so a profile is never briefly stored in an
// unconsented state that something else might read in between.
function CreateProfile(name, consent = false) {
    const profile = {
        version: PROFILE_VERSION,
        id: NewProfileId(),
        name: typeof name === 'string' && name.trim() ? name.trim() : 'Player',
        consent: !!consent,
        createdAt: Date.now(),
    };

    WriteProfile(profile);
    RequestPersistentStorage();
    return profile;
}

// The function the real Menu > Multiplayer > Online handler calls. First call
// creates; every call after returns what is already there. It does NOT rename or
// re-consent an existing profile — a returning player's stored answers stand.
function GetOrCreateProfile(name, consent = false) {
    const existing = GetProfile();
    if (existing) return existing;
    return CreateProfile(name, consent);
}

// Changes the stored flag. No archive logic here — A6 is what reads it and acts.
// Returns the updated profile, or null if there is no profile to update (which is
// not an error: nothing has consented because nothing exists).
function SetConsent(value) {
    const profile = GetProfile();
    if (!profile) {
        console.warn('[Profile] SetConsent called with no profile — nothing to update.');
        return null;
    }

    profile.consent = !!value;
    WriteProfile(profile);
    return profile;
}

function WriteProfile(profile) {
    cachedProfile = profile;
    try {
        localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch (e) {
        // The in-memory profile still stands for this session; it just will not
        // survive a reload. Nothing here can fix a full or blocked store, and
        // failing the Online flow over it would be worse than continuing.
        console.error('[Profile] Failed to persist profile:', e);
    }

    // The engine carries the profile as plain data so BuildSaveObject can attach
    // it without testament.js reaching for a browser API it does not have in a
    // Worker. See js/main.js for where this is first set, and js/testament.js
    // for what it does with it.
    if (typeof engine !== 'undefined' && engine) {
        engine.localProfile = ProfileForSave(profile);
    }
}

// What a save file records: who wrote it, not what they agreed to. `consent` is a
// device-scoped answer about this browser, not a fact about the match, so it has
// no business travelling inside a file that may be handed to someone else.
function ProfileForSave(profile) {
    if (!profile) return null;
    return { id: profile.id, name: profile.name };
}

// --- the two browser APIs this file exists to own ---------------------------

// crypto.randomUUID is the right generator: collision-safe, standard, and not
// something worth hand-rolling. It is only defined in a SECURE CONTEXT, though,
// and FortHex is reachable over plain http on a LAN — where the property is simply
// undefined and calling it would throw mid-creation.
//
// So: the standard API when it exists, and the same v4 layout assembled from
// crypto.getRandomValues (available in insecure contexts too) when it doesn't.
// That is not a custom generator — same CSPRNG, same shape, same guarantees.
function NewProfileId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
        bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
                hex.slice(16, 20), hex.slice(20)].join('-');
    }

    // No crypto at all is not a browser this game runs in, but an id is the one
    // thing a profile cannot be created without, so it does not get to be absent.
    console.warn('[Profile] No crypto API — falling back to a non-cryptographic id.');
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Progressive enhancement, per the roadmap: ask, don't branch on the answer. A
// granted request protects the profile id (and the existing settings and autosaves
// alongside it) from silent eviction under storage pressure. A denial or a missing
// API leaves behavior exactly as it is today — best-effort localStorage — so there
// is no fallback path to write.
function RequestPersistentStorage() {
    if (typeof navigator === 'undefined') return;
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return;

    navigator.storage.persist()
        .then(granted => console.log('[Profile] Persistent storage ' + (granted ? 'granted' : 'denied') + '.'))
        .catch(e => console.warn('[Profile] Persistent storage request failed:', e));
}

// --- testing seam -----------------------------------------------------------

// Drops the profile entirely. Not reachable from any UI — the roadmap rules out
// account management, and a player deleting their identity is not a flow A5 was
// asked to build. It exists so the console can test the "no profile" path without
// the player having to open devtools and clear site data by hand.
function ClearProfile() {
    cachedProfile = null;
    try {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
    } catch (e) {
        console.warn('[Profile] Failed to clear profile:', e);
    }
    if (typeof engine !== 'undefined' && engine) engine.localProfile = null;
}
