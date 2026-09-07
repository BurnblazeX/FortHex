// === FortHex host process (B2) ===
//
//   node host/server.js [--port 8080] [--no-static]
//
// One process. It owns the room registry, the worker pool, and every socket. It does
// NOT own game rules - those live in the workers, one per live match, which is the
// only place engine state is ever mutated.
//
// Two kinds of message arrive on a socket and they are handled in completely
// different places, which is the main thing to understand about this file:
//
//   LOBBY   hello, list-rooms, create-room, join-room, leave-room, start-match
//           Handled here. There is no engine yet - a room is not a match.
//
//   MATCH   connect, action, disconnect  (A1's four shapes)
//           Forwarded verbatim to the room's worker. This process does not inspect,
//           validate or rewrite them; SubmitAction inside the worker is the sole
//           authority, exactly as it is for a browser running LocalTransport.
//
// Lobby messages deliberately do NOT route through SubmitAction. It is match-scoped
// and has no meaning before a match exists - "create a room" is not a game action and
// giving it an ACTION_SPEC would make the validation table lie about what it covers.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { WebSocketServer } = require('ws');

const { RoomRegistry } = require('./rooms.js');
const { ComputeBuildHash, ComputeFileHashes, ComputeClientHash } = require('./build-hash.js');
const { BuildWorkerSource } = require('./server-bundle.js');

const ROOT = path.resolve(__dirname, '..');

