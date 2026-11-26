// Accounts and sign-in.
//
// - Passwords are hashed with scrypt (built into Node); only hashes are stored.
// - A session is a random token kept in an HttpOnly cookie; the database
//   stores only its SHA-256 hash.
// - New sign-ups wait for a master admin to approve them and set their role.
import crypto from "node:crypto";
import { brand, brandText, brandDeep, isSandbox } from "./brand.js";
import { LIVE } from "./events.js";
import { promisify } from "node:util";
import { allow } from "./ratelimit.js";
import { pool, tx } from "./db.js";
import { ROLE_LABEL, HttpError, isUuid, setSignDivisions, hasPerm } from "./collections.js";

const scrypt = promisify(crypto.scrypt);
export const COOKIE = "sgfd_session";
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
// Signed out after this many minutes without using the app (background refreshes don't count)
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 60);
import { clientIp, isLocalRequest } from "./clientip.js";
const MIN_PASSWORD = 10;
// Passwords expire after this many days (0 = never). Admins (master, accounts admin) also need an authenticator code to sign in
// unless MFA_ADMINS=off (tests only).
export const PASSWORD_MAX_DAYS = Math.max(0, Number(process.env.PASSWORD_MAX_DAYS ?? 90));
const MFA_ADMINS = String(process.env.MFA_ADMINS || "on").toLowerCase() !== "off";
export const PASSWORD_RULE = "At least 10 characters, with a capital letter, a lowercase letter and a symbol (like ! - # or a space).";

// ---------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(key, expected);
}

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return "That password is too long (200 characters at most).";
  const miss = [!/[A-Z]/.test(pw) && "a capital letter", !/[a-z]/.test(pw) && "a lowercase letter", !/[^A-Za-z0-9]/.test(pw) && "a symbol (like ! - # or a space)"].filter(Boolean);
  return miss.length ? `Add ${miss.join(" and ")}.` : "";
}
function checkNewPassword(pw) {
  const p = passwordProblem(pw);
  if (p) throw new HttpError(400, `${p} ${PASSWORD_RULE}`);
}

// Readable temporary passwords, e.g. "ember-hydrant-4821"
const WORDS = ["ember", "hydrant", "ladder", "engine", "station", "siren", "hose", "nozzle", "rescue", "tower",
  "brass", "anchor", "harbor", "cedar", "maple", "river", "bayou", "pelican", "magnolia", "levee"];
function tempPassword() {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  const cap = x => x[0].toUpperCase() + x.slice(1);
  return `${cap(w())}-${w()}-${crypto.randomInt(1000, 10000)}`;
}

const normEmail = e => String(e || "").trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieHeader(value, maxAgeSeconds, secure) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

async function startSession(userId, req, { pending = false } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  // A session still waiting for its authenticator code lasts 10 minutes
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip, mfa_pending)
     VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5, $6)`,
    [sha256(token), userId, pending ? 10 : SESSION_HOURS * 60, String(req.headers["user-agent"] || "").slice(0, 300), clientIp(req), pending]);
  if (!pending) await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
  return cookieHeader(token, SESSION_HOURS * 3600, req.secure);
}

// The signed-in person for this request, or null. A session still owing its authenticator code counts only with
// {allowPending: true} (the sign-in steps), and then carries mfaPending.
export async function getSessionUser(req, { allowPending = false } = {}) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const r = await pool.query(
    `SELECT u.id, u.full_name AS name, u.role, u.email, u.must_change_password, u.must_change_reason, d.name AS division,
            s.last_seen_at, (now() - s.last_seen_at > make_interval(mins => $2)) AS idle, s.mfa_at, s.inv_seen_at, s.mfa_pending
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN divisions d ON d.id = u.division_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND u.active AND u.account_status = 'approved'`, [hash, IDLE_MINUTES]);
  const u = r.rows[0];
  if (!u) return null;
  if (u.mfa_pending && !allowPending) return null;
  u.mfaPending = !!u.mfa_pending; delete u.mfa_pending;
  if (IDLE_MINUTES > 0 && u.idle) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hash]);
    return null;
  }
  // Background refreshes (Your Day checking for new items) don't keep an idle session alive
  const background = req.headers["x-sgfd-background"] === "1" || String(req.url || "").startsWith("/api/events");
  if (!background && Date.now() - new Date(u.last_seen_at) > 30_000) {
    await pool.query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [hash]);
  }
  u.sessionHash = hash;
  delete u.last_seen_at; delete u.idle;
  return u;
}

async function audit(actor, action, detail) {
  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail)
     VALUES ($1, $2, $3, 'Accounts', $4, $5)`,
    [actor?.id ?? null, actor?.name ?? "System", actor ? (ROLE_LABEL[actor.role] || actor.role) : "System", action, detail || ""]);
}

// ---------------------------------------------------------------------
// Repeated wrong passwords lock that email out for 15 minutes
// ---------------------------------------------------------------------

