// === What build is this browser actually running? (B2 anti-cheat) ===
//
// The client half of ComputeClientHash in host/build-hash.js. Both hash the same set of
// files in the same order - every <script src> in document order, then every
// stylesheet, with index.html first - so the two numbers can be compared at all.
// **Changing the order or the set here means changing it there in the same commit.**
// tools/p2p-smoke.js fails the suite when they disagree.
//
// WHAT THIS CATCHES, precisely: someone running their own modified copy of the game
// against the FortHex server. Their page fetches ITS files, not the server's, so the
// number comes out different and the server can decline. That is the case Burn
// described and it is the case this handles.
//
// WHAT IT DOES NOT CATCH, and no version of it could: a client that simply sends the
// expected number. Anything computed in a browser can be faked by a modified browser,
// so this is a compatibility gate, not a security control, and it should never be
// described as one. Cheating in server rooms is prevented somewhere else entirely and
// already is: SubmitAction runs inside the host's worker against the host's own state,
// so an illegal move is refused no matter what the client believes.
//
// Direct (P2P) connections do no verification at all. Play modded with your friends -
// Burn's call, and the reason this is only ever consulted on the socket path.

// One fetch per file. They are all in the browser cache already (the page just loaded
// them), so this is cheap in the normal case and slow exactly once on a cold start.
function CollectClientSources() {
    const found = [];

    const Add = (raw) => {
        if (!raw) return;
        const clean = String(raw).split('?')[0].split('#')[0];
        if (/^(https?:)?\/\//.test(clean) || clean.startsWith('data:')) return;
        const name = clean.replace(/^\.?\//, '');
        if (name && found.indexOf(name) === -1) found.push(name);
    };

    // Absolute URLs are reduced to page-relative names so both sides hash the same
    // string. `script.src` is always absolute in the DOM; `getAttribute` gives back
    // what the HTML actually said, which is what the server read off disk.
    document.querySelectorAll('script[src]').forEach(node => Add(node.getAttribute('src')));
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach(node => Add(node.getAttribute('href')));

    return ['index.html'].concat(found);
}

async function ComputeClientFingerprint() {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;

    const sources = CollectClientSources();
    const parts = [];
    const encoder = new TextEncoder();

    for (const name of sources) {
        parts.push(encoder.encode(name));
        try {
            // `cache: 'force-cache'` would be faster but can serve a stale copy of a
            // file that has since changed, which would report a build that is not the
            // one running. Correctness over speed for a once-per-session cost.
            const response = await fetch(name, { cache: 'no-store' });
            if (response.ok) {
                parts.push(new Uint8Array(await response.arrayBuffer()));
            }
            // A missing file contributes nothing, which is exactly what the server does
            // for a referenced file it cannot read. Both sides record the same absence.
        } catch (error) {
            // Same treatment: an unfetchable file is a fact about this build, and both
            // sides represent it identically.
        }
    }

    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    parts.forEach(part => { joined.set(part, at); at += part.length; });

    const digest = await crypto.subtle.digest('SHA-256', joined);
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}

// Computed once and reused. It cannot change without a reload, and it is asked for
// every time a socket connects.
let fingerprintPromise = null;

function GetClientFingerprint() {
    if (!fingerprintPromise) {
        fingerprintPromise = ComputeClientFingerprint().catch((error) => {
            console.warn('[Build] could not fingerprint this build:', error);
            return null;
        });
    }
    return fingerprintPromise;
}

// Console helper, for asking a player what their build says without walking them
// through anything. Pairs with FhStatus() and FhProbe().
function FhFingerprint() {
    return GetClientFingerprint().then(hash => {
        console.log('[Build] client fingerprint ' + hash + ' over '
            + CollectClientSources().length + ' files');
        return hash;
    });
}
