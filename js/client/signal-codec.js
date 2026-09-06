// === Making a connection code short enough to paste (B2) ===
//
// A WebRTC session description is ~650-2500 characters of extremely repetitive text, and
// the first version of this sent it as base64 of JSON of base64 of JSON - 1300+ characters
// for the smallest realistic case. Nobody is pasting that into a chat window twice.
//
// COMPRESSION IS NOT THE ANSWER HERE, and neither is encryption (which makes data
// slightly LONGER - it is not a size tool at all). The real observation is that almost
// none of an SDP is information. For a data-channel-only connection between two copies
// of the same game, every line is either a constant we both already know, or one of five
// short values. So the code carries only those five things, packed as binary, and the
// other side rebuilds the SDP around them from a template:
//
//     ICE ufrag      ~4 bytes     who is calling
//     ICE password   ~24 bytes    the shared secret for the connectivity checks
//     DTLS fingerprint 32 bytes   which certificate to expect - this is the security
//     setup role     1 byte       who starts the TLS handshake
//     candidates     ~12 bytes each   the addresses to try
//
// That is ~105 bytes, or ~140 characters of base64 - around a tenth of what it was, and
// it does not grow with how verbose the browser's SDP happens to be.
//
// THE RISK, AND WHAT IS DONE ABOUT IT. Rebuilding an SDP from parts means that if the
// rebuild is subtly wrong, the connection fails with no error anyone can act on - the
// worst possible failure for a screen people only reach when something else is already
// broken. So every code is decoded again immediately after being produced and checked
// against the original (PackDescription does this itself). If anything fails to survive
// the round trip, it falls back to form 2 - the whole SDP, base64, always correct, just
// long. Both sides read both forms, so a fallback code still works; it is only uglier.
//
// Form 2 is not compressed, deliberately: CompressionStream is asynchronous and would
// make every caller async to save characters on a path that should almost never be taken.

const SIGNAL_CODE_PREFIX = 'FH2-';

const SIGNAL_FORM_PACKED = 1;
const SIGNAL_FORM_RAW = 2;

// Both sides must agree on these orderings, so they are written as explicit tables
// rather than derived from anything.
const FINGERPRINT_ALGORITHMS = ['sha-256', 'sha-1', 'sha-384', 'sha-512'];
const SETUP_ROLES = ['actpass', 'active', 'passive', 'holdconn'];
const CANDIDATE_TYPES = ['host', 'srflx', 'prflx', 'relay'];

const ADDRESS_IPV4 = 0;
const ADDRESS_IPV6 = 1;
const ADDRESS_MDNS = 2;   // Chrome hides local IPs behind a <uuid>.local name

// --- bytes in, characters out -----------------------------------------------

// base64url: the standard alphabet's + and / get mangled by URLs and by some chat
// clients that helpfully turn them into something else. Padding is dropped because it
// carries no information and is three more characters to lose in a copy-paste.
function BytesToCode(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function CodeToBytes(text) {
    let base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
    return bytes;
}

// A growable byte buffer. Small enough to be worth writing rather than reaching for
// DataView gymnastics over a fixed allocation nobody can size in advance.
function ByteWriter() {
    const out = [];
    return {
        U8(value) { out.push(value & 0xff); },
        U16(value) { out.push((value >> 8) & 0xff, value & 0xff); },
        U32(value) {
            out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff,
                     (value >>> 8) & 0xff, value & 0xff);
        },
        Bytes(list) { list.forEach(byte => out.push(byte & 0xff)); },
        // Length-prefixed, because ufrag and password are both variable and neither has
        // a delimiter that could not legally appear inside it.
        Text(text) {
            const encoded = [];
            for (let at = 0; at < text.length; at++) encoded.push(text.charCodeAt(at) & 0xff);
            out.push(encoded.length);
            encoded.forEach(byte => out.push(byte));
        },
        Done() { return new Uint8Array(out); },
    };
}

