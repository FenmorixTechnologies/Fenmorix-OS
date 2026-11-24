// Interdepartmental directory: people, stations/facilities, outside contacts,
// favorites, the blanket "verified" date and verification drives, and who's on duty.
//
// Privacy: home phone and emergency contact are seen only by the person, master
// admins and directory admins. Anyone can edit their own card; directory admins and
// master admins can edit anyone's card and the places. Name, division and role stay
// in User Management.
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { HttpError, isUuid, ROLE_LABEL, hasPerm } from "./collections.js";
import { onDuty, refreshNow, nextCheckAt, requestsToday, checkTimes } from "./aladtec.js";
import { clearAccessCache } from "./access.js";

const bad = m => new HttpError(400, m);
const forbid = m => new HttpError(403, m);
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const nz = (v, n) => clean(v, n) || null;
const iso = d => (d ? new Date(d).toISOString() : null);
const KINDS = ["station", "facility", "outside"];

async function audit(c, user, action, detail) {
  await c.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Directory', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, detail]);
}

export const placeJson = p => ({
  id: p.id, kind: p.kind, name: p.name, number: p.number || "", category: p.category || "", address: p.address || "",
  phone: p.phone || "", fax: p.fax || "", extension: p.extension || "", email: p.email || "", notes: p.notes || "",
  aladtecMatch: p.aladtec_match || "", sort: p.sort_order, updatedAt: iso(p.updated_at),
});

async function verificationState(c, user, admin) {
  const last = (await c.query(
    `SELECT v.*, u.full_name AS closed_by_name FROM directory_verifications v LEFT JOIN users u ON u.id = v.closed_by
      WHERE v.closed_at IS NOT NULL ORDER BY v.closed_at DESC LIMIT 1`)).rows[0];
  const open = (await c.query(
    `SELECT v.*, u.full_name AS started_by_name FROM directory_verifications v LEFT JOIN users u ON u.id = v.started_by
      WHERE v.closed_at IS NULL ORDER BY v.started_at DESC LIMIT 1`)).rows[0];
  let active = null;
  if (open) {
    const total = (await c.query("SELECT count(*)::int AS n FROM users WHERE active AND account_status = 'approved'")).rows[0].n;
    const done = (await c.query(
      `SELECT count(*)::int AS n FROM directory_confirmations dc JOIN users u ON u.id = dc.user_id
        WHERE dc.verification_id = $1 AND u.active`, [open.id])).rows[0].n;
    const mine = (await c.query("SELECT 1 FROM directory_confirmations WHERE verification_id = $1 AND user_id = $2", [open.id, user.id])).rowCount > 0;
    active = { id: open.id, startedAt: iso(open.started_at), startedBy: open.started_by_name || "", note: open.note || "", confirmed: done, total, mine };
  }
  return {
    lastVerifiedAt: last ? iso(last.closed_at) : null, lastVerifiedBy: last?.closed_by_name || "", lastNote: last?.note || "",
    active,
  };
}

