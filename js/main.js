// === Composition root (A1 step 12) ===
//
// This file used to be 1,185 lines of game logic, DOM orchestration and input
// handling. All of it now lives in js/server/ or js/client/; what's left is the
// job §4 describes for js/main.js: create the server, create the client, wire
// the transport between them, register listeners, start the loop.
//
// The one thing to keep true here is the order:
//   1. engine        - the authoritative state, nothing else works without it
//   2. transport     - needs the engine to route actions into
//   3. client wiring - listener registration, which may reference both
//   4. bootstrap     - build a grid and start the render loop
//
// Script load order in index.html matters for a second reason: `engine` and
// `transport` are declared here, in the last script on the page. Every other
// file only touches them from inside a function, so by the time any of that
// runs these bindings exist.

// --- 1. Server ---
const engine = CreateEngineInstance();

// --- 2. Transport ---
// Local, in-process for now. Track B swaps this for WebRTC/WebSocket/UPnP
// adapters carrying the same four message shapes.
// `let`, not `const`: an online match swaps this for the WebSocket adapter and swaps
// it back when the match ends. Every call site reads it from inside a function - there
// is only one that matters for gameplay, js/client/actions.js - so reassigning is all
// the handover needs. That was the point of A1 defining a transport interface.
let transport = CreateLocalTransport(engine);

// Server -> client: every state-sync's events go through the same handler the
// client has always used, so nothing in client/ui.js or client/render.js had to change.
transport.OnMessage((message) => {
    if (message.type === 'state-sync') {
        message.events.forEach(HandleActionEvent);
    }
});

// --- B2: handing the board over to a hosted match ---------------------------
//
// Called by the lobby (src/ui/net-store.js) when the host starts. From here the client
// stops being the authority and becomes a renderer: actions go out over the socket, and
// what comes back is a filtered view that ApplyRemoteView writes into engine.state so
// every existing renderer keeps working untouched.
// Releases the socket subscription when the hosted match ends. Held at module scope
// because BeginOnlineMatchWith and EndOnlineMatch are the two halves of one lifecycle
// and the second cannot undo the first without it.
let onlineUnsubscribe = null;

function BeginOnlineMatchWith(socketTransport, seat, options = {}) {
    if (!socketTransport) return;

    // Never stack two subscriptions on one socket.
    if (onlineUnsubscribe) { onlineUnsubscribe(); onlineUnsubscribe = null; }

    transport = socketTransport;
    BeginRemoteMatch(seat, options.isHost);

    // Fog is a property of the MATCH, chosen when the room was created, not of this
    // device's settings panel. The host already filters what it sends accordingly -
    // which is why enemy units were correctly missing - but the client draws the fog
    // itself from engine.settings, and nothing was telling it the match had any. The
    // result was a board with no fog drawn and enemies that were simply absent.
    engine.settings.fogOfWarEnabled = !!options.fogOfWar;

    // And the movement pools, for the same reason and with a sharper edge: fog only
    // changes what this client DRAWS, but the pools change what it believes is legal.
    // A client left on the default would highlight moves the host then rejects.
    engine.settings.unitSpeedPreset = options.unitSpeedPreset || null;

    // An online match never goes through initializeGrid, so nothing else would size
    // the canvas or the side panels.
    SizeBoardAndPanels();

    console.log('[Online] Match handed over to the socket. You are player ' + seat
        + ' (' + (options.isHost ? 'host' : 'guest') + ').');

    onlineUnsubscribe = socketTransport.OnMessage((message) => {
        // A message that arrives after the match has been left is not ours to
        // apply. The unsubscribe below closes the window, but a payload already
        // in flight can still land in it.
        if (!IsRemoteMatch()) return;

        // Wrapped, because a throw inside a socket callback goes nowhere useful: the
        // subscription simply stops delivering and the board silently freezes. That is
        // exactly the failure that is impossible to diagnose from the outside, so it
        // gets to name itself.
        try {
            if (message.type === 'state-resync') {
                console.log('[Online] Full board received (resync).');
                ApplyRemoteView(message.snapshot);
                RefreshRemoteUi();
                return;
            }
            if (message.type !== 'state-sync') return;

            // Events first, then the board. The events drive the action log and the
            // animations; the view is the authoritative position afterwards, so
            // applying it second corrects a mid-flight animation rather than ignoring it.
            (message.events || []).forEach(HandleActionEvent);

            if (message.view) {
                ApplyRemoteView(message.view);
                RefreshRemoteUi();
            } else {
                // Not fatal, but it means this update changed nothing drawable - worth
                // saying out loud rather than leaving the board looking stuck.
                console.warn('[Online] state-sync arrived with no board view.',
                    (message.events || []).map(e => e.type).join(', ') || '(no events)');
            }
        } catch (error) {
            console.error('[Online] Failed to apply an update:', error);
            ShowAlert('Lost sync with the match. See console.');
        }
    });

    EnsureGameLoopRunning();
    UpdateStatusCorner();
    FetchBuildHash();
    if (window.FortHexUI) window.FortHexUI.Hide();

    // Three ways to arrive at the same board, and telling somebody who has just walked
    // back into a twenty-minute-old match that it has "started" is the kind of small
    // lie that makes a player doubt the rest of the screen.
    const side = seat === 1 ? 'Blue' : 'Red';
    if (options.hotJoined) ShowSuccess('You have taken over ' + side + '. Match already in progress.');
    else if (options.rejoined) ShowSuccess('Rejoined the match. You are ' + side + '.');
    else ShowSuccess('Match started. You are ' + side + '.');
}

