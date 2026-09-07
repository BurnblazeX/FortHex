// === Room registry (B2) ===
//
// A room is NOT a match. It is a lobby entry: a name, a visibility, and up to two
// seats. The engine - and the ~12.4 MB worker thread that carries it - is not
// created until a match actually starts.
//
// That distinction is the whole reason this file exists separately from the worker
// pool. Measured on the target hardware, a live match costs ~12.4 MB; a room in this
// registry costs a few hundred bytes. Spawning a worker at room-creation time would
// mean an idle lobby full of abandoned rooms consuming memory for games nobody is
// playing, and would drop the concurrent-match ceiling from hundreds to whatever
// people happened to leave lying around.
//
// Deliberately free of sockets, `ws`, and Node's http module: everything here is
// plain data in and plain data out, so tools/lobby-smoke.js can exercise every rule
// - capacity, private-room secrets, reconnect resolution - without opening a port.

const crypto = require('crypto');

// The game is two-player and its rules are deeply built around that (base camps,
// flags, currentPlayer). A1 asked that the PROTOCOL leave the door open for more
// without the rules pretending to support it, so this is a named constant rather
// than a hardcoded 2 - that is "leave the door open", not "build for it".
const SEATS = [1, 2];

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
const ROOM_CODE_LENGTH = 6;

// === Hot join (Burn, 2026-09-07) ===========================================
//
// How long a disconnected player's seat is theirs and nobody else's. After it, a
// stranger may take the seat over and the match carries on with a new opponent
// instead of dying when somebody's wifi drops.
//
// Why a head start at all, rather than opening the seat the instant it empties: the
// whole of A3 exists to give a dropped player their match back, and a seat that can
// be taken in the first three seconds is not a reconnect window, it is a race. Thirty
// seconds is long enough that walking back in beats being replaced, and it still
// leaves seventy of A3's hundred with the seat genuinely open - the match is alive
// that entire time, which is the only window a takeover could ever happen in. Once
// the hundred lapse the match is torn down (see 'resolution-needed' in
// host/server.js), so there is no "after" to hot join into.
const HOT_JOIN_GRACE_MS = 30000;

function NewRoomCode() {
    const bytes = crypto.randomBytes(ROOM_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    return code;
}

// Secrets are stored hashed and compared in constant time. This is a game room code,
// not a password vault - but a plain === leaks length and prefix through timing, the
// hash keeps the secret out of memory dumps and logs, and both cost nothing here.
function HashSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest();
}

function SecretMatches(hash, candidate) {
    if (!hash) return true;
    if (candidate === undefined || candidate === null) return false;
    const supplied = HashSecret(candidate);
    return supplied.length === hash.length && crypto.timingSafeEqual(supplied, hash);
}

// What board a room is on, in one line, for the listing and the room screen. One
// function so the two cannot describe the same room differently.
function DescribeRoomBoard(room) {
    const settings = room.settings || {};
    if (settings.resumeSave) return settings.resumeSave.label || 'Saved match';
    if (settings.customMap) return settings.customMap.name || 'Custom map';
    return settings.mapName || 'Standard';
}

class RoomRegistry {
    constructor(options = {}) {
        this.rooms = new Map();

        // The ceiling is on LIVE MATCHES, not rooms, because matches are what cost
        // memory. Default is deliberately well under the ~450 the hardware could hold:
        // a limit that is never reached teaches you nothing about what happens when it
        // is, and this one is meant to be raised deliberately.
        this.maxConcurrentMatches = options.maxConcurrentMatches || 50;
    }

    // --- lifecycle ----------------------------------------------------------

