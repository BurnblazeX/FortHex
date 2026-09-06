// === Lobby connection state (B2) ===
//
// Owns the one WebSocketTransport the lobby uses and exposes its state to React the
// same way menu-store.js and notify-store.js do - an external store, because the
// socket's lifetime is longer than any component's and messages arrive whether or not
// anything is mounted.
//
// The transport class itself is js/client/ws-transport.js, a plain script loaded with
// the rest of js/. It is reached through the bridge like every other game global, so
// this file never touches it directly.

import {
    CreateSocketTransport, GetLocalProfile, GetBuildVersion, BeginOnlineMatch,
    SetMatchContext, ClearMatchContext, LeaveOnlineMatch, ShowMenuAtRoot, ShowMenuAt,
    ProbeDirect, GetBuildFingerprint,
} from './bridge.js';
import { Notify } from './notify-store.js';
import { BeginDirectMatch, EndDirectMatch, GetDirectTransport } from './direct-store.js';

let state = {
    status: 'offline',   // offline | connecting | online | error
    error: null,
    rooms: [],
    room: null,          // the room this client is IN, once joined
    seat: null,
    matchStarted: false,

    // B2. What this network can do, and whether this build is welcome here. Both are
    // answered once and remembered: the probe takes seconds and the fingerprint reads
    // every file the page loaded, and neither answer can change without a reload.
    direct: null,          // null until probed, then the probe's { ok, verdict, detail }
    buildAccepted: true,   // the server's verdict on this build; true until told otherwise
    buildEnforced: false,  // whether that server is checking at all
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
// host/server.js or by Caddy in front of it needs no configuration - and wss:// is
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

    // Awaited rather than raced: `hello` carries this, and a hello sent without it
    // would be judged as a build that sent nothing - which on an enforcing server is
    // a refusal. Costs one pass over the already-cached page files.
    const fingerprint = await GetBuildFingerprint();

    transport = CreateSocketTransport(url || DefaultHostUrl(), {
        profileId: profile ? profile.id : null,
        name: profile ? profile.name : 'Player',
        version: GetBuildVersion(),
        fingerprint,
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
    // Order matters: hand the board back FIRST, then tell the server. Announcing the
    // departure first leaves a window in which the host's reply - including the
    // PLAYER_DISCONNECTED it raises for the leaver's own seat - arrives while this
    // client is still subscribed, which is how the person who left ended up watching a
    // countdown for their own disconnection.
    if (state.matchStarted) LeaveOnlineMatch();

    // A direct match has a peer connection and a worker of its own to shut down. The
    // socket knows nothing about either, so leaving the room would otherwise leave a
    // data channel open and an engine running in a worker nobody is talking to.
    EndDirectMatch();

    if (transport) transport.LeaveRoom();
    SetState({ room: null, seat: null, matchStarted: false, error: null });
    if (transport) transport.ListRooms();
}

// Called before starting any LOCAL match. Walking away to play singleplayer is
// leaving the room, and the server has no way to know that on its own - the socket
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
            SetState({
                rooms: message.rooms || [],
                buildAccepted: message.buildAccepted !== false,
                buildEnforced: !!message.buildEnforced,
            });
            // Said once, on arrival, rather than only when they try to create a room and
            // are refused with no idea why. A modified build is a thing the player did
            // on purpose, so this is information, not an accusation.
            if (message.buildAccepted === false) {
                Notify('This build is not recognised by the server. You can still play direct or offline.', 'warn');
            }
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

        case 'match-direct':
            // The server has bowed out. It will not see another byte of this match -
            // it relays the two connection blobs and that is all. Everything from here
            // is between the two browsers.
            SetState({ room: message.room, seat: message.seat, matchStarted: true });
            BeginDirectMatch(transport, message);
            PushMatchContext(message.room);
            break;

        case 'match-started':
            SetState({ room: message.room, seat: message.seat, matchStarted: true });
            // Hands the board over to the socket. Until this existed, pressing Start
            // did everything on the server and nothing the player could see.
            BeginOnlineMatch(transport, message.seat, {
                fogOfWar: !!(message.room && message.room.fogOfWar),
                isHost: !!(message.room && message.room.isHost),
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
            // The server restarted, or the network went. Either way the match this
            // client was drawing does not exist any more, so hand the board back and
            // put them somewhere real rather than leaving them on a frozen board with
            // no way to act. Burn's case: the host refreshing takes the server's rooms
            // with it, and the guest was left stranded.
            // A DIRECT match survives this: the server going away is exactly the case it
            // was built for, and the data channel does not care. Only the lobby is lost.
            if (state.matchStarted && !GetDirectTransport()) LeaveOnlineMatch();
            if (GetDirectTransport()) {
                Notify('Lost the lobby, but your match is direct and continues.', 'warn');
                SetState({ status: 'offline', rooms: [] });
                break;
            }
            SetState({ status: 'offline', room: null, seat: null, matchStarted: false,
                       error: 'Lost connection to the server.' });
            ClearMatchContext();
            Notify('Lost connection to the server.', 'error');
            ShowMenuAtRoot();
            break;

        case 'match-ended':
            LeaveOnlineMatch();
            EndDirectMatch();
            ClearMatchContext();

            // Where the player lands depends on whose absence ended it, because the room
            // belongs to its host. A host who did not return takes the room with them, so
            // the guest goes back to the list; a guest who did not return leaves the room
            // standing, so the host waits in it for somebody new.
            if (message.returnTo === 'room' && message.room) {
                SetState({
                    room: message.room,
                    seat: message.seat !== undefined ? message.seat : state.seat,
                    matchStarted: false,
                });
                Notify('Your opponent did not return. Waiting for another player.', 'warn');
            } else {
                SetState({
                    room: null,
                    seat: null,
                    matchStarted: false,
                    rooms: message.rooms || state.rooms,
                });
                Notify(message.reason === 'host_gone'
                    ? 'The host did not return - the room closed.'
                    : 'The match ended.', 'warn');
                if (transport) transport.ListRooms();
            }

            // Straight to the screen they belong on. MenuApp's rule only moves between
            // 'lobby' and 'room', so opening on 'root' with a room in hand would leave
            // them on the root menu wondering where their room went.
            ShowMenuAt(message.returnTo === 'room' ? 'room' : 'lobby');
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
        case 'build_not_recognised':
                                  return 'This build is not one the server recognises. Direct play still works.';
        default:                  return 'Something went wrong (' + code + ').';
    }
}

export function ClearError() {
    SetState({ error: null });
}

// === B2: can this network host a direct match? ===
//
// Asked once, lazily, the first time a screen needs the answer - the probe opens real
// peer connections against two STUN servers and takes a second or two, which is fine
// to spend when opening Create Room and not fine to spend on every page load.
//
// The result is deliberately not treated as a failure when it says no. "Your network
// will not do this" is an ordinary fact about a lot of connections - Burn's own is
// CGNAT and is exactly the case it exists to catch - so it downgrades an option with
// a reason attached rather than raising an error.
let probePromise = null;

export function EnsureDirectProbe() {
    if (!probePromise) {
        SetState({ direct: { verdict: 'probing', detail: 'Checking your network…', ok: false } });
        probePromise = ProbeDirect()
            .then(result => { SetState({ direct: result }); return result; })
            .catch(() => {
                const failed = { ok: false, verdict: 'blocked', detail: 'Could not test this network.' };
                SetState({ direct: failed });
                return failed;
            });
    }
    return probePromise;
}