// Back to the in-process engine. Used when an online match ends or the socket drops -
// without it the client would keep posting actions into a closed socket.
function EndOnlineMatch() {
    // THE important line. Without it the old subscription stayed live: every state-sync
    // the host kept sending was still applied to the local engine, so a player who left
    // for a local game watched that game get overwritten by the online board they had
    // just walked away from - including whose turn it was, which handed them control of
    // both sides. It also re-showed the disconnect banner for the person who left.
    if (onlineUnsubscribe) { onlineUnsubscribe(); onlineUnsubscribe = null; }

    EndRemoteMatch();
    ClearOnlineContext();

    // A direct match owns things a socket never did - a peer connection and a Web
    // Worker running the authoritative engine. Dropping the transport reference does
    // not stop either of them, and this is the one place every remote match ends, so
    // it is the one place that can be sure of closing them.
    if (window.FortHexUI && window.FortHexUI.EndDirectSession) {
        window.FortHexUI.EndDirectSession();
    }

    transport = CreateLocalTransport(engine);
    transport.OnMessage((message) => {
        if (message.type === 'state-sync') message.events.forEach(HandleActionEvent);
    });
}

// A5: the profile is read once, here, and handed to the engine as plain data.
// Reading it does NOT create one - GetProfile returns null for the majority of
// players, who have never entered the Online flow, and null is the normal answer.
// The engine carries it so BuildSaveObject (js/testament.js) can attach it to a
// save without that DOM-free module reaching for localStorage, which it does not
// have in a Worker. js/client/profile.js keeps this field current if a profile is
// created later in the session.
engine.localProfile = ProfileForSave(GetProfile());

// A6's gate, mirrored the same way and for the same reason. False for every device
// that has never gone online and said yes, which is the state that matters most:
// nothing is archived until somebody has agreed to it.
engine.archiveConsent = HasArchiveConsent();

// Local play still "connects" - one code path for local and networked, which
// is the whole point of A1. The id is the real profile id when this device has
// one, and the A1 placeholder when it does not: A5 changed what flows into this
// field, not the field itself or anything that reads it.
transport.Send(MakeConnectMessage(GetProfileId() || 'local-player'));

// --- 3. Client wiring ---
// Registered at script scope, not inside window.onload, exactly as before -
// moving them into onload would delay listener registration until after all
// page resources finish loading.
WireToolbar();
WirePwaInstall();
WireTutorialModal();
WireCanvasInput();

// --- 4. Bootstrap ---
window.onload = function () {

    // --- Initialize Debug Console System Immediately ---
    setupDebugConsoleSystem();

    document.getElementById('saveGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save Game`;
    document.getElementById('loadGameButton').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; stroke: white;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Load Game`;
    UpdateStatusCorner();

    loadSettings();
    loadColorPreferences();
    SyncSettingControls();
    WireConnectionStatus();
    WireMainMenu();
    WireSettingsModal();
    WireChangelogModal();
    WireSettingControls();
    WireLoadAndConfirmModals();
    WireRespawnChoices();

    updateCssVariables();
    populateColorPickers();
    WireColorDrawer();
    WireTabsAndSwapChoices();

    // --- B1: menu-first boot ---
    //
    // This used to be initializeGrid() + gameLoop(): the page opened straight onto a
    // live local match, and the menu was a modal drawn over the top of it. It now
    // opens onto the menu, and no match exists until the player picks one.
    //
    // Three things follow from that, and each is deliberate:
    //   - the render loop is started by the first match instead (EnsureGameLoopRunning,
    //     js/client/render.js), because there is nothing to draw before one;
    //   - engine.state.gridRadius is set by the chosen map's resize, not here;
    //   - A6's CaptureArchiveOpening no longer fires at launch. It hangs off
    //     initializeGrid, so booting a throwaway board was priming an archive opening
    //     for a match nobody had agreed to play.
    engine.state.gridRadius = 3;
    FortHexUI.Mount();
    FortHexUI.Show('root');
};