// The build string lives in js/config-data.js as a plain `const` for the browser, so
// there is nothing to require. Read once at boot rather than duplicating the value
// here, where it would quietly drift out of date.
const BUILD_VERSION = (() => {
    try {
        const source = fs.readFileSync(path.join(ROOT, 'js/config-data.js'), 'utf8');
        const found = source.match(/const\s+BUILD_VERSION\s*=\s*["'`]([^"'`]+)/);
        return found ? found[1] : 'unknown';
    } catch (error) {
        return 'unknown';
    }
})();

// === Which builds may play through this server (B2 anti-cheat) ===
//
// Burn's rule: modding is fine, and it is only online-THROUGH-THE-SERVER that is
// policed. Direct peer-to-peer connections are never checked - play modded with your
// friends - so nothing in this section is reachable from the WebRTC path.
//
// OFF BY DEFAULT, and that is deliberate rather than a stub. The file lists the client
// fingerprints of official releases; with no file, or an empty one, every build is
// accepted and the server says so at boot. An InDev tree changes its fingerprint on
// every edit, so a server that enforced by default would lock its own developer out
// after one keystroke. Enforcement turns on by writing the file, which is a decision
// somebody makes for a release, not a default anybody inherits by accident.
//
// The honest limits of this check are written out in js/client/build-fingerprint.js.
// Short version: it stops a modified client from JOINING, not from cheating, because a
// modified client already cannot cheat - SubmitAction adjudicates inside the worker.
const ACCEPTED_BUILDS = (() => {
    try {
        const raw = fs.readFileSync(path.join(__dirname, 'official-builds.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed.builds || []);
        return list.map(entry => (typeof entry === 'string' ? entry : entry.fingerprint))
                   .filter(Boolean);
    } catch (error) {
        return [];
    }
})();

const ENFORCE_BUILD_CHECK = ACCEPTED_BUILDS.length > 0;

// The fingerprint of the tree THIS server is serving. Always accepted: a client that
// loaded the page from here is by definition running what this server handed out, and
// refusing it would mean a release server rejecting its own build the moment a file
// was touched.
function IsAcceptedBuild(fingerprint) {
    if (!ENFORCE_BUILD_CHECK) return true;
    if (!fingerprint) return false;
    if (fingerprint === ComputeClientHash().hash) return true;
    return ACCEPTED_BUILDS.indexOf(fingerprint) !== -1;
}

function Arg(name, fallback) {
    const index = process.argv.indexOf('--' + name);
    return index === -1 ? fallback : process.argv[index + 1];
}

const PORT = Number(Arg('port', process.env.PORT || 8080));

// The reconnect window, in ms. Undefined means the engine's own 100-second default;
// tests set it to something they can actually wait for.
const DISCONNECT_TIMEOUT_MS_OVERRIDE = process.env.FORTHEX_DISCONNECT_MS
    ? Number(process.env.FORTHEX_DISCONNECT_MS)
    : undefined;
const SERVE_STATIC = !process.argv.includes('--no-static');

const registry = new RoomRegistry();

// clientId -> { socket, profileId, name, roomId }
const clients = new Map();

// roomId -> { worker, roomId }
const matches = new Map();

function Log(...parts) {
    console.log('[host]', ...parts);
}

// --- latency ---------------------------------------------------------------
//
// Real round-trip time, measured with the WebSocket protocol's own ping/pong rather
// than an application-level message. Two reasons: it is answered by the browser's
// socket implementation without waking the page, so it measures the LINK rather than
// how busy the tab is, and it doubles as the dead-connection check - a socket that
// stops ponging is gone whether or not it managed to send a close frame.
//
// The room listing reports the HOST's number. Everyone connects to this process
// independently, so a viewer's own latency is the same for every row and says nothing
// about the rooms; the host's is what generalises when the roadmap's P2P adapter makes
// the host peer the actual server.
const PING_INTERVAL_MS = 5000;

// The listing, annotated for one viewer.
//
// A match in progress is closed to strangers - but not to the player whose seat is
// still being held for them. Without this a disconnected player had nowhere to go: the
// room was still there, their seat was still theirs, and the lobby showed it as an
// in-progress room they were not allowed to enter.
function ListingFor(clientId) {
    const client = clients.get(clientId);
    return registry.PublicList(RttOf, IsConnected).map(row => {
        const room = registry.Get(row.id);
        const seat = room && client
            ? registry.SeatOf(room, clientId, client.profileId)
            : null;
        return { ...row, yourSeat: seat, canRejoin: seat !== null };
    });
}

function IsConnected(clientId) {
    const client = clients.get(clientId);
    return !!(client && client.socket.readyState === client.socket.OPEN);
}

function RttOf(clientId) {
    const client = clients.get(clientId);
    return client && typeof client.rttMs === 'number' ? client.rttMs : null;
}

const pingTimer = setInterval(() => {
    clients.forEach((client) => {
        if (client.socket.readyState !== client.socket.OPEN) return;
        client.pingSentAt = Date.now();
        try { client.socket.ping(); } catch (error) { /* socket died mid-loop */ }
    });
}, PING_INTERVAL_MS);
pingTimer.unref();

// --- static files ----------------------------------------------------------
//
// Serving the game itself is a convenience for LAN testing so the host is useful with
// nothing else installed. In the real deployment Caddy serves the files and this
// process only terminates WebSockets - hence --no-static.

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.map': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
};

// === Security headers (2026-09-07) ===
//
// These lived in host/Caddyfile while Caddy was the origin. It is not in the path any
// more - host/server.js serves the static site and /ws on one port and the tunnel points
// straight at it - so the policy moved here, where it is actually applied.
//
// It is STRICTER than the Caddy version was. That one granted script-src 'unsafe-inline';
// this build has zero inline <script> blocks and zero inline on* handlers, so the grant
// was never needed and it is the single most valuable thing a CSP withholds. Verified by
// counting, not assumed - if an inline script is ever added, it will fail loudly in the
// console rather than silently weakening this.
//
// What each exception is actually for:
//   style-src   'unsafe-inline'       196 inline style attributes. Removing those is
//                                     Candidates F2 work, not a header change. Tailwind
//                                     used to need this too and no longer exists here.
//   style/font  fonts.googleapis.com / fonts.gstatic.com   the Exo 2 + Lexend Deca pair
//   connect-src wss://forthex.xyz     the game socket. 'self' covers same-origin wss in
//                                     current browsers, but the hosts are named because
//                                     "current browsers" is doing a lot of work there.
//   worker-src  'self'                js/client/p2p-worker.js, the P2P host's engine
//
// NOT set here: Strict-Transport-Security. Cloudflare terminates TLS and can set it at
// the edge, and HSTS is close to irreversible once a browser has cached it - that is a
// deliberate decision to make in the dashboard, not a side effect of a code change.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' wss://forthex.xyz wss://www.forthex.xyz",
    "worker-src 'self'",
    "manifest-src 'self'",

    // Nothing in this game embeds anything, is embedded by anything, posts a form
    // anywhere, or loads a plugin. Each of these closes a door rather than narrowing one.
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    // A .js served as text/plain is still executed if something can make the browser
    // guess. This stops the guessing.
    'X-Content-Type-Options': 'nosniff',
    // frame-ancestors covers this for anything modern; kept for browsers that do not
    // implement it.
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    // The game asks for none of these. Saying so is cheaper than auditing later whether
    // some dependency started asking.
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
};

function WithSecurity(headers = {}) {
    return { ...SECURITY_HEADERS, ...headers };
}

function ServeStatic(request, response) {
    const url = new URL(request.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';

    // Contained to the repo: resolve, then confirm the result is still inside ROOT.
    // A path check on the raw string is what lets "..%2f.." through.
    const target = path.resolve(ROOT, '.' + rel);
    if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
        response.writeHead(403, WithSecurity()).end('Forbidden');
        return;
    }

    fs.readFile(target, (error, data) => {
        if (error) {
            response.writeHead(404, WithSecurity()).end('Not found');
            return;
        }
        response.writeHead(200, WithSecurity({
            'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',

            // Never cache. This server exists for development, and a cached
            // dist/ui-bundle.js or js/client/ws-transport.js means editing the game and
            // reloading shows you the previous build - which looks exactly like a bug
            // in the code you just changed, and cost an afternoon proving otherwise.
            // The real deployment is Caddy, which sets its own sensible caching.
            'Cache-Control': 'no-store, must-revalidate',
            'Pragma': 'no-cache',
        }));
        response.end(data);
    });
}

const httpServer = http.createServer((request, response) => {
    // The source fingerprint, so a tester can tell whether the page in front of them is
    // the same build as five minutes ago. Recomputed per request but cached on mtime,
    // so an unchanged tree costs one stat per file.
    if (request.url === '/build' || request.url.startsWith('/build?')) {
        const build = ComputeBuildHash();
        const wantFiles = request.url.includes('files=1');
        response.writeHead(200, WithSecurity({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }));
        response.end(JSON.stringify({
            hash: build.hash,
            version: BUILD_VERSION,
            files: build.files,
            newestMtime: build.newestMtime,
            fileHashes: wantFiles ? ComputeFileHashes() : undefined,
        }));
        return;
    }

    if (request.url === '/health') {
        response.writeHead(200, WithSecurity({ 'Content-Type': 'application/json' }));
        response.end(JSON.stringify({
            ok: true,
            rooms: registry.rooms.size,
            liveMatches: registry.LiveMatchCount(),
            clients: clients.size,
            build: BUILD_VERSION,
            buildHash: ComputeBuildHash().hash,
        }));
        return;
    }
    if (!SERVE_STATIC) {
        response.writeHead(404, WithSecurity()).end('Not found');
        return;
    }
    ServeStatic(request, response);
});

// --- sockets ---------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function Send(clientId, message) {
    const client = clients.get(clientId);
    if (!client || client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(JSON.stringify(message));
}

function SendRaw(clientId, encoded) {
    const client = clients.get(clientId);
    if (!client || client.socket.readyState !== client.socket.OPEN) return;
    client.socket.send(encoded);
}

function Fail(clientId, error, detail) {
    Send(clientId, { type: 'room-error', error, detail: detail || null });
}

// Everyone seated in a room, so a join or a leave updates both players' lobby view.
function BroadcastRoom(room) {
    registry.Occupants(room).forEach(occupant => {
        Send(occupant.clientId, { type: 'room-update', room: registry.RoomView(room, occupant.clientId, occupant.profileId) });
    });
}

wss.on('connection', (socket) => {
    const clientId = crypto.randomUUID();
    clients.set(clientId, {
        socket, profileId: null, name: 'Player', version: null,
        roomId: null, joinFailures: [], rttMs: null, pingSentAt: null,
    });

    socket.on('pong', () => {
        const client = clients.get(clientId);
        if (!client || !client.pingSentAt) return;
        const sample = Date.now() - client.pingSentAt;
        // Smoothed, not last-sample: one slow pong from a garbage-collecting browser
        // should not drop a room from four bars to one for five seconds.
        client.rttMs = client.rttMs === null ? sample : Math.round(client.rttMs * 0.7 + sample * 0.3);
    });

    socket.on('message', (raw) => {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (error) {
            Fail(clientId, 'bad_json');
            return;
        }
        try {
            Route(clientId, message);
        } catch (error) {
            Log('handler error:', error.message);
            Fail(clientId, 'internal_error', error.message);
        }
    });

    socket.on('close', () => HandleSocketClose(clientId));

    // Ping straight away rather than waiting for the first interval tick: a room
    // created in the next second would otherwise advertise "not measured" bars for
    // five seconds, which reads as a bad connection rather than an unknown one.
    const fresh = clients.get(clientId);
    fresh.pingSentAt = Date.now();
    try { socket.ping(); } catch (error) { /* nothing to measure if it is already gone */ }

    Send(clientId, { type: 'welcome', clientId });
});

// --- routing ---------------------------------------------------------------

const MATCH_MESSAGES = new Set(['connect', 'action', 'disconnect']);

function Route(clientId, message) {
    if (MATCH_MESSAGES.has(message.type)) return ForwardToMatch(clientId, message);

    switch (message.type) {
        case 'hello':        return HandleHello(clientId, message);
        case 'list-rooms':   return Send(clientId, { type: 'room-list', rooms: ListingFor(clientId) });
        case 'create-room':  return HandleCreateRoom(clientId, message);
        case 'join-room':    return HandleJoinRoom(clientId, message);
        case 'leave-room':   return HandleLeaveRoom(clientId);
        case 'swap-seats':   return HandleSwapSeats(clientId);
        case 'start-match':  return HandleStartMatch(clientId);
        case 'signal':       return HandleSignal(clientId, message);
        default:
            return Fail(clientId, 'unknown_message', message.type);
    }
}

function HandleHello(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;

    // A5's durable id. It is what lets a reconnecting player be recognised as the
    // same person on a new socket, and it is the only identity this process has -
    // there is no authentication here by design.
    client.profileId = message.profileId || null;
    client.name = String(message.name || 'Player').slice(0, 24);
    client.version = message.version ? String(message.version).slice(0, 24) : null;

    // B2 anti-cheat. Recorded here and consulted when a room is created or joined,
    // rather than closing the socket outright: a player on an unrecognised build should
    // still reach the lobby and be TOLD why they cannot play, instead of watching the
    // connection drop with nothing said.
    client.fingerprint = message.fingerprint ? String(message.fingerprint).slice(0, 64) : null;
    client.buildOk = IsAcceptedBuild(client.fingerprint);
    if (!client.buildOk) {
        Log('unrecognised build from client', clientId, '-', client.fingerprint || '(none sent)');
    }

    Send(clientId, {
        type: 'hello-ok',
        clientId,
        rooms: ListingFor(clientId),
        buildAccepted: client.buildOk,
        buildEnforced: ENFORCE_BUILD_CHECK,
    });
}

// === Brokering a DIRECT connection (B2) ===
//
// Two peers cannot start a WebRTC connection without each seeing the other's session
// description first, and they have no way to exchange them until they are connected -
// which is the thing they are trying to arrange. This relays those two blobs and
// nothing else.
//
// It is worth being precise about what this does NOT make the server: a participant.
// The payload is opaque here and never inspected, exactly two of them cross per match,
// and once the channel is open this process can be switched off without the match
// noticing. That is the entire difference between a direct match and a hosted one, and
// it is why the signalling living on the server does not undo it.
//
// A peer that cannot reach the server at all uses the manual code path instead
// (js/client/signalling.js), which needs no relay and no server.
function HandleSignal(clientId, message) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return Fail(clientId, 'not_in_room');

    const room = registry.Get(client.roomId);
    if (!room) return Fail(clientId, 'no_such_room');

    // Addressed by ROOM OCCUPANCY, never by anything the sender says. A client cannot
    // name its recipient, so this cannot be used to push a connection offer at someone
    // who is not sitting across the board from the sender.
    const others = registry.Occupants(room).filter(occupant => occupant.clientId !== clientId);
    if (others.length === 0) return;

    others.forEach(occupant => Send(occupant.clientId, {
        type: 'signal',
        payload: message.payload,
        from: clientId,
    }));
}

function HandleCreateRoom(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;
    if (client.roomId) return Fail(clientId, 'already_in_room');
    if (!client.buildOk) return Fail(clientId, 'build_not_recognised');

    // Create seats the host as part of creating - see host/rooms.js for why that is
    // not a follow-up Join.
    const room = registry.Create({
        name: message.name,
        visibility: message.visibility,
        code: message.code,
        hostClientId: clientId,
        hostName: client.name,
        hostProfileId: client.profileId,
        hostVersion: client.version,
        hosting: message.hosting === 'direct' ? 'direct' : 'server',
        settings: message.settings || {},
    });

    client.roomId = room.id;

    Send(clientId, {
        type: 'room-joined',
        room: registry.RoomView(room, clientId, client.profileId),
        seat: registry.SeatOf(room, clientId, client.profileId),
    });
    Log('room created:', room.name, room.id, '(' + room.visibility + ', code ' + room.joinCode + ')');
}

// Private rooms are visible in the listing (Burn's call - with two seats, a room
// someone is in is not joinable anyway). That trades away obscurity, so the code has
// to stand on its own: 6 characters from a 31-symbol alphabet is ~887 million
// combinations, which is only out of reach if guesses are RATE-LIMITED.
//
// Counted per client and only on FAILURE, so an honest player fumbling a code a few
// times is unaffected while a script grinding the space is stopped at 8 tries a
// minute. Cleared on success.
const JOIN_FAILURE_LIMIT = 8;
const JOIN_FAILURE_WINDOW_MS = 60000;

function RecordJoinFailure(client) {
    const now = Date.now();
    client.joinFailures = (client.joinFailures || []).filter(at => now - at < JOIN_FAILURE_WINDOW_MS);
    client.joinFailures.push(now);
    return client.joinFailures.length;
}

function IsJoinThrottled(client) {
    const now = Date.now();
    client.joinFailures = (client.joinFailures || []).filter(at => now - at < JOIN_FAILURE_WINDOW_MS);
    return client.joinFailures.length >= JOIN_FAILURE_LIMIT;
}

function HandleJoinRoom(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;
    if (client.roomId) return Fail(clientId, 'already_in_room');
    if (!client.buildOk) return Fail(clientId, 'build_not_recognised');

    if (IsJoinThrottled(client)) {
        Log('join throttled for client', clientId);
        return Fail(clientId, 'too_many_attempts');
    }

    const result = registry.Join({
        roomId: message.roomId,
        joinCode: message.joinCode,
        code: message.code,
        clientId,
        profileId: client.profileId,
        name: client.name,
    });

    if (!result.ok) {
        // Only a wrong secret counts toward the throttle. A full room or a stale room
        // id is an ordinary miss and says nothing about the code.
        if (result.error === 'bad_code') RecordJoinFailure(client);
        return Fail(clientId, result.error);
    }

    client.joinFailures = [];
    client.roomId = result.room.id;
    // A returning player reclaims a seat that was flagged empty; clearing the flag is
    // what stops the abandonment sweep counting them as gone.
    if (result.rejoined) registry.MarkConnected(result.room, clientId, client.profileId);

    // Walking back into a match that is still running: tell the engine the player is
    // back (which stops the countdown for everyone) and push them a full board, since
    // they have missed everything that happened while they were away.
    const live = matches.get(result.room.id);
    if (live && result.room.state === 'in-progress') {
        live.worker.postMessage({
            kind: 'client-message',
            requestId: clientId + ':reconnect',
            message: { type: 'connect', profileId: client.profileId, player: result.seat },
        });
        Send(clientId, {
            type: 'match-started',
            room: registry.RoomView(result.room, clientId, client.profileId),
            seat: result.seat,
        });
        live.worker.postMessage({ kind: 'resync' });
    }

    Send(clientId, {
        type: 'room-joined',
        room: registry.RoomView(result.room, clientId, client.profileId),
        seat: result.seat,
    });
    BroadcastRoom(result.room);
}

function HandleLeaveRoom(clientId) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return;

    const room = registry.Get(client.roomId);
    const wasLive = !!(room && room.state === 'in-progress');
    const left = registry.Leave(clientId, { deliberate: true });
    client.roomId = null;

    // Walking out of a LIVE match starts the same 100-second window a dropped socket
    // would, rather than ending the match on the spot. Burn's call: someone leaving to
    // play a local game may be back in twenty seconds, and the other player should be
    // watching a countdown, not staring at a room that vanished.
    //
    // It also means the room survives for them to walk back into - the "hot join" case.
    if (wasLive && left && left.seat !== null) {
        const live = matches.get(room.id);
        if (live) {
            live.worker.postMessage({
                kind: 'client-message',
                requestId: clientId + ':left',
                message: { type: 'disconnect', reason: 'player_left', player: left.seat, profileId: client.profileId },
            });
        }
    }

    // The list goes back with the confirmation, so the leaver lands on a lobby that
    // already reflects the seat they just gave up - including being able to walk
    // straight back into the room they just left.
    Send(clientId, { type: 'room-left', rooms: ListingFor(clientId) });

    if (room) {
        BroadcastRoom(room);

        // Deliberately NOT ending the match here any more. The room stays up for the
        // reconnect window so the leaver can come back and the other player can watch
        // the countdown; the abandonment sweep tears it down if nobody returns.
        ReapIfEmpty(room);
    }
    return left;
}

