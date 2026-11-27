#!/bin/bash
# Client portal test: office on localhost:3077, the portal on 127.0.0.1:3077 (PORTAL_HOST), license keys/office.lic
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1
K=$PWD/sysroot-portal; rm -rf $K; mkdir -p $K/license; cp keys/office.lic $K/license/nexus.lic
echo "== e2e64"
(export PRODUCT=fenmorix ORG_NAME="Fenmorix Technologies" ORG_SHORT=FX SYSTEM_DIR=$K PORTAL_HOST=127.0.0.1 PORTAL_URL=http://127.0.0.1:3077 MFA_ADMINS=off WEBSITE_FORM_SECRET=test-website-secret-0123456789abcdef; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e64.mjs > out-e2e64.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e64.txt | cut -c1-400; tail -1 out-e2e64.txt