function ByteReader(bytes) {
    let at = 0;
    return {
        U8() { return bytes[at++]; },
        U16() { const value = (bytes[at] << 8) | bytes[at + 1]; at += 2; return value; },
        U32() {
            const value = ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16)
                        + (bytes[at + 2] << 8) + bytes[at + 3];
            at += 4;
            return value >>> 0;
        },
        Take(count) { const slice = bytes.slice(at, at + count); at += count; return slice; },
        Text() {
            const length = bytes[at++];
            let text = '';
            for (let step = 0; step < length; step++) text += String.fromCharCode(bytes[at + step]);
            at += length;
            return text;
        },
        Remaining() { return bytes.length - at; },
    };
}

// --- reading the parts out of an SDP ----------------------------------------

function FindLine(sdp, prefix) {
    const line = sdp.split(/\r?\n/).find(entry => entry.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
}

function ParseAddress(text) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) {
        return { family: ADDRESS_IPV4, bytes: text.split('.').map(Number) };
    }

    // A <uuid>.local name, which is what Chrome publishes instead of a private IP. The
    // uuid is 16 bytes of hex once the dashes come out, so it packs like an address.
    const mdns = text.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i);
    if (mdns) {
        const hex = mdns.slice(1).join('');
        const bytes = [];
        for (let at = 0; at < 32; at += 2) bytes.push(parseInt(hex.slice(at, at + 2), 16));
        return { family: ADDRESS_MDNS, bytes };
    }

    if (text.includes(':')) {
        const groups = ExpandIpv6(text);
        if (groups) return { family: ADDRESS_IPV6, bytes: groups };
    }

    return null;
}

// IPv6 has to be expanded by hand because it is written with an elision (::) that stands
// for a run of zero groups whose length depends on how many groups are actually present.
function ExpandIpv6(text) {
    const halves = text.split('::');
    if (halves.length > 2) return null;

    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
    if (halves.length === 1 && head.length !== 8) return null;

    const filled = 8 - head.length - tail.length;
    if (filled < 0) return null;

    const groups = head.concat(new Array(filled).fill('0'), tail);
    const bytes = [];
    for (const group of groups) {
        const value = parseInt(group, 16);
        if (Number.isNaN(value)) return null;
        bytes.push((value >> 8) & 0xff, value & 0xff);
    }
    return bytes.length === 16 ? bytes : null;
}

function FormatAddress(family, bytes) {
    if (family === ADDRESS_IPV4) return Array.from(bytes).join('.');

    if (family === ADDRESS_MDNS) {
        const hex = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-'
             + hex.slice(16, 20) + '-' + hex.slice(20, 32) + '.local';
    }

    const groups = [];
    for (let at = 0; at < 16; at += 2) groups.push(((bytes[at] << 8) | bytes[at + 1]).toString(16));

    // RFC 5952: collapse the LONGEST run of zero groups to '::'. The expanded form is
    // a perfectly valid address and would still connect, but it is not what any browser
    // writes - and a rebuilt SDP that differs from the real thing in ways nobody expects
    // is exactly how a rarely-used path rots without anyone noticing.
    let bestAt = -1;
    let bestRun = 0;
    let runAt = -1;
    let run = 0;

    // The sentinel closes a run that reaches the end of the address.
    groups.concat(['x']).forEach((group, index) => {
        if (group === '0') {
            if (runAt === -1) runAt = index;
            run++;
            return;
        }
        // A lone zero group is written as '0'; '::' only pays for two or more.
        if (run > bestRun && run > 1) { bestRun = run; bestAt = runAt; }
        runAt = -1;
        run = 0;
    });

    if (bestAt === -1) return groups.join(':');

    return groups.slice(0, bestAt).join(':') + '::' + groups.slice(bestAt + bestRun).join(':');
}