function HandleSwapSeats(clientId) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return Fail(clientId, 'not_in_room');

    const room = registry.Get(client.roomId);
    if (!room) return Fail(clientId, 'no_such_room');
    if (room.hostClientId !== clientId) return Fail(clientId, 'not_host');

    const result = registry.SwapSeats(room);
    if (!result.ok) return Fail(clientId, result.error);

    // Both occupants need telling - their own seat changed, not just the host's.
    BroadcastRoom(room);
}

// --- starting a match ------------------------------------------------------

function HandleStartMatch(clientId) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return Fail(clientId, 'not_in_room');

    const room = registry.Get(client.roomId);
    if (!room) return Fail(clientId, 'no_such_room');
    if (room.hostClientId !== clientId) return Fail(clientId, 'not_host');
    if (room.state === 'in-progress') return Fail(clientId, 'already_started');
    if (!registry.IsReady(room)) return Fail(clientId, 'room_not_full');

    // A direct match costs this process nothing - no worker, no engine, no memory
    // ceiling to check, because the match is about to run in the host player's
    // browser. All this does is tell the two of them to go and find each other.
    if (room.hosting === 'direct') return StartDirectMatch(room);

    // The memory ceiling, enforced at the only moment it can be: a room costs a few
    // hundred bytes, a worker costs ~12.4 MB, and this is where one becomes the other.
    if (!registry.CanStartMatch()) return Fail(clientId, 'server_at_capacity');

    SpawnMatch(room);
}

