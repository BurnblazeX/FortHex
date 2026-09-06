// === Lobby connection state (B2) ===
//
// Owns the one WebSocketTransport the lobby uses and exposes its state to React the
// same way menu-store.js and notify-store.js do — an external store, because the
// socket's lifetime is longer than any component's and messages arrive whether or not
// anything is mounted.
//
// The transport class itself is js/client/ws-transport.js, a plain script loaded with
// the rest of js/. It is reached through the bridge like every other game global, so
// this file never touches it directly.

import {
    CreateSocketTransport, GetLocalProfile, GetBuildVersion, BeginOnlineMatch,
    SetMatchContext, ClearMatchContext,
} from './bridge.js';
import { Notify } from './notify-store.js';

let state = {
    status: 'offline',   // offline | connecting | online | error
    error: null,
    rooms: [],
    room: null,          // the room this client is IN, once joined
    seat: null,
    matchStarted: false,
};

const listeners = new Set();
let transport = null;

function SetState(patch) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
}

export function Subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function GetSnapshot() {
    return state;
}

export function GetTransport() {
    return transport;
}

// Where the host lives. Same origin as the page by default, so a build served by
// host/server.js or by Caddy in front of it needs no configuration — and wss:// is
// chosen from the page's own protocol, which is what makes it work behind the tunnel
// without a second setting to get wrong.
export function DefaultHostUrl() {
    if (typeof window === 'undefined') return '';
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return scheme + '//' + window.location.host + '/ws';
}

export async function ConnectToLobby(url) {
    if (state.status === 'connecting' || state.status === 'online') return transport;

    SetState({ status: 'connecting', error: null });

    const profile = GetLocalProfile();
    transport = CreateSocketTransport(url || DefaultHostUrl(), {
        profileId: profile ? profile.id : null,
        name: profile ? profile.name : 'Player',
        version: GetBuildVersion(),
    });

    transport.OnLobbyMessage(HandleLobbyMessage);

    try {
        await transport.Connect();
        SetState({ status: 'online' });
        transport.ListRooms();
    } catch (error) {
        // A refused socket is the ordinary case, not an exception: the host is a home
        // server that is sometimes simply off. Say so plainly rather than throwing.
        SetState({ status: 'error', error: 'Could not reach the server.' });
        transport = null;
    }

    return transport;
}

// Leaving is a local intent that cannot meaningfully fail, so the room clears here
// rather than waiting for the host's `room-left`. Waiting was what blanked the screen:
// navigation keyed off `room`, so a leave that had not yet been confirmed left the UI
// on a room screen with no room to draw.
export function LeaveRoom() {
    if (transport) transport.LeaveRoom();
    SetState({ room: null, seat: null, matchStarted: false, error: null });
    if (transport) transport.ListRooms();
}

// Called before starting any LOCAL match. Walking away to play singleplayer is
// leaving the room, and the server has no way to know that on its own — the socket
// is still open, so the seat stayed occupied and the room went on advertising
// itself as full with nobody actually in it.
export function LeaveRoomIfAny() {
    if (state.room) LeaveRoom();
}

export function Disconnect() {
    if (transport) transport.Close();
    transport = null;
    SetState({ status: 'offline', rooms: [], room: null, seat: null, matchStarted: false, error: null });
}

function HandleLobbyMessage(message) {
    switch (message.type) {
        case 'hello-ok':
            SetState({ rooms: message.rooms || [] });
            break;

        case 'room-list':
            SetState({ rooms: message.rooms || [] });
            break;

        case 'room-joined':
            SetState({ room: message.room, seat: message.seat, error: null });
            break;

        case 'room-update':
            SetState({ room: message.room });
            // The opponent may have only just arrived, or just left.
            PushMatchContext(message.room);
            break;

        case 'room-left':
            // The server sends the refreshed list with the confirmation, so the lobby
            // is correct the moment it appears rather than a request later.
            SetState({ room: null, seat: null, matchStarted: false, rooms: message.rooms || state.rooms });
            ClearMatchContext();
            if (transport) transport.ListRooms();
            break;

        case 'match-started':
            SetState({ room: message.room, seat: message.seat, matchStarted: true });
            // Hands the board over to the socket. Until this existed, pressing Start
            // did everything on the server and nothing the player could see.
            BeginOnlineMatch(transport, message.seat, {
                fogOfWar: !!(message.room && message.room.fogOfWar),
            });
            PushMatchContext(message.room);
            break;

        case 'room-error': {
            const said = DescribeError(message.error);
            SetState({ error: said });
            // Also as a toast. The inline line is easy to miss on a screen you are
            // reading rather than watching, and some of these arrive while the player
            // is looking somewhere else entirely.
            Notify(said, 'warn');
            break;
        }

        case 'match-error':
            SetState({ error: message.error || 'The match ended unexpectedly.' });
            Notify(message.error || 'The match ended unexpectedly.', 'error');
            break;

        case 'host-disconnected':
            SetState({ status: 'offline', room: null, seat: null, matchStarted: false,
                       error: 'Lost connection to the server.' });
            Notify('Lost connection to the server.', 'error');
            break;

        case 'room-closed':
            SetState({ room: null, seat: null, matchStarted: false });
            Notify('The room was closed.', 'warn');
            break;

        default:
            break;
    }
}

// Feeds the status corner: the room's join code and whoever is in the other seat.
function PushMatchContext(room) {
    if (!room) { ClearMatchContext(); return; }
    const other = (room.seats || []).find(seat => seat.filled && !seat.you);
    SetMatchContext(room.joinCode, other ? other.name : null);
}

// The host speaks in codes so it never has to care about wording. This is the only
// place they become sentences.
function DescribeError(code) {
    switch (code) {
        case 'bad_code':          return 'That code is not right.';
        case 'already_started':   return 'That match has already started.';
        case 'not_in_room':       return 'You are not in a room any more.';
        case 'not_seated':        return 'You do not have a seat in this room.';
        case 'match_not_running': return 'That match is not running.';
        case 'unknown_message':   return 'The server did not understand that.';
        case 'bad_json':          return 'The server could not read that message.';
        case 'internal_error':    return 'The server hit an error.';
        case 'room_full':         return 'That room is already full.';
        case 'no_such_room':      return 'That room no longer exists.';
        case 'room_finished':     return 'That match has already ended.';
        case 'already_in_room':   return 'You are already in a room.';
        case 'not_host':          return 'Only the host can start the match.';
        case 'room_not_full':     return 'Both seats have to be filled first.';
        case 'server_at_capacity':return 'The server is running as many matches as it can.';
        case 'too_many_attempts': return 'Too many wrong codes. Wait a minute and try again.';
        default:                  return 'Something went wrong (' + code + ').';
    }
}

export function ClearError() {
    SetState({ error: null });
}