function ReadCandidates(sdp) {
    const found = [];

    sdp.split(/\r?\n/).forEach(line => {
        const text = line.startsWith('a=candidate:') ? line.slice('a=candidate:'.length) : null;
        if (!text) return;

        // <foundation> <component> <protocol> <priority> <address> <port> typ <type> ...
        const parts = text.trim().split(/\s+/);
        if (parts.length < 8 || parts[6] !== 'typ') return;

        const protocol = parts[2].toLowerCase();
        const type = CANDIDATE_TYPES.indexOf(parts[7]);
        const address = ParseAddress(parts[4]);

        // Anything not understood is a reason to abandon the packed form entirely rather
        // than to drop a candidate - a code missing the one address that would have
        // worked is worse than a long code that has them all.
        if (type === -1 || !address) { found.push(null); return; }

        found.push({
            component: Number(parts[1]) || 1,
            tcp: protocol === 'tcp',
            priority: Number(parts[3]) || 0,
            address,
            port: Number(parts[5]) || 0,
            type,
        });
    });

    return found;
}

// --- packing ----------------------------------------------------------------

function PackFields(description) {
    const sdp = description.sdp || '';

    const ufrag = FindLine(sdp, 'a=ice-ufrag:');
    const password = FindLine(sdp, 'a=ice-pwd:');
    const fingerprint = FindLine(sdp, 'a=fingerprint:');
    const setup = FindLine(sdp, 'a=setup:');
    if (!ufrag || !password || !fingerprint || !setup) return null;

    const [algorithm, digits] = fingerprint.split(/\s+/);
    const algorithmId = FINGERPRINT_ALGORITHMS.indexOf(String(algorithm).toLowerCase());
    const setupId = SETUP_ROLES.indexOf(setup);
    if (algorithmId === -1 || setupId === -1) return null;

    const digest = digits.split(':').map(pair => parseInt(pair, 16));
    if (digest.some(Number.isNaN)) return null;

    const candidates = ReadCandidates(sdp);
    if (candidates.some(entry => entry === null)) return null;

    const writer = ByteWriter();
    writer.U8(SIGNAL_FORM_PACKED);
    writer.U8(description.type === 'answer' ? 1 : 0);
    writer.U8(algorithmId);
    writer.U8(setupId);
    writer.Text(ufrag);
    writer.Text(password);
    writer.U8(digest.length);
    writer.Bytes(digest);

    writer.U8(candidates.length);
    candidates.forEach(candidate => {
        writer.U8((candidate.address.family & 0x03)
                | ((candidate.type & 0x03) << 2)
                | (candidate.tcp ? 0x10 : 0)
                | ((candidate.component === 2 ? 1 : 0) << 5));
        writer.U32(candidate.priority);
        writer.U16(candidate.port);
        writer.Bytes(candidate.address.bytes);
    });

    return writer.Done();
}

function UnpackFields(bytes) {
    const reader = ByteReader(bytes);
    reader.U8();                                  // form, already consumed by the caller
    const type = reader.U8() === 1 ? 'answer' : 'offer';
    const algorithm = FINGERPRINT_ALGORITHMS[reader.U8()];
    const setup = SETUP_ROLES[reader.U8()];
    const ufrag = reader.Text();
    const password = reader.Text();
    const digest = Array.from(reader.Take(reader.U8()))
        .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
        .join(':');

    const count = reader.U8();
    const candidates = [];
    for (let index = 0; index < count; index++) {
        const flags = reader.U8();
        const family = flags & 0x03;
        const candidateType = CANDIDATE_TYPES[(flags >> 2) & 0x03];
        const protocol = (flags & 0x10) ? 'tcp' : 'udp';
        const component = (flags & 0x20) ? 2 : 1;
        const priority = reader.U32();
        const port = reader.U16();
        const address = FormatAddress(family, reader.Take(family === ADDRESS_IPV4 ? 4 : 16));

        // The foundation is an opaque grouping token - ICE only compares it against
        // other foundations, so the index serves as well as the browser's own number.
        candidates.push('a=candidate:' + (index + 1) + ' ' + component + ' ' + protocol + ' '
            + priority + ' ' + address + ' ' + port + ' typ ' + candidateType);
    }

    // The template. Every line here was a constant in both descriptions this codec has
    // ever been asked to carry, which is the entire reason the code is short - and the
    // reason PackDescription verifies its own output rather than trusting that claim.
    const sdp = [
        'v=0',
        'o=- 0 2 IN IP4 127.0.0.1',
        's=-',
        't=0 0',
        'a=group:BUNDLE 0',
        'a=msid-semantic: WMS',
        'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
        'c=IN IP4 0.0.0.0',
        'a=ice-ufrag:' + ufrag,
        'a=ice-pwd:' + password,
        'a=ice-options:trickle',
        'a=fingerprint:' + algorithm + ' ' + digest,
        'a=setup:' + setup,
        'a=mid:0',
        'a=sctp-port:5000',
        'a=max-message-size:262144',
    ].concat(candidates, ['a=end-of-candidates', '']).join('\r\n');

    return { type, sdp };
}

