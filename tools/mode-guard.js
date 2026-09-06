// FortHex — stops "singleplayer" standing in for "the player has a side"  (B2)
//
//   node tools/mode-guard.js
//
// Online multiplayer arrived after every mode check in the client had already been
// written, and the client had exactly one mode that bound a player to one side:
// singleplayer. So ownership, fog perspective, victory adjudication, autosaving and
// action-button gating were all written as `gameMode === 'singleplayer'`.
//
// Every one of those silently did nothing in an online match, and each surfaced as its
// own separate bug days apart — both players able to drag both armies, fog computed
// from the opponent's viewpoint, a win by annihilation on the first end-turn. They were
// never separate bugs. They were one wrong idea, repeated.
//
// The right question was never the mode. It is:
//
//   IsBoundToOneSide()  — does this client play one side, or both?
//   IsForeignUnit(u)    — is that somebody else's unit?
//   IsRemoteMatch()     — is the authority elsewhere, so we must not decide?
//
// This file fails if a NEW `gameMode === 'singleplayer'` appears in client code outside
// the allowlist below. A genuinely AI-specific check is still fine — it just has to be
// added here with a reason, which is the point: it makes the choice deliberate instead
// of accidental.
//
// Exit code 0 = pass.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Files that ARE the AI, and are allowed to talk about singleplayer freely.
const EXEMPT_FILES = new Set(['js/client/ai.js', 'js/client/ai-training.js']);

// Checks that are genuinely about the AI opponent, not about who owns a side. Matched
// as a substring of the line; each needs a reason.
const ALLOWED = [
    {
        file: 'js/client/game-flow.js',
        contains: "gameMode === 'singleplayer' && engine.state.currentPlayer !== engine.state.playerSide",
        why: 'triggers executeAITurn — there is no AI in an online match',
    },
    {
        file: 'js/client/game-flow.js',
        contains: "if (engine.state.gameMode === 'singleplayer') {",
        why: 'singleplayer start message and the AI taking the opening turn as P1',
    },
    {
        file: 'js/client/modals.js',
        contains: "gameMode === 'singleplayer' && engine.state.currentPlayer !== side",
        why: 'resuming a save as a side — the AI owes the first move',
    },
    {
        file: 'js/client/modals.js',
        contains: "'forthexSaveGame_sp' : 'forthexSaveGame'",
        why: 'storage key naming, not a rule',
    },
    {
        file: 'js/client/save.js',
        contains: "'forthexSaveGame_sp' : 'forthexSaveGame'",
        why: 'storage key naming, not a rule',
    },
    {
        file: 'js/client/save.js',
        contains: "'SP-' : ''",
        why: 'save filename prefix, not a rule',
    },
    {
        file: 'js/client/toolbar.js',
        contains: "engine.state.mapMakerMode || engine.state.gameMode === 'singleplayer'",
        why: 'disables map generation during a singleplayer match; online rooms pick their map up front',
    },
];

const failures = [];

function Walk(dir, out = []) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) Walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    });
    return out;
}

const files = [...Walk(path.join(ROOT, 'js/client')), path.join(ROOT, 'js/main.js')];

files.forEach(file => {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (EXEMPT_FILES.has(rel)) return;

    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        // Comments explaining the rule are not violations of it.
        const code = line.replace(/\/\/.*$/, '');
        if (!/gameMode\s*[!=]==\s*['"]singleplayer['"]/.test(code)) return;

        const permitted = ALLOWED.some(rule => rel === rule.file && code.includes(rule.contains));
        if (permitted) return;

        failures.push(rel + ':' + (index + 1) + '  ' + line.trim());
    });
});

if (failures.length) {
    console.error('FAIL — ' + failures.length + ' unreviewed singleplayer check(s).');
    console.error('');
    console.error('If this is about WHO OWNS A SIDE, it is wrong in online play. Use:');
    console.error('  IsForeignUnit(unit)   — somebody else\'s unit');
    console.error('  IsBoundToOneSide()    — this client plays one side, not both');
    console.error('  IsRemoteMatch()       — the host decides, not us');
    console.error('');
    console.error('If it really is AI-specific, add it to ALLOWED in tools/mode-guard.js with a reason.');
    console.error('');
    failures.forEach(f => console.error('  !! ' + f));
    process.exit(1);
}

console.log('PASS — mode checks');
console.log('  ownership : no client code decides who owns a side from the mode string');
console.log('  allowed   : ' + ALLOWED.length + ' AI-specific checks, each with a recorded reason');
console.log('  scanned   : ' + files.length + ' files');
