// === The one seam between React and FortHex's script globals (B1) ===
//
// Every game function the menu touches is reached through here. The bundle is an
// IIFE in the same global scope as js/, so these are plain free identifiers - but
// funnelling them through one module means the React tree has a single, obvious
// dependency on the game rather than dozens scattered across components.
/* global StartMatchFromMenu, GetSelectableMaps, renderMapPreview, GetProfile,
          GetOrCreateProfile, PROFILE_AVATARS, startTrainingMode,
          showInstruction, OpenSettingsModal, OpenChangelogModal, showLoadGameModal,
          fileLoadContext, gameSettings, engine, CreateWebSocketTransport,
          BUILD_VERSION, BeginOnlineMatchWith, SetOnlineContext, ClearOnlineContext,
          UpdateStatusCorner, EndOnlineMatch, ShowMainMenu, SendAction, RemoteSeat,
          OpenTutorialModal, CanInstallApp, InstallApp, ReadMapFileForRoom, ReadSaveFileForRoom, ProbeDirectConnectivity, GetClientFingerprint, CreateRtcHostTransport,
          CreateRtcGuestTransport, CreateBrokeredSignal, CreateManualSignal */

export function StartMatch(options) { StartMatchFromMenu(options); }
export function GetMaps() { return GetSelectableMaps(); }

// Turns a .fhmap the player picked into the plain object a room carries. It does NOT
// touch the running game: the map maker's loader replaces the live board, which is
// the last thing wanted while standing in a lobby. Returns null and says why on a
// file that is not a map.
export function ReadMapFile(file) { return ReadMapFileForRoom(file); }

// The same, for a saved match a room should resume from. Testament runs on THIS
// machine, including the modernise prompt, because that question needs a person and
// this is where the person is.
export function ReadSaveFile(file) { return ReadSaveFileForRoom(file); }
export function DrawMapPreview(canvas, map) { renderMapPreview(canvas, map); }

export function GetLocalProfile() { return GetProfile(); }
export function CreateLocalProfile(name, consent, avatar) {
    return GetOrCreateProfile(name, consent, avatar);
}
export function GetAvatars() { return PROFILE_AVATARS; }

// The B2 socket adapter (js/client/ws-transport.js). Same Send/OnMessage surface as
// LocalTransport, so nothing downstream can tell them apart.
export function CreateSocketTransport(url, options) {
    return CreateWebSocketTransport(url, options);
}

// Hands the board over to a hosted match. Everything about how that works lives in
// js/main.js - the lobby's job is to say when, not how.
export function BeginOnlineMatch(socketTransport, seat, options) {
    BeginOnlineMatchWith(socketTransport, seat, options);
}

// The room code and the other player, for the status corner. Lobby knowledge, so it
// is pushed down rather than the engine being taught what a room is.
export function SetMatchContext(code, opponent) {
    SetOnlineContext({ code, opponent });
}

export function ClearMatchContext() {
    ClearOnlineContext();
}

// The corner shows the build hash while the menu is up and the mode while playing, so
// it has to be told when that changes.
export function RefreshStatusCorner() {
    UpdateStatusCorner();
}

// Hands the board back to the in-process engine. Without this the client kept posting
// actions into a socket it had walked away from, and every one came back "you are not
// in a room anymore".
export function LeaveOnlineMatch() {
    EndOnlineMatch();
}

// Puts the player back on the menu. Used when the match they were in stops existing
// underneath them, so they are never left on a board they cannot act on.
export function ShowMenuAtRoot() {
    ShowMainMenu('root');
}

// Opens the menu ON a given screen. Needed because MenuApp's room rule only moves
// between 'lobby' and 'room' - landing on 'root' with a room in hand would sit there.
export function ShowMenuAt(screen) {
    ShowMainMenu(screen);
}

// B3: the answer to "your opponent did not come back". Goes to the server as a normal
// action, so it is validated like any other - the host refuses it from the player who
// is absent, which is exactly the check that matters.
export function ResolveDisconnectChoice(player, choice) {
    SendAction('resolve-disconnect', { player, choice });
}

// === B2: direct (peer-to-peer) play ===
//
// Kept behind the bridge like everything else, so the lobby can offer "host on your
// own machine" without importing a line of WebRTC.

// Asks the NETWORK, before the player commits to anything, whether it can accept a
// direct connection at all. The answer is what decides whether that option is
// offered or greyed out with a reason - see js/client/webrtc-probe.js.
export function ProbeDirect() {
    return ProbeDirectConnectivity();
}

// What build this browser is running, for the server's compatibility check. A
// promise: it reads every file the page loaded. Null when the browser cannot hash.
export function GetBuildFingerprint() {
    return GetClientFingerprint();
}

export function CreateDirectHost(options) { return CreateRtcHostTransport(options); }
export function CreateDirectGuest(options) { return CreateRtcGuestTransport(options); }

// Two ways for the peers to exchange connection details. Brokered goes through the
// lobby socket; manual is two people pasting codes, and needs no server at all.
export function CreateRelaySignal(socketTransport) { return CreateBrokeredSignal(socketTransport); }
export function CreateCodeSignal(options) { return CreateManualSignal(options); }

export function RemoteSeatNumber() {
    return RemoteSeat();
}

export function GetBuildVersion() {
    return typeof BUILD_VERSION === 'string' ? BUILD_VERSION : null;
}

export function OpenSettings() { OpenSettingsModal(); }
export function OpenChangelog() { OpenChangelogModal(); }

// Was a floating button pinned over the board. It is a menu item now, which is also
// where a guided tutorial would go when one exists.
export function OpenTutorial() { OpenTutorialModal(); }

// Installing FortHex as an app. Worth keeping reachable: an installed copy works
// offline, which is the exact situation Direct Connect's manual codes exist for.
// The browser decides whether this is possible and says so once, via
// `beforeinstallprompt`; there is nothing to force if it never does.
export function CanInstall() { return CanInstallApp(); }
export function Install() { return InstallApp(); }
export function StartTraining() { startTrainingMode(); }

// Menu-first boot moved the toolbar behind the menu at launch, so a saved game was
// only reachable after starting a throwaway match first. This is the same pair of
// statements the toolbar's Load button runs (js/client/toolbar.js) - not a second
// load path, just a second door onto the one that exists.
export function OpenLoadGame() {
    fileLoadContext = 'game_save';
    showLoadGameModal();
}
export function Instruct(message, duration) { showInstruction(message, duration); }

// Training is a debug-only entry point, gated by the same flag the old menu used to
// toggle #trainingModeButton's visibility (js/client/settings-panel.js).
export function IsDebugMode() {
    return !!(typeof gameSettings !== "undefined" && gameSettings && gameSettings.debugModeEnabled);
}

// Whether there is a match behind the menu to go back to. False on the very first
// open, which is what lets the root screen hide its close button at launch - there
// is nothing underneath to close onto.
export function IsMatchInProgress() {
    return !!(engine && engine.state && engine.state.tiles && engine.state.tiles.size > 0);
}
