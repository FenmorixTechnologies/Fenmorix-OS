#!/bin/bash
# Clients & Quotes (vendor tool) test: Fenmorix Technologies' office install, license keys/office.lic (all + sales)
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-office; rm -rf $K; mkdir -p $K/license; cp keys/office.lic $K/license/nexus.lic
echo "== e2e61"
(export PRODUCT=fenmorix ORG_NAME="Fenmorix Technologies" ORG_SHORT=FX SYSTEM_DIR=$K; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e61.mjs > out-e2e61.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e61.txt | cut -c1-400; tail -1 out-e2e61.txt
