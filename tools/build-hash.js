// FortHex — print the source fingerprint  (InDev)
//
//   node tools/build-hash.js            the short hash
//   node tools/build-hash.js --files    every file's hash, for diffing two builds
//
// Same computation the host serves at /build, so a hash read off the screen and one
// read here are directly comparable. That is the point: it answers "am I testing what
// I think I am testing" without having to trust a build step to have been run.

const { ComputeBuildHash, ComputeFileHashes } = require('../host/build-hash.js');

const build = ComputeBuildHash();

if (process.argv.includes('--files')) {
    const hashes = ComputeFileHashes();
    Object.keys(hashes).sort().forEach(file => {
        console.log(hashes[file] + '  ' + file);
    });
    console.log('');
}

console.log('source hash : ' + build.hash);
console.log('files       : ' + build.files);
console.log('newest edit : ' + new Date(build.newestMtime).toLocaleString());
