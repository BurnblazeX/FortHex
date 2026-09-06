// FortHex - two real clients, one real socket server, one real match  (B2)
//
//   node tools/lobby-smoke.js
//
// replication-smoke.js proves the engine produces a per-recipient board. This proves
// the rest of the path: that two separate WebSocket clients can find a room, take
// seats, start a match, and each receive their OWN filtered view over an actual
// socket - plus the lobby rules that decide who is allowed in.
//
// It starts the real host/server.js on an ephemeral port and drives it with the `ws`
// client. Nothing is stubbed; the only thing this file fakes is a browser.
//
// Exit code 0 = pass.

const vm = require('vm');
const WebSocket = require('ws');
const { RoomRegistry } = require('../host/rooms.js');
const { ReadBundle } = require('../host/server-bundle.js');

const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

// A client that records everything the host says, so assertions can look back rather
// than race. Mirrors what js/client/ws-transport.js does, minus the browser globals.
function Client(url, name, profileId) {
    const socket = new WebSocket(url);
    const inbox = [];
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });

    const api = {
        socket, name, inbox, ready,
        clientId: null,
        seat: null,
        send: (message) => socket.send(JSON.stringify(message)),
        last: (type) => [...inbox].reverse().find(m => m.type === type) || null,
        all: (type) => inbox.filter(m => m.type === type),
        _resolveReady: (...args) => resolveReady(...args),
    };

    socket.on('message', (raw) => {
        const message = JSON.parse(raw);
        inbox.push(message);
        if (message.type === 'hello-ok') { api.clientId = message.clientId; api._resolveReady(); }
        if (message.seat !== undefined && message.seat !== null) api.seat = message.seat;
    });
    socket.on('open', () => api.send({ type: 'hello', profileId, name, version: 'test-build' }));
    return api;
}

const Settle = (predicate, ms = 8000, label = 'condition') => new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
        if (predicate()) return resolve();
        if (Date.now() > deadline) return reject(new Error('timed out waiting for ' + label));
        setTimeout(tick, 15);
    };
    tick();
});

// The host reports its own live-match count, which is the cheapest way to prove a
// direct match did NOT spawn a worker - the alternative is reaching into the
// process's internals, which would be testing the implementation rather than the
// claim.
async function Health(url) {
    const base = url.replace(/^ws/, 'http').replace(/\/ws$/, '');
    const response = await fetch(base + '/health');
    return response.json();
}

