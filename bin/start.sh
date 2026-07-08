#!/usr/bin/env bash
#
# Production entrypoint: run the web server and the firehose ingester as two
# separate OS processes on the *same* machine.
#
# They must share a machine because both read/write a single SQLite file on the
# mounted volume (WAL + busy_timeout, see src/db.ts). Fly volumes can't be
# shared across machines, so a fly.toml `[processes]` split would give each its
# own empty DB. Separate OS processes here keep the CPU-heavy firehose decoding
# off the HTTP event loop while sharing the same DB file.
#
# If either process exits, tear the other down and exit non-zero so Fly restarts
# the whole machine cleanly.
set -euo pipefail

node dist/ingester-runner.js &
ingester_pid=$!

node dist/index.js &
web_pid=$!

# Wait for whichever process exits first, capturing its status.
wait -n
status=$?

kill "$ingester_pid" "$web_pid" 2>/dev/null || true
wait 2>/dev/null || true

exit "$status"
