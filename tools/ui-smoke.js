// FortHex - headless harness for the React UI bundle  (Track B1)
//
//   node tools/ui-smoke.js
//
// B1 introduced the project's first build step, and with it two failure modes that
// nothing else can catch: a bundle that is stale relative to its sources, and a
// bundle that calls a game global which has since been renamed or deleted. Neither
// throws until a player opens the menu, and the second one is silent in the editor
// because the identifiers are free variables resolved at runtime.
//
// Exit code 0 = pass.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const failures = [];
function check(what, condition) {
    if (!condition) failures.push(what);
    return condition;
}

function Walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? Walk(full) : [full];
    });
}

// --- 1. the bundle exists, and is newer than everything it was built from ---
{
    const bundle = path.join(ROOT, 'dist/ui-bundle.js');
    const styles = path.join(ROOT, 'dist/ui-bundle.css');

    if (check('dist/ui-bundle.js exists (run `npm run build`)', fs.existsSync(bundle)) &&
        check('dist/ui-bundle.css exists', fs.existsSync(styles))) {

        const built = Math.min(fs.statSync(bundle).mtimeMs, fs.statSync(styles).mtimeMs);
        const stale = Walk(path.join(ROOT, 'src/ui'))
            .filter(f => fs.statSync(f).mtimeMs > built)
            .map(f => path.relative(ROOT, f));

        check('the bundle is not stale' + (stale.length ? ' (newer: ' + stale.join(', ') + ')' : ''),
            stale.length === 0);
    }
}

// --- 2. index.html actually loads it, after js/main.js ---------------------
// Order matters: the bundle publishes window.FortHexUI, which js/main.js calls from
// window.onload, and it reads `engine`, which js/main.js declares at script scope.
{
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    check('index.html loads dist/ui-bundle.js', html.includes('dist/ui-bundle.js'));
    check('index.html loads dist/ui-bundle.css', html.includes('dist/ui-bundle.css'));
    check('index.html has the #menuRoot mount point', html.includes('id="menuRoot"'));
    // Compared as <script> tags, not raw substrings - both paths are also named in
    // comments elsewhere in the file, and the first mention is not the load order.
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
    check('the bundle is loaded after js/main.js',
        scripts.indexOf('dist/ui-bundle.js') > scripts.indexOf('js/main.js'));

    // The full departure B1 called for: none of the old menu should be left behind.
    ['gameMenuModal', 'singleplayerMenuContent', 'multiplayerMenuContent',
     'profileSetupModalOverlay', 'onlineMultiplayerButton'].forEach(id => {
        check('the old menu markup is gone: ' + id, !html.includes('id="' + id + '"'));
    });
}