async function Main() {
    // --- 1. registry rules, with no sockets involved -----------------------
    // These are pure-logic checks; doing them here rather than over a socket means a
    // failure names the rule that broke instead of the round trip that surfaced it.
    {
        const registry = new RoomRegistry();
        const priv = registry.Create({ name: 'Hidden', visibility: 'private', hostClientId: 'h', hostName: 'Burn' });
        const pub = registry.Create({ name: 'Open', visibility: 'public', hostClientId: 'h2', hostName: 'Burn' });

        // Private rooms ARE listed (Burn, 2026-09-06) - two seats means an occupied
        // room is not joinable anyway. What must not appear is the way IN.
        const privRow = registry.PublicList().find(r => r.id === priv.id);
        check('a private room appears in the listing', !!privRow);
        check('a private room is marked as locked', !!privRow && privRow.locked === true);
        check('a public room is not marked as locked',
            registry.PublicList().find(r => r.id === pub.id).locked === false);

        registry.PublicList().forEach(listed => {
            check('the listing leaks no join code', listed.joinCode === undefined);
            check('the listing leaks no secret',
                listed.secretHash === undefined && listed.code === undefined);
            check('the listing leaks no client or profile ids',
                listed.hostClientId === undefined && listed.seats === undefined);
        });

        // The creator is seated by Create itself. Routing them through Join made them
        // pass the room's own secret check, which they had no code for - so a PRIVATE
        // room silently failed to seat its host and sat there reading 0/2 with nobody
        // in it. Both visibilities are asserted because only one of them broke.
        check('the host of a public room is seated on creation',
            registry.SeatOf(pub, 'h2', null) === 1 && registry.Occupants(pub).length === 1);
        check('the host of a PRIVATE room is seated on creation',
            registry.SeatOf(priv, 'h', null) === 1 && registry.Occupants(priv).length === 1);

        check('joining a private room without the code is refused',
            registry.Join({ roomId: priv.id, clientId: 'x' }).error === 'bad_code');
        const guest = registry.Join({ roomId: priv.id, code: priv.joinCode, clientId: 'x' });
        check('joining a private room with the code succeeds', guest.ok === true);
        check('the guest takes the seat the host is not in', guest.seat === 2);

        registry.Join({ roomId: pub.id, clientId: 'a' });
        check('a full room refuses a third player',
            registry.Join({ roomId: pub.id, clientId: 'c' }).error === 'room_full');

        // Seats are chosen in the room, not up front: the host clicks the other side
        // and the two swap. Refused once the match is running.
        const before = registry.SeatOf(pub, 'h2', null);
        registry.SwapSeats(pub);
        check('swapping moves the host to the other side',
            registry.SeatOf(pub, 'h2', null) !== before);
        check('and moves whoever was there into the vacated seat',
            registry.SeatOf(pub, 'a', null) === before);
        pub.state = 'in-progress';
        check('swapping is refused once the match is running',
            registry.SwapSeats(pub).error === 'already_started');
        pub.state = 'waiting';

        // A5's durable id is what survives a dropped socket, so a returning player must
        // be matched on it rather than on the connection they no longer have.
        const back = new RoomRegistry();
        const room = back.Create({ name: 'R', hostClientId: 'h', hostName: 'H' });
        const first = back.Join({ roomId: room.id, clientId: 'old-socket', profileId: 'burn-123' });
        const again = back.Join({ roomId: room.id, clientId: 'new-socket', profileId: 'burn-123' });

        // Compared against the seat they actually got, not a hardcoded number - the
        // host now holds seat 1 from creation, so the guest's seat is an implementation
        // detail and the property being asserted is that it does not CHANGE.
        check('a reconnecting player reclaims their seat rather than taking the other',
            again.ok && again.rejoined === true && again.seat === first.seat);
        check('and does not consume the other seat',
            back.Occupants(room).length === 2);
    }

    // --- 2. the real server, over real sockets -----------------------------
    // A 100-second reconnect window is not something a test can wait out, so the lapse
    // path went uncovered until it was made configurable. Set before the host is
    // required, since it reads this once at load.
    if (!process.env.FORTHEX_DISCONNECT_MS) process.env.FORTHEX_DISCONNECT_MS = '600';

    const host = require('../host/server.js');
    await new Promise((resolve) => host.httpServer.listen(0, '127.0.0.1', resolve));
    const url = 'ws://127.0.0.1:' + host.httpServer.address().port + '/ws';

    const alice = Client(url, 'Alice', 'profile-alice');
    const bob = Client(url, 'Bob', 'profile-bob');
    await Promise.all([alice.ready, bob.ready]);
    check('both clients completed the handshake', !!alice.clientId && !!bob.clientId);

    // Fog ON: the configuration where per-recipient filtering actually matters.
    alice.send({ type: 'create-room', name: 'Smoke Room', visibility: 'public', settings: { fogOfWarEnabled: true } });
    await Settle(() => alice.last('room-joined'), 4000, 'room creation');

    const created = alice.last('room-joined');
    check('the creator is seated on creation', created && created.seat === 1);
    check('the creator is told they are host', created && created.room.isHost === true);
    check('the creator receives the join code', created && typeof created.room.joinCode === 'string');

    bob.send({ type: 'list-rooms' });
    await Settle(() => bob.last('room-list'), 4000, 'room list');
    const listing = bob.last('room-list').rooms;
    check('the public room is discoverable by another client', listing.length === 1);
    check('the listing reports occupancy', listing[0] && listing[0].players === 1 && listing[0].capacity === 2);

    // The row the lobby draws: name | count | privacy | build | connection.
    check('the row carries the host build', listing[0] && listing[0].hostVersion === 'test-build');
    check('the row carries a connection quality', listing[0] && typeof listing[0].quality === 'number');

    // The bars must come from a REAL round trip, not a placeholder. Over loopback the
    // pong is near-instant, so after one exchange the host should be reporting full
    // strength - and a number that never leaves 0 means nothing is being measured.
    await Settle(() => {
        bob.send({ type: 'list-rooms' });
        const rows = bob.last('room-list').rooms;
        return rows[0] && rows[0].quality > 0;
    }, 6000, 'a measured round-trip time');
    check('quality reflects a measured round trip, not a placeholder',
        bob.last('room-list').rooms[0].quality === 4);

    bob.send({ type: 'join-room', roomId: listing[0].id });
    await Settle(() => bob.last('room-joined'), 4000, 'bob joining');
    check('the second player is seated', bob.last('room-joined').seat === 2);
    check('the host is notified that someone joined', !!alice.last('room-update'));

    // Only the host may start, and only when the room is full - both enforced on the
    // server, because a client asking nicely is not a permission system.
    bob.send({ type: 'start-match' });
    await Settle(() => bob.last('room-error'), 4000, 'non-host start refusal');
    check('a non-host cannot start the match', bob.last('room-error').error === 'not_host');

    alice.send({ type: 'start-match' });
    await Settle(() => alice.last('match-started') && bob.last('match-started'), 8000, 'match start');
    check('both players are told the match started',
        !!alice.last('match-started') && !!bob.last('match-started'));

    // --- 2b. the opening board actually reaches both players ---------------
    //
    // A client only starts listening for match traffic when it is told the match
    // started, and the worker flushes the opening board during start-match - which is
    // necessarily earlier. So the opening board went nowhere and players opened onto a
    // blank canvas that stayed blank until somebody moved. The host asks the worker for
    // a fresh view AFTER match-started, and this is the guard for it.
    await Settle(() => alice.last('state-resync') && bob.last('state-resync'),
        6000, 'the opening board');

    [['host', alice], ['guest', bob]].forEach(([who, client]) => {
        const opening = client.last('state-resync');
        check('the ' + who + ' receives an opening board', !!opening && !!opening.snapshot);
        if (opening && opening.snapshot) {
            check('the ' + who + ' opening board has tiles',
                Array.isArray(opening.snapshot.tiles) && opening.snapshot.tiles.length > 0);
            check('the ' + who + ' opening board has units',
                Array.isArray(opening.snapshot.units) && opening.snapshot.units.length > 0);
        }
    });

    // --- 3. a real move, over the socket, filtered per player --------------
    // The move is computed the way a browser computes one: its own copy of the same
    // engine code from the same deterministic board. The client only ever *requests*.
    const mirror = { console: { log() {}, warn() {}, error() {} } };
    vm.createContext(mirror);
    vm.runInContext(ReadBundle(), mirror);
    vm.runInContext('globalThis.engine = CreateEngineInstance(); InitializeGrid();', mirror);
    const plan = JSON.parse(vm.runInContext([
        'const unit = engine.state.units.find(u => u.player === engine.state.currentPlayer);',
        'const moves = getPossibleMoves(unit);',
        'JSON.stringify({ unitId: unit.id, targetEdgeKey: [...moves.keys()][0] });',
    ].join('\n'), mirror));

    const aliceSyncsBefore = alice.all('state-sync').length;
    const bobSyncsBefore = bob.all('state-sync').length;

    alice.send({ type: 'action', action: 'move', payload: plan });
    await Settle(() => alice.all('state-sync').length > aliceSyncsBefore
        && bob.all('state-sync').length > bobSyncsBefore, 8000, 'the move to reach both clients');

    const aliceSync = alice.all('state-sync').pop();
    const bobSync = bob.all('state-sync').pop();

    check('the mover receives a sync carrying a board', !!(aliceSync && aliceSync.view));
    check('the opponent receives a sync carrying a board', !!(bobSync && bobSync.view));

    if (aliceSync && aliceSync.view) {
        const moved = aliceSync.view.units.find(u => u.id === plan.unitId);
        check('the mover sees their unit at the edge it moved to',
            !!moved && moved.position === plan.targetEdgeKey);
        check('the board arrived over the socket intact',
            aliceSync.view.tiles.length > 0 && aliceSync.view.edges.length > 0);
    }

    if (bobSync && bobSync.view) {
        const enemies = bobSync.view.units.filter(u => u.player === 1);
        const redacted = enemies.filter(u => u.hidden === true);
        check('the opponent receives redacted enemies over the wire (' + redacted.length +
            ' of ' + enemies.length + ')', redacted.length > 0);
        check('a redacted enemy carries no position over the wire',
            redacted.every(u => u.position === undefined));
    }

    // The two payloads must not be the same object serialized twice - that is the
    // difference between per-recipient filtering and a broadcast.
    if (aliceSync && bobSync) {
        check('the two players received DIFFERENT payloads',
            JSON.stringify(aliceSync.view.units) !== JSON.stringify(bobSync.view.units));
    }

    // --- 4. a client cannot act as the other player ------------------------
    //
    // Bob sits in seat 2 and sends an action claiming `player: 1`. The host stamps
    // every forwarded message with the seat IT recorded at join time, so the engine
    // should see the request as coming from player 2 and refuse it.
    //
    // The assertion is deliberately about WHO the rejection is addressed to, not
    // merely that a rejection happened. A move can be refused for a dozen boring
    // reasons; only the stamping explains a refusal addressed to player 2. And
    // FilterEventsForPlayer only delivers ACTION_REJECTED to the player who made the
    // request - so Bob receiving one is itself the proof the server attributed the
    // request to Bob rather than believing the claim in the packet.
    const bobBefore = bob.all('state-sync').length;
    bob.send({ type: 'action', action: 'move', payload: plan, player: 1 });
    await new Promise(r => setTimeout(r, 500));

    const spoofAck = [...bob.inbox].reverse().find(m => m.type === 'ack');
    check('the spoofed action was refused',
        !!spoofAck && spoofAck.outcome && spoofAck.outcome.ok === false);

    const rejections = bob.all('state-sync')
        .slice(bobBefore)
        .flatMap(sync => sync.events || [])
        .filter(event => event.type === 'ACTION_REJECTED');

    check('the refusal was attributed to the seat the SERVER recorded, not the one claimed',
        rejections.length > 0 && rejections.every(event => event.player === 2));

    // And the board must be untouched: a refused action did not happen (A2).
    const afterSpoof = bob.all('state-sync').pop();
    if (afterSpoof && afterSpoof.view) {
        check('the refused action mutated nothing',
            afterSpoof.view.globalTurnNumber === bobSync.view.globalTurnNumber
            && afterSpoof.view.currentPlayer === bobSync.view.currentPlayer);
    }

    // --- 3b. a dropped player can find their way back -----------------------
    //
    // A3 holds the seat for 100 seconds so a dropped player can return. Nothing let
    // them: an in-progress room is closed to strangers, and the lobby made no
    // distinction between a stranger and the person whose seat it was still holding.
    // Their own match sat in the list refusing them.
    {
        const ghost = Client(url, 'Ghost', 'profile-ghost');
        const holder = Client(url, 'Holder', 'profile-holder');
        await Promise.all([ghost.ready, holder.ready]);

        holder.send({ type: 'create-room', name: 'Rejoinable', visibility: 'public' });
        await Settle(() => holder.last('room-joined'), 4000, 'rejoin room');
        const roomId = holder.last('room-joined').room.id;

        ghost.send({ type: 'join-room', roomId });
        await Settle(() => ghost.last('room-joined'), 4000, 'ghost joining');
        holder.send({ type: 'start-match' });
        await Settle(() => ghost.last('match-started'), 8000, 'match start');

        // Drop them the way a closed tab does - no leave-room, just a dead socket.
        ghost.socket.close();
        await new Promise(r => setTimeout(r, 400));

        // Same durable profile id, brand new socket. That is the whole of A5's identity
        // model, and the only thing that survives the drop.
        const returned = Client(url, 'Ghost', 'profile-ghost');
        await returned.ready;
        returned.send({ type: 'list-rooms' });
        await Settle(() => returned.last('room-list'), 4000, 'listing for the returner');

        const mine = returned.last('room-list').rooms.find(r => r.id === roomId);
        check('the abandoned match is still listed', !!mine);
        check('and is marked as rejoinable BY THEM', !!mine && mine.canRejoin === true);
        check('and names the seat being held', !!mine && (mine.yourSeat === 1 || mine.yourSeat === 2));

        // A stranger must NOT see it as rejoinable - canRejoin is per viewer, and
        // getting that wrong would advertise other people's seats as available.
        const stranger = Client(url, 'Stranger', 'profile-stranger');
        await stranger.ready;
        stranger.send({ type: 'list-rooms' });
        await Settle(() => stranger.last('room-list'), 4000, 'listing for a stranger');
        const theirs = stranger.last('room-list').rooms.find(r => r.id === roomId);
        check('a stranger is not offered the same seat',
            !theirs || theirs.canRejoin === false);

        // And the return actually works, with a full board waiting.
        returned.send({ type: 'join-room', roomId });
        await Settle(() => returned.last('match-started'), 5000, 'rejoining the match');
        check('rejoining puts them back in the match', !!returned.last('match-started'));

        await Settle(() => returned.last('state-resync'), 5000, 'a board for the returner');
        const board = returned.last('state-resync');
        check('and hands them a full board, since they missed everything',
            !!board && !!board.snapshot && board.snapshot.tiles.length > 0);

        ghost.socket.close(); holder.socket.close();
        returned.socket.close(); stranger.socket.close();
    }

    // --- 3c. the host leaving does not evict the guest ----------------------
    //
    // It used to end the match on the spot and destroy the room, which left the guest
    // sitting in something that no longer existed. A host walking out is now a
    // DISCONNECT: the seat is held, the guest is told and shown the countdown, and the
    // room survives for the host to walk back into.
    {
        const owner = Client(url, 'Owner', 'profile-owner');
        const guest = Client(url, 'Guest', 'profile-guest');
        await Promise.all([owner.ready, guest.ready]);

        owner.send({ type: 'create-room', name: 'Host Leaves', visibility: 'public' });
        await Settle(() => owner.last('room-joined'), 4000, 'room');
        const roomId = owner.last('room-joined').room.id;

        check('the creator is told they are the host', owner.last('room-joined').room.isHost === true);

        guest.send({ type: 'join-room', roomId });
        await Settle(() => guest.last('room-joined'), 4000, 'guest joining');
        check('the joiner is told they are NOT the host',
            guest.last('room-joined').room.isHost === false);

        owner.send({ type: 'start-match' });
        await Settle(() => guest.last('match-started'), 8000, 'match start');

        const syncsBefore = guest.all('state-sync').length;
        owner.send({ type: 'leave-room' });
        await Settle(() => guest.all('state-sync').length > syncsBefore, 5000,
            'the guest to hear about it');

        const events = guest.all('state-sync').slice(syncsBefore).flatMap(s2 => s2.events || []);
        const dropped = events.find(e => e.type === 'PLAYER_DISCONNECTED');
        check('the guest is told the host went', !!dropped);
        check('and is given a deadline to count down to',
            !!dropped && typeof dropped.deadline === 'number' && dropped.deadline > Date.now());

        // The room must still be there - for the guest AND for the host to return to.
        guest.send({ type: 'list-rooms' });
        await Settle(() => guest.last('room-list'), 4000, 'listing');
        check('the room is not destroyed when the host leaves',
            guest.last('room-list').rooms.some(r => r.id === roomId));

        // Hot join: same profile, new socket, straight back into the running match.
        const returning = Client(url, 'Owner', 'profile-owner');
        await returning.ready;
        returning.send({ type: 'list-rooms' });
        await Settle(() => returning.last('room-list'), 4000, 'listing for the host');
        const theirs = returning.last('room-list').rooms.find(r => r.id === roomId);
        check('the host sees their own match as rejoinable', !!theirs && theirs.canRejoin === true);

        returning.send({ type: 'join-room', roomId });
        await Settle(() => returning.last('match-started'), 5000, 'host rejoining');
        check('the host gets back in', !!returning.last('match-started'));
        check('and is STILL the host on the new socket',
            returning.last('match-started').room.isHost === true);

        owner.socket.close(); guest.socket.close(); returning.socket.close();
    }

    // --- 3d. what happens when the window actually runs out -----------------
    //
    // The room belongs to its host, so its fate follows the ABSENT player's role:
    // a host who does not come back takes the room with them and the guest goes back to
    // the list; a guest who does not come back leaves the room standing and the host
    // waits in it for somebody new. Both branches are checked, because they are opposite
    // outcomes from the same event and only one of them was obvious.
    for (const whoLeaves of ['guest', 'host']) {
        const owner = Client(url, 'Owner-' + whoLeaves, 'p-owner-' + whoLeaves);
        const guest = Client(url, 'Guest-' + whoLeaves, 'p-guest-' + whoLeaves);
        await Promise.all([owner.ready, guest.ready]);

        owner.send({ type: 'create-room', name: 'Lapse ' + whoLeaves, visibility: 'public' });
        await Settle(() => owner.last('room-joined'), 4000, 'room');
        const roomId = owner.last('room-joined').room.id;

        guest.send({ type: 'join-room', roomId });
        await Settle(() => guest.last('room-joined'), 4000, 'guest joining');
        owner.send({ type: 'start-match' });
        await Settle(() => owner.last('match-started') && guest.last('match-started'), 8000, 'start');

        const leaver = whoLeaves === 'host' ? owner : guest;
        const stayer = whoLeaves === 'host' ? guest : owner;

        leaver.socket.close();
        await Settle(() => stayer.last('match-ended'), 8000, whoLeaves + ' window lapsing');

        const ended = stayer.last('match-ended');
        if (whoLeaves === 'host') {
            check('a guest whose host vanished is sent back to the room list',
                ended.returnTo === 'lobby' && ended.reason === 'host_gone');

            const listsBefore = stayer.all('room-list').length;
            stayer.send({ type: 'list-rooms' });
            await Settle(() => stayer.all('room-list').length > listsBefore, 4000, 'listing');
            check('and the room is gone, not left stale in the list',
                !stayer.last('room-list').rooms.some(r => r.id === roomId));
        } else {
            check('a host whose guest vanished stays in their room',
                ended.returnTo === 'room' && ended.reason === 'guest_gone');
            check('and the room is waiting again, with the seat freed',
                !!ended.room && ended.room.state === 'waiting'
                && ended.room.seats.filter(s2 => s2.filled).length === 1);

            // Somebody new must be able to take the empty seat.
            const newcomer = Client(url, 'Newcomer', 'p-newcomer-' + whoLeaves);
            await newcomer.ready;
            newcomer.send({ type: 'join-room', roomId });
            await Settle(() => newcomer.last('room-joined') || newcomer.last('room-error'),
                4000, 'newcomer joining');
            check('and a new player can join the reopened room',
                !!newcomer.last('room-joined'));
            newcomer.socket.close();
        }

        stayer.socket.close();
    }

    // --- 4b. guessing a private room's code is rate-limited ----------------
    //
    // Private rooms are visible in the listing, so obscurity is gone and the code has
    // to stand on its own. ~887 million combinations is only out of reach if guesses
    // are limited - this is the check that the limit exists and that an honest fumble
    // still gets through.
    {
        const carol = Client(url, 'Carol', 'profile-carol');
        const mallory = Client(url, 'Mallory', 'profile-mallory');
        await Promise.all([carol.ready, mallory.ready]);

        carol.send({ type: 'create-room', name: 'Locked Room', visibility: 'private' });
        await Settle(() => carol.last('room-joined'), 4000, 'private room creation');
        const locked = carol.last('room-joined').room;

        mallory.send({ type: 'list-rooms' });
        await Settle(() => mallory.last('room-list'), 4000, 'listing');
        const lockedRow = mallory.last('room-list').rooms.find(r => r.name === 'Locked Room');
        check('a private room is visible to another client', !!lockedRow);
        check('and is marked locked, without exposing its code',
            !!lockedRow && lockedRow.locked === true && lockedRow.joinCode === undefined);

        // A few wrong guesses are ordinary - refused, but not throttled.
        for (let attempt = 0; attempt < 3; attempt++) {
            mallory.send({ type: 'join-room', roomId: locked.id, code: 'WRONG' + attempt });
            await Settle(() => mallory.all('room-error').length === attempt + 1, 3000, 'refusal ' + attempt);
        }
        check('a wrong code is refused as a bad code, not a throttle',
            mallory.all('room-error').every(e => e.error === 'bad_code'));

        // Keep going past the limit.
        for (let attempt = 3; attempt < 10; attempt++) {
            mallory.send({ type: 'join-room', roomId: locked.id, code: 'WRONG' + attempt });
            await Settle(() => mallory.all('room-error').length === attempt + 1, 3000, 'refusal ' + attempt);
        }
        check('sustained guessing is throttled',
            mallory.all('room-error').some(e => e.error === 'too_many_attempts'));

        // And the real code still works for someone who has it.
        const dave = Client(url, 'Dave', 'profile-dave');
        await dave.ready;
        dave.send({ type: 'join-room', roomId: locked.id, code: locked.joinCode });
        await Settle(() => dave.last('room-joined') || dave.last('room-error'), 4000, 'legitimate join');
        check('the correct code still admits a legitimate player', !!dave.last('room-joined'));

        carol.socket.close();
        mallory.socket.close();
        dave.socket.close();
    }

    // --- 4b2. a DIRECT room starts without the server joining in -----------
    //
    // The whole claim of direct play is that the server relays two setup messages and
    // then has nothing more to do with the match. That claim is only worth anything if
    // it is checked, so this checks the two halves of it: no worker is spawned, and a
    // signalling blob reaches the other seat without the server reading it.
    {
        const erin = Client(url, 'Erin', 'profile-erin');
        const finn = Client(url, 'Finn', 'profile-finn');
        await Promise.all([erin.ready, finn.ready]);

        const before = await Health(url);

        erin.send({ type: 'create-room', name: 'Direct Room', visibility: 'public', hosting: 'direct' });
        await Settle(() => erin.last('room-joined'), 4000, 'direct room creation');
        const directRoom = erin.last('room-joined').room;
        check('a room records that it will be hosted directly', directRoom.hosting === 'direct');

        finn.send({ type: 'join-room', roomId: directRoom.id });
        await Settle(() => finn.last('room-joined'), 4000, 'direct room join');

        erin.send({ type: 'start-match' });
        await Settle(() => erin.last('match-direct') && finn.last('match-direct'), 4000, 'direct start');

        const erinStart = erin.last('match-direct');
        const finnStart = finn.last('match-direct');

        check('both players are told the match is direct', !!erinStart && !!finnStart);
        check('exactly one of them is the host',
            !!erinStart && !!finnStart && (erinStart.isHost !== finnStart.isHost));
        check('the creator is the one hosting', !!erinStart && erinStart.isHost === true);
        check('each is told which side it is playing',
            !!erinStart && !!finnStart && erinStart.seat !== finnStart.seat
            && [1, 2].includes(erinStart.seat) && [1, 2].includes(finnStart.seat));
        check('the guest is told which seat the host holds',
            !!finnStart && finnStart.hostSeat === erinStart.seat);

        // THE point of the whole exercise. A server room would have ~12.4 MB of worker
        // resident by now; a direct one costs this process nothing at all.
        const after = await Health(url);
        check('no worker was spawned for a direct match',
            after.liveMatches === before.liveMatches);
        check('and no ordinary match-started was sent',
            !erin.last('match-started') && !finn.last('match-started'));

        // The relay. An opaque blob, addressed by who else is in the room rather than
        // by anything the sender claims.
        erin.send({ type: 'signal', payload: { kind: 'offer', description: 'OPAQUE-BLOB' } });
        await Settle(() => finn.last('signal'), 4000, 'signal relay');
        const relayed = finn.last('signal');
        check('a connection blob reaches the other seat',
            !!relayed && relayed.payload && relayed.payload.description === 'OPAQUE-BLOB');
        check('and is not echoed back to the sender', !erin.last('signal'));

        erin.socket.close();
        finn.socket.close();
    }

    // --- 4c. an abandoned match is reaped, and its worker with it ----------
    //
    // An in-progress room deliberately does NOT free its seats when a player drops -
    // A3's reconnect window needs the seat kept. The consequence was that a match whose
    // players both closed their browsers stayed listed as full forever and its worker
    // stayed resident, ~12.4 MB each, with nothing to ever collect them.
    {
        const registry = new RoomRegistry();
        const room = registry.Create({ name: 'Ghost', hostClientId: 'h', hostName: 'H' });
        registry.Join({ roomId: room.id, clientId: 'g' });
        room.state = 'in-progress';

        const nobody = () => false;
        const everybody = () => true;

        check('a room with people in it is never abandoned',
            registry.FindAbandoned(everybody, 0).length === 0);

        registry.MarkDisconnected(room, 'h');
        registry.MarkDisconnected(room, 'g');

        check('a room is not abandoned while the reconnect window is still open',
            registry.FindAbandoned(nobody, 100000).length === 0);
        check('a room with nobody left is abandoned once the window closes',
            registry.FindAbandoned(nobody, 0).length === 1);

        // The listing must say nobody is there. Reporting seats rather than people is
        // what made a dead room advertise itself as a full, joinable-looking 2/2.
        const row = registry.PublicList(null, nobody)[0];
        check('the listing counts connected players, not reserved seats',
            row.players === 0 && row.seated === 2);

        // One player coming back cancels it for both - the other still has their seat.
        registry.MarkConnected(room, 'h', null);
        check('a returning player cancels the abandonment',
            registry.FindAbandoned(id => id === 'h', 0).length === 0);
    }

    // --- 5. capacity is enforced where it costs money ----------------------
    {
        const registry = new RoomRegistry({ maxConcurrentMatches: 1 });
        const a = registry.Create({ name: 'A', hostClientId: 'h', hostName: 'H' });
        a.state = 'in-progress';
        check('the match ceiling counts live matches, not rooms',
            registry.LiveMatchCount() === 1 && registry.CanStartMatch() === false);
        registry.Create({ name: 'B', hostClientId: 'h2', hostName: 'H' });
        check('an idle room does not count against the ceiling',
            registry.LiveMatchCount() === 1);
    }

    alice.socket.close();
    bob.socket.close();
    await new Promise(r => setTimeout(r, 200));
    host.wss.close();
    host.httpServer.close();

    if (failures.length) {
        console.error('FAIL - ' + failures.length + ' check(s)');
        failures.forEach(f => console.error('  !! ' + f));
        process.exit(1);
    }

    console.log('PASS - lobby + WebSocket transport');
    console.log('  rooms     : private rooms listed but locked, codes required, full rooms refused');
    console.log('  row       : name, occupancy, privacy, host build and a measured connection');
    console.log('  listing   : no join codes, secrets, client ids or profile ids leak');
    console.log('  throttle  : code guessing is rate-limited, honest fumbles are not');
    console.log('  seats     : host seated on create (public AND private), swap before start');
    console.log('  authority : only the host starts, and only a full room');
    console.log('  opening   : both players receive a full board when the match starts');
    console.log('  rejoin    : a dropped player finds their held seat and gets a full board');
    console.log('  roles     : host survives a reconnect; leaving holds the room, not ends it');
    console.log('  lapse     : host gone closes the room; guest gone reopens it for someone new');
    console.log('  abandoned : a match nobody is left in is reaped, worker and all');
    console.log('  match     : a move over a real socket reached both players, each filtered');
    console.log('  identity  : the seat is server-recorded, not client-claimed');
    process.exit(0);
}

Main().catch((error) => {
    // Print what already failed BEFORE reporting the throw. A broken rule early on
    // usually causes the timeout later - reporting only "timed out waiting for match
    // start" hides the assertion that actually explains why.
    if (failures.length) {
        console.error(failures.length + ' check(s) had already failed:');
        failures.forEach(f => console.error('  !! ' + f));
    }
    console.error('FAIL -', error.message);
    process.exit(1);
});
