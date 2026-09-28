#!/usr/bin/env bash
# Compiles the pure health modules (readiness, energy, insights) + tests and runs them with node.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lib/run" "$TMP/lib/__tests__"
cp "$ROOT/lib/format.ts" "$ROOT/lib/types.ts" "$ROOT/lib/nutrients.ts" \
   "$ROOT/lib/readiness.ts" "$ROOT/lib/energy.ts" "$ROOT/lib/insights.ts" "$ROOT/lib/sleep.ts" "$ROOT/lib/strain.ts" "$ROOT/lib/naps.ts" "$ROOT/lib/journal.ts" "$TMP/lib/"
cp "$ROOT/lib/run/load.ts" "$TMP/lib/run/"
cp "$ROOT/lib/__tests__/"*.test.ts "$TMP/lib/__tests__/"
node "$ROOT/node_modules/typescript/bin/tsc" --ignoreConfig --module commonjs --target es2020 \
  --esModuleInterop --strict --types node --ignoreDeprecations 6.0 --skipLibCheck \
  --outDir "$TMP/out" --rootDir "$TMP" "$TMP/lib/__tests__/"*.test.ts
for f in "$TMP/out/lib/__tests__/"*.test.js; do
  echo "── $(basename "$f") ──"
  node "$f"
done
