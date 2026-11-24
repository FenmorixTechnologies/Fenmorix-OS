#!/bin/bash
# Setup wizard test: a fake customer-kit install (what install-ubuntu.sh --kit leaves behind)
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-kit; rm -rf $K; mkdir -p $K/branding/setup $K/license
printf '{"org":"Acme County Government","short":"ACG","place":"Acme","app":"","colors":{"accent":"#1E6BD6"},"terms":{},"setup":"pending"}' > $K/branding/branding.json
cp test-logo.png $K/branding/setup/logo.png; cp keys/lakeview.lic $K/license/nexus.lic
echo "== e2e57"
(export PRODUCT=fenmorix ORG_NAME="Acme County Government" ORG_SHORT=ACG SYSTEM_DIR=$K; ./reset-db.sh >/dev/null 2>&1; timeout 500 node e2e57.mjs > out-e2e57.txt 2>&1)
grep "^FAIL\|^ERR" out-e2e57.txt | cut -c1-300; tail -1 out-e2e57.txt
