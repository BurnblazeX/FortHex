// === Source fingerprint (InDev) ===
//
// A short hash over every code file the game is made of, so a tester can tell at a
// glance whether the build in front of them is the same one they were looking at five
// minutes ago. Chasing a bug that was silently fixed - or silently reintroduced - by an
// edit between two reloads is a very expensive way to spend an afternoon.
//
// Computed LIVE from the files on disk rather than stamped at build time. That is the
// whole point: a build-time stamp is only as honest as the last time somebody ran the
// build, and the failure this exists to catch is precisely "the thing you are running
// is not the thing you think you are running".
//
// Assets are excluded. This answers "did the CODE change", and a changed piece of art
// announces itself by being visibly different.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// Everything that can change behaviour. host/ is included because a server change
// alters the game just as much as a client one, and it is the half you cannot see.
const INCLUDE_DIRS = ['js', 'css', 'dist', 'host'];
const INCLUDE_FILES = ['index.html', 'manifest.json', 'sw.js'];
const INCLUDE_EXT = new Set(['.js', '.jsx', '.css', '.html', '.json']);

const SKIP_DIRS = new Set(['node_modules', '.git']);

function Walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        return out;
    }

    entries.forEach(entry => {
        if (SKIP_DIRS.has(entry.name)) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) Walk(full, out);
        else if (INCLUDE_EXT.has(path.extname(entry.name))) out.push(full);
    });
    return out;
}

function CollectFiles() {
    const files = [];
    INCLUDE_DIRS.forEach(dir => Walk(path.join(ROOT, dir), files));
    INCLUDE_FILES.forEach(name => {
        const full = path.join(ROOT, name);
        if (fs.existsSync(full)) files.push(full);
    });

    // Sorted, so the hash depends on the CONTENT and not on the order the filesystem
    // happened to hand things back.
    return files.sort();
}

// Cached against the newest mtime across the tree, so the common case - a page reload
// with nothing changed - costs one stat per file rather than a full re-read.
let cache = { hash: null, signature: null, files: 0, computedAt: 0 };

function ComputeBuildHash() {
    const files = CollectFiles();

    let signature = '';
    let newest = 0;
    files.forEach(file => {
        const stat = fs.statSync(file);
        signature += file + ':' + stat.size + ':' + stat.mtimeMs + '|';
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    });

    if (cache.signature === signature) return cache;

    // Names go into the hash as well as contents: renaming a file changes the build
    // even when every byte of it survives.
    const digest = crypto.createHash('sha256');
    files.forEach(file => {
        digest.update(path.relative(ROOT, file).replace(/\\/g, '/'));
        digest.update(fs.readFileSync(file));
    });

    cache = {
        hash: digest.digest('hex').slice(0, 8),
        signature,
        files: files.length,
        newestMtime: newest,
        computedAt: Date.now(),
    };
    return cache;
}

// Per-file hashes, for answering "what changed" rather than just "something did".
function ComputeFileHashes() {
    const out = {};
    CollectFiles().forEach(file => {
        out[path.relative(ROOT, file).replace(/\\/g, '/')] =
            crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
    });
    return out;
}

// === The half of the build a browser can see (B2 anti-cheat) ===
//
// ComputeBuildHash above covers js/, css/, dist/, host/ and index.html - everything
// that can change behaviour. A browser cannot reproduce it: it never sees host/, so the
// two numbers could never agree no matter how honest either side was being.
//
// So there is a second hash over exactly the files index.html LOADS, in the order it
// loads them, computed identically on both sides. The client reads that list from its
// own document (js/client/build-fingerprint.js); this reads it out of index.html on
// disk. Same set, same order, same digest - which is the only way a comparison means
// anything.
//
// WHAT THIS IS AND IS NOT. It is not a security control and cannot be one: anything a
// browser computes, a modified browser can lie about, and a determined person will just
// send the expected number. It catches the case Burn actually described - somebody
// running their own modified build against the public server - and nothing harder than
// that. The real protection against cheating in server rooms is elsewhere and already
// built: SubmitAction runs inside the host's worker and validates every action against
// its own state, so a modified client cannot make an illegal move however it is
// modified. This check is about keeping incompatible builds out, not attackers.

// Only same-origin, relative sources count. A font from a CDN is not part of the build
// and is not something either side can hash.
function ExtractLoadedSources(html) {
    const found = [];

    const Add = (raw) => {
        if (!raw) return;
        const clean = raw.split('?')[0].split('#')[0];
        if (/^(https?:)?\/\//.test(clean) || clean.startsWith('data:')) return;
        const name = clean.replace(/^\.?\//, '');
        if (name && found.indexOf(name) === -1) found.push(name);
    };

    // Two passes, in this order - ALL scripts, then ALL stylesheets. That is the order
    // the client can reproduce cheaply (one querySelectorAll each) without having to
    // interleave two node types by document position, so it is the order defined here.
    // Any change to this ordering has to be made in js/client/build-fingerprint.js at
    // the same time or the two sides silently stop agreeing; tools/fingerprint-smoke.js
    // is what catches that.
    let match;
    const scripts = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
    while ((match = scripts.exec(html)) !== null) Add(match[1]);

    // One pass over <link> tags rather than one per attribute order, so a stylesheet
    // written `href` before `rel` lands in the same position as any other.
    const links = /<link[^>]*>/gi;
    while ((match = links.exec(html)) !== null) {
        const tag = match[0];
        if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
        const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
        if (href) Add(href[1]);
    }

    return found;
}

function ComputeClientHash() {
    let html;
    try {
        html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    } catch (error) {
        return { hash: null, files: 0, error: 'no index.html' };
    }

    const sources = ['index.html'].concat(ExtractLoadedSources(html));
    const digest = crypto.createHash('sha256');
    let counted = 0;

    sources.forEach(name => {
        let body;
        try {
            body = fs.readFileSync(path.join(ROOT, name));
        } catch (error) {
            // A referenced file that is not there is itself a fact about this build,
            // and both sides will record it the same way: the client's fetch 404s.
            body = Buffer.from('');
        }
        digest.update(name);
        digest.update(body);
        counted++;
    });

    return { hash: digest.digest('hex').slice(0, 16), files: counted };
}

module.exports = { ComputeBuildHash, ComputeFileHashes, ComputeClientHash, ExtractLoadedSources, ROOT };
