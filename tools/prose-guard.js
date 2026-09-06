// === House style, enforced (2026-09-07) ===
//
//   node tools/prose-guard.js
//
// Burn's rule: no em-dashes, anywhere. They were everywhere - 678 of them across 94
// files, almost all in comments - and a one-off sweep only fixes the ones that exist
// today. Left unguarded they come straight back the next time anybody writes a long
// comment, which is the same reason mode-guard.js exists rather than a checklist.
//
// Use " - " for a spoken break, or a comma, or two sentences. All three read fine.
//
// dist/ is generated from src/, so it is skipped: fixing a dash there would be undone by
// the next build, and the source it came from is checked anyway.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SEARCH_DIRS = ['js', 'host', 'src', 'tools', 'css'];
const SEARCH_FILES = ['index.html', 'sw.js', 'README.md'];
const EXTENSIONS = new Set(['.js', '.jsx', '.css', '.html', '.json', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

// Em-dash and en-dash, built from their code points rather than written literally.
// Spelling them out would put two em-dashes in this file and the guard would fail on
// itself, which it duly did the first time it ran.
const BANNED = new RegExp('[\\u2014\\u2013]');

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
        else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
    });
    return out;
}

const targets = [];
SEARCH_DIRS.forEach(dir => Walk(path.join(ROOT, dir), targets));
SEARCH_FILES.forEach(name => {
    const full = path.join(ROOT, name);
    if (fs.existsSync(full)) targets.push(full);
});

const offences = [];

targets.forEach(file => {
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (!BANNED.test(line)) return;
        offences.push({ file: relative, line: index + 1, text: line.trim().slice(0, 96) });
    });
});

if (offences.length) {
    console.log('\nprose-guard: ' + offences.length + ' em-dash(es) found. Use " - " instead.\n');
    offences.forEach(({ file, line, text }) => {
        console.log('  ' + file + ':' + line);
        console.log('    ' + text);
    });
    console.log('');
    process.exit(1);
}

console.log('prose-guard: ' + targets.length + ' files, no em-dashes');
