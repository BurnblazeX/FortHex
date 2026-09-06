// === The status corner (B2) ===
//
// Bottom-right, two lines, deliberately faint:
//
//     FortHex Build InDev B30 - Online
//     H8YGSH - Blaze
//
// The first line always shows; the second only exists during an online match. That
// asymmetry is the point. Singleplayer and Local explain themselves in play - the AI
// moves on its own, or the pass-device overlay appears - so they need an answer that
// is FINDABLE, not one that is constantly in the way. Online is the mode with an
// opponent who can leave and a connection that can drop, so it earns the extra line.
//
// The room is identified by its JOIN CODE, not its id. The id is a UUID: unreadable,
// unrepeatable over voice, and useless to a player. The join code is the thing you
// would actually say out loud to invite someone, and it is already what the room
// screen shows.

// Set when an online match starts, cleared when it ends. Held here rather than read
// out of the engine because it is lobby knowledge - the engine has no idea what a
// room is, and should not learn.
let onlineContext = null;

// The source fingerprint, fetched from the host. Null until it arrives, and null
// forever when the page is served by something that does not provide it (a plain
// static host, or opened straight off disk) - in which case the line simply omits it
// rather than showing a placeholder that looks like a real value.
let buildHash = null;

// InDev only, per its purpose: this exists so a tester can tell one build from another
// mid-session. A released build has a version number and does not need a fingerprint.
function IsInDevBuild() {
    return typeof BUILD_VERSION === 'string' && /indev/i.test(BUILD_VERSION);
}

// Asked for once at startup. Deliberately not polled: the hash answers "what am I
// running right now", and it can only change by reloading the page anyway.
function FetchBuildHash() {
    if (!IsInDevBuild() || typeof fetch !== 'function') return;

    fetch('/build', { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .then(build => {
            if (!build || !build.hash) return;
            buildHash = build.hash;
            UpdateStatusCorner();
            console.log('[Build] ' + build.version + ' - source hash ' + build.hash
                + ' over ' + build.files + ' files, newest edit '
                + new Date(build.newestMtime).toLocaleTimeString()
                + '  |  corner now reads: "' + document.getElementById('buildVersionDisplay').textContent + '"'
                + '  (FhStatus() for why)');
        })
        .catch(() => { /* not served by the host; the line just omits it */ });
}

const MODE_LABELS = {
    singleplayer: 'Singleplayer',
    local: 'Local',
    online: 'Online',
    arcade: 'Arcade',
};

function SetOnlineContext(context) {
    onlineContext = context || null;
    UpdateStatusCorner();
}

function ClearOnlineContext() {
    onlineContext = null;
    UpdateStatusCorner();
}

function DescribeMode() {
    // A fresh engine reports gameMode 'local' before anything has been played - that is
    // the field's default, not a statement about what the player is doing. Menu-first
    // boot therefore opened onto a clean menu with "- Local" already claiming a match
    // existed. So the board is what decides: no tiles, no mode.
    //
    // Same test as IsMatchInProgress (src/ui/bridge.js, js/client/menu.js), which is
    // what the root menu uses to decide whether to offer "Back to Match" - the two
    // answers should never disagree about whether a match exists.
    if (!engine.state.tiles || engine.state.tiles.size === 0) return null;

    if (engine.state.mapMakerMode) return 'Map Maker';
    if (engine.state.isTrainingMode) return 'Training';
    return MODE_LABELS[engine.state.gameMode] || null;
}

// Type FhStatus() in the console to see exactly what the corner decided and why.
// Added because this line failed to show the build hash twice in a row and reasoning
// about it from the outside got the wrong answer both times - a display that cannot
// explain itself costs more to debug than it costs to make it explain itself.
function FhStatus() {
    const line = document.getElementById('buildVersionDisplay');
    return {
        buildHash,
        isInDev: IsInDevBuild(),
        fetchAvailable: typeof fetch === 'function',
        menuOpen: !!(typeof window !== 'undefined' && window.FortHexUI && window.FortHexUI.IsOpen()),
        uiPresent: !!(typeof window !== 'undefined' && window.FortHexUI),
        mode: DescribeMode(),
        tiles: engine.state.tiles ? engine.state.tiles.size : 0,
        gameMode: engine.state.gameMode,
        elementFound: !!line,
        showing: line ? line.textContent : null,
    };
}

function UpdateStatusCorner() {
    const versionLine = document.getElementById('buildVersionDisplay');
    const contextLine = document.getElementById('matchContextDisplay');
    if (!versionLine) {
        console.warn('[Status] #buildVersionDisplay is missing - nothing to write to.');
        return;
    }

    const mode = DescribeMode();
    // One suffix, and which of the two fills it depends on WHERE YOU ARE, not on
    // whether a board exists.
    //
    // The first attempt keyed off "is there a match", which is true forever once you
    // have played one - so after the first game the mode took the slot permanently and
    // the hash was only visible in the few seconds between page load and starting to
    // play. Which is to say: never, in practice.
    //
    // Menu open, you are deciding what to run: show the hash. In a match, you are
    // playing: show the mode. Each falls back to the other, so the line is never empty
    // when it has something to say.
    const menuOpen = !!(typeof window !== 'undefined' && window.FortHexUI && window.FortHexUI.IsOpen());
    const suffix = menuOpen ? (buildHash || mode) : (mode || buildHash);
    versionLine.textContent = 'FortHex ' + BUILD_VERSION + (suffix ? ' - ' + suffix : '');

    if (!contextLine) return;

    // No room, no second line - an empty element would still take vertical space and
    // shove the version line up for no reason.
    if (!onlineContext || engine.state.gameMode !== 'online') {
        contextLine.textContent = '';
        contextLine.style.display = 'none';
        return;
    }

    const who = onlineContext.opponent || 'waiting for opponent';
    contextLine.textContent = onlineContext.code + ' - ' + who;
    contextLine.style.display = 'block';
}
