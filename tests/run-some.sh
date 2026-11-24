#!/bin/bash
# usage: run-some.sh "ENV=.. test" ...   results to run-some.log
cd /home/claude/testrun; ./pg-up.sh; : > run-some.log
export MFA_ADMINS=${MFA_ADMINS:-off}
for spec in "$@"; do
  envs="${spec% *}"; t="${spec##* }"; [ "$envs" = "$spec" ] && envs=""
  env $envs ./reset-db.sh > /dev/null 2>&1
  echo "== $t" >> run-some.log
  timeout 600 node $t.mjs > out-r-$t.txt 2>&1
  grep -A1 "^FAIL\|^ERR" out-r-$t.txt | head -8 >> run-some.log
  tail -1 out-r-$t.txt >> run-some.log
done
echo ALLDONE >> run-some.log