// The direct case. This process does NOT become a participant - it marks the room
// busy, names who is hosting, and steps back. Everything after this crosses the
// data channel; the only further traffic here is the two signalling blobs, which
// HandleSignal relays without reading.
//
// Consequence worth being explicit about: the host player's browser is now the
// authority, and an authoritative peer can cheat if they modify their client. That
// is accepted policy (Burn, 2026-09-06) - modding is fine off the server - but it
// is the reason ranked play and the Gospel corpus must stay on SERVER rooms only.
// Do not archive a direct match into anything that claims to be a record.
function StartDirectMatch(room) {
    room.state = 'in-progress';
    room.matchId = room.id;

    const hostSeat = registry.SeatOfHost(room);

    registry.Occupants(room).forEach(occupant => {
        const seat = registry.SeatOf(room, occupant.clientId, occupant.profileId);
        const isHost = registry.IsHost(room, occupant.clientId, occupant.profileId);
        Send(occupant.clientId, {
            type: 'match-direct',
            room: registry.RoomView(room, occupant.clientId, occupant.profileId),
            seat,
            isHost,
            hostSeat,
            // Only the host builds a board, and only the host is handed the map to
            // build it from. It is their own upload coming back to them: this process
            // held it between Create and Start and never looked inside.
            map: isHost
                ? {
                    mapName: room.settings.mapName || null,
                    customMap: room.settings.customMap || null,
                    resumeSave: room.settings.resumeSave || null,
                }
                : null,
        });
    });

    Log('direct match starting in room', room.name, '- this process is out of it now');
}

