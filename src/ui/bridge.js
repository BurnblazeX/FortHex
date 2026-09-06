// === The one seam between React and FortHex's script globals (B1) ===
//
// Every game function the menu touches is reached through here. The bundle is an
// IIFE in the same global scope as js/, so these are plain free identifiers — but
// funnelling them through one module means the React tree has a single, obvious
// dependency on the game rather than dozens scattered across components.
/* global StartMatchFromMenu, GetSelectableMaps, renderMapPreview, GetProfile,
          GetOrCreateProfile, PROFILE_AVATARS, startTrainingMode,
          showInstruction, OpenSettingsModal, OpenChangelogModal, showLoadGameModal,
          fileLoadContext, gameSettings, engine, CreateWebSocketTransport,
          BUILD_VERSION, BeginOnlineMatchWith, SetOnlineContext, ClearOnlineContext,
          UpdateStatusCorner, EndOnlineMatch */

export function StartMatch(options) { StartMatchFromMenu(options); }
export function GetMaps() { return GetSelectableMaps(); }
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
// js/main.js — the lobby's job is to say when, not how.
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

export function GetBuildVersion() {
    return typeof BUILD_VERSION === 'string' ? BUILD_VERSION : null;
}

export function OpenSettings() { OpenSettingsModal(); }
export function OpenChangelog() { OpenChangelogModal(); }
export function StartTraining() { startTrainingMode(); }

// Menu-first boot moved the toolbar behind the menu at launch, so a saved game was
// only reachable after starting a throwaway match first. This is the same pair of
// statements the toolbar's Load button runs (js/client/toolbar.js) — not a second
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
// open, which is what lets the root screen hide its close button at launch — there
// is nothing underneath to close onto.
export function IsMatchInProgress() {
    return !!(engine && engine.state && engine.state.tiles && engine.state.tiles.size > 0);
}
