// === WebRTC transport adapter (B2) ===
//
// The third adapter behind A1's transport interface, and the first one with no server
// in the middle of the GAME traffic. Same two methods as the other two - Send(message)
// and OnMessage(handler) - so js/main.js cannot tell which of the three it holds.
//
// There are two classes here because a direct match has two genuinely different roles,
// which the socket case hid by putting the authority on a third machine:
//
//   RtcHostTransport   owns the match. Spawns js/client/p2p-worker.js, which owns the
//                      one authoritative engine, and relays between it and the guest's
//                      data channel. The host's OWN client is just another remote
//                      client of that worker - see p2p-worker.js for why that is not
//                      an over-complication but the only correct arrangement.
//
//   RtcGuestTransport  a data channel and nothing else. Byte for byte the same job
//                      WebSocketTransport does, over a different pipe.
//
// SIGNALLING IS NOT THIS FILE'S PROBLEM. Both classes take a `signal` object with
// Send(payload) and OnSignal(handler), and never ask where it goes. That is what lets
// the same adapter run brokered through the FortHex server AND through two people
// pasting codes at each other with the server switched off - see js/client/signalling.js.
//
// VANILLA ICE, deliberately. Both sides wait for candidate gathering to finish and send
// ONE complete description, rather than trickling candidates as they appear. Trickle is
// faster and would be the obvious choice for the brokered path - but the manual path
// cannot trickle at all, because a human pasting a code exchanges exactly one message
// in each direction. Two negotiation paths would mean the rarely-used one is the broken
// one, so both wait. The cost is a second or two of setup, once.

const RTC_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];

const RTC_ACK_TIMEOUT_MS = 10000;
const RTC_GATHER_TIMEOUT_MS = 5000;
// How long a connection may take to come up ONCE BOTH SIDES HAVE ANSWERED. It is
// deliberately not a limit on the exchange itself: on the manual path a human is in
// the loop, carrying a code into a chat window and waiting for a reply, and that can
// take as long as it takes. Arming this at the moment the offer was created told a
// host who was patiently waiting that their connection had failed.
const RTC_CONNECT_TIMEOUT_MS = 20000;

// The deadline heartbeat. host/server.js runs the same tick for the same reason: the
// engine cannot speak unprompted, so somebody has to look at the clock, and the player
// who dropped is by definition not sending anything to ride along with.
const RTC_TICK_MS = 1000;

// A description is only worth sending once every candidate is in it. `iceGatheringState`
// can already be 'complete' by the time this is called, so the fast path is checked
// first - waiting for an event that has already fired is a hang, not a delay.
function WaitForIceGathering(connection, timeoutMs = RTC_GATHER_TIMEOUT_MS) {
    if (connection.iceGatheringState === 'complete') return Promise.resolve();

    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            connection.removeEventListener('icegatheringstatechange', check);
            resolve();
        };
        const check = () => { if (connection.iceGatheringState === 'complete') finish(); };

        // Gathering can stall on an unreachable STUN server. Whatever has been
        // collected by now is still worth trying - usually the host candidates, which
        // are all that a same-LAN match needs anyway.
        const timer = setTimeout(finish, timeoutMs);
        connection.addEventListener('icegatheringstatechange', check);
    });
}

// Descriptions travel as one compact token, packed by js/client/signal-codec.js -
// ~120 characters instead of the ~1300 a base64'd SDP costs, which is the difference
// between a code somebody will paste and one they will not.
//
// BOTH paths use it, including the brokered one where length does not matter. A code
// that only gets exercised on the rare manual path is a code nobody finds out is
// broken until the day it is the only thing left working.
function EncodeDescription(description) {
    return PackDescription(description);
}

function DecodeDescription(token) {
    return UnpackDescription(token);
}

// Everything both roles do with a data channel: frame messages, match acks to the
// Send() that is waiting for them, and fan incoming traffic out to subscribers. The
// roles differ in what they do with a message once it has arrived, not in how it
// arrives.
class RtcChannelBase {
    constructor() {
        this.subscribers = new Set();
        this.lobbySubscribers = new Set();
        this.pending = new Map();
        this.nextRequestId = 1;
        this.channel = null;
        this.connection = null;
        this.closed = false;
    }

    OnMessage(handler) {
        this.subscribers.add(handler);
        return () => this.subscribers.delete(handler);
    }

    OnLobbyMessage(handler) {
        this.lobbySubscribers.add(handler);
        return () => this.lobbySubscribers.delete(handler);
    }

    EmitMatch(message) { this.subscribers.forEach(handler => handler(message)); }
    EmitLobby(message) { this.lobbySubscribers.forEach(handler => handler(message)); }

