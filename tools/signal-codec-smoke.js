// === Connection codes survive the trip (B2) ===
//
//   node tools/signal-codec-smoke.js
//
// js/client/signal-codec.js throws away almost the whole SDP and rebuilds it from a
// template on the far side. That is what makes a code ~140 characters instead of ~1300,
// and it is also the one thing here that can fail SILENTLY: a subtly wrong rebuild
// produces a connection that never opens, on a screen people only reach when something
// else is already broken.
//
// So this runs real SDP - the shapes Chrome, Firefox and Safari actually emit, including
// the awkward ones - through pack and unpack, and checks that everything a connection
// depends on came back. It also checks the fallback triggers rather than guessing when
// it meets something it does not understand, because a long code that works beats a
// short code that does not.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// The codec is a browser script; give it the two globals it uses and load it.
if (typeof globalThis.btoa !== 'function') {
    globalThis.btoa = (binary) => Buffer.from(binary, 'binary').toString('base64');
    globalThis.atob = (base64) => Buffer.from(base64, 'base64').toString('binary');
}
const codec = require(path.join(ROOT, 'js/client/signal-codec.js'));
const { PackDescription, UnpackDescription } = codec;

let failures = 0;
function Check(label, condition, detail) {
    if (condition) { console.log('  ok   ' + label); return; }
    failures++;
    console.log('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
}

function Line(sdp, prefix) {
    const found = sdp.split(/\r?\n/).find(entry => entry.startsWith(prefix));
    return found ? found.slice(prefix.length).trim() : null;
}

function Candidates(sdp) {
    return sdp.split(/\r?\n/)
        .filter(line => line.startsWith('a=candidate:'))
        .map(line => {
            const parts = line.slice('a=candidate:'.length).trim().split(/\s+/);
            return parts[4] + ':' + parts[5] + ' ' + parts[7];
        })
        .sort();
}

// --- the fixtures -----------------------------------------------------------

const CHROME_OFFER = [
    'v=0',
    'o=- 8375926594832156789 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:1510613869 1 udp 2113937151 192.168.0.122 54321 typ host generation 0 network-cost 999',
    'a=candidate:842163049 1 udp 1677729535 86.24.191.7 54322 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
    'a=ice-ufrag:Xk3n',
    'a=ice-pwd:9Xy2LmQpRtVw4Bz7Nc1Hd6Fg',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90',
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
].join('\r\n');

// Chrome's default: local addresses replaced with an mDNS name so a page cannot learn
// the LAN layout. These are NOT IPs and would break a naive parser.
const CHROME_MDNS_ANSWER = [
    'v=0',
    'o=- 1122334455 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:1 1 udp 2113937151 f47ac10b-58cc-4372-a567-0e02b2c3d479.local 61001 typ host generation 0',
    'a=ice-ufrag:9pQ2',
    'a=ice-pwd:AbCdEfGhIjKlMnOpQrStUvWx',
    'a=ice-options:trickle',
    'a=fingerprint:sha-256 0F:1E:2D:3C:4B:5A:69:78:87:96:A5:B4:C3:D2:E1:F0:0F:1E:2D:3C:4B:5A:69:78:87:96:A5:B4:C3:D2:E1:F0',
    'a=setup:active',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
].join('\r\n');

// Firefox: different line ordering, an IPv6 candidate with an elision, and a TCP one.
const FIREFOX_OFFER = [
    'v=0',
    'o=mozilla...THIS_IS_SDPARTA-99.0 5432109876543210 0 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    'a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00',
    'a=group:BUNDLE 0',
    'a=ice-options:trickle',
    'a=msid-semantic:WMS *',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:0 1 UDP 2122252543 10.0.0.7 51000 typ host',
    'a=candidate:1 1 UDP 2122187007 2a00:23c5:1e00:6a01::42 51001 typ host',
    'a=candidate:2 1 TCP 2105524479 10.0.0.7 9 typ host tcptype active',
    'a=ice-pwd:ZzYyXxWwVvUuTtSsRrQqPpOo',
    'a=ice-ufrag:7fA1',
    'a=mid:0',
    'a=setup:actpass',
    'a=sctp-port:5000',
    'a=max-message-size:1073741823',
    '',
].join('\r\n');

const FIXTURES = [
    ['Chrome offer, host + srflx', { type: 'offer', sdp: CHROME_OFFER }],
    ['Chrome answer, mDNS host candidate', { type: 'answer', sdp: CHROME_MDNS_ANSWER }],
    ['Firefox offer, IPv6 and TCP candidates', { type: 'offer', sdp: FIREFOX_OFFER }],
];

console.log('\n[1] every browser shape survives the round trip');

FIXTURES.forEach(([label, description]) => {
    const code = PackDescription(description);
    const back = UnpackDescription(code);

    Check(label + ' - packed, not fallback', code.length < 400,
        'code was ' + code.length + ' chars, which means it fell back to the raw form');
    Check(label + ' - offer/answer preserved', back.type === description.type);
    Check(label + ' - ICE ufrag preserved',
        Line(back.sdp, 'a=ice-ufrag:') === Line(description.sdp, 'a=ice-ufrag:'));
    Check(label + ' - ICE password preserved',
        Line(back.sdp, 'a=ice-pwd:') === Line(description.sdp, 'a=ice-pwd:'));
    Check(label + ' - DTLS fingerprint preserved exactly',
        (Line(back.sdp, 'a=fingerprint:') || '').toLowerCase()
        === (Line(description.sdp, 'a=fingerprint:') || '').toLowerCase());
    Check(label + ' - setup role preserved',
        Line(back.sdp, 'a=setup:') === Line(description.sdp, 'a=setup:'));
    Check(label + ' - every candidate came back, same address and type',
        JSON.stringify(Candidates(back.sdp)) === JSON.stringify(Candidates(description.sdp)),
        'was ' + JSON.stringify(Candidates(description.sdp))
        + '\n         got ' + JSON.stringify(Candidates(back.sdp)));
});

console.log('\n[2] the code is short enough for a human to move');

const sample = PackDescription({ type: 'offer', sdp: CHROME_OFFER });
const oldStyle = 'FH1-' + Buffer.from(JSON.stringify({
    kind: 'offer',
    description: Buffer.from(JSON.stringify({ type: 'offer', sdp: CHROME_OFFER })).toString('base64'),
    guestSeat: 2,
})).toString('base64');

console.log('       raw SDP      ' + CHROME_OFFER.length + ' chars');
console.log('       old code     ' + oldStyle.length + ' chars');
console.log('       new code     ' + sample.length + ' chars');

Check('a code is under 200 characters', sample.length < 200, sample.length + ' chars');
Check('and is at least six times shorter than it was',
    sample.length * 6 <= oldStyle.length,
    oldStyle.length + ' -> ' + sample.length);

console.log('\n[3] the fallback triggers rather than guessing');

// A candidate type the table does not know. The packer must refuse the whole packed
// form rather than quietly dropping the candidate - a code missing the one route that
// would have worked is indistinguishable from a broken network.
const EXOTIC = CHROME_OFFER.replace('typ srflx', 'typ nonsense');
const exoticCode = PackDescription({ type: 'offer', sdp: EXOTIC });
Check('an unparseable candidate falls back to the raw form', exoticCode.length > 400,
    'code was ' + exoticCode.length + ' chars - it should have refused to pack');
Check('and the fallback still decodes to the original SDP',
    UnpackDescription(exoticCode).sdp === EXOTIC);

const NO_FINGERPRINT = CHROME_OFFER.split(/\r?\n/)
    .filter(line => !line.startsWith('a=fingerprint:')).join('\r\n');
const noPrintCode = PackDescription({ type: 'offer', sdp: NO_FINGERPRINT });
Check('a description with no fingerprint falls back rather than inventing one',
    noPrintCode.length > 400);

console.log('\n[4] a bad code is refused, not misread');

['', 'hello', 'FH2-', 'FH1-abc', 'FH2-!!!!'].forEach(bad => {
    let threw = false;
    try { UnpackDescription(bad); } catch (error) { threw = true; }
    Check('refuses ' + (bad ? JSON.stringify(bad) : '(empty)'), threw);
});

// Whitespace is what a paste actually looks like - chat clients wrap, and people select
// a trailing newline more often than not.
const padded = '  \n' + sample + '\n ';
let survivedPadding = false;
try { survivedPadding = UnpackDescription(padded).type === 'offer'; } catch (error) { /* fails below */ }
Check('a pasted code with stray whitespace still works', survivedPadding);

console.log('');
if (failures) {
    console.log('FAILED - ' + failures + ' check(s)\n');
    process.exit(1);
}
console.log('signal-codec-smoke: all checks passed\n');
