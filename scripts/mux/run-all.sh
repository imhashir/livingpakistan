#!/bin/bash
# Runs the whole mobile audit, one browser at a time (SwiftShader at DPR 2
# needs ~1.5 GB per browser; parallel runs get OOM-killed on a small box).
# Needs the built site served: npx vite preview --port 4391 --strictPort
# and, for the PR #2 comparison, the perf branch served on 4392.
#   bash scripts/mux/run-all.sh > /tmp/mux-queue.log 2>&1
cd "$(dirname "$0")/../.."
run() { echo "=== $(date -u +%T) $*"; "$@"; echo "=== $(date -u +%T) exit $?"; }
run node scripts/mux/matrix.mjs i14
run node scripts/mux/flows.mjs gestures,back,inputs,explorer,hover,tourz,ghost,covered
run node scripts/mux/matrix.mjs land
MUX_STATES=home,lenses,tours,inspCity,guide,tourOpen,explore,duel,search run node scripts/mux/matrix.mjs tab768,tab820
run node scripts/mux/flows.mjs safearea,short,rotate,labels,walk,deeplink,tablet,motion,load
MUX_STATES=home,lenses,light,more,tours,search,explore,duel,guide,inspCity,almanac,surprise,eras,tourOpen run node scripts/mux/matrix.mjs se,android
MUX_STATES=home,lenses,inspCity,tourOpen run node scripts/mux/matrix.mjs max
MUX_BASE=http://127.0.0.1:4392/ run node scripts/mux/perf-compare.mjs perf
run node scripts/mux/perf-compare.mjs mobile
echo "=== QUEUE DONE"
python3 scripts/mux/annotate.py scripts/mux/annotate-spec.json
