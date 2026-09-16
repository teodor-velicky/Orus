#!/usr/bin/env bash
# Compiles the pure engine modules + tests with the project's tsc and runs
# them with node. Strips Deno-style .ts import extensions for the node build.
set -e
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/src/__tests__"
sed "s|from './nutrients.ts'|from './nutrients'|" "$ROOT/supabase/functions/_shared/scoring.ts" > "$TMP/src/scoring.ts"
cp "$ROOT/supabase/functions/_shared/nutrients.ts" "$TMP/src/nutrients.ts"
cp "$ROOT/supabase/functions/_shared/correlations.ts" "$TMP/src/correlations.ts"
cp "$ROOT/supabase/functions/_shared/__tests__"/*.test.ts "$TMP/src/__tests__/"

node "$ROOT/node_modules/typescript/bin/tsc" \
  --ignoreConfig --module commonjs --target es2020 --esModuleInterop --strict --types node --ignoreDeprecations 6.0 \
  --outDir "$TMP/out" "$TMP/src/__tests__/"*.test.ts

for f in "$TMP/out/__tests__/"*.test.js; do
  echo "── $(basename "$f") ──"
  node "$f"
done