    SendRaw(message) {
        if (!this.channel || this.channel.readyState !== 'open') {
            console.warn('[RTC] dropping message, channel not open:', message.type || message.kind);
            return false;
        }
        this.channel.send(JSON.stringify(message));
        return true;
    }

    // Same contract as WebSocketTransport.Send: a Promise for the ack, which most
    // callers ignore because the authoritative answer was never the return value. It is
    // the state-sync that follows.
    Await(requestId) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                resolve({ ok: null, timedOut: true });
            }, RTC_ACK_TIMEOUT_MS);
            this.pending.set(requestId, { resolve, timer });
        });
    }

    SettleAck(message) {
        const bare = String(message.requestId || '').split(':').pop();
        const waiting = this.pending.get(bare);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        this.pending.delete(bare);
        waiting.resolve(message.outcome);
    }

    RejectAllPending(reason) {
        this.pending.forEach(({ resolve, timer }) => {
            clearTimeout(timer);
            resolve({ ok: false, error: reason });
        });
        this.pending.clear();
    }

    // Present and does nothing, for the same reason WebSocketTransport's does: the
    // engine's queue is drained wherever the engine actually lives, and here that is
    // the worker. HandleActionEvents calls this after any engine function and has no
    // business knowing which transport is underneath. Leaving it undefined threw inside
    // a channel callback, which killed the subscription and froze the board while the
    // client still looked connected. That cost an afternoon once; it is not costing
    // another one.
    Flush() {
        return null;
    }

    Close() {
        this.closed = true;
        this.RejectAllPending('closed');
        try { if (this.channel) this.channel.close(); } catch (error) { /* already gone */ }
        try { if (this.connection) this.connection.close(); } catch (error) { /* already gone */ }
    }
}

// --- host -------------------------------------------------------------------

class RtcHostTransport extends RtcChannelBase {
    // `seats` names which side each peer plays. The host takes hostSeat and the guest
    // is given guestSeat here, ONCE, before any traffic arrives - see StampFromGuest.
    constructor({ signal, hostSeat = 1, guestSeat = 2, matchId, settings = {} } = {}) {
        super();
        this.signal = signal;
        this.hostSeat = hostSeat;
        this.guestSeat = guestSeat;
        this.matchId = matchId || ('p2p-' + Date.now().toString(36));
        this.settings = settings;

        this.worker = null;
        this.tickTimer = null;
        this.connectTimer = null;
        this.seat = hostSeat;
        this.guestPresent = false;
    }

