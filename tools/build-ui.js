#!/usr/bin/env node
// === React UI bundler (B1) ===
//
// FortHex is otherwise a no-build project: js/ is a list of plain <script> tags
// in dependency order, and that stays true. This script exists for exactly one
// reason — Track B1 adopts React, JSX is not something a browser runs, and
// Candidates F1 plans to migrate nearly every existing screen onto it. Writing
// that much UI without JSX was the alternative, and it was judged the worse cost.
//
// The contract with the rest of the codebase:
//
//   src/ui/**            hand-written React sources. Nothing else imports them.
//   dist/ui-bundle.js    the generated output, loaded by index.html as the LAST
//                        script on the page. Committed, so a clone can be opened
//                        straight from the filesystem with no npm install.
//
// The bundle is an IIFE, not a module, so it lives in the same global scope as
// everything else. That is what lets React components call StartSingleplayerGame
// or read `engine` as plain free identifiers — a top-level `const` in a classic
// script is a global lexical binding, visible to every script that runs after it.
// Going the other way, the bundle publishes window.FortHexUI; see src/ui/main.jsx.
//
// Usage:
//   npm run build          production bundle (minified, React production build)
//   npm run watch          rebuild on change
//   node tools/build-ui.js --dev    readable output + React dev warnings

const esbuild = require('esbuild');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const options = {
    entryPoints: [path.join(root, 'src/ui/main.jsx')],
    outfile: path.join(root, 'dist/ui-bundle.js'),
    bundle: true,

    // IIFE, deliberately — see the header. A module would get its own scope and
    // lose the free-identifier access to the game's globals that every screen needs.
    format: 'iife',

    // React 17+ automatic runtime, so no file has to import React just to use JSX.
    jsx: 'automatic',

    // React ships both builds behind this check. Without the define, esbuild keeps
    // the development build — a megabyte of it, plus every dev-only warning.
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },

    minify: !dev,
    sourcemap: true,

    // Without this, esbuild writes ABSOLUTE paths into the sourcemap (D:\...), and the
    // browser tries to resolve them as file:/// — which a page served over http is not
    // allowed to touch. It is harmless, but it prints a security error on every load
    // and buries the console output that actually matters.
    absWorkingDir: root,
    sourcesContent: true,
    target: ['es2020'],
    logLevel: 'info',
};

async function Main() {
    if (watch) {
        const context = await esbuild.context(options);
        await context.watch();
        console.log('[build-ui] watching src/ui/ — ctrl-c to stop.');
        return;
    }

    await esbuild.build(options);
    console.log('[build-ui] wrote dist/ui-bundle.js' + (dev ? ' (dev build)' : ''));
}

Main().catch((error) => {
    console.error('[build-ui] failed:', error.message);
    process.exit(1);
});
