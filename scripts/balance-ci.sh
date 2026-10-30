#!/usr/bin/env bash
# Regenerate docs/balance.md on the platform CI uses (linux/amd64, Node 24) so the committed report
# is byte-identical to what the CI freshness step produces. Float results differ between CPU
# architectures (Apple Silicon vs x64), so a report generated natively on a Mac reads as stale in CI.
# Needs Docker. Extra arguments are passed to scripts/balance.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
commit=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- src scripts package-lock.json)" ]; then commit="$commit-dirty"; fi
docker run --rm --platform linux/amd64 -e BALANCE_COMMIT="$commit" -v "$PWD":/src:ro -v "$PWD/docs":/out node:24 bash -c '
  set -euo pipefail
  mkdir /w && cd /src && tar --exclude=node_modules --exclude=.git --exclude=dist -cf - . | tar -xf - -C /w
  cd /w && npm ci >/dev/null 2>&1
  npx tsx scripts/balance.ts --out /out/balance.md "$@"
' _ "$@"