    // Bring up the worker and the peer connection, and settle when the guest is
    // actually on the channel. Resolving earlier would let the caller start a match
    // into a pipe with nobody at the far end.
    Start() {
        this.StartWorker();

        this.connection = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });

        // The host creates the channel; the guest receives it. Someone has to, and the
        // offerer is the conventional choice.
        this.channel = this.connection.createDataChannel('forthex', { ordered: true });
        this.WireChannel();

        this.connection.onconnectionstatechange = () => {
            const state = this.connection.connectionState;
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                this.OnPeerLost(state);
            }
        };

        this.signal.OnSignal((payload) => this.HandleSignal(payload));

        return new Promise((resolve, reject) => {
            // Armed by HandleSignal when the answer arrives, not here. Until then there
            // is nothing being waited on that a clock could judge.
            this.ArmConnectTimeout = () => {
                if (this.connectTimer) return;
                this.connectTimer = setTimeout(
                    () => reject(new Error('the other player never connected')),
                    RTC_CONNECT_TIMEOUT_MS
                );
            };
            const Disarm = () => {
                if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
            };

            this.onChannelOpen = () => { Disarm(); resolve(this); };
            this.onChannelFail = (error) => { Disarm(); reject(error); };

            this.connection.createOffer()
                .then(offer => this.connection.setLocalDescription(offer))
                .then(() => WaitForIceGathering(this.connection))
                .then(() => {
                    this.signal.Send({
                        kind: 'offer',
                        description: EncodeDescription(this.connection.localDescription),
                        matchId: this.matchId,
                        guestSeat: this.guestSeat,
                    });
                })
                .catch(error => { Disarm(); reject(error); });
        });
    }

    HandleSignal(payload) {
        if (!payload || payload.kind !== 'answer') return;

        // The other player has replied, so from here a stall is a real fault rather
        // than someone still typing.
        if (this.ArmConnectTimeout) this.ArmConnectTimeout();

        try {
            const description = DecodeDescription(payload.description);
            this.connection.setRemoteDescription(description).catch((error) => {
                console.error('[RTC] host could not accept the answer:', error);
                if (this.onChannelFail) this.onChannelFail(error);
            });
        } catch (error) {
            console.error('[RTC] unusable answer code:', error.message);
            if (this.onChannelFail) this.onChannelFail(error);
        }
    }

    // --- the worker that owns the match ------------------------------------

    StartWorker() {
        this.worker = new Worker('js/client/p2p-worker.js');
        this.worker.onmessage = (event) => this.HandleWorkerMessage(event.data);
        this.worker.onerror = (event) => {
            console.error('[RTC] match worker error:', event.message);
            this.EmitLobby({ type: 'match-error', error: event.message || 'match worker failed' });
        };

        this.worker.postMessage({
            kind: 'init',
            workerData: {
                matchId: this.matchId,
                players: [this.hostSeat, this.guestSeat],
                settings: this.settings,
            },
        });

        this.tickTimer = setInterval(() => {
            if (this.worker) this.worker.postMessage({ kind: 'tick' });
        }, RTC_TICK_MS);
    }

    HandleWorkerMessage(m) {
        if (!m) return;

        switch (m.type) {
            case 'ready':
                break;

            case 'started':
                // Both peers are told the same thing at the same moment, from the same
                // source. The guest hears it over the channel.
                // Fog travels with this. It is the HOST's setting - the guest has no way to
                // know it and must not assume: assuming false draws an unfogged board over a
                // fogged match, and assuming true fogs a match that has none. On the brokered
                // path the server knows and says so; here the host is the only one who can.
                this.SendRaw({
                    type: 'match-started',
                    matchId: m.matchId,
                    seat: this.guestSeat,
                    fogOfWar: !!this.settings.fogOfWarEnabled,
                    // Same reasoning as fog: the guest's own engine computes legal
                    // moves, so it has to know the pools this match runs on or it
                    // will disagree with the host about how far a unit can go.
                    unitSpeedPreset: this.settings.unitSpeedPreset || null,
                });
                this.EmitLobby({ type: 'match-started', matchId: m.matchId, seat: this.hostSeat });
                this.worker.postMessage({ kind: 'resync' });
                break;

            case 'wire': {
                // Already JSON - the worker stringifies inside the match that produced
                // it, so anything unserializable names itself there rather than
                // arriving empty here.
                if (m.player === this.guestSeat) {
                    if (this.channel && this.channel.readyState === 'open') this.channel.send(m.encoded);
                    return;
                }
                let message;
                try {
                    message = JSON.parse(m.encoded);
                } catch (error) {
                    console.error('[RTC] host could not parse its own worker output:', error);
                    return;
                }
                this.EmitMatch(message);
                break;
            }

            case 'ack': {
                // Prefixed at the point it was forwarded, so the prefix says whose it
                // is. A guest's ack goes back down the channel; the host's settles a
                // local promise.
                const requestId = String(m.requestId || '');
                if (requestId.startsWith('guest:')) {
                    this.SendRaw({ type: 'ack', requestId: requestId.slice('guest:'.length), outcome: m.outcome });
                    return;
                }
                this.SettleAck({ requestId, outcome: m.outcome });
                break;
            }

            case 'resolution-needed':
                // A P2P room has no third party to decide its fate, so this is
                // surfaced to the host's own UI and nothing else.
                this.EmitLobby({ type: 'resolution-needed', player: m.player });
                break;

            case 'host-error':
                console.error('[RTC] match worker:', m.where, m.error, m.stack || '');
                break;

            default:
                break;
        }
    }

    // --- the A1 interface ---------------------------------------------------

    // The HOST's own actions. They go to the worker exactly as the guest's do, stamped
    // with the host's seat, and come back as a filtered view like anyone else's. This
    // is what stops the host being a special case with a private view of the board.
    Send(message) {
        const requestId = 'r' + (this.nextRequestId++);
        if (!this.worker) return Promise.resolve({ ok: false, error: 'no_match' });

        this.worker.postMessage({
            kind: 'client-message',
            requestId,
            message: { ...message, player: this.hostSeat },
        });
        return this.Await(requestId);
    }

    // Same envelope host/server.js posts to its own worker, because the worker is the
    // same driver. A preset map is a name the worker looks up; a map loaded from a file
    // is the only thing that has to be carried whole.
    StartMatch(options = {}) {
        if (!this.worker) return;
        this.worker.postMessage({
            kind: 'start-match',
            mapName: options.mapName || null,
            customMap: options.customMap || null,
            resumeSave: options.resumeSave || null,
        });
    }

    // --- the guest's traffic ------------------------------------------------

    WireChannel() {
        this.channel.onopen = () => {
            this.guestPresent = true;
            if (this.onChannelOpen) this.onChannelOpen();
        };
        this.channel.onclose = () => this.OnPeerLost('closed');
        this.channel.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                console.error('[RTC] unparseable message from the other player:', error);
                return;
            }
            this.StampFromGuest(message);
        };
    }

    // THE TRUST BOUNDARY, and the reason this is a named function rather than three
    // lines inline. The guest does not get to say which player it is. Its seat is what
    // this host recorded when the connection was made, and that is what reaches the
    // engine - a peer that sends `player: 1` while sitting in seat 2 is asking to move
    // the host's army, and A2's entire model rests on that not being taken at face
    // value. host/server.js stamps the same way, at ForwardToMatch, for the same reason.
    StampFromGuest(message) {
        if (!this.worker) return;

        this.worker.postMessage({
            kind: 'client-message',
            requestId: 'guest:' + (message.requestId || ('g' + Date.now().toString(36))),
            message: { ...message, player: this.guestSeat },
        });
    }

    OnPeerLost(reason) {
        if (this.closed || !this.guestPresent) return;
        this.guestPresent = false;

        // A3's window opens. The engine starts the countdown and the host keeps
        // playing until the turn reaches the absent player - exactly as it would if
        // this were a socket dropping on the real server.
        if (this.worker) {
            this.worker.postMessage({
                kind: 'client-message',
                requestId: 'guest:drop',
                message: { type: 'disconnect', reason: 'peer_' + reason, player: this.guestSeat },
            });
        }
        this.EmitLobby({ type: 'peer-disconnected', reason });
    }

    Close() {
        if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
        if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
        if (this.worker) { this.worker.terminate(); this.worker = null; }
        super.Close();
    }
}

