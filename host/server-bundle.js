// === The js/server bundle, as bare Node sees it (B2 groundwork) ===
//
// index.html loads these with <script> tags; a Worker has no such thing, so they
// are concatenated into one source string and evaluated in the worker's own global
// scope. tools/worker-smoke.js has done exactly this since A1 — this file lifts the
// list out so the harness and the real host cannot drift apart.
//
// The load order is index.html's, minus everything client-side. Nothing here may
// touch document/window/localStorage; worker-smoke.js is what proves that, and it
// should stay the thing that proves it.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SERVER_BUNDLE = [
    'js/config-data.js',
    'js/grid-math.js',
    'js/testament.js',
    'js/server/engine.js',
    'js/server/rules.js',
    'js/server/actions.js',
    'js/server/turn-lifecycle.js',
    'js/server/match-setup.js',
    'js/server/map-generation.js',
    'js/server/validation.js',
    'js/server/state-filter.js',
    'js/server/session.js',
    'js/transport.js',
];

function ReadBundle() {
    return SERVER_BUNDLE
        .map(file => '\n//# ' + file + '\n' + fs.readFileSync(path.join(ROOT, file), 'utf8'))
        .join('\n');
}

// One worker's complete source: the game, then the runtime that drives it.
function BuildWorkerSource() {
    return ReadBundle() + '\n' + fs.readFileSync(path.join(__dirname, 'match-worker.js'), 'utf8');
}

module.exports = { ROOT, SERVER_BUNDLE, ReadBundle, BuildWorkerSource };