    Create({ name, visibility = 'public', code = null, hostClientId, hostName,
             hostProfileId = null, hostVersion = null, hosting = 'server', settings = {} }) {
        const isPrivate = visibility === 'private';

        // Falls back to the host's own name rather than "Untitled room". The client
        // sends this default too; having it here as well means a room created by a
        // future client that forgets to is still named after somebody.
        const who = String(hostName || 'Player').trim() || 'Player';
        const roomName = String(name || '').trim().slice(0, 40) || (who + "'s Room");

        // Every room gets a join code, private or not - it is the room's shareable
        // address ("join ABC123"), separate from whether a secret is required to get
        // in. A private room with no supplied password uses its own code as the
        // secret, which is the "share a code out-of-band" flow B2 describes.
        const joinCode = NewRoomCode();
        const secret = isPrivate ? (code || joinCode) : null;

        const room = {
            id: crypto.randomUUID(),
            name: roomName,
            visibility: isPrivate ? 'private' : 'public',
            joinCode,
            secretHash: secret ? HashSecret(secret) : null,
            hostClientId,

            // Host identity is anchored to the PROFILE, not the socket. A host who drops
            // and comes back arrives on a new clientId; keyed on that alone they would
            // return to their own room as a guest, and nobody would be able to start it.
            hostProfileId: hostProfileId || null,
            hostName: String(hostName || 'Player').slice(0, 24),

            // The build the room's host is running. Recorded per room rather than
            // read from this process because it is the CLIENT build that decides
            // whether two players can understand each other - the host process may
            // be serving files it did not compile.
            hostVersion: hostVersion ? String(hostVersion).slice(0, 24) : null,
            seats: new Map(SEATS.map(seat => [seat, null])),
            state: 'waiting',
            settings: {
                fogOfWarEnabled: !!settings.fogOfWarEnabled,

                // A preset map is a NAME. The worker has config-data.js and looks it
                // up itself, so nothing about the board travels.
                mapName: typeof settings.mapName === 'string' ? settings.mapName.slice(0, 60) : null,

                // A map loaded from a file has no name the other side knows, so this
                // one carries the board. Held as received and handed to the worker
                // unread: the host process does not adjudicate maps any more than it
                // adjudicates moves.
                customMap: settings.customMap || null,

                // A saved match to resume, already migrated by whoever uploaded it.
                // Held and forwarded unread, like customMap: this process does not
                // adjudicate saves any more than it adjudicates moves.
                resumeSave: settings.resumeSave || null,
            },

            // B2. 'server' spawns a worker on this process when the match starts;
            // 'direct' spawns nothing and the two players connect to each other, with
            // this process relaying only the two setup messages. The room itself is
            // identical either way - it is listed, seated and coded the same - because
            // finding an opponent is the same problem regardless of where the match
            // ends up running.
            hosting: hosting === 'direct' ? 'direct' : 'server',
            createdAt: Date.now(),
            matchId: null,
        };

        // The creator is seated HERE rather than by a follow-up Join. Routing them
        // through Join meant passing the room's own secret check - which they had no
        // code for, because they had just invented it - so creating a PRIVATE room
        // silently failed to seat its host and the room sat there reading 0/2.
        //
        // Seat 1 always. Which side the host actually plays is chosen in the room
        // itself by clicking the other seat, not decided up front.
        room.seats.set(SEATS[0], { clientId: hostClientId, profileId: hostProfileId, name: room.hostName });

        this.rooms.set(room.id, room);
        return room;
    }

    Get(roomId) {
        return this.rooms.get(roomId) || null;
    }

    FindByJoinCode(code) {
        if (!code) return null;
        const wanted = String(code).trim().toUpperCase();
        for (const room of this.rooms.values()) {
            if (room.joinCode === wanted) return room;
        }
        return null;
    }

    Destroy(roomId) {
        return this.rooms.delete(roomId);
    }

    // --- joining ------------------------------------------------------------

