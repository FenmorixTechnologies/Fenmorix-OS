-- Aladtec units are named <type><station><unit digit>, e.g. EG613 = Engine at Station 61.
-- Stations still on the original plain-number match ("61") get the pattern "??61*",
-- which matches EG613, LD618, SQ615, MD617 ... Matches someone already edited are kept.
UPDATE directory_places
   SET aladtec_match = '??' || number || '*'
 WHERE kind = 'station'
   AND number ~ '^[0-9]{2}$'
   AND (aladtec_match IS NULL OR btrim(aladtec_match) = '' OR btrim(aladtec_match) = number);