const failures = new Map();   // email -> { count, until }
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
function lockedOut(email) {
  const f = failures.get(email);
  return f && f.until && f.until > Date.now();
}
function noteFailure(email) {
  const f = failures.get(email) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) { f.until = Date.now() + 15 * 60 * 1000; f.count = 0; }
  failures.set(email, f);
  if (failures.size > 5000) for (const [k, v] of failures) { if (!v.until || v.until < Date.now()) failures.delete(k); if (failures.size <= 2500) break; }
}

// ---------------------------------------------------------------------
// Endpoints (all under /api/auth/)
// ---------------------------------------------------------------------

async function noPasswordsYet() {
  const r = await pool.query("SELECT count(*)::int AS n FROM users WHERE password_hash IS NOT NULL AND account_status = 'approved'");
  return r.rows[0].n === 0;
}


function requireMaster(user) {
  if (!user || user.role !== "master") throw new HttpError(403, "Only a master admin can do that.");
}
// Master admins, or people given the "accounts admin" permission (approve requests, reset passwords)
async function requireAccounts(user) {
  if (!(await hasPerm(pool, user, "accounts_admin"))) throw new HttpError(403, "Only master admins and accounts admins can do that.");
}

// Who must give an authenticator code to sign in: master admins and accounts admins
async function mfaRequired(u) {
  if (!MFA_ADMINS) return false;
  return u.role === "master" || (await hasPerm(pool, { id: u.id, role: u.role }, "accounts_admin"));
}
const passwordSet = "password_changed_at = now(), must_change_password = false, must_change_reason = ''";
const PUBLIC_URL = () => String(brand().url || process.env.PUBLIC_URL || "").replace(/\/+$/, "");