function SpawnMatch(room) {
    const seated = registry.Occupants(room);
    const players = [];
    room.seats.forEach((occupant, seat) => { if (occupant) players.push(seat); });

    const worker = new Worker(BuildWorkerSource(), {
        eval: true,
        workerData: {
            matchId: room.id,
            players,
            settings: {
                fogOfWarEnabled: !!room.settings.fogOfWarEnabled,
                // Shortened by tests; the engine's own 100s default otherwise.
                disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS_OVERRIDE,
            },
        },
    });

    matches.set(room.id, { worker, roomId: room.id });
    room.state = 'in-progress';
    room.matchId = room.id;

    worker.on('message', (m) => HandleWorkerMessage(room, m));
    worker.on('error', (error) => {
        Log('worker error in room', room.id, error.message);
        seated.forEach(o => Send(o.clientId, { type: 'match-error', error: error.message }));
        EndMatch(room);
    });
    worker.on('exit', () => { matches.delete(room.id); });

    // The map the room was created with. A preset is a name the worker resolves
    // itself; a loaded file is the only thing that has to be posted in full.
    worker.postMessage({
        kind: 'start-match',
        mapName: room.settings.mapName || null,
        customMap: room.settings.customMap || null,
        resumeSave: room.settings.resumeSave || null,
    });
    Log('match started in room', room.name, '(' + registry.LiveMatchCount() + ' live)');
}

