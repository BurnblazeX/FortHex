// === Source fingerprint (InDev) ===
//
// A short hash over every code file the game is made of, so a tester can tell at a
// glance whether the build in front of them is the same one they were looking at five
// minutes ago. Chasing a bug that was silently fixed — or silently reintroduced — by an
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

// Cached against the newest mtime across the tree, so the common case — a page reload
// with nothing changed — costs one stat per file rather than a full re-read.
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

module.exports = { ComputeBuildHash, ComputeFileHashes, ROOT };
