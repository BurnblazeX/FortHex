// === FortHex host process (B2) ===
//
//   node host/server.js [--port 8080] [--no-static]
//
// One process. It owns the room registry, the worker pool, and every socket. It does
// NOT own game rules — those live in the workers, one per live match, which is the
// only place engine state is ever mutated.
//
// Two kinds of message arrive on a socket and they are handled in completely
// different places, which is the main thing to understand about this file:
//
//   LOBBY   hello, list-rooms, create-room, join-room, leave-room, start-match
//           Handled here. There is no engine yet — a room is not a match.
//
//   MATCH   connect, action, disconnect  (A1's four shapes)
//           Forwarded verbatim to the room's worker. This process does not inspect,
//           validate or rewrite them; SubmitAction inside the worker is the sole
//           authority, exactly as it is for a browser running LocalTransport.
//
// Lobby messages deliberately do NOT route through SubmitAction. It is match-scoped
// and has no meaning before a match exists — "create a room" is not a game action and
// giving it an ACTION_SPEC would make the validation table lie about what it covers.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { WebSocketServer } = require('ws');

const { RoomRegistry } = require('./rooms.js');
const { ComputeBuildHash, ComputeFileHashes } = require('./build-hash.js');
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

function Arg(name, fallback) {
    const index = process.argv.indexOf('--' + name);
    return index === -1 ? fallback : process.argv[index + 1];
}

const PORT = Number(Arg('port', process.env.PORT || 8080));
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
// how busy the tab is, and it doubles as the dead-connection check — a socket that
// stops ponging is gone whether or not it managed to send a close frame.
//
// The room listing reports the HOST's number. Everyone connects to this process
// independently, so a viewer's own latency is the same for every row and says nothing
// about the rooms; the host's is what generalises when the roadmap's P2P adapter makes
// the host peer the actual server.
const PING_INTERVAL_MS = 5000;

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
// process only terminates WebSockets — hence --no-static.

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

function ServeStatic(request, response) {
    const url = new URL(request.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';

    // Contained to the repo: resolve, then confirm the result is still inside ROOT.
    // A path check on the raw string is what lets "..%2f.." through.
    const target = path.resolve(ROOT, '.' + rel);
    if (!target.startsWith(ROOT + path.sep) && target !== ROOT) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(target, (error, data) => {
        if (error) {
            response.writeHead(404).end('Not found');
            return;
        }
        response.writeHead(200, {
            'Content-Type': MIME[path.extname(target)] || 'application/octet-stream',

            // Never cache. This server exists for development, and a cached
            // dist/ui-bundle.js or js/client/ws-transport.js means editing the game and
            // reloading shows you the previous build — which looks exactly like a bug
            // in the code you just changed, and cost an afternoon proving otherwise.
            // The real deployment is Caddy, which sets its own sensible caching.
            'Cache-Control': 'no-store, must-revalidate',
            'Pragma': 'no-cache',
        });
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
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
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
        response.writeHead(200, { 'Content-Type': 'application/json' });
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
        response.writeHead(404).end('Not found');
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
        Send(occupant.clientId, { type: 'room-update', room: registry.RoomView(room, occupant.clientId) });
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
        case 'list-rooms':   return Send(clientId, { type: 'room-list', rooms: registry.PublicList(RttOf, IsConnected) });
        case 'create-room':  return HandleCreateRoom(clientId, message);
        case 'join-room':    return HandleJoinRoom(clientId, message);
        case 'leave-room':   return HandleLeaveRoom(clientId);
        case 'swap-seats':   return HandleSwapSeats(clientId);
        case 'start-match':  return HandleStartMatch(clientId);
        default:
            return Fail(clientId, 'unknown_message', message.type);
    }
}

function HandleHello(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;

    // A5's durable id. It is what lets a reconnecting player be recognised as the
    // same person on a new socket, and it is the only identity this process has —
    // there is no authentication here by design.
    client.profileId = message.profileId || null;
    client.name = String(message.name || 'Player').slice(0, 24);
    client.version = message.version ? String(message.version).slice(0, 24) : null;

    Send(clientId, { type: 'hello-ok', clientId, rooms: registry.PublicList(RttOf, IsConnected) });
}

function HandleCreateRoom(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;
    if (client.roomId) return Fail(clientId, 'already_in_room');

    // Create seats the host as part of creating — see host/rooms.js for why that is
    // not a follow-up Join.
    const room = registry.Create({
        name: message.name,
        visibility: message.visibility,
        code: message.code,
        hostClientId: clientId,
        hostName: client.name,
        hostProfileId: client.profileId,
        hostVersion: client.version,
        settings: message.settings || {},
    });

    client.roomId = room.id;

    Send(clientId, {
        type: 'room-joined',
        room: registry.RoomView(room, clientId),
        seat: registry.SeatOf(room, clientId, client.profileId),
    });
    Log('room created:', room.name, room.id, '(' + room.visibility + ', code ' + room.joinCode + ')');
}

// Private rooms are visible in the listing (Burn's call — with two seats, a room
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

    Send(clientId, {
        type: 'room-joined',
        room: registry.RoomView(result.room, clientId),
        seat: result.seat,
    });
    BroadcastRoom(result.room);
}

function HandleLeaveRoom(clientId) {
    const client = clients.get(clientId);
    if (!client || !client.roomId) return;

    const room = registry.Get(client.roomId);
    const left = registry.Leave(clientId, { deliberate: true });
    client.roomId = null;

    // The list goes back with the confirmation, so the leaver lands on a lobby that
    // already reflects the seat they just gave up — including being able to walk
    // straight back into the room they just left.
    Send(clientId, { type: 'room-left', rooms: registry.PublicList(RttOf, IsConnected) });

    if (room) {
        BroadcastRoom(room);

        // A match somebody walked out of has no second player and nothing to resume.
        // Tearing it down here is also what returns its worker's ~12.4 MB, rather than
        // waiting out the abandonment sweep for a room already known to be finished.
        if (room.state === 'in-progress' && registry.Occupants(room).length < 2) {
            Log('match ended early — a player left:', room.name);
            EndMatch(room, 'opponent_left');
        }
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

    // Both occupants need telling — their own seat changed, not just the host's.
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

    // The memory ceiling, enforced at the only moment it can be: a room costs a few
    // hundred bytes, a worker costs ~12.4 MB, and this is where one becomes the other.
    if (!registry.CanStartMatch()) return Fail(clientId, 'server_at_capacity');

    SpawnMatch(room);
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
            settings: { fogOfWarEnabled: !!room.settings.fogOfWarEnabled },
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

    worker.postMessage({ kind: 'start-match' });
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
                    room: registry.RoomView(room, occupant.clientId),
                    seat: registry.SeatOf(room, occupant.clientId, occupant.profileId),
                });
            });

            // Only now is anyone listening for match traffic — match-started is what
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
            // tags each copy with the player it was filtered for — this process only
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
    // recorded when it joined, and that is what goes to the engine — a client that
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
        Log('build ' + BUILD_VERSION + ' — source hash ' + build.hash + ' over ' + build.files + ' files');
    });
}

module.exports = { httpServer, wss, registry, PORT };