function HandleWorkerMessage(room, m) {
    switch (m.type) {
        case 'ready':
            break;

        case 'started': {
            registry.Occupants(room).forEach(occupant => {
                Send(occupant.clientId, {
                    type: 'match-started',
                    room: registry.RoomView(room, occupant.clientId, occupant.profileId),
                    seat: registry.SeatOf(room, occupant.clientId, occupant.profileId),
                });
            });

            // Only now is anyone listening for match traffic - match-started is what
            // makes a client subscribe. Asking for the board after that, rather than
            // relying on the flush that already happened during start-match, is what
            // stops players opening onto a blank canvas.
            const started = matches.get(room.id);
            if (started) started.worker.postMessage({ kind: 'resync' });
            break;
        }

        case 'wire': {
            // Already JSON, already addressed. The worker stringifies inside the match
            // that produced it (so an unserializable payload names itself there), and
            // tags each copy with the player it was filtered for - this process only
            // has to find that player's socket and put the bytes on it.
            //
            // A null player is the omniscient stream, which a hosted match never
            // registers. Dropping it is deliberate: forwarding it would hand every
            // client the unfiltered board and undo the per-recipient filtering.
            if (m.player === null || m.player === undefined) return;

            const occupant = room.seats.get(m.player);
            if (occupant) SendRaw(occupant.clientId, m.encoded);
            break;
        }

        case 'ack': {
            const target = m.requestId && String(m.requestId).split(':')[0];
            if (target) Send(target, { type: 'ack', requestId: m.requestId, outcome: m.outcome });
            break;
        }

        case 'resolution-needed': {
            // The window closed. Whoever is left is taken out of the match - the modal
            // asking what to do with it is already on their screen - and the room's fate
            // follows the ABSENT player's role, because the room belongs to its host.
            const absentSeat = m.player;
            const absent = room.seats.get(absentSeat);
            const absentWasHost = absent
                ? registry.IsHost(room, absent.clientId, absent.profileId)
                : false;

            const remaining = registry.Occupants(room)
                .filter(o => o.clientId !== (absent && absent.clientId));

            const match = matches.get(room.id);
            if (match) match.worker.terminate();
            matches.delete(room.id);

            if (absentWasHost) {
                // No host, no room. Whoever is left goes back to the room list.
                remaining.forEach(o => Send(o.clientId, {
                    type: 'match-ended',
                    reason: 'host_gone',
                    returnTo: 'lobby',
                    rooms: ListingFor(o.clientId),
                }));
                remaining.forEach(o => {
                    const client = clients.get(o.clientId);
                    if (client) client.roomId = null;
                });
                registry.Destroy(room.id);
                Log('room closed - the host did not return:', room.name);
            } else {
                // The guest gave up. The host keeps their room; it goes back to waiting
                // so somebody else can take the empty seat.
                room.seats.set(absentSeat, null);
                room.state = 'waiting';
                room.matchId = null;

                remaining.forEach(o => Send(o.clientId, {
                    type: 'match-ended',
                    reason: 'guest_gone',
                    returnTo: 'room',
                    room: registry.RoomView(room, o.clientId, o.profileId),
                    seat: registry.SeatOf(room, o.clientId, o.profileId),
                }));
                Log('room reopened - the guest did not return:', room.name);
            }
            break;
        }

        case 'host-error':
            Log('match error in room', room.id, m.where, m.error);
            break;
    }
}

