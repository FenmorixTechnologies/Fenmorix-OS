#!/bin/bash
# Main menu groups (e2e65): business install with the shop license
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-menu; rm -rf $K; mkdir -p $K/license; cp keys/shop.lic $K/license/nexus.lic
echo "== e2e65"
(export PRODUCT=fenmorix ORG_NAME="Demo Coin Shop" ORG_SHORT=DCS SPOT_PROVIDER=demo SYSTEM_DIR=$K; ./reset-db.sh >/dev/null 2>&1; timeout 400 node e2e65.mjs > out-e2e65.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e65.txt | cut -c1-400; tail -1 out-e2e65.txt