// --- guest ------------------------------------------------------------------

class RtcGuestTransport extends RtcChannelBase {
    constructor({ signal } = {}) {
        super();
        this.signal = signal;
        this.seat = null;
    }

    Start() {
        this.connection = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });

        // The host created the channel, so it arrives rather than being made.
        this.connection.ondatachannel = (event) => {
            this.channel = event.channel;
            this.WireChannel();
        };

        this.connection.onconnectionstatechange = () => {
            const state = this.connection.connectionState;
            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                if (!this.closed) this.EmitLobby({ type: 'host-disconnected', reason: state });
            }
        };

        this.signal.OnSignal((payload) => this.HandleSignal(payload));

        // The guest starts its clock immediately, and correctly: it is only ever
        // started once the host's code is in hand, so there is no human left to wait
        // for - either the connection comes up or the network cannot do it.
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('could not reach the host')),
                RTC_CONNECT_TIMEOUT_MS
            );
            this.onChannelOpen = () => { clearTimeout(timer); resolve(this); };
            this.onChannelFail = (error) => { clearTimeout(timer); reject(error); };
        });
    }

    HandleSignal(payload) {
        if (!payload || payload.kind !== 'offer') return;

        // The host names the seat. The guest has no say in it and no reason to want
        // one - see StampFromGuest for why claiming otherwise would not help anyway.
        if (payload.guestSeat) this.seat = payload.guestSeat;

        let description;
        try {
            description = DecodeDescription(payload.description);
        } catch (error) {
            console.error('[RTC] unusable connection code:', error.message);
            if (this.onChannelFail) this.onChannelFail(error);
            return;
        }

        this.connection.setRemoteDescription(description)
            .then(() => this.connection.createAnswer())
            .then(answer => this.connection.setLocalDescription(answer))
            .then(() => WaitForIceGathering(this.connection))
            .then(() => {
                this.signal.Send({
                    kind: 'answer',
                    description: EncodeDescription(this.connection.localDescription),
                });
            })
            .catch((error) => {
                console.error('[RTC] guest could not answer:', error);
                if (this.onChannelFail) this.onChannelFail(error);
            });
    }

    WireChannel() {
        this.channel.onopen = () => { if (this.onChannelOpen) this.onChannelOpen(); };
        this.channel.onclose = () => {
            if (!this.closed) this.EmitLobby({ type: 'host-disconnected', reason: 'closed' });
        };
        this.channel.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                console.error('[RTC] unparseable message from the host:', error);
                return;
            }
            this.Receive(message);
        };
    }

    Receive(message) {
        if (message.type === 'ack') { this.SettleAck(message); return; }

        switch (message.type) {
            case 'match-started':
                if (message.seat !== undefined) this.seat = message.seat;
                this.EmitLobby(message);
                return;

            case 'match-ended':
            case 'match-error':
            case 'host-disconnected':
                this.EmitLobby(message);
                return;

            default:
                // state-sync and state-resync - the match stream the renderer wants.
                this.EmitMatch(message);
        }
    }

    // Straight down the channel. Unlike the host, there is no worker here and nothing
    // to stamp: the host will stamp this with the guest's seat on arrival, and would
    // overwrite anything claimed here.
    Send(message) {
        const requestId = 'r' + (this.nextRequestId++);
        this.SendRaw({ ...message, requestId });
        return this.Await(requestId);
    }
}

function CreateRtcHostTransport(options) { return new RtcHostTransport(options); }
function CreateRtcGuestTransport(options) { return new RtcGuestTransport(options); }
