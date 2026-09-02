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
const transport = CreateLocalTransport(engine);

// Server -> client: every state-sync's events go through the same handler the
// client has always used, so nothing in client/ui.js or client/render.js had to change.
transport.OnMessage((message) => {
    if (message.type === 'state-sync') {
        message.events.forEach(HandleActionEvent);
    }
});

// A5: the profile is read once, here, and handed to the engine as plain data.
// Reading it does NOT create one — GetProfile returns null for the majority of
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
    document.getElementById('buildVersionDisplay').textContent = `FortHex Build ${BUILD_VERSION}`;

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

    engine.state.gridRadius = 3; // Use the default value directly
    initializeGrid();
    // This is the important call to our new function
    updateCssVariables();
    populateColorPickers();
    gameLoop();
    showInstruction("Project Hexblade Loaded. Player 1's Turn.", 3000);
    WireColorDrawer();
    WireTabsAndSwapChoices();
};