export async function handleDirectory(req, res, parts, user, send, jsonBody) {
  const [, , a, b, c3] = parts;
  const body = req.method === "GET" ? {} : await jsonBody(req);
  const admin = await hasPerm(pool, user, "directory_admin");

  // ---- Everything the directory screen needs
  if (!a && req.method === "GET") {
    const people = (await pool.query(
      `SELECT u.*, d.name AS division FROM users u JOIN divisions d ON d.id = u.division_id
        WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows.map(u => {
      const o = {
        id: u.id, name: u.full_name, division: u.division, role: u.role, jobTitle: u.job_title || "", station: u.station || "",
        cellPhone: u.phone || "", email: u.email || "", extension: u.extension || "", callSign: u.call_sign || "",
      };
      if (admin || u.id === user.id) {
        o.homePhone = u.home_phone || "";
        o.emergency = { name: u.emergency_contact_name || "", phone: u.emergency_contact_phone || "", relationship: u.emergency_contact_relationship || "" };
      }
      return o;
    });
    const places = (await pool.query("SELECT * FROM directory_places ORDER BY kind, sort_order, number NULLS LAST, name")).rows.map(placeJson);
    const favorites = (await pool.query("SELECT target_type, target_id FROM directory_favorites WHERE user_id = $1", [user.id])).rows
      .map(f => ({ type: f.target_type, id: f.target_id }));
    const duty = onDuty();
    return send(res, 200, {
      people, places, favorites, canAdmin: admin, meId: user.id,
      verification: await verificationState(pool, user, admin),
      onDuty: { configured: duty.configured, updatedAt: duty.updatedAt, error: admin ? duty.error : "", assignments: duty.assignments },
    });
  }

  // ---- A person's card (themselves, or a directory admin)
  if (a === "people" && isUuid(b) && req.method === "POST") {
    if (b !== user.id && !admin) throw forbid("You can only change your own card.");
    const target = (await pool.query("SELECT full_name FROM users WHERE id = $1 AND active", [b])).rows[0];
    if (!target) throw new HttpError(404, "That person wasn't found.");
    const email = clean(body.email, 200).toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("Enter a valid email address.");
    await tx(async c => {
      await c.query(
        `UPDATE users SET job_title = $2, station = $3, phone = $4, home_phone = $5, email = COALESCE($6, email), extension = $7,
                emergency_contact_name = $8, emergency_contact_phone = $9, emergency_contact_relationship = $10,
                call_sign = CASE WHEN $11::boolean THEN $12 ELSE call_sign END
          WHERE id = $1`,
        [b, nz(body.jobTitle, 120), nz(body.station, 80), nz(body.cellPhone, 40), nz(body.homePhone, 40), email || null, nz(body.extension, 20),
          nz(body.emergency?.name, 120), nz(body.emergency?.phone, 40), nz(body.emergency?.relationship, 60),
          body.callSign !== undefined, String(body.callSign || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12)]);
      // Changing your card during a verification drive counts as confirming it
      const open = (await c.query("SELECT id FROM directory_verifications WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1")).rows[0];
      if (open && b === user.id) {
        await c.query(
          `INSERT INTO directory_confirmations (verification_id, user_id, changed) VALUES ($1, $2, true)
           ON CONFLICT (verification_id, user_id) DO UPDATE SET changed = true, confirmed_at = now()`, [open.id, b]);
      }
      clearAccessCache();   // home station / title changes move people between groups
      await audit(c, user, "Updated directory card", b === user.id ? "Own card" : target.full_name);
    });
    return send(res, 200, { ok: true });
  }

  // ---- Stations, facilities, outside contacts (directory admins)
  if (a === "places") {
    if (!admin) throw forbid("Only directory admins and master admins can change stations and contacts.");
    if (req.method === "POST") {
      const kind = KINDS.includes(body.kind) ? body.kind : null;
      if (!kind) throw bad("Bad kind");
      const name = clean(body.name, 160);
      if (!name) throw bad("Give it a name.");
      const id = isUuid(body.id) ? body.id : crypto.randomUUID();
      const vals = [id, kind, name, nz(body.number, 20), nz(body.category, 80), nz(body.address, 300), nz(body.phone, 40), nz(body.fax, 40),
        nz(body.extension, 20), nz(body.email, 200), nz(body.notes, 2000), nz(body.aladtecMatch, 200), Number(body.sort) || 100, user.id];
      await tx(async c => {
        await c.query(
          `INSERT INTO directory_places (id, kind, name, number, category, address, phone, fax, extension, email, notes, aladtec_match, sort_order, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, number = EXCLUDED.number, category = EXCLUDED.category,
             address = EXCLUDED.address, phone = EXCLUDED.phone, fax = EXCLUDED.fax, extension = EXCLUDED.extension, email = EXCLUDED.email,
             notes = EXCLUDED.notes, aladtec_match = EXCLUDED.aladtec_match, sort_order = EXCLUDED.sort_order,
             updated_by = EXCLUDED.updated_by, updated_at = now()`, vals);
        await audit(c, user, isUuid(body.id) ? "Updated directory entry" : "Added directory entry", name);
      });
      return send(res, 200, { id });
    }
    if (req.method === "DELETE" && isUuid(b)) {
      await tx(async c => {
        const r = await c.query("DELETE FROM directory_places WHERE id = $1 RETURNING name", [b]);
        await c.query("DELETE FROM directory_favorites WHERE target_type = 'place' AND target_id = $1", [b]);
        if (r.rowCount) await audit(c, user, "Removed directory entry", r.rows[0].name);
      });
      return send(res, 200, { ok: true });
    }
  }

  // ---- Favorites (each person's own)
  if (a === "favorites" && req.method === "POST") {
    if (!["person", "place"].includes(body.type) || !isUuid(body.id)) throw bad("Bad favorite");
    if (body.on) {
      await pool.query("INSERT INTO directory_favorites (user_id, target_type, target_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [user.id, body.type, body.id]);
    } else {
      await pool.query("DELETE FROM directory_favorites WHERE user_id = $1 AND target_type = $2 AND target_id = $3", [user.id, body.type, body.id]);
    }
    return send(res, 200, { ok: true });
  }

  // ---- Verification drives
  if (a === "verification") {
    const open = (await pool.query("SELECT * FROM directory_verifications WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1")).rows[0];
    if (b === "confirm" && req.method === "POST") {
      if (!open) throw bad("There's no directory check going on right now.");
      await pool.query(
        `INSERT INTO directory_confirmations (verification_id, user_id, changed) VALUES ($1, $2, false)
         ON CONFLICT (verification_id, user_id) DO UPDATE SET confirmed_at = now()`, [open.id, user.id]);
      return send(res, 200, { ok: true });
    }
    if (!admin) throw forbid("Only directory admins and master admins can run directory checks.");
    if (b === "start" && req.method === "POST") {
      if (open) throw bad("A directory check is already going on.");
      const id = crypto.randomUUID();
      await tx(async c => {
        await c.query("INSERT INTO directory_verifications (id, started_by, note) VALUES ($1, $2, $3)", [id, user.id, nz(body.note, 500)]);
        await audit(c, user, "Started directory check", clean(body.note, 500));
      });
      return send(res, 200, { id });
    }
    if (b === "close" && req.method === "POST") {
      if (!open) throw bad("There's no directory check going on right now.");
      await tx(async c => {
        await c.query("UPDATE directory_verifications SET closed_at = now(), closed_by = $2, note = COALESCE($3, note) WHERE id = $1", [open.id, user.id, nz(body.note, 500)]);
        await audit(c, user, "Marked directory verified", clean(body.note, 500));
      });
      return send(res, 200, { ok: true });
    }
    // Mark the whole directory verified without a drive (e.g. checked against a printed list)
    if (b === "stamp" && req.method === "POST") {
      if (open) throw bad("Finish the directory check that's going on first.");
      await tx(async c => {
        await c.query("INSERT INTO directory_verifications (id, started_by, closed_at, closed_by, note) VALUES ($1, $2, now(), $2, $3)",
          [crypto.randomUUID(), user.id, nz(body.note, 500)]);
        await audit(c, user, "Marked directory verified", clean(body.note, 500));
      });
      return send(res, 200, { ok: true });
    }
    if (b === "status" && req.method === "GET") {
      if (!open) return send(res, 200, { active: null, people: [] });
      const r = await pool.query(
        `SELECT u.id, u.full_name, d.name AS division, dc.confirmed_at, dc.changed
           FROM users u JOIN divisions d ON d.id = u.division_id
           LEFT JOIN directory_confirmations dc ON dc.user_id = u.id AND dc.verification_id = $1
          WHERE u.active AND u.account_status = 'approved' ORDER BY (dc.confirmed_at IS NULL) DESC, d.name, u.full_name`, [open.id]);
      return send(res, 200, {
        active: { id: open.id, startedAt: iso(open.started_at) },
        people: r.rows.map(x => ({ id: x.id, name: x.full_name, division: x.division, confirmedAt: iso(x.confirmed_at), changed: x.changed })),
      });
    }
  }

  // ---- Your Day: does this person still need to confirm their card?
  if (a === "check" && req.method === "GET") {
    return send(res, 200, { confirmPending: await pendingConfirmation(user) });
  }

  // ---- Your Day "On duty today" widget: today's shift for everyone. Leave types (vacation,
  // sick, workers' comp...) and connection errors only for directory/master admins.
  if (a === "duty" && req.method === "GET") {
    const d = onDuty();
    if (!d.configured) return send(res, 200, { configured: false });
    const places = (await pool.query("SELECT * FROM directory_places WHERE kind = 'station' ORDER BY sort_order, name")).rows.map(placeJson);
    const strip = ({ phone, startMs, stopMs, ...rest }) => rest;
    return send(res, 200, {
      configured: true, updatedAt: d.updatedAt, shiftStartTime: d.shiftStartTime || "07:00",
      assignments: (d.assignments || []).map(strip), today: (d.today || []).map(strip),
      timeOff: (d.timeOff || []).map(o => ({ name: o.name, start: o.start, stop: o.stop, type: admin ? o.type : "" })),
      todayError: admin ? d.todayError || "" : "", timeOffError: admin ? d.timeOffError || "" : "",
      error: admin ? d.error || "" : d.error ? "Aladtec can't be reached right now." : "",
      places,
    });
  }

  // ---- Aladtec: refresh now and show what it sees (to set up station matching)
  if (a === "aladtec") {
    if (!admin) throw forbid("Only directory admins and master admins can see the Aladtec setup.");
    const snap = req.method === "POST" ? await refreshNow() : onDuty();
    return send(res, 200, { ...snap, nextCheckAt: nextCheckAt(), requests: requestsToday(), checkTimes: process.env.ALADTEC_REFRESH_MINUTES ? null : checkTimes() });
  }

  throw new HttpError(404, "Not found");
}

// For Your Day: is there a directory check this person still needs to confirm?
export async function pendingConfirmation(user) {
  const open = (await pool.query("SELECT id FROM directory_verifications WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1")).rows[0];
  if (!open) return false;
  return (await pool.query("SELECT 1 FROM directory_confirmations WHERE verification_id = $1 AND user_id = $2", [open.id, user.id])).rowCount === 0;
}
