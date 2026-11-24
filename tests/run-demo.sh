#!/bin/bash
# Sandbox demo modules (System page switches)
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
rm -rf sysroot-demo; mkdir sysroot-demo
echo "== e2e59"; (export SANDBOX=on SYSTEM_DIR=$PWD/sysroot-demo; ./reset-db.sh >/dev/null 2>&1; timeout 300 node e2e59.mjs > out-e2e59.txt 2>&1); grep "^FAIL\|^ERR" out-e2e59.txt | cut -c1-300; tail -1 out-e2e59.txt
