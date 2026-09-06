// FortHex — headless harness for the React UI bundle  (Track B1)
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
    // Compared as <script> tags, not raw substrings — both paths are also named in
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
// its /* global */ block. This checks that block against reality — a renamed
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
                String.raw`(?:^|\n)\s*(?:function\s+${name}\b|(?:const|let|var)\s+${name}\b)`
            ).test(source);
            check('js/ still declares `' + name + '`, which the menu calls', declaredInJs);
        });
    }

    // The rule the bridge exists to enforce. If a component reaches past it, the seam
    // is decorative — so no other file under src/ui may name a game global directly.
    // Comments are stripped first. The rule is about what the CODE reaches for, and a
    // file that documents why the engine is off-limits should not be reported for
    // saying so — which is exactly what happened the first time a screen explained the
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

// --- report ----------------------------------------------------------------
if (failures.length) {
    console.error('FAIL — ' + failures.length + ' check(s)');
    failures.forEach(f => console.error('  !! ' + f));
    process.exit(1);
}
console.log('PASS — src/ui + dist/ui-bundle.js');
console.log('  freshness : the bundle is newer than every source it was built from');
console.log('  wiring    : index.html mounts #menuRoot and loads the bundle after main.js');
console.log('  departure : none of the old menu markup survives');
console.log('  seam      : every global the bridge calls exists, and only it calls them');
