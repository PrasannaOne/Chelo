#!/bin/sh
set -eu
rm -rf _site
mkdir -p _site/src
cp -a index.html manifest.webmanifest sw.js _headers .nojekyll assets models wasm benchmarks _site/
cp -a src/app src/engine src/nnue src/soul src/worker _site/src/
printf 'Chelo static site prepared in _site/\n'