export async function handleAuth(req, res, action, body, user, send, pending = null) {
  if (action.startsWith("mfa-")) return handleMfa(req, res, action, body, user || pending, send);
  if (action === "forgot" || action === "reset-check" || action === "reset") return handleReset(req, res, action, body, send);
  switch (action) {

    // Who am I? Also tells the sign-in screen what to show.
    case "me": {
      if (!user) {
        const divisions = (await pool.query("SELECT name FROM divisions ORDER BY name")).rows.map(r => r.name);
        const { mailConfigured } = await import("./mail.js");
        let mfa = null;
        if (pending) {
          const t = (await pool.query("SELECT totp_enabled_at, mfa_locked_at FROM users WHERE id = $1", [pending.id])).rows[0];
          mfa = { setup: !t?.totp_enabled_at, locked: !!t?.mfa_locked_at, name: pending.name };
        }
        return send(res, 200, { user: null, firstRun: await noPasswordsYet(), firstRunAllowedHere: isLocalRequest(req), divisions,
          mfaPending: mfa, resetByEmail: mailConfigured(), passwordRule: PASSWORD_RULE });
      }
      let pendingCount = 0;
      if (await hasPerm(pool, user, "accounts_admin")) {
        pendingCount = (await pool.query("SELECT count(*)::int AS n FROM users WHERE account_status = 'pending' AND active")).rows[0].n;
      }
      return send(res, 200, {
        user: { id: user.id, name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role], division: user.division,
                email: user.email, mustChangePassword: user.must_change_password, mustChangeReason: user.must_change_reason || "",
                passwordRule: PASSWORD_RULE },
        pendingCount, live: LIVE,
      });
    }

    case "login": {
      const email = normEmail(body.email);
      if (lockedOut(email)) throw new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.");
      // Many tries from one address against many accounts (password spraying): slow it to 30 a minute per address
      if (!allow(`login:${clientIp(req)}`, 30, 60_000)) throw new HttpError(429, "Too many sign-in attempts from this address. Wait a minute and try again.");
      const r = await pool.query(
        "SELECT id, role, password_hash, account_status, active, password_changed_at, must_change_password FROM users WHERE lower(email) = $1", [email]);
      const u = r.rows[0];
      // Always check a password (a stand-in hash when there's no such account) so the answer takes the same time either way
      const ok = (await verifyPassword(String(body.password || ""), u?.password_hash || DUMMY_HASH)) && !!u && u.active && !!u.password_hash;
      if (!ok) {
        noteFailure(email);
        await audit(null, "Sign-in failed", `${email.slice(0, 120)} from ${clientIp(req)}`);
        throw new HttpError(401, "That email and password don't match.");
      }
      failures.delete(email);
      if (u.account_status !== "approved") {
        throw new HttpError(403, "Your account is waiting for a master admin to approve it.");
      }
      // Expired (older than PASSWORD_MAX_DAYS): signs in, but has to choose a new password before anything else
      if (PASSWORD_MAX_DAYS && !u.must_change_password && (!u.password_changed_at || Date.now() - new Date(u.password_changed_at) > PASSWORD_MAX_DAYS * 86400e3)) {
        if (!u.password_changed_at) await pool.query("UPDATE users SET password_changed_at = now() WHERE id = $1", [u.id]);
        else await pool.query("UPDATE users SET must_change_password = true, must_change_reason = 'expired' WHERE id = $1", [u.id]);
      }
      const needMfa = await mfaRequired(u);
      res.setHeader("Set-Cookie", await startSession(u.id, req, { pending: needMfa }));
      const me = (await pool.query("SELECT id, full_name AS name, role, totp_enabled_at FROM users WHERE id = $1", [u.id])).rows[0];
      if (needMfa) return send(res, 200, { ok: true, mfa: me.totp_enabled_at ? "verify" : "setup" });
      await audit(me, "Signed in", "");
      return send(res, 200, { ok: true });
    }

    case "logout": {
      const token = readCookie(req, COOKIE);
      if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
      res.setHeader("Set-Cookie", cookieHeader("", 0, req.secure));
      if (user) await audit(user, "Signed out", "");
      return send(res, 200, { ok: true });
    }

    // Very first account: only from this computer, and only while nobody has a password.
    // Takes over the existing master admin record if there is one.
    case "first-run": {
      if (!isLocalRequest(req)) throw new HttpError(403, "The first account has to be set up on the computer running the app.");
      if (!(await noPasswordsYet())) throw new HttpError(409, "Setup is already done. Sign in instead.");
      const name = String(body.name || "").trim();
      const email = normEmail(body.email);
      if (!name) throw new HttpError(400, "Enter your name.");
      if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
      checkNewPassword(body.password);
      const hash = await hashPassword(body.password);
      const id = await tx(async c => {
        const existing = (await c.query(
          "SELECT id FROM users WHERE role = 'master' AND active ORDER BY created_at LIMIT 1")).rows[0];
        if (existing) {
          await c.query(
            `UPDATE users SET full_name = $2, email = $3, password_hash = $4, account_status = 'approved',
                    approved_at = now(), ${passwordSet} WHERE id = $1`, [existing.id, name, email, hash]);
          return existing.id;
        }
        const div = (await c.query("SELECT id FROM divisions ORDER BY (name = 'Administration') DESC, name LIMIT 1")).rows[0];
        const ins = await c.query(
          `INSERT INTO users (full_name, division_id, role, email, password_hash, account_status, approved_at, password_changed_at)
           VALUES ($1, $2, 'master', $3, $4, 'approved', now(), now()) RETURNING id`, [name, div.id, email, hash]);
        return ins.rows[0].id;
      });
      res.setHeader("Set-Cookie", await startSession(id, req));
      await audit({ id, name, role: "master" }, "Set up master admin account", email);
      return send(res, 200, { ok: true });
    }

    case "signup": {
      if (!allow(`signup:${clientIp(req)}`, 10, 3600_000)) throw new HttpError(429, "Too many account requests from this address. Try again later.");
      // First and last name are separate fields; an older client may still send one "name" (then it needs two words)
      const part = v => String(v || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const first = part(body.firstName), last = part(body.lastName);
      const name = first || last ? `${first} ${last}`.trim() : part(body.name).slice(0, 120);
      const email = normEmail(body.email);
      if ((first || last) && (!first || !last)) throw new HttpError(400, "Enter your first and last name.");
      if (!/\p{L}/u.test(first || name) || !/\S+\s+\S+/.test(name) || (first && !/\p{L}/u.test(last))) throw new HttpError(400, "Enter your first and last name.");
      if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
      checkNewPassword(body.password);
      const div = (await pool.query("SELECT id FROM divisions WHERE name = $1", [body.division])).rows[0];
      if (!div) throw new HttpError(400, "Choose your division.");
      // Sandbox: people from other departments say who they are, so the admin knows whom they're approving
      const org = String(body.organization || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (isSandbox() && org.length < 3) throw new HttpError(400, "Enter the department or agency you're with.");
      const hash = await hashPassword(body.password);
      await tx(async c => {
        const existing = (await c.query(
          "SELECT id, password_hash, account_status FROM users WHERE lower(email) = $1", [email])).rows[0];
        if (existing && existing.password_hash) {
          throw new HttpError(409, existing.account_status === "pending"
            ? "An account with that email is already waiting for approval."
            : "An account with that email already exists. Sign in, or ask an admin to reset your password.");
        }
        if (existing) {
          // Already on the roster (added by an admin) but never signed in: claim it
          await c.query(
            `UPDATE users SET password_hash = $2, account_status = 'pending', claimed_existing = true,
                    signed_up_at = now(), signup_org = $3, ${passwordSet} WHERE id = $1`, [existing.id, hash, org]);
        } else {
          await c.query(
            `INSERT INTO users (full_name, division_id, role, email, password_hash, account_status, signed_up_at, password_changed_at, signup_org)
             VALUES ($1, $2, 'user', $3, $4, 'pending', now(), now(), $5)`, [name, div.id, email, hash, org]);
        }
      });
      await audit(null, "Account requested", `${name} <${email}>, ${body.division}${org ? `, from ${org}` : ""}`);
      return send(res, 200, { ok: true });
    }

    case "change-password": {
      if (!user) throw new HttpError(401, "Sign in first.");
      const row = (await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0];
      if (!(await verifyPassword(String(body.currentPassword || ""), row.password_hash))) {
        throw new HttpError(400, "Your current password isn't right.");
      }
      checkNewPassword(body.newPassword);
      if (body.newPassword === body.currentPassword) throw new HttpError(400, "Choose a different password from the current one.");
      await pool.query(`UPDATE users SET password_hash = $2, ${passwordSet} WHERE id = $1`,
        [user.id, await hashPassword(body.newPassword)]);
      // Sign out everywhere else
      await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [user.id, sha256(readCookie(req, COOKIE))]);
      await audit(user, "Changed password", "");
      return send(res, 200, { ok: true });
    }

    // ---- Signed-in devices: your own, or everyone's for master admins ----
    case "sessions": {
      if (!user) throw new HttpError(401, "Sign in first.");
      const all = user.role === "master";
      const r = await pool.query(
        `SELECT s.token_hash, s.created_at, s.last_seen_at, s.expires_at, s.user_agent, s.ip, u.full_name, u.id AS user_id
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.expires_at > now() AND now() - s.last_seen_at <= make_interval(mins => $2) AND ($3 OR s.user_id = $1)
          ORDER BY s.last_seen_at DESC LIMIT 500`, [user.id, IDLE_MINUTES, all]);
      return send(res, 200, {
        idleMinutes: IDLE_MINUTES, sessionHours: SESSION_HOURS,
        sessions: r.rows.map(s => ({
          id: s.token_hash, name: s.full_name, userId: s.user_id, ip: s.ip || "", device: s.user_agent || "",
          startedAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at, current: s.token_hash === user.sessionHash,
        })),
      });
    }
    case "end-session": {
      if (!user) throw new HttpError(401, "Sign in first.");
      const target = (await pool.query("SELECT s.user_id, u.full_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1", [String(body.id || "")])).rows[0];
      if (!target) return send(res, 200, { ok: true });
      if (target.user_id !== user.id && user.role !== "master") throw new HttpError(403, "You can only sign out your own devices.");
      await pool.query("DELETE FROM sessions WHERE token_hash = $1", [String(body.id)]);
      await audit(user, "Signed out a device", target.full_name);
      return send(res, 200, { ok: true });
    }
    case "end-other-sessions": {
      if (!user) throw new HttpError(401, "Sign in first.");
      const everyone = body.everyone === true && user.role === "master";
      const r = everyone
        ? await pool.query("DELETE FROM sessions WHERE token_hash <> $1", [user.sessionHash])
        : await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [user.id, user.sessionHash]);
      await audit(user, everyone ? "Signed everyone else out" : "Signed out my other devices", `${r.rowCount} session(s)`);
      return send(res, 200, { ended: r.rowCount });
    }

    // ---- Master admin: approvals and resets ----

    case "accounts": {
      await requireAccounts(user);
      const r = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.role, u.account_status, u.claimed_existing, u.signed_up_at,
                u.last_login_at, (u.password_hash IS NOT NULL) AS has_password, d.name AS division,
                (u.totp_enabled_at IS NOT NULL) AS mfa, (u.mfa_locked_at IS NOT NULL) AS mfa_locked, u.password_changed_at, u.signup_org,
                COALESCE(u.job_title, '') AS job_title
           FROM users u JOIN divisions d ON d.id = u.division_id
          WHERE u.active
          ORDER BY (u.account_status = 'pending') DESC, u.full_name`);
      return send(res, 200, {
        accounts: r.rows.map(a => ({
          id: a.id, name: a.full_name, email: a.email || "", role: a.role, division: a.division,
          status: a.account_status, claimedExisting: a.claimed_existing, signedUpAt: a.signed_up_at,
          lastLoginAt: a.last_login_at, hasPassword: a.has_password, mfa: a.mfa, mfaLocked: a.mfa_locked, passwordChangedAt: a.password_changed_at, organization: a.signup_org || "", jobTitle: a.job_title,
        })),
        jobRoles: (await import("./jobroles.js")).jobRoles(),
      });
    }

    case "approve": {
      await requireAccounts(user);
      if (!isUuid(body.id)) throw new HttpError(400, "Bad account id");
      const role = Object.keys(ROLE_LABEL).includes(body.role) ? body.role : "user";
      if (role === "master" && user.role !== "master") throw new HttpError(403, "Only a master admin can make someone a master admin.");
      const div = (await pool.query("SELECT id FROM divisions WHERE name = $1", [body.division])).rows[0];
      if (!div) throw new HttpError(400, "Choose a division.");
      // The license's user limit (seats): active, approved accounts with a password
      const { seatLimit } = await import("./license.js");
      const seats = seatLimit();
      if (seats) {
        const used = (await pool.query("SELECT count(*)::int AS n FROM users WHERE active AND account_status = 'approved' AND password_hash IS NOT NULL")).rows[0].n;
        if (used >= seats) throw new HttpError(409, `This subscription covers ${seats} users and all ${seats} are in use. Deactivate someone or ask your vendor to add users.`);
      }
      const also = ["approver1", "approver2"].includes(role) && Array.isArray(body.signDivisions)
        ? body.signDivisions.filter(d => d !== body.division) : [];
      const r = await tx(async c => {
        const r = await c.query(
          `UPDATE users SET account_status = 'approved', role = $2, division_id = $3,
                  approved_by = $4, approved_at = now()
            WHERE id = $1 AND account_status = 'pending'
            RETURNING full_name`, [body.id, role, div.id, user.id]);
        if (!r.rowCount) throw new HttpError(409, "That request was already handled.");
        if (also.length) await setSignDivisions(c, body.id, also);
        return r;
      });
      if (body.jobRole) await (await import("./jobroles.js")).assignRole(user, body.id, body.jobRole);
      await audit(user, "Approved account", `${r.rows[0].full_name} — ${ROLE_LABEL[role]}, ${body.division}` + (body.jobRole ? `, ${body.jobRole}` : "") +
        (also.length ? `; also signs for ${also.join(", ")}` : ""));
      // Leave picks: unlock their roster entry (matched by Emp # or name)
      import("./leave.js").then(m => m.accountReady(body.id)).catch(e => console.warn(`[Leave picks] ${e.message}`));
      return send(res, 200, { ok: true });
    }

    // Give someone one of the organization's job roles (job title + the permission profile the role carries)
    case "job-role": {
      await requireAccounts(user);
      if (!isUuid(body.id)) throw new HttpError(400, "Bad account id");
      const r = await (await import("./jobroles.js")).assignRole(user, body.id, body.role || "");
      return send(res, 200, { ok: true, ...r });
    }
    case "reject": {
      await requireAccounts(user);
      if (!isUuid(body.id)) throw new HttpError(400, "Bad account id");
      const a = (await pool.query(
        "SELECT full_name, claimed_existing FROM users WHERE id = $1 AND account_status = 'pending'", [body.id])).rows[0];
      if (!a) throw new HttpError(409, "That request was already handled.");
      if (a.claimed_existing) {
        // Leave the existing roster person as they were, just without the new password
        await pool.query(
          `UPDATE users SET account_status = 'approved', password_hash = NULL, claimed_existing = false,
                  signed_up_at = NULL WHERE id = $1`, [body.id]);
      } else {
        await pool.query("DELETE FROM users WHERE id = $1", [body.id]);
      }
      await audit(user, "Declined account request", a.full_name);
      return send(res, 200, { ok: true });
    }

    // Gives the person a temporary password they must change at next sign-in
    case "reset-password": {
      await requireAccounts(user);
      if (!isUuid(body.id)) throw new HttpError(400, "Bad account id");
      const a = (await pool.query("SELECT full_name, email, role FROM users WHERE id = $1 AND active", [body.id])).rows[0];
      if (!a) throw new HttpError(404, "Account not found.");
      if (a.role === "master" && user.role !== "master") throw new HttpError(403, "Only a master admin can reset a master admin's password.");
      let email = a.email;
      if (body.email !== undefined && normEmail(body.email) !== normEmail(a.email)) {
        email = normEmail(body.email);
        if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
      }
      if (!email) throw new HttpError(400, "Add an email address for this person first.");
      const temp = tempPassword();
      await pool.query(
        `UPDATE users SET email = $2, password_hash = $3, must_change_password = true, must_change_reason = 'temp', password_changed_at = now(),
                account_status = 'approved' WHERE id = $1`, [body.id, email, await hashPassword(temp)]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [body.id]);
      await audit(user, "Issued temporary password", `${a.full_name} <${email}>`);
      import("./leave.js").then(m => m.accountReady(body.id)).catch(e => console.warn(`[Leave picks] ${e.message}`));
      return send(res, 200, { tempPassword: temp, email });
    }
  }
  throw new HttpError(404, "Not found");
}

// Removing someone from the roster also signs them out everywhere
export async function endSessionsFor(userId) {
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

// ---------------------------------------------------------------------
// Second factor (authenticator app) for CJIS areas (Investigations). A session counts as verified for 12 hours, and
// only while it has used Investigations in the last 30 minutes (investigations.js). 5 wrong codes within 15 minutes
// lock the second factor until an Investigations manager or master admin releases it.
// ---------------------------------------------------------------------
export const MFA_HOURS = 12, MFA_IDLE_MINUTES = 30;
async function handleMfa(req, res, action, body, user, send) {
  if (!user) throw new HttpError(401, "Sign in first.");
  const { encrypt, decrypt } = await import("./forms.js");
  const { newSecret, checkCode, otpauthUrl, qrMatrix } = await import("./totp.js");
  const row = async id => (await pool.query("SELECT id, full_name, email, role, totp_secret, totp_pending, totp_enabled_at, totp_last_step, mfa_failures, mfa_first_fail_at, mfa_locked_at, mfa_recovery FROM users WHERE id = $1", [id])).rows[0];
  const u = await row(user.id);
  const fresh = s => s.mfa_at && Date.now() - new Date(s.mfa_at) < MFA_HOURS * 3600e3 && s.inv_seen_at && Date.now() - new Date(s.inv_seen_at) < MFA_IDLE_MINUTES * 60e3;
  // A code accepted: Investigations counts it for this session; a sign-in waiting for its code is finished
  const verified = async () => {
    if (user.mfaPending) {
      await pool.query(`UPDATE sessions SET mfa_pending = false, mfa_at = now(), expires_at = now() + make_interval(hours => $2) WHERE token_hash = $1`, [user.sessionHash, SESSION_HOURS]);
      await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
      await audit(user, "Signed in", "with authenticator code");
    } else await pool.query("UPDATE sessions SET mfa_at = now(), inv_seen_at = now() WHERE token_hash = $1", [user.sessionHash]);
  };
  const lockedText = user.mfaPending
    ? "Your authenticator is locked after 5 wrong codes. Ask a master admin to release it (User Management › Accounts)."
    : "Too many wrong codes. Investigations is locked for you until the Chief of Fire Prevention (or a master admin) releases it.";
  // Recovery codes: 10 one-time codes shown once at setup, for a lost phone (sign-in only)
  const newRecovery = async () => {
    const codes = Array.from({ length: 10 }, () => Array.from(crypto.randomBytes(8), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("").replace(/^(.{4})/, "$1-"));
    await pool.query("UPDATE users SET mfa_recovery = $2 WHERE id = $1", [u.id, JSON.stringify(codes.map(c => sha256(c)))]);
    return codes;
  };
  async function fail() {
    const within = u.mfa_first_fail_at && Date.now() - new Date(u.mfa_first_fail_at) < 15 * 60e3;
    const n = within ? u.mfa_failures + 1 : 1;
    await pool.query("UPDATE users SET mfa_failures = $2, mfa_first_fail_at = CASE WHEN $3 THEN mfa_first_fail_at ELSE now() END, mfa_locked_at = CASE WHEN $2 >= 5 THEN now() ELSE NULL END WHERE id = $1", [u.id, n, !!within]);
    await audit(user, "Wrong authenticator code", `${n} of 5`);
    if (n >= 5) {
      await audit(user, "Authenticator locked", "5 wrong codes within 15 minutes");
      try {
        const { managers } = await import("./investigations.js");
        const { send: sendMsg } = await import("./messages.js");
        const to = await managers();
        if (to.length) await sendMsg({ id: u.id, name: u.full_name, role: user.role }, { users: to, subject: `Investigations: ${u.full_name}'s authenticator is locked`,
          body: `${u.full_name} entered 5 wrong authenticator codes within 15 minutes. Their access to Investigations is locked until you release it (Investigations › CJIS list).`, important: true, toSelf: false });
      } catch (e) { console.error("mfa lock notice:", e.message); }
      throw new HttpError(423, lockedText);
    }
    throw new HttpError(400, `That code isn't right. ${5 - n} tr${5 - n === 1 ? "y" : "ies"} left before it locks.`);
  }
  switch (action) {
    case "mfa-recovery": {
      // New recovery codes (the old ones stop working): signed in, with a current authenticator code
      if (user.mfaPending) throw new HttpError(401, "Finish signing in first.");
      if (!u.totp_enabled_at) throw new HttpError(400, "Set up your authenticator first.");
      const step = checkCode(decrypt(u.totp_secret).secret, body.code, u.totp_last_step);
      if (step == null) return fail();
      await pool.query("UPDATE users SET totp_last_step = $2 WHERE id = $1", [u.id, step]);
      await audit(user, "Made new recovery codes", "");
      return send(res, 200, { recoveryCodes: await newRecovery() });
    }
    case "mfa-status":
      return send(res, 200, { enabled: !!u.totp_enabled_at, verified: !!u.totp_enabled_at && fresh(user), locked: !!u.mfa_locked_at, enabledAt: u.totp_enabled_at,
        recoveryLeft: Array.isArray(u.mfa_recovery) ? u.mfa_recovery.length : 0, requiredAtSignIn: await mfaRequired(u) });
    case "mfa-setup": {
      if (u.totp_enabled_at) throw new HttpError(409, "Your authenticator is already set up. To move it to a new phone, ask the Chief of Fire Prevention or a master admin to reset it.");
      const secret = newSecret();
      await pool.query("UPDATE users SET totp_pending = $2 WHERE id = $1", [u.id, encrypt({ secret })]);
      const url = otpauthUrl(secret, u.email || u.full_name, brand().app);
      return send(res, 200, { secret: secret.replace(/(.{4})/g, "$1 ").trim(), url, qr: qrMatrix(url) });
    }
    case "mfa-confirm": {
      if (u.totp_enabled_at) throw new HttpError(409, "Your authenticator is already set up.");
      if (!u.totp_pending) throw new HttpError(400, "Start the setup first.");
      if (u.mfa_locked_at) throw new HttpError(423, "Locked: ask the Chief of Fire Prevention or a master admin to release it.");
      const { secret } = decrypt(u.totp_pending);
      const step = checkCode(secret, body.code);
      if (step == null) return fail();
      await pool.query("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_step = $2, mfa_failures = 0, mfa_first_fail_at = NULL WHERE id = $1", [u.id, step]);
      const recoveryCodes = await newRecovery();
      await audit(user, "Authenticator set up", "");
      await verified();
      return send(res, 200, { ok: true, recoveryCodes });
    }
    case "mfa-verify": {
      if (!u.totp_enabled_at) throw new HttpError(400, "Set up your authenticator first.");
      if (u.mfa_locked_at) throw new HttpError(423, user.mfaPending ? lockedText : "Locked: ask the Chief of Fire Prevention or a master admin to release it.");
      // A recovery code (xxxx-xxxx) works once, for signing in
      const typed = String(body.code || "").trim().toLowerCase();
      if (user.mfaPending && /^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(typed) && !/^\d+$/.test(typed)) {
        const want = sha256(typed.replace(/^(.{4})-?/, "$1-"));
        const left = (Array.isArray(u.mfa_recovery) ? u.mfa_recovery : []);
        if (!left.includes(want)) return fail();
        await pool.query("UPDATE users SET mfa_recovery = $2, mfa_failures = 0, mfa_first_fail_at = NULL WHERE id = $1", [u.id, JSON.stringify(left.filter(x => x !== want))]);
        await audit(user, "Used a recovery code", `${left.length - 1} left`);
        await verified();
        return send(res, 200, { ok: true, recoveryLeft: left.length - 1 });
      }
      const step = checkCode(decrypt(u.totp_secret).secret, body.code, u.totp_last_step);
      if (step == null) return fail();
      await pool.query("UPDATE users SET totp_last_step = $2, mfa_failures = 0, mfa_first_fail_at = NULL WHERE id = $1", [u.id, step]);
      if (!user.mfaPending) await audit(user, "Authenticator code accepted", "");
      await verified();
      return send(res, 200, { ok: true });
    }
    case "mfa-reset": {
      // {userId, unlockOnly}: Investigations managers and master admins
      if (user.mfaPending) throw new HttpError(401, "Finish signing in first.");
      const { hasAccess } = await import("./access.js");
      const t = await row(String(body.userId || ""));
      if (!t) throw new HttpError(404, "Person not found.");
      const accountsAdmin = await hasPerm(pool, user, "accounts_admin");
      if (t.role === "master" && user.role !== "master") throw new HttpError(403, "Only a master admin can reset a master admin's authenticator.");
      if (!accountsAdmin && !(await hasAccess(pool, user, "investigations", "manage"))) throw new HttpError(403, "Only accounts admins, Investigations managers and master admins can do that.");
      if (body.unlockOnly) await pool.query("UPDATE users SET mfa_locked_at = NULL, mfa_failures = 0, mfa_first_fail_at = NULL WHERE id = $1", [t.id]);
      else {
        await pool.query("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL, mfa_locked_at = NULL, mfa_failures = 0, mfa_first_fail_at = NULL, mfa_recovery = '[]'::jsonb WHERE id = $1", [t.id]);
        await pool.query("UPDATE sessions SET mfa_at = NULL WHERE user_id = $1", [t.id]);
      }
      await audit(user, body.unlockOnly ? "Released authenticator lock" : "Reset authenticator", t.full_name);
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, "Not found");
}