function ForwardToMatch(clientId, message) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return Fail(clientId, 'not_in_room');

    const match = matches.get(client.roomId);
    if (!match) return Fail(clientId, 'match_not_running');

    const room = registry.Get(client.roomId);
    const seat = registry.SeatOf(room, clientId, client.profileId);
    if (seat === null) return Fail(clientId, 'not_seated');

    // The client does not get to say which player it is. Its seat is what this process
    // recorded when it joined, and that is what goes to the engine - a client that
    // claims `player: 2` while sitting in seat 1 is asking to move someone else's
    // units, and A2's whole model depends on that not being taken at face value.
    const stamped = { ...message, player: seat, profileId: client.profileId };

    match.worker.postMessage({
        kind: 'client-message',
        // Prefixed so the ack can be routed back to the socket that asked.
        requestId: clientId + ':' + (message.requestId || crypto.randomUUID()),
        message: stamped,
    });
}

// --- teardown --------------------------------------------------------------

function HandleSocketClose(clientId) {
    const client = clients.get(clientId);
    if (!client) return;

    const room = client.roomId ? registry.Get(client.roomId) : null;

    if (room && room.state === 'in-progress') {
        const seat = registry.SeatOf(room, clientId, client.profileId);
        const match = matches.get(room.id);

        // A3 owns what happens next: the seat stays occupied, the countdown starts in
        // the engine, and the other player keeps playing until the turn reaches the
        // absent one. Freeing the seat here would let a stranger take the chair of
        // someone with 90 seconds left to come back.
        registry.MarkDisconnected(room, clientId);
        BroadcastRoom(room);

        if (match && seat !== null) {
            match.worker.postMessage({
                kind: 'client-message',
                requestId: clientId + ':disconnect',
                message: { type: 'disconnect', reason: 'socket_closed', player: seat, profileId: client.profileId },
            });
        }
    } else if (room) {
        registry.Leave(clientId);
        BroadcastRoom(room);
        ReapIfEmpty(room);
    }

    clients.delete(clientId);
}

