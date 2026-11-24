#!/bin/bash
pg_isready -h /home/pgtest -p 5498 >/dev/null 2>&1 && exit 0
cd /home/pgtest; rm -f data/postmaster.pid .s.PGSQL.5498*; su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /home/pgtest/data -l /home/pgtest/log -o '-p 5498 -k /home/pgtest' start -w" >/dev/null
