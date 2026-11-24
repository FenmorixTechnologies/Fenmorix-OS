// Drop-in replacement for the Claude artifact `window.storage` API.
//
// App.jsx is unchanged from the artifact: it still calls
// window.storage.get / set / delete. This module routes those calls:
//   - "current-identity"                -> the signed-in account (set at sign-in;
//                                          the app's "Sign out" clears it)
//   - "<prefix>-file:<id>" (uploads)    -> /api/files/<id>
//   - everything else (shared records)  -> /api/collections/<key>
//
// The app saves whole lists (e.g. every requisition at once). To avoid one
// person's stale copy overwriting another person's work, only the records
// that actually changed since the last load/save are sent.

const FILE_KEY = /^(invoice-file|contract-file|cert-file|reimb-file|ticket-file|gear-file|quote-file):(.+)$/;
const VALUE_KEYS = new Set(["divisions", "categories", "mileage-rate"]);   // saved whole
const APPEND_ONLY = new Set(["audit-log"]);

const snapshots = new Map();   // key -> last value seen from / sent to the server
let queue = Promise.resolve(); // writes run one at a time, in order

function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

let signedInUserId = null;

// X-SGFD marks requests as coming from this app (the server rejects
// changes without it). Sign-in itself travels in an HttpOnly cookie.
// While Your Day refreshes itself in the background, requests are marked so they
// don't count as activity (the server signs people out after a stretch of no use).
let background = false;
export function setBackground(on) { background = !!on; }
export const backgroundHeaders = () => (background ? { "X-SGFD-Background": "1" } : {});

function headers() {
  return { "Content-Type": "application/json", "X-SGFD": "1", ...backgroundHeaders() };
}

export async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST", headers: headers() }); } catch { /* ignore */ }
  location.reload();
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401) {
    // Session ended (signed out elsewhere, expired, or account removed)
    location.reload();
    throw new Error("Please sign in again.");
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Server error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Key-order-independent JSON, so reordered-but-equal records aren't resent
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  return JSON.stringify(v ?? null);
}

function diff(key, before, after) {
  const prev = new Map((Array.isArray(before) ? before : []).map(x => [String(x.id), stable(x)]));
  const seen = new Set();
  const upserts = [];
  for (const item of Array.isArray(after) ? after : []) {
    if (!item || item.id === undefined) continue;
    const id = String(item.id);
    seen.add(id);
    if (APPEND_ONLY.has(key) ? !prev.has(id) : prev.get(id) !== stable(item)) upserts.push(item);
  }
  const deletes = APPEND_ONLY.has(key) ? [] : [...prev.keys()].filter(id => !seen.has(id));
  return { upserts, deletes };
}

// A visible notice when the database refuses a change (for example editing
// a finalized requisition), since the app itself ignores save errors.
function showError(message) {
  let bar = document.getElementById("sgfd-save-error");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "sgfd-save-error";
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#C8102E;color:#fff;" +
      "padding:10px 16px;font:600 13.5px -apple-system,'Segoe UI',sans-serif;display:flex;gap:14px;align-items:center;";
    document.body.appendChild(bar);
  }
  bar.innerHTML = "";
  const text = document.createElement("span");
  text.style.flex = "1";
  text.textContent = "Not saved: " + message;
  const reload = document.createElement("button");
  reload.textContent = "Reload";
  reload.style.cssText = "background:#fff;color:#C8102E;border:0;border-radius:5px;padding:5px 12px;font-weight:700;cursor:pointer;";
  reload.onclick = () => location.reload();
  const close = document.createElement("button");
  close.textContent = "×";
  close.style.cssText = "background:transparent;color:#fff;border:0;font-size:20px;cursor:pointer;";
  close.onclick = () => bar.remove();
  bar.append(text, reload, close);
}

const storage = {
  async get(key, shared) {
    if (key === "current-identity") return signedInUserId ? { key, value: signedInUserId, shared: false } : null;
    if (!shared) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? null : { key, value: v, shared: false };
      } catch { return null; }
    }
    if (FILE_KEY.test(key)) {
      const id = FILE_KEY.exec(key)[2];
      try {
        const data = await api("GET", `/api/files/${encodeURIComponent(id)}`);
        return { key, value: data.value, shared: true };
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    }
    // Wait for saves already in progress so a read never returns older
    // data, but let reads themselves run side by side.
    await queue;
    const data = await api("GET", `/api/collections/${encodeURIComponent(key)}`);
    if (data.value === null || data.value === undefined) return null;
    snapshots.set(key, data.value);
    return { key, value: JSON.stringify(data.value), shared: true };
  },

  async set(key, value, shared) {
    if (key === "current-identity") {
      // The app's "Sign out" button sets this to ""; picking someone else is no longer possible
      if (!value) await signOut();
      return { key, value: signedInUserId, shared: false };
    }
    if (!shared) {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
      return { key, value, shared: false };
    }
    if (FILE_KEY.test(key)) {
      const id = FILE_KEY.exec(key)[2];
      return enqueue(async () => {
        try {
          await api("PUT", `/api/files/${encodeURIComponent(id)}`, { dataUrl: value });
          return { key, value: "(stored)", shared: true };
        } catch (err) {
          showError(err.message);
          return null;   // the app shows "Couldn't save the file"
        }
      });
    }
    const next = JSON.parse(value);
    return enqueue(async () => {
      try {
        if (VALUE_KEYS.has(key)) {
          await api("POST", `/api/collections/${encodeURIComponent(key)}`, { value: next });
        } else {
          const { upserts, deletes } = diff(key, snapshots.get(key), next);
          if (upserts.length || deletes.length) {
            await api("POST", `/api/collections/${encodeURIComponent(key)}`, { upserts, deletes });
          }
        }
        snapshots.set(key, next);
        return { key, value, shared: true };
      } catch (err) {
        showError(err.message);
        throw err;
      }
    });
  },

  async delete(key, shared) {
    if (!shared) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      return { key, deleted: true, shared: false };
    }
    if (FILE_KEY.test(key)) {
      const id = FILE_KEY.exec(key)[2];
      return enqueue(async () => {
        await api("DELETE", `/api/files/${encodeURIComponent(id)}`);
        return { key, deleted: true, shared: true };
      });
    }
    return { key, deleted: false, shared: true };
  },

  async list() {
    return { keys: [], shared: true };
  },
};

export function installStorage(userId) {
  signedInUserId = userId;
  window.storage = storage;

  // The app creates record ids with crypto.randomUUID, which browsers only
  // provide on https:// or localhost pages. Fill it in elsewhere.
  if (typeof crypto !== "undefined" && !crypto.randomUUID) {
    crypto.randomUUID = () =>
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, ch =>
        (ch ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (ch / 4)))).toString(16));
  }
}
