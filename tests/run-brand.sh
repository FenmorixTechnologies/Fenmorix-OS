#!/bin/bash
# Branding page test in both modes (the test itself reads SYSTEM_DIR / NEXUS_MODE, so they go to the test too)
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
rm -rf sysroot-brand sysroot-nexus; mkdir sysroot-brand sysroot-nexus
echo "== e2e56 fenmorix"; (export SANDBOX=on SYSTEM_DIR=$PWD/sysroot-brand; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e56.mjs > out-e2e56a.txt 2>&1); grep "^FAIL\|^ERR" out-e2e56a.txt | cut -c1-250; tail -1 out-e2e56a.txt
echo "== e2e56 nexus"; (export NEXUS_MODE=1 SYSTEM_DIR=$PWD/sysroot-nexus; ./reset-db.sh >/dev/null 2>&1; timeout 300 node e2e56.mjs > out-e2e56b.txt 2>&1); grep "^FAIL\|^ERR" out-e2e56b.txt | cut -c1-250; tail -1 out-e2e56b.txt
