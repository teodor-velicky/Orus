#!/usr/bin/env bash
# Compiles the pure ring modules + tests with tsc and runs them with node.
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src/__tests__" "$TMP/node_modules"
cp "$ROOT/lib/ring/aggregate.ts" "$ROOT/lib/ring/packet.ts" "$ROOT/lib/ring/types.ts" "$ROOT/lib/ring/custom.ts" "$TMP/src/"
printf "export type SleepStage = 'core' | 'deep' | 'rem' | 'awake' | 'asleep' | 'in_bed'\n" > "$TMP/types.ts"
cp -r "$ROOT/node_modules/base64-arraybuffer" "$TMP/node_modules/"
cp "$ROOT/lib/ring/__tests__/"*.test.ts "$TMP/src/__tests__/"
node "$ROOT/node_modules/typescript/bin/tsc" --ignoreConfig --module commonjs --target es2020 \
  --esModuleInterop --strict --types node --ignoreDeprecations 6.0 --skipLibCheck \
  --outDir "$TMP/out" --rootDir "$TMP" "$TMP/src/__tests__/"*.test.ts
cp -r "$TMP/node_modules" "$TMP/out/"
for f in "$TMP/out/src/__tests__/"*.test.js; do
  echo "── $(basename "$f") ──"
  node "$f"
done