    // Returns { ok, room, seat } or { ok: false, error }. Every refusal is a named
    // error rather than a thrown exception: a client asking to join a full room is
    // ordinary traffic, not an exceptional condition.
    // `preferSeat` is a REQUEST, not a claim: honoured when that seat is free and
    // quietly ignored when it is not. The host picks a side when creating the room, so
    // whoever joins takes whatever is left rather than the sides being fixed by who
    // arrived first - which is what locked every host to Blue.
    Join({ roomId, joinCode, code, clientId, profileId, name = null, preferSeat = null }) {
        const room = roomId ? this.Get(roomId) : this.FindByJoinCode(joinCode);
        if (!room) return { ok: false, error: 'no_such_room' };

        if (room.state === 'finished') return { ok: false, error: 'room_finished' };

        if (!SecretMatches(room.secretHash, code)) {
            return { ok: false, error: 'bad_code' };
        }

        // Already seated - the same client asking twice, or a reconnect landing before
        // the old socket was reaped. Hand back the seat they already hold rather than
        // consuming the other one.
        const held = this.SeatOf(room, clientId, profileId);
        if (held !== null) return { ok: true, room, seat: held, rejoined: true };

        // Everyone still here is a STRANGER to this room - the two lines above already
        // handed every returning player their own seat back. A running match has no
        // free seats to offer a stranger unless somebody has dropped out of one.
        if (room.state === 'in-progress') return this.HotJoin(room, { clientId, profileId, name });

        const wanted = Number(preferSeat);
        const free = (SEATS.includes(wanted) && room.seats.get(wanted) === null)
            ? wanted
            : SEATS.find(seat => room.seats.get(seat) === null);
        if (free === undefined) return { ok: false, error: 'room_full' };

        room.seats.set(free, { clientId, profileId: profileId || null, name: name || 'Player' });
        return { ok: true, room, seat: free, rejoined: false };
    }

    // Taking over an empty chair in a match that is already running.
    //
    // Reached only from Join, and only for somebody with no seat in this room - which
    // is what makes the private rule below a rule about STRANGERS rather than about
    // everybody.
    HotJoin(room, { clientId, profileId, name, now = Date.now() } = {}) {
        // A private match is closed to strangers, code or no code (Burn, 2026-09-07).
        // The code is how you invite the person you meant to play with; it is not a
        // claim on a seat, and the people who started a private game chose each other.
        // The two of them can still come and go freely - Join returned their held seat
        // before this function was ever called.
        if (room.visibility === 'private') return { ok: false, error: 'private_match' };

        // A DIRECT match runs in the host player's browser and this process is not in
        // it - there is no worker here to hand a newcomer, and the two peers have
        // already finished signalling. Seating someone would put them in a room whose
        // match they have no connection to and no way to get one.
        if (room.hosting === 'direct') return { ok: false, error: 'match_in_progress' };

        const claimable = this.HotJoinSeat(room, now);
        if (claimable.seat === null) {
            // Distinguished on purpose. "Somebody dropped and the seat is still theirs
            // for another twenty seconds" and "both players are sitting right there"
            // are different answers, and a player staring at a room they cannot enter
            // deserves the one that tells them whether waiting will help.
            return { ok: false, error: claimable.openAt !== null ? 'seat_still_held' : 'match_in_progress' };
        }

        room.seats.set(claimable.seat, { clientId, profileId: profileId || null, name: name || 'Player' });
        return { ok: true, room, seat: claimable.seat, hotJoined: true };
    }

    // The seat a stranger could take, and when. `seat` is non-null once a held seat's
    // head start has run out; `openAt` is when the earliest one does, so a lobby can
    // count down to it rather than showing a door that silently unlocks.
    HotJoinSeat(room, now = Date.now()) {
        if (room.state !== 'in-progress') return { seat: null, openAt: null };
        if (room.visibility === 'private') return { seat: null, openAt: null };
        if (room.hosting === 'direct') return { seat: null, openAt: null };

        let openAt = null;
        for (const seat of SEATS) {
            const occupant = room.seats.get(seat);
            if (!occupant || !occupant.disconnectedAt) continue;

            const opens = occupant.disconnectedAt + HOT_JOIN_GRACE_MS;
            if (now >= opens) return { seat, openAt: opens };
            if (openAt === null || opens < openAt) openAt = opens;
        }
        return { seat: null, openAt };
    }