// How long a room may sit with nobody connected before it is torn down. Matched to
// A3's 100-second reconnect window: a player who drops mid-match has exactly that long
// to come back, and the room has to outlive them by at least as much.
const ABANDON_GRACE_MS = 100000;
const ABANDON_SWEEP_MS = 15000;

// Drives every live match's clock. Without this nothing ever looks at a disconnect
// deadline in a hosted match - see the 'tick' case in host/match-worker.js.
const DEADLINE_TICK_MS = 1000;

const deadlineTimer = setInterval(() => {
    matches.forEach(match => {
        try { match.worker.postMessage({ kind: 'tick' }); } catch (error) { /* worker gone */ }
    });
}, DEADLINE_TICK_MS);
deadlineTimer.unref();

const abandonTimer = setInterval(() => {
    registry.FindAbandoned(IsConnected, ABANDON_GRACE_MS).forEach(room => {
        Log('reaping abandoned room:', room.name, '(' + room.state + ')');
        const match = matches.get(room.id);
        if (match) match.worker.terminate();   // ~12.4 MB back
        matches.delete(room.id);
        registry.Destroy(room.id);
    });
}, ABANDON_SWEEP_MS);
abandonTimer.unref();

function ReapIfEmpty(room) {
    if (registry.Occupants(room).length > 0) return;
    if (room.state === 'in-progress') return;
    registry.Destroy(room.id);
    Log('room reaped:', room.name);
}

function EndMatch(room, reason) {
    const match = matches.get(room.id);
    if (match) match.worker.terminate();
    matches.delete(room.id);
    room.state = 'finished';

    // Whoever is still sitting there needs telling. Without this the remaining player
    // was left in a match against a ghost: their opponent had walked out, the worker
    // was gone, and nothing on their screen said so.
    registry.Occupants(room).forEach(occupant => {
        Send(occupant.clientId, { type: 'match-ended', reason: reason || 'ended' });
    });

    // A finished room is not coming back, so free the seats rather than holding them
    // for a reconnect that has nothing to reconnect to. Holding them was what left the
    // room listed, empty and unjoinable, until the process restarted.
    registry.Occupants(room).forEach(occupant => {
        const seat = registry.SeatOf(room, occupant.clientId, occupant.profileId);
        if (seat !== null) room.seats.set(seat, null);
        const client = clients.get(occupant.clientId);
        if (client) client.roomId = null;
    });

    registry.Destroy(room.id);
    Log('room closed:', room.name, '(' + (reason || 'ended') + ')');
}

// --- boot ------------------------------------------------------------------

if (require.main === module) {
    httpServer.listen(PORT, '0.0.0.0', () => {
        Log('listening on http://0.0.0.0:' + PORT + (SERVE_STATIC ? ' (serving ' + ROOT + ')' : ' (sockets only)'));
        Log('websocket endpoint: ws://0.0.0.0:' + PORT + '/ws');

        const build = ComputeBuildHash();
        Log('build ' + BUILD_VERSION + ' - source hash ' + build.hash + ' over ' + build.files + ' files');
        Log(ENFORCE_BUILD_CHECK
            ? 'build check ON - ' + ACCEPTED_BUILDS.length + ' accepted release(s), plus this tree ('
              + ComputeClientHash().hash + ')'
            : 'build check OFF - no host/official-builds.json, every client accepted');
    });
}

module.exports = { httpServer, wss, registry, PORT };
