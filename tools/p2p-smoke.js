// === Two hosts, one game (B2) ===
//
//   node tools/p2p-smoke.js
//
// A match can now be hosted in two places: host/server.js spawns a Node worker, and a
// player's browser spawns a Web Worker (js/client/p2p-worker.js). Both load the same
// js/server bundle and the same match driver, and they MUST keep loading the same one.
//
// If they drift, the failure is the worst kind available in this codebase: two players
// in a direct match would be playing a subtly different game from two players on the
// server, with no error anywhere and no way to tell which was right. That is the whole
// reason match-worker.js is shared rather than copied - and the browser's file list
// cannot be imported from the Node one (CommonJS vs a worker script), so a mirrored
// list is unavoidable and this is what stops it rotting.
//
// It also checks the anti-cheat fingerprint agrees across the two implementations that
// compute it, for the same reason: a check that quietly hashes different things on each
// side is worse than no check, because it looks like it is working.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { SERVER_BUNDLE, BuildWorkerSource } = require('../host/server-bundle.js');
const { ComputeClientHash, ExtractLoadedSources } = require('../host/build-hash.js');

let failures = 0;

function Check(label, condition, detail) {
    if (condition) {
        console.log('  ok   ' + label);
        return;
    }
    failures++;
    console.log('  FAIL ' + label + (detail ? '\n         ' + detail : ''));
}

console.log('\n[1] the browser worker loads the same bundle as the server worker');

const workerSource = fs.readFileSync(path.join(ROOT, 'js/client/p2p-worker.js'), 'utf8');

// The list as the browser file declares it, reduced to repo-relative paths so the two
// can be compared at all - the browser's are relative to js/client/, the server's to
// the repo root.
const listed = (() => {
    const block = workerSource.match(/const P2P_SERVER_BUNDLE = \[([\s\S]*?)\];/);
    if (!block) return null;
    return block[1]
        .split('\n')
        .map(line => (line.match(/['"]([^'"]+)['"]/) || [])[1])
        .filter(Boolean)
        .map(rel => path.posix.normalize(path.posix.join('js/client', rel)));
})();

Check('P2P_SERVER_BUNDLE is declared and parseable', listed !== null);

if (listed) {
    Check(
        'it lists exactly SERVER_BUNDLE, in the same order',
        JSON.stringify(listed) === JSON.stringify(SERVER_BUNDLE),
        'server: ' + JSON.stringify(SERVER_BUNDLE) + '\n         browser: ' + JSON.stringify(listed)
    );
    Check(
        'every listed file exists',
        listed.every(file => fs.existsSync(path.join(ROOT, file))),
        listed.filter(file => !fs.existsSync(path.join(ROOT, file))).join(', ')
    );
}

const driver = (workerSource.match(/const P2P_MATCH_DRIVER = ['"]([^'"]+)['"]/) || [])[1];
Check('it loads the real match driver, not a copy',
    driver === '../../host/match-worker.js',
    'found: ' + driver);

console.log('\n[2] the match driver still runs in both environments');

const driverSource = fs.readFileSync(path.join(ROOT, 'host/match-worker.js'), 'utf8');

Check('it takes parentPort/workerData from the browser shim when one is installed',
    driverSource.includes('FORTHEX_WORKER_HOST'));
Check('it still falls back to worker_threads under Node',
    driverSource.includes("require('worker_threads')"));

// The Node path must keep working exactly as it did - the browser shim is an addition,
// not a replacement, and this is the cheapest possible proof that the source it
// produces is still valid JavaScript.
Check('BuildWorkerSource still produces parseable source', (() => {
    try {
        new (require('vm').Script)(BuildWorkerSource());
        return true;
    } catch (error) {
        return false;
    }
})());

console.log('\n[3] the build fingerprint means the same thing on both sides');

// The client computes over: index.html, then every <script src> in document order, then
// every stylesheet. The server must extract that same set from index.html on disk. A
// mismatch here is the check silently comparing two different things.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const serverSide = ExtractLoadedSources(html);

