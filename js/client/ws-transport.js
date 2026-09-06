// === WebSocket transport adapter (B2) ===
//
// The second adapter behind A1's transport interface. It exposes the SAME two methods
// the client already uses — Send(message) and OnMessage(handler) — so js/main.js and
// every call site downstream cannot tell which one it is talking to. That was the
// point of defining the interface in A1; this is the first thing to prove it.
//
// What is deliberately different from LocalTransport, and why:
//
//   LocalTransport.Send() returns the outcome SYNCHRONOUSLY, because the engine is in
//   the same process and SubmitAction has already run by the time it returns. Over a
//   socket nothing can be known synchronously. Send() therefore returns a Promise that
//   settles when the host acks — and callers that ignore the return value (most of
//   them) keep working unchanged, because the authoritative answer was never the
//   return value. It is the state-sync that follows.
//
//   There is no Flush(). Draining the engine queue happens on the host, inside the
//   worker that owns the engine. A client has no queue to drain.
//
// This file is CLIENT-side: it uses `WebSocket`, which is a browser global. It must
// never be loaded by js/server/ or by the host — worker-smoke.js asserts the server
// module is free of exactly this kind of thing.

const WS_ACK_TIMEOUT_MS = 10000;

class WebSocketTransport {
    constructor(url, options = {}) {
        this.url = url;
        this.socket = null;
        this.connected = false;

        this.subscribers = new Set();
        this.lobbySubscribers = new Set();

        // requestId -> { resolve, timer }. An ack that never comes must not leak a
        // pending promise forever, so every entry carries its own timeout.
        this.pending = new Map();
        this.nextRequestId = 1;

        this.profileId = options.profileId || null;
        this.playerName = options.name || 'Player';
        this.buildVersion = options.version || null;

        // Assigned by the host when this client takes a seat. The client does not get
        // to choose it and does not send it with actions — the host stamps every
        // forwarded message with the seat it recorded at join time. Held here only so
        // the renderer knows which side it is drawing for.
        this.seat = null;
        this.room = null;
    }

    // --- connection ---------------------------------------------------------

    Connect() {
        return new Promise((resolve, reject) => {
            let settled = false;

            try {
                this.socket = new WebSocket(this.url);
            } catch (error) {
                reject(error);
                return;
            }

            this.socket.onopen = () => {
                this.connected = true;
                // `hello` is a LOBBY message, not one of A1's four. It carries the A5
                // profile id, which is the only identity this system has and the thing
                // that lets a reconnecting player be recognised on a new socket.
                this.SendRaw({
                    type: 'hello',
                    profileId: this.profileId,
                    name: this.playerName,
                    version: this.buildVersion,
                });
            };

            this.socket.onmessage = (event) => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch (error) {
                    console.error('[WS] unparseable message from host:', error);
                    return;
                }

                if (message.type === 'hello-ok' && !settled) {
                    settled = true;
                    this.clientId = message.clientId;
                    resolve(message);
                }

                this.Receive(message);
            };

            this.socket.onerror = (event) => {
                if (!settled) { settled = true; reject(new Error('websocket error')); }
            };

            this.socket.onclose = () => {
                this.connected = false;
                this.RejectAllPending('socket_closed');
                this.Receive({ type: 'host-disconnected' });
            };
        });
    }

    Close() {
        if (this.socket) this.socket.close();
    }

    // --- the A1 interface ---------------------------------------------------

    // Server -> client. Same signature and same unsubscribe contract as
    // LocalTransport.OnMessage, so HandleActionEvent wiring in js/main.js is identical.
    OnMessage(handler) {
        this.subscribers.add(handler);
        return () => this.subscribers.delete(handler);
    }

    // Client -> server. Returns a Promise for the host's ack; see the header for why
    // that differs from LocalTransport and why it does not matter to most callers.
    Send(message) {
        const requestId = 'r' + (this.nextRequestId++);
        this.SendRaw({ ...message, requestId });

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                // Resolve rather than reject: a lost ack is not a failed action. The
                // host may well have applied it, and the state-sync is what says so.
                resolve({ ok: null, timedOut: true });
            }, WS_ACK_TIMEOUT_MS);

            this.pending.set(requestId, { resolve, timer });
        });
    }

    // The client half of "drain the queue and deliver it". LocalTransport has a real
    // queue because the engine is in the same process; here the engine is a worker on
    // the host, and it drains itself after every action it applies.
    //
    // So this is a no-op — but it has to EXIST. HandleActionEvents (js/client/actions.js)
    // calls it as the single drain point after any engine function, and that call site
    // has no business knowing which transport is underneath. Leaving it undefined threw
    // mid-match, and because the throw happened inside a socket callback it killed the
    // subscription: the board stopped updating and the client kept looking connected.
    Flush() {
        return null;
    }

    // --- lobby --------------------------------------------------------------

    // Room traffic is a separate stream from match traffic. Keeping them apart means
    // the React lobby can subscribe without seeing state-syncs, and the renderer can
    // subscribe without seeing room lists.
    OnLobbyMessage(handler) {
        this.lobbySubscribers.add(handler);
        return () => this.lobbySubscribers.delete(handler);
    }

    ListRooms()                 { this.SendRaw({ type: 'list-rooms' }); }
    CreateRoom(options)         { this.SendRaw({ type: 'create-room', ...options }); }
    JoinRoom(options)           { this.SendRaw({ type: 'join-room', ...options }); }
    LeaveRoom()                 { this.SendRaw({ type: 'leave-room' }); }
    SwapSeats()                 { this.SendRaw({ type: 'swap-seats' }); }
    StartMatch()                { this.SendRaw({ type: 'start-match' }); }

    // --- internals ----------------------------------------------------------

    SendRaw(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            console.warn('[WS] dropping message, socket not open:', message.type);
            return false;
        }
        this.socket.send(JSON.stringify(message));
        return true;
    }

    Receive(message) {
        // Acks settle a pending Send() and go no further.
        if (message.type === 'ack') {
            const bare = String(message.requestId || '').split(':').pop();
            const waiting = this.pending.get(bare);
            if (waiting) {
                clearTimeout(waiting.timer);
                this.pending.delete(bare);
                waiting.resolve(message.outcome);
            }
            return;
        }

        switch (message.type) {
            case 'room-joined':
            case 'match-started':
                this.room = message.room || this.room;
                if (message.seat !== undefined) this.seat = message.seat;
                this.lobbySubscribers.forEach(handler => handler(message));
                return;

            case 'welcome':
            case 'hello-ok':
            case 'room-list':
            case 'room-update':
            case 'room-left':
            case 'room-error':
            case 'match-ended':
            case 'match-error':
            case 'host-disconnected':
                this.lobbySubscribers.forEach(handler => handler(message));
                return;

            default:
                // state-sync and state-resync — the match stream the renderer wants.
                this.subscribers.forEach(handler => handler(message));
        }
    }

    RejectAllPending(reason) {
        this.pending.forEach(({ resolve, timer }) => {
            clearTimeout(timer);
            resolve({ ok: false, error: reason });
        });
        this.pending.clear();
    }
}

function CreateWebSocketTransport(url, options) {
    return new WebSocketTransport(url, options);
}