    // Which seat this client holds, if any. profileId is checked as well as
    // clientId because a reconnecting player arrives on a NEW socket - the durable
    // identity A5 gave them is the only thing that survives the drop.
    SeatOf(room, clientId, profileId) {
        for (const seat of SEATS) {
            const occupant = room.seats.get(seat);
            if (!occupant) continue;
            if (occupant.clientId === clientId) return seat;
            if (profileId && occupant.profileId === profileId) return seat;
        }
        return null;
    }

    // Frees whatever seat this client held, in whatever room. Returns the affected
    // room, or null. A player leaving a room mid-match does NOT free the seat - A3's
    // disconnect window owns that decision, and freeing it here would let a stranger
    // take the seat of someone who is about to reconnect.
    // `deliberate` is the difference between "my socket died" and "I clicked Leave",
    // and it decides whether the seat is held.
    //
    // A DISCONNECT holds the seat: A3 gives that player a window to come back, and
    // freeing it would let a stranger take the chair of someone with 90 seconds left.
    //
    // An explicit LEAVE frees it, even mid-match. Refusing to was the bug: the client
    // cleared its own room and the server kept the seat, so the room went on listing
    // the player as present and Leave appeared to do nothing until it was clicked
    // again. Somebody who clicks Leave has told you they are not coming back.
    Leave(clientId, { deliberate = false } = {}) {
        for (const room of this.rooms.values()) {
            const seat = this.SeatOf(room, clientId, null);
            if (seat === null) continue;

            // A match in progress keeps the seat WHETHER OR NOT the leaving was
            // deliberate (Burn, 2026-09-06). Someone who clicks Leave mid-match may be
            // switching to a local game and coming straight back, and the point of the
            // window is that the match survives long enough for that. So both paths
            // become "absent, with a deadline", and the room is only torn down when
            // that deadline passes with nobody left - see FindAbandoned.
            if (room.state === 'in-progress') {
                const occupant = room.seats.get(seat);
                if (occupant && !occupant.disconnectedAt) occupant.disconnectedAt = Date.now();
                return { room, seat, seatFreed: false, held: true };
            }

            // A room that has not started has nothing to hold a seat for.
            room.seats.set(seat, null);
            return { room, seat, seatFreed: true, held: false };
        }
        return null;
    }

    // Swaps whoever is sitting where. Works with one occupant or two, which is what
    // lets a host change their mind after someone has already joined without either
    // player having to leave and come back.
    //
    // Refused once the match is running: seats are the identity the engine has been
    // handed, and moving a player between them mid-match would hand them the other
    // side's units.
    SwapSeats(room) {
        if (room.state !== 'waiting') return { ok: false, error: 'already_started' };

        const [first, second] = SEATS;
        const held = room.seats.get(first);
        room.seats.set(first, room.seats.get(second));
        room.seats.set(second, held);
        return { ok: true };
    }

    // Marks a seat as empty-but-reserved. The occupant stays, so A3's reconnect window
    // still has a seat to give back, but the room now knows nobody is actually there.
    MarkDisconnected(room, clientId) {
        const seat = this.SeatOf(room, clientId, null);
        if (seat === null) return null;
        const occupant = room.seats.get(seat);
        occupant.disconnectedAt = Date.now();
        return seat;
    }

    MarkConnected(room, clientId, profileId) {
        const seat = this.SeatOf(room, clientId, profileId);
        if (seat === null) return null;
        const occupant = room.seats.get(seat);
        occupant.clientId = clientId;
        delete occupant.disconnectedAt;

        // A host who dropped comes back on a NEW socket, and room.hostClientId still
        // named the dead one. Everything that identifies a host by PROFILE followed
        // them home (IsHost, SeatOf, RoomView); everything that compares the socket
        // did not - which meant a reconnected host was refused Start Match and Swap
        // Sides in their own room, and the room listed their latency as unmeasured.
        // Anchoring the socket here, at the one place a return is recorded, fixes all
        // of them at once.
        if (this.IsHost(room, clientId, profileId)) room.hostClientId = clientId;

        return seat;
    }

