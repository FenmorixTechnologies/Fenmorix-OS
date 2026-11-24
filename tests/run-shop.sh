#!/bin/bash
# Retail modules test (a precious-metals shop on Fenmorix OS, demo spot prices)
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-shop; rm -rf $K; mkdir -p $K/license; cp keys/shop.lic $K/license/nexus.lic
echo "== e2e58"
(export PRODUCT=fenmorix ORG_NAME="Louisiana Gold & Coins" ORG_SHORT=LGC SPOT_PROVIDER=demo SYSTEM_DIR=$K; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e58.mjs > out-e2e58.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e58.txt | cut -c1-300; tail -1 out-e2e58.txt