const domScripts = [];
const scriptTag = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
let m;
while ((m = scriptTag.exec(html)) !== null) {
    const raw = m[1].split('?')[0];
    if (!/^(https?:)?\/\//.test(raw)) domScripts.push(raw.replace(/^\.?\//, ''));
}
const domStyles = [];
const linkTag = /<link[^>]*>/gi;
while ((m = linkTag.exec(html)) !== null) {
    if (!/rel\s*=\s*["']stylesheet["']/i.test(m[0])) continue;
    const href = (m[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href || /^(https?:)?\/\//.test(href)) continue;
    domStyles.push(href.split('?')[0].replace(/^\.?\//, ''));
}
const browserSide = domScripts.concat(domStyles);

Check('the server extracts the same source list the browser will see',
    JSON.stringify(serverSide) === JSON.stringify(browserSide),
    'server: ' + serverSide.length + ' files, browser: ' + browserSide.length + ' files');

// Guards a real bug this file caught once: a stray control character in the <link>
// regex made it match nothing, and the resulting hash was perfectly stable and
// plausible while silently covering four fewer files. A hash that is WRONG but
// consistent is invisible, so the set is asserted by shape and not just by agreement.
Check('stylesheets are actually in the set',
    serverSide.some(file => file.endsWith('.css')),
    'no .css files extracted - the <link> pass is matching nothing');
Check('scripts are actually in the set',
    serverSide.filter(file => file.endsWith('.js')).length > 10);
Check('external CDN sources are excluded',
    !serverSide.some(file => file.includes('//')));

const fingerprint = ComputeClientHash();
Check('ComputeClientHash returns a hash over the whole set',
    !!fingerprint.hash && fingerprint.files === serverSide.length + 1,
    JSON.stringify(fingerprint));

// The client's own extraction rules live in a separate file and must match the ones
// asserted above. Compared as source text because there is no DOM here to run it in.
const clientSide = fs.readFileSync(path.join(ROOT, 'js/client/build-fingerprint.js'), 'utf8');
Check('the client hashes index.html first, like the server does',
    clientSide.includes("['index.html'].concat"));
Check('the client takes scripts before stylesheets, like the server does',
    clientSide.indexOf("script[src]") < clientSide.indexOf('link[rel="stylesheet"]'));
Check('the client truncates to the same length as the server',
    clientSide.includes('.slice(0, 16)'));

console.log('\n[4] the anti-cheat gate is off unless somebody turns it on');

const serverFile = fs.readFileSync(path.join(ROOT, 'host/server.js'), 'utf8');
Check('enforcement keys off the accepted-builds file being non-empty',
    serverFile.includes('const ENFORCE_BUILD_CHECK = ACCEPTED_BUILDS.length > 0;'));
Check('no official-builds.json is committed, so an InDev tree is not gated',
    !fs.existsSync(path.join(ROOT, 'host/official-builds.json')));
Check('create-room is gated', serverFile.includes("if (!client.buildOk) return Fail(clientId, 'build_not_recognised');"));
Check('the gate is never consulted on the direct path',
    !fs.readFileSync(path.join(ROOT, 'js/client/rtc-transport.js'), 'utf8').includes('fingerprint'));

console.log('\n[5] the direct transport keeps the promises the other two make');

const rtc = fs.readFileSync(path.join(ROOT, 'js/client/rtc-transport.js'), 'utf8');

// The one that cost an afternoon: a missing Flush() threw inside a channel callback,
// which killed the subscription and froze the board while the client looked connected.
Check('there is a Flush(), even though it does nothing', /\n    Flush\(\) \{/.test(rtc));
Check('both roles expose Send and OnMessage',
    rtc.includes('class RtcHostTransport') && rtc.includes('class RtcGuestTransport'));

// The trust boundary. host/server.js stamps the seat at ForwardToMatch for exactly this
// reason; the P2P host is the only other place a peer's message reaches an engine.
Check('the host stamps the guest\'s seat rather than trusting the message',
    rtc.includes('player: this.guestSeat'));
Check('the guest cannot name its own seat',
    !/message\.player/.test(rtc.split('StampFromGuest')[1] || ''));

console.log('');
if (failures) {
    console.log('FAILED - ' + failures + ' check(s)\n');
    process.exit(1);
}
console.log('p2p-smoke: all checks passed\n');
