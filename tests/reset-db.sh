#!/bin/bash
# Recreate a database like the user's: schema.sql loaded by hand + Phase 1 data
P="psql -h /home/pgtest -p 5498"
$P -U postgres -qc "DROP DATABASE IF EXISTS sgfd WITH (FORCE)" && $P -U postgres -qc 'CREATE DATABASE sgfd OWNER sgfd_app'
$P -U sgfd_app -d sgfd -q -f /home/claude/sgfd-app/db/schema.sql >/dev/null
$P -U sgfd_app -d sgfd -q <<'SQL'
INSERT INTO users (id, full_name, division_id, role) VALUES ('11111111-1111-4111-8111-111111111111','Mike Admin',(SELECT id FROM divisions WHERE name='Administration'),'master');
INSERT INTO users (id, full_name, division_id, role) VALUES ('22222222-2222-4222-8222-222222222222','Old Timer',(SELECT id FROM divisions WHERE name='Training'),'user');
INSERT INTO vendors (id, name) VALUES ('33333333-3333-4333-8333-333333333333','Phase One Vendor');
INSERT INTO requisitions (division_id, category_id, title, vendor_id, amount, requested_by, requested_by_name)
VALUES ((SELECT id FROM divisions WHERE name='Administration'),1,'Phase 1 requisition','33333333-3333-4333-8333-333333333333',125,'11111111-1111-4111-8111-111111111111','Mike Admin');
BEGIN;
SET LOCAL sgfd.importing = 'on';
INSERT INTO requisitions (id, division_id, category_id, title, vendor_id, amount, requested_by_name, status, paid_at, created_at)
VALUES ('44444444-4444-4444-8444-444444444444',(SELECT id FROM divisions WHERE name='Administration'),1,'Paid Phase 1 requisition','33333333-3333-4333-8333-333333333333',500,'Mike Admin','paid', now() - interval '3 days', now() - interval '10 days');
INSERT INTO requisition_signatures (requisition_id, stage, signer_name, decision) VALUES
 ('44444444-4444-4444-8444-444444444444','auth1','Mike Admin','approved'),('44444444-4444-4444-8444-444444444444','auth2','Mike Admin','approved'),('44444444-4444-4444-8444-444444444444','chief','Mike Admin','approved');
INSERT INTO requisitions (division_id, category_id, title, vendor_id, amount, requested_by_name, status)
VALUES ((SELECT id FROM divisions WHERE name='Administration'),1,'Approved Phase 1 requisition','33333333-3333-4333-8333-333333333333',90,'Mike Admin','approved');
INSERT INTO requisitions (division_id, category_id, title, vendor_id, amount, requested_by_name, status, rejected_reason)
VALUES ((SELECT id FROM divisions WHERE name='Administration'),1,'Rejected Phase 1 requisition','33333333-3333-4333-8333-333333333333',70,'Mike Admin','rejected','too much');
COMMIT;
SQL
rm -rf /home/claude/testrun/app/uploads
# restart the app server so it runs its startup migrations
for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done; sleep 1
cd /home/claude/testrun/app && LIVE_EVENTS=${LIVE_EVENTS:-off} nohup node server/index.js --production > server.log 2>&1 &
echo $! > /home/claude/testrun/app/server.pid
sleep 3