// --- 3. every game global the bundle calls still exists in js/ -------------
// src/ui/bridge.js is the only file allowed to touch them, and it declares them in
// its /* global */ block. This checks that block against reality - a renamed
// function in js/ would otherwise fail at the click, not at the build.
{
    const bridge = fs.readFileSync(path.join(ROOT, 'src/ui/bridge.js'), 'utf8');
    const declared = (bridge.match(/\/\* global([\s\S]*?)\*\//) || [])[1];

    if (check('bridge.js declares its globals in a /* global */ block', !!declared)) {
        const names = declared.split(/[\s,]+/).filter(Boolean);
        check('the bridge names some globals', names.length > 0);

        const source = Walk(path.join(ROOT, 'js'))
            .filter(f => f.endsWith('.js'))
            .map(f => fs.readFileSync(f, 'utf8'))
            .join('\n');

        names.forEach(name => {
            const declaredInJs = new RegExp(
                // `async function` counts. Missing it reported InstallApp as undeclared
                // when it was right there, which sent the search to the wrong place.
                String.raw`(?:^|\n)\s*(?:(?:async\s+)?function\s*\*?\s*${name}\b|(?:const|let|var)\s+${name}\b)`
            ).test(source);
            check('js/ still declares `' + name + '`, which the menu calls', declaredInJs);
        });
    }

    // The rule the bridge exists to enforce. If a component reaches past it, the seam
    // is decorative - so no other file under src/ui may name a game global directly.
    // Comments are stripped first. The rule is about what the CODE reaches for, and a
    // file that documents why the engine is off-limits should not be reported for
    // saying so - which is exactly what happened the first time a screen explained the
    // seam it was respecting.
    const StripComments = (source) => source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

    const offenders = Walk(path.join(ROOT, 'src/ui'))
        .filter(f => /\.jsx?$/.test(f) && path.basename(f) !== 'bridge.js')
        .filter(f => /\b(engine|gameState|gameSettings|initializeGrid|StartMatchFromMenu)\b/
            .test(StripComments(fs.readFileSync(f, 'utf8'))))
        .map(f => path.relative(ROOT, f));

    check('only bridge.js touches game globals' + (offenders.length ? ' (offenders: ' + offenders.join(', ') + ')' : ''),
        offenders.length === 0);
}

// --- 5. the seat picker names people, not colours --------------------------
//
// The room's two seats ARE the side picker, and they used to read "Blue (P1)" and
// "Red (P2)" - three ways of saying the side (the pip's colour, the number, and the
// word) in the one row where the interesting fact was missing entirely: who is
// sitting there (Burn, 2026-09-07). The seat's `name` has always crossed the wire;
// nothing was drawing it.
{
    const room = fs.readFileSync(path.join(ROOT, 'src/ui/screens/RoomScreen.jsx'), 'utf8');

    check('the seat picker draws the occupant name', /seat\.name/.test(room));
    check('the seat picker no longer names the colour',
        !/'Blue \(P1\)'/.test(room) && !/'Red \(P2\)'/.test(room));
    check('the seat still says which side it is', /P\{seat\.seat\}/.test(room));
    // A held seat looks identical to an occupied one without this, which is exactly
    // the state hot join exists to act on.
    check('the seat picker distinguishes a disconnected occupant',
        /seat\.connected/.test(room));
}

// --- 6. the victory screen's cross-file calls still resolve ----------------
//
// remote-state.js reaches ShowRemoteVictory and ResetVictoryScreen through a
// `typeof x === 'function'` guard, because the headless parity harnesses load that
// file without game-flow.js. The guard is what keeps those tools runnable, and it is
// also what would let a rename turn the whole victory path into a silent no-op.
{
    const flow = fs.readFileSync(path.join(ROOT, 'js/client/game-flow.js'), 'utf8');
    const remote = fs.readFileSync(path.join(ROOT, 'js/client/remote-state.js'), 'utf8');

    ['ShowRemoteVictory', 'ResetVictoryScreen'].forEach(name => {
        const guarded = new RegExp("typeof " + name + " === 'function'").test(remote);
        const defined = new RegExp('function ' + name + '\\s*\\(').test(flow);
        check('remote-state.js guards its call to ' + name, guarded);
        check('game-flow.js still defines ' + name + ', which that guard would silently skip',
            defined);
    });
}

// --- 7. the service worker stays out of the way ----------------------------
//
// sw.js exists only to make the app installable, and a fetch handler has to EXIST for
// that - it does not have to answer anything. The version that did answer, described
// in its own comment as "just a pass-through", was not one: re-issuing a cross-origin
// request inside a worker yields an OPAQUE response, so the Google Fonts stylesheet
// arrived with zero rules and Exo 2 fell back to sans-serif on every browser. Its
// catch was worse - a failed request became a fake 200 serving the string "Offline"
// in place of whatever had been asked for.
{
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const code = sw.replace(/\/\/.*$/gm, '');

    check('sw.js still registers a fetch handler, which is what makes the app installable',
        /addEventListener\(\s*'fetch'/.test(code));
    check('sw.js does not answer requests itself (that is what broke the fonts)',
        !/respondWith/.test(code));
    check('sw.js never fabricates a response for a request that failed',
        !/new Response\s*\(/.test(code));
}

// --- report ----------------------------------------------------------------
if (failures.length) {
    console.error('FAIL - ' + failures.length + ' check(s)');
    failures.forEach(f => console.error('  !! ' + f));
    process.exit(1);
}
console.log('PASS - src/ui + dist/ui-bundle.js');
console.log('  freshness : the bundle is newer than every source it was built from');
console.log('  wiring    : index.html mounts #menuRoot and loads the bundle after main.js');
console.log('  departure : none of the old menu markup survives');
console.log('  seam      : every global the bridge calls exists, and only it calls them');
console.log('  seats     : the side picker names the player, not the colour');
console.log('  victory   : the guarded victory calls in remote-state.js still resolve');
console.log('  worker    : sw.js is installable without intercepting a single request');
