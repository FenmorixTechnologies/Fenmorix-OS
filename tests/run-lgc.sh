#!/bin/bash
cd /home/claude/testrun; ./pg-up.sh >/dev/null 2>&1; export MFA_ADMINS=off
K=$PWD/sysroot-lgc; rm -rf $K; mkdir -p $K/license; cp keys/shop.lic $K/license/nexus.lic
export PRODUCT=fenmorix ORG_NAME="Louisiana Gold & Coins" ORG_SHORT=LGC SPOT_PROVIDER=demo SYSTEM_DIR=$K
./reset-db.sh >/dev/null 2>&1
# a morning of demo readings so the charts have a shape
psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -qc "INSERT INTO spot_points (at, metal, price) SELECT t, m, p FROM (SELECT g AS t FROM generate_series(date_trunc('day', now()), now() - interval '2 minutes', interval '5 minutes') g) s,
  LATERAL (VALUES ('gold', 2650 * (1 + 0.006*sin(extract(epoch FROM s.t)/2220) + 0.012*sin(extract(epoch FROM s.t)/13980))), ('silver', 31.2 * (1 + 0.006*sin(extract(epoch FROM s.t)/2880) + 0.012*sin(extract(epoch FROM s.t)/15720))),
  ('platinum', 965 * (1 + 0.006*sin(extract(epoch FROM s.t)/3540) + 0.012*sin(extract(epoch FROM s.t)/17460))), ('palladium', 1010 * (1 + 0.006*sin(extract(epoch FROM s.t)/4200) + 0.012*sin(extract(epoch FROM s.t)/19200)))) v(m, p) ON CONFLICT DO NOTHING"
timeout 300 node lgc-preview.mjs