// --- the two things the rest of the code calls -------------------------------

// A description in, one pasteable token out. Tries the packed form and PROVES it before
// using it; falls back to the whole SDP if anything about this browser's output does not
// survive the round trip.
function PackDescription(description) {
    let packed = null;
    try {
        packed = PackFields(description);
    } catch (error) {
        packed = null;
    }

    if (packed && SurvivesRoundTrip(description, packed)) {
        return SIGNAL_CODE_PREFIX + BytesToCode(packed);
    }

    // Form 2: everything, verbatim. Long, and always right.
    const json = JSON.stringify({ type: description.type, sdp: description.sdp });
    const bytes = [SIGNAL_FORM_RAW];
    const utf8 = unescape(encodeURIComponent(json));
    for (let at = 0; at < utf8.length; at++) bytes.push(utf8.charCodeAt(at) & 0xff);
    return SIGNAL_CODE_PREFIX + BytesToCode(new Uint8Array(bytes));
}

function UnpackDescription(code) {
    const text = String(code).trim();
    if (!text.startsWith(SIGNAL_CODE_PREFIX)) throw new Error('not a FortHex code');

    const bytes = CodeToBytes(text.slice(SIGNAL_CODE_PREFIX.length));
    if (!bytes.length) throw new Error('empty code');

    if (bytes[0] === SIGNAL_FORM_PACKED) return UnpackFields(bytes);

    if (bytes[0] === SIGNAL_FORM_RAW) {
        let utf8 = '';
        for (let at = 1; at < bytes.length; at++) utf8 += String.fromCharCode(bytes[at]);
        const parsed = JSON.parse(decodeURIComponent(escape(utf8)));
        if (!parsed || !parsed.type || !parsed.sdp) throw new Error('not a connection code');
        return parsed;
    }

    throw new Error('unrecognised code version');
}

// The safety net. Compares what would be REBUILT against what the browser produced, on
// the fields that decide whether a connection can happen at all. Not a text comparison:
// the rebuilt SDP is deliberately not identical, and demanding that it were would reject
// every code.
function SurvivesRoundTrip(original, packed) {
    let rebuilt;
    try {
        rebuilt = UnpackFields(packed);
    } catch (error) {
        return false;
    }

    if (rebuilt.type !== (original.type === 'answer' ? 'answer' : 'offer')) return false;

    const Same = (prefix) => FindLine(original.sdp, prefix) === FindLine(rebuilt.sdp, prefix);
    if (!Same('a=ice-ufrag:') || !Same('a=ice-pwd:') || !Same('a=setup:')) return false;

    // The fingerprint is the one field where being wrong is a security problem rather
    // than a connectivity one - it is what pins the far end's certificate - so it is
    // compared case-insensitively but exactly.
    const originalPrint = (FindLine(original.sdp, 'a=fingerprint:') || '').toLowerCase();
    const rebuiltPrint = (FindLine(rebuilt.sdp, 'a=fingerprint:') || '').toLowerCase();
    if (originalPrint !== rebuiltPrint) return false;

    // Every candidate must come back, addressing the same place. A code that silently
    // dropped the only route that would have worked looks exactly like a network fault.
    const Addresses = (sdp) => ReadCandidates(sdp)
        .filter(Boolean)
        .map(entry => FormatAddress(entry.address.family, entry.address.bytes) + ':' + entry.port)
        .sort()
        .join(',');

    return Addresses(original.sdp) === Addresses(rebuilt.sdp);
}

// Node's test harness reaches these directly; the browser gets them as globals like
// every other script on the page.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PackDescription, UnpackDescription, SIGNAL_CODE_PREFIX };
}
