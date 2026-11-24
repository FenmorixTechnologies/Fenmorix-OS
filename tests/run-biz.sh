#!/bin/bash
# A business on Fenmorix OS (Organization settings, divisions, sick types, Work Schedule): e2e60 with the shop license
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-biz; rm -rf $K; mkdir -p $K/license; cp keys/shop.lic $K/license/nexus.lic
echo "== e2e60"
(export PRODUCT=fenmorix ORG_NAME="Demo Coin Shop" ORG_SHORT=DCS SPOT_PROVIDER=demo SYSTEM_DIR=$K; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e60.mjs > out-e2e60.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e60.txt | cut -c1-400; tail -1 out-e2e60.txt
