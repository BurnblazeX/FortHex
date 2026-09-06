// === The build check, against a real server (B2 anti-cheat) ===
//
//   node tools/build-gate-smoke.js
//
// p2p-smoke.js reads the source and confirms the gate is wired and off by default.
// This one turns it ON - writing a real host/official-builds.json and starting a real
// server process against it - because "off by default" is only half the promise, and
// the half that is easy to get wrong is the other one.
//
// It runs in a CHILD PROCESS rather than in-process like lobby-smoke.js, because the
// accepted list is read once at module load. Requiring the server after writing the
// file would work exactly once per Node process and then quietly test nothing.
//
// Three things are checked, and the third is the one that matters most:
//
//   1. an unrecognised build is refused a room
//   2. a listed build is admitted
//   3. THE SERVER'S OWN TREE is always admitted - a release server must not lock out
//      the build it is itself serving the moment a file is touched
//
// It writes the REAL host/official-builds.json and deletes it again, because that path
// is what the server reads and pointing it elsewhere would test a path nothing uses. It
// refuses to run if one already exists rather than clobbering a release configuration,
// and if it is interrupted the leftover file gates the tree - so if online play starts
// refusing your own build, look for that file first.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const BUILDS_FILE = path.join(ROOT, 'host', 'official-builds.json');
const PORT = 8123 + Math.floor(Math.random() * 400);

const failures = [];
function Check(what, condition) {
    if (!condition) failures.push(what);
    console.log((condition ? '  ok   ' : '  FAIL ') + what);
}

// Refusing to clobber a real one is not politeness - running this against a tree that
// already has an accepted-builds list would delete a release's configuration.
if (fs.existsSync(BUILDS_FILE)) {
    console.error('host/official-builds.json already exists - refusing to overwrite it.');
    process.exit(1);
}

const { ComputeClientHash } = require('../host/build-hash.js');
const ownHash = ComputeClientHash().hash;

// A fingerprint that is emphatically not this tree's, plus one this tree could never
// produce, so "accepted" can be told apart from "accepted because it matched itself".
const KNOWN_RELEASE = 'a'.repeat(16);

function Hello(url, fingerprint) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const inbox = [];
        const timer = setTimeout(() => { socket.close(); reject(new Error('timed out')); }, 8000);

        socket.on('open', () => {
            socket.send(JSON.stringify({ type: 'hello', profileId: 'p-' + fingerprint, name: 'Tester', fingerprint }));
        });

        socket.on('message', (raw) => {
            const message = JSON.parse(raw);
            inbox.push(message);

            if (message.type === 'hello-ok') {
                socket.send(JSON.stringify({ type: 'create-room', name: 'Gate Test', visibility: 'public' }));
                return;
            }
            if (message.type === 'room-joined' || message.type === 'room-error') {
                clearTimeout(timer);
                socket.close();
                resolve({
                    hello: inbox.find(m => m.type === 'hello-ok'),
                    result: message,
                });
            }
        });

        socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
}

async function Main() {
    fs.writeFileSync(BUILDS_FILE, JSON.stringify({ builds: [KNOWN_RELEASE] }, null, 4));

    const server = spawn(process.execPath, [path.join(ROOT, 'host', 'server.js'), '--port', String(PORT)], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let booted = '';
    server.stdout.on('data', chunk => { booted += chunk.toString(); });
    server.stderr.on('data', chunk => { booted += chunk.toString(); });

    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('server did not boot:\n' + booted)), 10000);
            const poll = setInterval(() => {
                // Waits for the LAST boot line, not the first: the build-check line is
                // printed after 'listening', so resolving on the port would race it and the
                // assertion below would read a log that had not finished being written.
                if (/build check (ON|OFF)/.test(booted)) {
                    clearInterval(poll); clearTimeout(timer); resolve();
                }
            }, 100);
        });

        console.log('\n[1] the gate turns itself on when the file exists');
        Check('the server says the check is on at boot', /build check ON/.test(booted));
        Check('and names how many releases it accepts', /1 accepted release/.test(booted));

        const url = 'ws://127.0.0.1:' + PORT + '/ws';

        console.log('\n[2] an unrecognised build is told so, and refused a room');
        const stranger = await Hello(url, 'f'.repeat(16));
        Check('hello still succeeds, so the player can be told why',
            !!stranger.hello);
        Check('hello reports the build was not accepted',
            !!stranger.hello && stranger.hello.buildAccepted === false);
        Check('hello reports that this server is enforcing',
            !!stranger.hello && stranger.hello.buildEnforced === true);
        Check('creating a room is refused with a reason that names the cause',
            stranger.result.type === 'room-error' && stranger.result.error === 'build_not_recognised');

        console.log('\n[3] a listed release is admitted');
        const official = await Hello(url, KNOWN_RELEASE);
        Check('hello reports the build was accepted',
            !!official.hello && official.hello.buildAccepted === true);
        Check('and the room is created', official.result.type === 'room-joined');

        console.log('\n[4] the server never locks out the build it is serving');
        const ownBuild = await Hello(url, ownHash);
        Check('its own tree is accepted without being listed',
            !!ownBuild.hello && ownBuild.hello.buildAccepted === true);
        Check('and can create a room', ownBuild.result.type === 'room-joined');

        console.log('\n[5] a client that sends no fingerprint at all is refused');
        const silent = await Hello(url, null);
        Check('an absent fingerprint is not treated as a pass',
            !!silent.hello && silent.hello.buildAccepted === false);
    } finally {
        server.kill();
        fs.unlinkSync(BUILDS_FILE);
    }

    console.log('');
    if (failures.length) {
        console.log('FAILED - ' + failures.length + ' check(s):');
        failures.forEach(f => console.log('  !! ' + f));
        process.exit(1);
    }
    console.log('build-gate-smoke: all checks passed\n');
    process.exit(0);
}

Main().catch((error) => {
    try { if (fs.existsSync(BUILDS_FILE)) fs.unlinkSync(BUILDS_FILE); } catch (cleanup) { /* best effort */ }
    console.error(error);
    process.exit(1);
});
