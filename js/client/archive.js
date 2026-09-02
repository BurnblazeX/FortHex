// === Consent-gated match archive (A6) ===
//
// Every match involving a human is recorded, when consent has been given, from
// B30 launch onward. The roadmap's framing is deliberate and worth repeating: a
// match nobody recorded is gone. There is no deriving it afterwards, which is why
// this collects from day one rather than waiting for Gospel (Track D) to need it.
//
// WHAT A RECORD IS. A save, produced by the same BuildSaveObject every other save
// path uses (js/testament.js) - not a second bespoke format. A6 invents no
// serialization; it stores what Testament already produces and versions.
//
// Each record keeps TWO of them:
//
//   opening  the board as the match began, written once and never again
//   latest   the board as of the most recent snapshot, overwritten each turn
//
// The second one alone is not enough, and this is the one place the A6 guide's
// §3 was incomplete: a completed match's save holds the FINAL board, so a record
// containing only that cannot be replayed forward from the start - the opening
// positions are gone. tools/replay-matchlog.js needs a starting board plus the
// ledger, which is exactly what these two fields give it, with `latest` doubling
// as the expected result to check a replay against.
//
// WHY IndexedDB AND NOT localStorage. Every other client-side store in this
// project is localStorage, and this deliberately is not. A profile is a handful
// of fields; an archive is a few KB per match accumulating for as long as someone
// plays. localStorage is synchronous, quota-limited to roughly 5-10MB across the
// whole origin, and shared with the settings, colour preferences and autosaves
// that already live there - filling it would break those, not just this.
//
// WHAT THIS FILE DOES NOT DO, by track boundary:
//   - the replay system            -> parked by the roadmap; A6 collects, it does
//                                     not present
//   - balance telemetry            -> a different purpose, different shape, and
//                                     still has no track. Not folded in here just
//                                     because it shares one consent toggle
//   - sending anything anywhere    -> no central server exists. See
//                                     SyncArchiveToServer, deliberately empty
//   - deciding consent             -> A5 owns that; this reads engine.archiveConsent

const ARCHIVE_DB_NAME = 'forthex_archive';
const ARCHIVE_DB_VERSION = 1;
const ARCHIVE_STORE = 'matches';

// Cached across calls: opening a database per snapshot would be a connection per
// turn for no benefit. Null means "not opened yet", not "unavailable".
let archiveDb = null;

// The opening board, held in memory from the moment a match starts until that
// match first has something worth storing.
//
// Writing it straight to IndexedDB at match start looked simpler and was wrong:
// the app builds a default local match on every page load, so a consenting player
// who opened the game and walked away would accumulate one empty record per
// launch. Holding it here costs nothing and means a record exists only once a
// match has actually produced a turn.
let pendingOpening = null;

// --- the gate ---------------------------------------------------------------

// The single question this whole file hangs off. Split out so the answer is in
// one place and every caller gives the same one.
//
// engine.archiveConsent, not HasArchiveConsent(): the flag is mirrored onto the
// engine instance by js/client/profile.js precisely so server-side code can read
// it without localStorage. Reading the mirror here too means the client and the
// server can never disagree about whether a match is being recorded.
function ArchiveIsEnabled() {
    if (typeof engine === 'undefined' || !engine) return false;
    if (!engine.archiveConsent) return false;

    // Training is AI-vs-AI at thousands of matches a minute and bypasses the
    // transport entirely; it is not a human match and has no business in a corpus
    // meant to learn from human play.
    if (engine.state.isTrainingMode) return false;

    // Map-maker mode and test-driving a map in progress are authoring, not play.
    // isTestingMap is client-owned, which is why this check lives here and not in
    // the engine's own gate.
    if (engine.state.mapMakerMode) return false;
    if (typeof gameState !== 'undefined' && gameState && gameState.isTestingMap) return false;

    return !!engine.state.matchId;
}

// --- opening the store ------------------------------------------------------

// Called when a match begins (js/client/match-setup.js). Captures where the board
// started WITHOUT writing anything - see pendingOpening for why that distinction
// matters. Every later snapshot overwrites `latest` and leaves `opening` alone, so
// this is the only chance to record the true starting positions.
function CaptureArchiveOpening() {
    if (!ArchiveIsEnabled()) { pendingOpening = null; return null; }

    pendingOpening = { matchId: engine.state.matchId, save: BuildSaveState() };
    return pendingOpening.matchId;
}

function OpenArchive() {
    if (archiveDb) return Promise.resolve(archiveDb);

    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined' || !indexedDB) {
            reject(new Error('IndexedDB unavailable'));
            return;
        }

        const request = indexedDB.open(ARCHIVE_DB_NAME, ARCHIVE_DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(ARCHIVE_STORE)) {
                // Keyed by matchId, which is why A6 put one on engine.state and in
                // the save schema: a match saved and resumed later keeps updating
                // this same record instead of forking a second partial one.
                const store = db.createObjectStore(ARCHIVE_STORE, { keyPath: 'matchId' });
                store.createIndex('updatedAt', 'updatedAt');
                store.createIndex('complete', 'complete');
            }
        };

        request.onsuccess = () => { archiveDb = request.result; resolve(archiveDb); };
        request.onerror = () => reject(request.error || new Error('could not open the archive'));
    });
}

