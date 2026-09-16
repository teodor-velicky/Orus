#!/usr/bin/env bash
# Compiles the pure running modules + tests with tsc and runs them with node.
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lib/run/__tests__"
cp "$ROOT/lib/format.ts" "$TMP/lib/"
cp "$ROOT/lib/run/geo.ts" "$ROOT/lib/run/zones.ts" "$ROOT/lib/run/plan.ts" "$ROOT/lib/run/load.ts" "$ROOT/lib/run/kcal.ts" "$ROOT/lib/run/workout.ts" "$TMP/lib/run/"
cp "$ROOT/lib/run/__tests__/"*.test.ts "$TMP/lib/run/__tests__/"
node "$ROOT/node_modules/typescript/bin/tsc" --ignoreConfig --module commonjs --target es2020 \
  --esModuleInterop --strict --types node --ignoreDeprecations 6.0 --skipLibCheck \
  --outDir "$TMP/out" --rootDir "$TMP" "$TMP/lib/run/__tests__/"*.test.ts
for f in "$TMP/out/lib/run/__tests__/"*.test.js; do
  echo "── $(basename "$f") ──"
  node "$f"
done
