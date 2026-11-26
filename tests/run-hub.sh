#!/bin/bash
# Broadcast updates test: the office's update service + a server checking in (the same test server), license keys/office.lic
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1
K=$PWD/sysroot-hub; rm -rf $K; mkdir -p $K/license; cp keys/office.lic $K/license/nexus.lic
echo "== e2e63"
(export PRODUCT=fenmorix ORG_NAME="Fenmorix Technologies" ORG_SHORT=FX SYSTEM_DIR=$K UPDATER_COMMAND=/home/claude/testrun/fake-updater.sh FAKE_UPDATER_MS=1000 \
  UPDATE_AUTO_TICK_SECONDS=2 UPDATE_FIRST_CHECK_SECONDS=3600 MFA_ADMINS=off; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e63.mjs > out-e2e63.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e63.txt | cut -c1-400; tail -1 out-e2e63.txt