// ---------------------------------------------------------------------
// "Forgot your password?": a single-use link by email, good for 30 minutes. People who use an authenticator (all admins)
// also need a code from it, so someone who gets into an admin's email still can't take over Nexus.
// ---------------------------------------------------------------------
const RESET_MINUTES = 30;
async function handleReset(req, res, action, body, send) {
  const { allow } = await import("./ratelimit.js");
  const { mailConfigured, sendMail } = await import("./mail.js");
  const ip = clientIp(req);
  const tokenRow = async token => {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    return (await pool.query(`SELECT r.*, u.full_name, u.email, u.role, u.totp_enabled_at, u.totp_secret, u.totp_last_step, u.mfa_recovery, u.mfa_locked_at
      FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now() AND u.active AND u.account_status = 'approved'`, [sha256(token)])).rows[0] || null;
  };
  if (action === "forgot") {
    if (!mailConfigured()) throw new HttpError(503, "Password reset by email isn't set up. Ask an accounts admin for a temporary password.");
    const email = normEmail(body.email);
    if (!validEmail(email)) throw new HttpError(400, "Enter the email you sign in with.");
    if (!allow(`forgot-ip:${ip}`, 5, 15 * 60e3)) throw new HttpError(429, "Too many reset requests from this address. Try again in 15 minutes.");
    // The same answer whether or not the email has an account
    const done = () => send(res, 200, { ok: true, minutes: RESET_MINUTES });
    if (!allow(`forgot-email:${email}`, 3, 3600e3)) return done();
    const u = (await pool.query("SELECT id, full_name, email FROM users WHERE lower(email) = $1 AND active AND account_status = 'approved'", [email])).rows[0];
    if (!u) { await audit(null, "Password reset asked for an unknown email", `${email.slice(0, 120)} from ${ip}`); return done(); }
    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [u.id]);
    await pool.query("INSERT INTO password_resets (token_hash, user_id, expires_at, ip) VALUES ($1, $2, now() + make_interval(mins => $3), $4)", [sha256(token), u.id, RESET_MINUTES, ip]);
    await audit({ id: u.id, name: u.full_name, role: "" }, "Asked for a password reset link", `from ${ip}`);
    const link = `${PUBLIC_URL()}/reset-password?token=${token}`;
    sendMail({ to: u.email, subject: `Reset your ${brand().app} password`,
      text: `Hello ${u.full_name},\n\nSomeone (hopefully you) asked to reset your ${brand().app} password. Open this link within ${RESET_MINUTES} minutes to choose a new one:\n\n${link}\n\nThe link works once. If you didn't ask for this, you can ignore this email; your password hasn't changed. Requests are logged.\n\n${brand().app}` })
      .catch(async e => { console.error(`[Password reset] email to user ${u.id} failed: ${e.message}`); await audit({ id: u.id, name: u.full_name, role: "" }, "Password reset email failed", e.message.slice(0, 200)).catch(() => {}); });
    return done();
  }
  if (action === "reset-check") {
    const r = await tokenRow(body.token);
    if (!r) throw new HttpError(410, "That reset link has expired or was already used. Ask for a new one.");
    return send(res, 200, { ok: true, name: r.full_name.split(" ")[0], needCode: !!r.totp_enabled_at, passwordRule: PASSWORD_RULE });
  }
  if (action === "reset") {
    if (!allow(`reset-ip:${ip}`, 20, 15 * 60e3)) throw new HttpError(429, "Too many tries. Wait a few minutes.");
    const r = await tokenRow(body.token);
    if (!r) throw new HttpError(410, "That reset link has expired or was already used. Ask for a new one.");
    checkNewPassword(body.password);
    if (await verifyPassword(String(body.password), (await pool.query("SELECT password_hash FROM users WHERE id = $1", [r.user_id])).rows[0]?.password_hash)) {
      throw new HttpError(400, "Choose a different password from your current one.");
    }
    if (r.totp_enabled_at) {
      if (r.mfa_locked_at) throw new HttpError(423, "Your authenticator is locked. Ask a master admin to release it.");
      const { decrypt } = await import("./forms.js");
      const { checkCode } = await import("./totp.js");
      const typed = String(body.code || "").trim().toLowerCase();
      const left = Array.isArray(r.mfa_recovery) ? r.mfa_recovery : [];
      const rec = /^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(typed) && !/^\d+$/.test(typed) ? sha256(typed.replace(/^(.{4})-?/, "$1-")) : null;
      if (rec && left.includes(rec)) await pool.query("UPDATE users SET mfa_recovery = $2 WHERE id = $1", [r.user_id, JSON.stringify(left.filter(x => x !== rec))]);
      else {
        const step = checkCode(decrypt(r.totp_secret).secret, typed, r.totp_last_step);
        if (step == null) {
          await audit({ id: r.user_id, name: r.full_name, role: "" }, "Wrong authenticator code on a password reset", `from ${ip}`);
          throw new HttpError(400, "That authenticator code isn't right.");
        }
        await pool.query("UPDATE users SET totp_last_step = $2 WHERE id = $1", [r.user_id, step]);
      }
    }
    const used = await pool.query("UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL", [sha256(body.token)]);
    if (!used.rowCount) throw new HttpError(410, "That reset link was already used.");
    await pool.query(`UPDATE users SET password_hash = $2, ${passwordSet} WHERE id = $1`, [r.user_id, await hashPassword(body.password)]);
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [r.user_id]);
    failures.delete(normEmail(r.email));
    await audit({ id: r.user_id, name: r.full_name, role: "" }, "Reset password with an email link", `from ${ip}; signed out everywhere`);
    sendMail({ to: r.email, subject: `Your ${brand().app} password was changed`,
      text: `Hello ${r.full_name},\n\nYour ${brand().app} password was just changed with a reset link, and every device was signed out. If this wasn't you, tell an accounts admin right away.\n\n${brand().app}` })
      .catch(e => console.error(`[Password reset] confirmation email failed: ${e.message}`));
    return send(res, 200, { ok: true });
  }
  throw new HttpError(404, "Not found");
}