// One promise-wrapped transaction, so no caller writes raw IndexedDB plumbing.
function ArchiveTransaction(mode, run) {
    return OpenArchive().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(ARCHIVE_STORE, mode);
        const store = tx.objectStore(ARCHIVE_STORE);
        let result;

        const request = run(store);
        if (request) {
            request.onsuccess = () => { result = request.result; };
            request.onerror = () => reject(request.error);
        }

        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('archive transaction aborted'));
    }));
}

// --- writing ----------------------------------------------------------------

// The one write path. `complete` marks a match that reached a real conclusion,
// which is what separates a finished record from a snapshot of one in progress.
//
// Returns a promise, but callers are not expected to await it: a snapshot failing
// must never take a turn down with it. Errors are logged and swallowed at the
// call sites in js/client/actions.js.
function ArchiveMatchSnapshot(complete = false) {
    if (!ArchiveIsEnabled()) return Promise.resolve(null);

    const matchId = engine.state.matchId;

    // BuildSaveState, not a private serializer: byte-for-byte the same thing the
    // Save Game button writes, so anything that can load a save can load this.
    const save = BuildSaveState();
    const now = Date.now();

    return ArchiveTransaction('readonly', store => store.get(matchId))
        .then(existing => {
            // The true opening when this match's start was captured, and the
            // current board when it was not - a match that gained consent partway
            // through has no recorded start, and inventing one would be worse than
            // saying it began where the recording did.
            const opening = (pendingOpening && pendingOpening.matchId === matchId)
                ? pendingOpening.save
                : save;

            const record = existing || {
                matchId,
                // Denormalised so the list view needs no second lookup, and so a
                // record still says who played it if the profile is later cleared.
                profileId: engine.localProfile ? engine.localProfile.id : null,
                profileName: engine.localProfile ? engine.localProfile.name : null,
                gameMode: engine.state.gameMode,
                startedAt: now,
                // Written once, on the first snapshot of this match, and never
                // touched again - see the header. For a match resumed from a save
                // this is where it was resumed from, which is the honest answer:
                // nothing was recording it before that.
                opening,
            };

            record.updatedAt = now;
            record.turn = engine.state.globalTurnNumber;
            record.complete = !!complete;
            record.completedAt = complete ? now : null;
            record.schemaVersion = save.schemaVersion;
            record.latest = save;

            if (complete && engine.pendingVictory) {
                record.verdict = {
                    winner: engine.pendingVictory.winner ?? engine.pendingVictory.winningPlayer ?? null,
                    isDraw: !!engine.pendingVictory.isDraw,
                    text: engine.pendingVictory.victoryText || null,
                };
            }

            return ArchiveTransaction('readwrite', store => store.put(record))
                .then(() => {
                    // Stored now, so it does not linger for the next match.
                    if (pendingOpening && pendingOpening.matchId === matchId) pendingOpening = null;
                    return record;
                });
        });
}

// --- reading ----------------------------------------------------------------

// Metadata only. The saves inside a record are several KB each and a list view
// has no use for them; anything that wants one asks for the record by id.
function ListArchivedMatches() {
    return ArchiveTransaction('readonly', store => store.getAll())
        .then(records => (records || [])
            .map(r => ({
                matchId: r.matchId,
                profileName: r.profileName,
                gameMode: r.gameMode,
                turn: r.turn,
                complete: r.complete,
                verdict: r.verdict || null,
                startedAt: r.startedAt,
                updatedAt: r.updatedAt,
                entries: r.latest && r.latest.matchHistory ? r.latest.matchHistory.length : 0,
                bytes: JSON.stringify(r).length,
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt));
}

function GetArchivedMatch(matchId) {
    return ArchiveTransaction('readonly', store => store.get(matchId))
        .then(record => record || null);
}

function DeleteArchivedMatch(matchId) {
    return ArchiveTransaction('readwrite', store => store.delete(matchId));
}

function ClearArchive() {
    return ArchiveTransaction('readwrite', store => store.clear());
}

// --- the seam that isn't built yet ------------------------------------------

// Deliberately empty, and the same shape RecordAccepted itself was left in by A2
// for this track to eventually fill.
//
// There is no central server. Per the roadmap's infrastructure notes one may
// exist eventually - the fixed-address WebSocket adapter in Track B2 is what
// would reach it - and until then a real network call here would be built against
// constraints nobody knows yet. What IS settled and worth writing down for
// whoever fills this in:
//
//   - consent has already been checked by the time a record exists at all. This
//     function does not re-ask, but it also must not assume: a player can revoke
//     consent through SetConsent after a match was recorded, and records written
//     under an earlier yes should not be uploaded under a later no.
//   - records are keyed by matchId and tagged with profileId, so a server can
//     de-duplicate re-uploads without a second identity scheme.
//   - a record is a Testament save. Its schemaVersion says how to read it, and
//     the migration chain already knows how to bring an old one forward.
function SyncArchiveToServer() {
    console.log('[Archive] No central server exists yet - nothing is sent anywhere. ' +
                'See SyncArchiveToServer in js/client/archive.js.');
    return Promise.resolve({ sent: 0, reason: 'no_server' });
}
