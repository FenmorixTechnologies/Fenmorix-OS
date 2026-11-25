// Job roles: the names an organization gives people ("Owner", "Manager", "Sales associate"), kept in Organization settings
// (brand.js orgSettings().roles = [{name, profile}]). A person's role is their job title (users.job_title); a role can carry a
// permission profile (access.js), and giving someone the role gives them that profile. Profiles that belong to a role are
// managed here: changing someone's role takes off the old role's profile and puts on the new one.
//
// Who: masters change the list (system.js POST /api/system/roles); masters and accounts admins give people roles (auth.js
// "job-role", and "approve" with jobRole). Only a master can give or take away a role that carries more than the Basic profile.
import { pool } from "./db.js";
import { orgSettings, saveOrgSettings, cleanRoles } from "./brand.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, n = 60) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const lower = s => String(s || "").trim().toLowerCase();
// Profiles anyone who approves accounts may hand out (Basic = what everyone gets anyway)
const HARMLESS = new Set(["", "basic"]);

export const jobRoles = () => orgSettings().roles;
const roleNamed = name => jobRoles().find(r => lower(r.name) === lower(name));

async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'User management', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}

// Put one person's role-linked profile in step with their role
async function syncProfile(c, userId, profile, actorName) {
  const linked = [...new Set(jobRoles().map(r => r.profile).filter(Boolean))];
  if (linked.length) await c.query(`DELETE FROM access_profile_members WHERE user_id = $1 AND profile_key = ANY(string_to_array($2, ','))`, [userId, linked.join(",")]);
  if (profile) await c.query(`INSERT INTO access_profile_members (id, profile_key, user_id, added_by) VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT DO NOTHING`,
    [profile, userId, `Role (${actorName})`]);
}

// Give someone a role ("" = no role: their job title is cleared and role profiles come off)
export async function assignRole(actor, userId, name, c = pool) {
  const u = (await c.query("SELECT id, full_name, role, job_title FROM users WHERE id = $1", [userId])).rows[0];
  if (!u) throw err(404, "That person isn't there any more.");
  const want = clean(name) ? roleNamed(name) : null;
  if (clean(name) && !want) throw err(400, `There's no role called ${clean(name)}. Add it under Organization first.`);
  const had = roleNamed(u.job_title);
  if (actor.role !== "master") {
    if (u.role === "master") throw err(403, "Only a master admin can change a master admin's role.");
    if (!HARMLESS.has(want?.profile || "") || !HARMLESS.has(had?.profile || ""))
      throw err(403, "That role comes with extra access, so only a master admin can give it or take it away.");
  }
  if ((want?.name || "") === (u.job_title || "") && (want ? true : !had)) return { changed: false };
  await c.query("UPDATE users SET job_title = $2 WHERE id = $1", [userId, want?.name || null]);
  await syncProfile(c, userId, want?.profile || "", actor.name);
  (await import("./access.js")).clearAccessCache();
  await audit(actor, "Set a job role", `${u.full_name}: ${u.job_title || "none"} → ${want?.name || "none"}`);
  return { changed: true };
}

// How many active people hold each role (by job title)
export async function roleCounts() {
  const rows = (await pool.query("SELECT lower(job_title) AS t, count(*)::int AS n FROM users WHERE active AND job_title IS NOT NULL GROUP BY 1")).rows;
  const by = new Map(rows.map(r => [r.t, r.n]));
  return jobRoles().map(r => ({ ...r, people: by.get(lower(r.name)) || 0 }));
}

// Masters: add / rename / remove a role, or change the profile it carries
export async function changeRoles(actor, b) {
  const roles = jobRoles().map(r => ({ ...r }));
  const name = clean(b.name), i = roles.findIndex(r => lower(r.name) === lower(name));
  const profileOk = async p => !p || (await pool.query("SELECT 1 FROM access_profiles WHERE key = $1", [p])).rowCount > 0
    || (await import("./access.js")).BUILTIN_PROFILES.some(x => x.key === p);
  const holders = async n => (await pool.query("SELECT id FROM users WHERE active AND lower(job_title) = lower($1)", [n])).rows.map(r => r.id);

  if (b.action === "add") {
    if (!name) throw err(400, "Give the role a name.");
    if (i >= 0) throw err(409, `There's already a role called ${roles[i].name}.`);
    const profile = String(b.profile || "");
    if (!(await profileOk(profile))) throw err(400, "That permission profile isn't there.");
    roles.push({ name, profile });
    saveOrgSettings({ roles: cleanRoles(roles) });
    // People who already have this exact job title now hold the role
    if (profile) for (const id of await holders(name)) await syncProfile(pool, id, profile, actor.name);
    (await import("./access.js")).clearAccessCache();
    return audit(actor, "Added a job role", `${name}${profile ? ` (profile ${profile})` : ""}`);
  }
  if (i < 0) throw err(404, "That role isn't there any more.");
  const cur = roles[i];
  if (b.action === "rename") {
    const to = clean(b.to);
    if (!to) throw err(400, "Give the new name.");
    if (roles.some((r, k) => k !== i && lower(r.name) === lower(to))) throw err(409, `There's already a role called ${to}.`);
    roles[i] = { ...cur, name: to };
    saveOrgSettings({ roles: cleanRoles(roles) });
    const n = (await pool.query("UPDATE users SET job_title = $2 WHERE lower(job_title) = lower($1)", [cur.name, to])).rowCount;
    return audit(actor, "Renamed a job role", `${cur.name} → ${to}${n ? ` (${n} ${n === 1 ? "person" : "people"})` : ""}`);
  }
  if (b.action === "profile") {
    const profile = String(b.profile || "");
    if (!(await profileOk(profile))) throw err(400, "That permission profile isn't there.");
    const ids = await holders(cur.name);
    roles[i] = { ...cur, profile };
    // Take the old profile off this role's people before the list changes (it may be no other role's)
    if (cur.profile) await pool.query(`DELETE FROM access_profile_members WHERE profile_key = $1 AND user_id = ANY(string_to_array($2, ',')::uuid[])`, [cur.profile, ids.join(",") || null]);
    saveOrgSettings({ roles: cleanRoles(roles) });
    for (const id of ids) await syncProfile(pool, id, profile, actor.name);
    (await import("./access.js")).clearAccessCache();
    return audit(actor, "Changed a job role's access", `${cur.name}: ${cur.profile || "none"} → ${profile || "none"} (${ids.length} ${ids.length === 1 ? "person" : "people"})`);
  }
  if (b.action === "remove") {
    const ids = await holders(cur.name);
    if (cur.profile && ids.length) await pool.query(`DELETE FROM access_profile_members WHERE profile_key = $1 AND user_id = ANY(string_to_array($2, ',')::uuid[])`, [cur.profile, ids.join(",")]);
    roles.splice(i, 1);
    saveOrgSettings({ roles: cleanRoles(roles) });
    (await import("./access.js")).clearAccessCache();
    // People keep the words as their job title; only the role (and its access) goes
    return audit(actor, "Removed a job role", `${cur.name}${ids.length ? ` (${ids.length} kept it as their job title)` : ""}`);
  }
  throw err(400, "Add, rename, remove, or change access?");
}