    // Seats whose player is actually on the end of a live socket. `isConnected` is
    // supplied by the host, since the registry has no sockets of its own.
    ConnectedCount(room, isConnected) {
        return this.Occupants(room).filter(o => !o.disconnectedAt && (!isConnected || isConnected(o.clientId))).length;
    }

    // Rooms nobody is left in. An in-progress room does NOT free its seats when a
    // player drops - A3's reconnect window depends on that - which meant a match whose
    // players both closed their browsers stayed listed as full forever, and its worker
    // stayed resident with it. Nothing reaped them, because the only thing that would
    // have is a deadline checked on a heartbeat that had stopped arriving.
    //
    // `graceMs` is how long every seat must have been empty. A room where somebody is
    // still connected is never abandoned, however long the other player has been gone.
    FindAbandoned(isConnected, graceMs) {
        const now = Date.now();
        const abandoned = [];

        for (const room of this.rooms.values()) {
            const occupants = this.Occupants(room);
            if (occupants.length === 0) { abandoned.push(room); continue; }

            const live = occupants.filter(o => isConnected(o.clientId));
            if (live.length > 0) continue;

            // Everyone is gone. Wait out the grace period from the MOST RECENT
            // departure, so the last player to leave still gets a full window back.
            // Fall back to the room's own age. An occupant who LEFT deliberately has no
            // disconnectedAt - nothing recorded one, because nothing had dropped - so
            // `latest` was 0 and the guard below never fired. That is how a finished
            // match ended up sitting in the list forever, empty and unjoinable, until
            // the host was restarted.
            const latest = occupants.reduce((newest, o) => Math.max(newest, o.disconnectedAt || 0), 0)
                || room.createdAt;
            if (now - latest >= graceMs) abandoned.push(room);
        }

        return abandoned;
    }

    // Host or guest. The distinction matters: only a host may start a match or swap
    // sides, and a guest's client hides the match-level controls entirely.
    IsHost(room, clientId, profileId) {
        if (profileId && room.hostProfileId) return profileId === room.hostProfileId;
        return room.hostClientId === clientId;
    }

    Occupants(room) {
        return SEATS.map(seat => room.seats.get(seat)).filter(Boolean);
    }

    IsReady(room) {
        return this.Occupants(room).length === SEATS.length;
    }

    // Matches this process is actually RUNNING - which is to say, workers. A direct
    // match is in progress too, but it is in progress in somebody's browser and costs
    // this process nothing, so counting it here would let a handful of direct rooms
    // exhaust a ceiling that exists to cap worker memory. That is what this number is
    // for (CanStartMatch below, and the ~12.4 MB per worker it guards), so it counts
    // only what it is guarding.
    LiveMatchCount() {
        let count = 0;
        for (const room of this.rooms.values()) {
            if (room.state === 'in-progress' && room.hosting !== 'direct') count++;
        }
        return count;
    }

    // Called before a worker is spawned. This is where the memory ceiling is actually
    // enforced - the registry is the only thing that knows how many matches are live.
    CanStartMatch() {
        return this.LiveMatchCount() < this.maxConcurrentMatches;
    }

    // --- what a client is allowed to see ------------------------------------

