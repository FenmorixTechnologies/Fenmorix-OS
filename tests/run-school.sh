#!/bin/bash
# Gradebook (e2e66): a school on Fenmorix OS, license keys/school.lic (all + gradebook)
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-school; rm -rf $K; mkdir -p $K/license; cp keys/school.lic $K/license/nexus.lic
echo "== e2e66"
(export PRODUCT=fenmorix ORG_NAME="Riverbend Elementary" ORG_SHORT=RES SYSTEM_DIR=$K; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e66.mjs > out-e2e66.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e66.txt | cut -c1-400; tail -1 out-e2e66.txt
