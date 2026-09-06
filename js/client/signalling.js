// === Getting two peers to say hello (B2) ===
//
// WebRTC cannot start a connection out of nothing: each side has to see the other's
// session description first. Delivering those two blobs is "signalling", and it is a
// separate problem from the connection itself - which is why js/client/rtc-transport.js
// takes a signal object and never asks what is behind it.
//
// There are two, and the second is the point:
//
//   BrokeredSignal   relays through the FortHex server's existing WebSocket. Two small
//                    messages, once, at setup. The GAME never touches the server -
//                    that is the whole difference from a hosted match, and it survives
//                    the server going down mid-match, because by then signalling is
//                    over and nothing needs it.
//
//   ManualSignal     two people paste codes at each other. No server at any point.
//                    This is the genuinely serverless path, and it exists for the case
//                    the brokered one cannot cover: the FortHex host process is off.
//
// Both hand rtc-transport the same shape, so neither is a special case there. The
// vanilla-ICE decision in that file is what makes this possible: exactly one message in
// each direction, which is the most a human will paste.

// Relay through the lobby socket. The server forwards a `signal` to whoever else is in
// the room and does not read the payload - it is an opaque blob to the host process,
// which is the correct amount for it to know about a connection it is not part of.
function CreateBrokeredSignal(socketTransport) {
    let handler = null;

    const unsubscribe = socketTransport.OnLobbyMessage((message) => {
        if (message.type === 'signal' && handler) handler(message.payload);
    });

    return {
        Send(payload) {
            socketTransport.SendRaw({ type: 'signal', payload });
        },
        OnSignal(fn) {
            handler = fn;
        },
        Close() {
            handler = null;
            unsubscribe();
        },
    };
}

// No server anywhere. `onCode` is handed the code this side produced, for the UI to
// show; `Accept(code)` is called when the player pastes the other side's.
//
// The asymmetry between the two is real and worth stating: the host produces its code
// immediately and waits, while the guest cannot produce anything until it has seen the
// host's. So the flow is always host-code -> guest -> guest-code -> host, and a UI that
// asks the guest for a code first has nothing to give them.
function CreateManualSignal({ onCode } = {}) {
    let handler = null;
    // A code can be pasted before the transport has subscribed - the player is faster
    // than the ICE gathering they are waiting on more often than you would think.
    let waiting = [];

    return {
        Send(payload) {
            if (onCode) onCode(EncodeSignalPayload(payload), payload.kind);
        },
        OnSignal(fn) {
            handler = fn;
            const queued = waiting;
            waiting = [];
            queued.forEach(fn);
        },
        // Returns an error string rather than throwing: this is driven by a text box a
        // human typed into, so a bad paste is an expected input, not an exception.
        Accept(code) {
            let payload;
            try {
                payload = DecodeSignalPayload(code);
            } catch (error) {
                return 'That does not look like a connection code.';
            }
            if (handler) handler(payload);
            else waiting.push(payload);
            return null;
        },
        Close() {
            handler = null;
            waiting = [];
        },
    };
}

// A manual code IS the packed description, with nothing wrapped around it.
//
// The first version wrapped the routing fields in JSON and base64'd that - around the
// description, which was itself base64'd JSON. Two layers of base64 cost ~78% on top of
// an SDP that was already too long, to carry two facts that do not need carrying: an
// offer/answer flag the description already contains, and a seat number that is always
// the same (the host holds seat 1, so the guest is 2 - there is no third possibility in
// a two-player match with no lobby).
function EncodeSignalPayload(payload) {
    return payload.description;
}

// The kind is recovered from the description rather than stated alongside it, so the
// two can never disagree - an 'offer' label on an answer would have been accepted by
// the old format and then failed somewhere much less obvious.
function DecodeSignalPayload(code) {
    const description = UnpackDescription(code);
    return {
        kind: description.type === 'answer' ? 'answer' : 'offer',
        description: String(code).trim(),
        guestSeat: 2,
    };
}
