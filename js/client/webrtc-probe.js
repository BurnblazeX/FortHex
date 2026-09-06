// === Can this network host a direct connection? (B2) ===
//
// Answered BEFORE the player commits to anything, so "host on your own machine" can be
// offered honestly or greyed out with a reason, rather than failing after they have
// invited someone.
//
// The method is ICE candidate gathering against public STUN servers. Open a peer
// connection, ask for candidates, and read what comes back:
//
//   host   - an address on this machine. Always present, means nothing on its own.
//   srflx  - "server reflexive": the public address a STUN server SAW you arrive from.
//            Its presence is the whole point - it means something outside your network
//            can name you.
//   relay  - a TURN relay. FortHex runs none, so this never appears.
//
// The subtle case is SYMMETRIC NAT, where a naive check passes and direct play still
// fails. A symmetric NAT allocates a DIFFERENT public port per destination, so the
// address a third party is told to use is not the one that works. It is detected by
// asking two independent STUN servers and comparing the ports they report: same port
// means the mapping is stable and usable; different ports mean it is not.
//
// No FortHex server is involved. This works with the host process switched off, which
// matters because "the server is down" is exactly when a player reaches for direct play.

// Two INDEPENDENT providers, deliberately. Two addresses at the same provider can share
// infrastructure and return the same mapping even on a symmetric NAT, which would make
// the check pass when it should fail.
const PROBE_STUN_SERVERS = [
    'stun:stun.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
];

const PROBE_TIMEOUT_MS = 4000;

// One STUN server, one answer. Resolves to the reflexive "ip:port" it observed, or null.
function GatherReflexiveAddress(stunUrl, timeoutMs) {
    return new Promise((resolve) => {
        if (typeof RTCPeerConnection !== 'function') { resolve(null); return; }

        let connection;
        try {
            connection = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] });
        } catch (error) {
            resolve(null);
            return;
        }

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            try { connection.close(); } catch (error) { /* already gone */ }
            resolve(value);
        };

        const timer = setTimeout(() => finish(null), timeoutMs);

        connection.onicecandidate = (event) => {
            // A null candidate means gathering finished. If nothing reflexive turned up
            // by then, nothing will.
            if (!event.candidate) { clearTimeout(timer); finish(null); return; }

            const text = event.candidate.candidate || '';
            if (!text.includes(' typ srflx')) return;

            // "candidate:… udp … <ip> <port> typ srflx …" - the address and port are the
            // two fields before the type.
            const parts = text.split(' ');
            const typeAt = parts.indexOf('typ');
            if (typeAt < 2) return;

            clearTimeout(timer);
            finish(parts[typeAt - 2] + ':' + parts[typeAt - 1]);
        };

        // A data channel is what makes the connection gather candidates at all - without
        // one there is no media and nothing to negotiate.
        try {
            connection.createDataChannel('probe');
            connection.createOffer()
                .then(offer => connection.setLocalDescription(offer))
                .catch(() => finish(null));
        } catch (error) {
            finish(null);
        }
    });
}

// The answer, as something a UI can render without knowing what NAT is.
//
// Returns { ok, verdict, detail, addresses }:
//   'open'       reflexive addresses agree - direct play should work
//   'symmetric'  reflexive addresses disagree - the mapping changes per peer, so no
//   'blocked'    no reflexive address at all - nothing outside can name this machine
//   'unsupported' this browser has no WebRTC
function ProbeDirectConnectivity({ timeoutMs = PROBE_TIMEOUT_MS } = {}) {
    if (typeof RTCPeerConnection !== 'function') {
        return Promise.resolve({
            ok: false,
            verdict: 'unsupported',
            detail: 'This browser cannot make direct connections.',
            addresses: [],
        });
    }

    return Promise.all(PROBE_STUN_SERVERS.map(url => GatherReflexiveAddress(url, timeoutMs)))
        .then(addresses => {
            const found = addresses.filter(Boolean);

            if (found.length === 0) {
                return {
                    ok: false,
                    verdict: 'blocked',
                    detail: 'Your network does not allow direct connections.',
                    addresses,
                };
            }

            // Only one answer came back: enough to say something outside can reach this
            // machine, not enough to prove the mapping is stable. Treated as usable but
            // reported honestly, because refusing on one slow STUN server would be worse.
            if (found.length === 1) {
                return {
                    ok: true,
                    verdict: 'open',
                    detail: 'Direct connections look available.',
                    addresses,
                };
            }

            const ports = found.map(address => address.split(':').pop());
            if (ports[0] !== ports[1]) {
                return {
                    ok: false,
                    verdict: 'symmetric',
                    detail: 'Your network changes address for every connection, so direct play will not work.',
                    addresses,
                };
            }

            return {
                ok: true,
                verdict: 'open',
                detail: 'Direct connections look available.',
                addresses,
            };
        })
        .catch(() => ({
            ok: false,
            verdict: 'blocked',
            detail: 'Could not test this network.',
            addresses: [],
        }));
}

// Console helper: type FhProbe() and read the verdict. The probe is otherwise only
// reached from the Create Room screen, and this is the fastest way to ask a player
// what their network says without walking them through the UI.
function FhProbe() {
    return ProbeDirectConnectivity().then(result => {
        console.log('[Probe] ' + result.verdict + ' - ' + result.detail,
            result.addresses.filter(Boolean));
        return result;
    });
}