    // The listing. Private rooms ARE included (Burn, 2026-09-06) - with only two seats,
    // a room someone is already in is not joinable anyway, so hiding it buys little.
    // They are marked `locked` so the client can ask for a code, and their join code
    // is of course not in the row.
    //
    // What that trades away is obscurity: a visible private room can have its code
    // guessed at leisure. Obscurity was never the real defence - the code is 6
    // characters from a 31-symbol alphabet (~887 million combinations) - but guessing
    // is only impractical if attempts are LIMITED, which is why failed joins are
    // throttled in host/server.js. Visibility is what makes that throttle load-bearing
    // rather than belt-and-braces.
    //
    // Nothing secret-derived appears here - no secretHash, no joinCode, no clientIds
    // and no profileIds. Building this by picking fields rather than deleting them
    // from a copy means a field added to a room later is invisible by default rather
    // than published by default.
    // `rttOf` is a lookup the host process supplies - the registry has no sockets and
    // therefore no way to know a round-trip time. Passing it in keeps this file
    // testable without a port, which is the rule the whole module is built on.
    PublicList(rttOf = null, isConnected = null) {
        const listing = [];
        for (const room of this.rooms.values()) {
            if (room.state === 'finished') continue;

            const hotJoin = this.HotJoinSeat(room);

            listing.push({
                id: room.id,
                name: room.name,
                hostName: room.hostName,
                hostVersion: room.hostVersion,
                players: this.ConnectedCount(room, isConnected),
                seated: this.Occupants(room).length,
                capacity: SEATS.length,
                state: room.state,
                locked: room.visibility === 'private',
                fogOfWar: !!room.settings.fogOfWarEnabled,
                hosting: room.hosting || 'server',
                mapName: DescribeRoomBoard(room),
                resuming: !!room.settings.resumeSave,
                quality: QualityBars(rttOf ? rttOf(room.hostClientId) : null),

                // A running match with an empty chair in it. Without these two the
                // lobby had no way to tell "closed, both players present" from
                // "somebody dropped and you can take their place", and drew both as
                // the same greyed-out row.
                hotJoin: hotJoin.seat !== null,
                hotJoinAt: hotJoin.openAt,
                createdAt: room.createdAt,
            });
        }
        return listing.sort((a, b) => a.createdAt - b.createdAt);
    }

    // What a member of the room may see. Carries the join code - they are inside, and
    // it is how they invite the other player - but still never the secret hash.
    // Which seat the host is sitting in. A direct match needs it by number rather
    // than by "whoever is host", because the guest has to be told which side it is
    // playing before any connection exists to ask over.
    SeatOfHost(room) {
        let found = null;
        room.seats.forEach((occupant, seat) => {
            // IsHost, not a clientId comparison: a host who reconnects arrives on a new
            // socket with a new clientId, and their profileId is what still identifies
            // them. Comparing sockets would hand the room to nobody.
            if (occupant && this.IsHost(room, occupant.clientId, occupant.profileId)) found = seat;
        });
        return found;
    }

    RoomView(room, forClientId, forProfileId = null) {
        return {
            id: room.id,
            name: room.name,
            visibility: room.visibility,
            joinCode: room.joinCode,
            hostName: room.hostName,
            isHost: this.IsHost(room, forClientId, forProfileId),
            state: room.state,
            fogOfWar: !!room.settings.fogOfWarEnabled,
            hosting: room.hosting || 'server',
            // The name only. A client that needs the board either has the preset
            // already or is the host who loaded the file.
            mapName: DescribeRoomBoard(room),
            // The guest is told they are joining a match in progress, not starting
            // one. It changes what the room means to them.
            resuming: !!room.settings.resumeSave,
            seats: SEATS.map(seat => {
                const occupant = room.seats.get(seat);
                return {
                    seat,
                    filled: !!occupant,
                    you: !!occupant && occupant.clientId === forClientId,
                    // Names are already public via the room listing's hostName, so this
                    // exposes nothing new - it just lets a client say who it is playing.
                    name: occupant ? (occupant.name || 'Player') : null,
                    connected: occupant ? !occupant.disconnectedAt : false,
                };
            }),
        };
    }
}

// Four bars, from a real round-trip time. The thresholds are deliberately generous:
// FortHex is turn-based, so 250ms is perfectly playable and the indicator should say
// so rather than alarming people used to shooters. 0 means "not measured yet" - a
// room created a second ago has no sample, and claiming one bar would be a lie.
function QualityBars(rttMs) {
    if (rttMs === null || rttMs === undefined) return 0;
    if (rttMs < 60) return 4;
    if (rttMs < 140) return 3;
    if (rttMs < 300) return 2;
    return 1;
}

module.exports = { RoomRegistry, SEATS, NewRoomCode, QualityBars, HOT_JOIN_GRACE_MS };
