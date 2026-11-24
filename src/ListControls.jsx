// Shared search / filter / sort / paging for every list in the app.
//
//   const view = useListView(items, {
//     search: r => [r.title, r.vendor],                         // text the search box looks in
//     sorts: [{ key: "date", label: "Date", get: r => r.createdAt, dir: "desc" }, ...],
//     filters: [{ key: "division", label: "Division", get: r => r.division }],
//   });
//   <ListControls view={view} placeholder="Search requisitions" />
//   {view.pageItems.map(...)}
//   <Pager view={view} />
//
// Rows per page (25 / 50 / 100 / 200) is remembered in this browser for every list.
import React, { useEffect, useMemo, useRef, useState } from "react";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA";
export const PAGE_SIZES = [25, 50, 100, 200];
const SIZE_KEY = "sgfd-rows-per-page";

function readPageSize() {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : 25;
  } catch (e) { return 25; }
}

const empty = v => v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v));
function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(!!a) - Number(!!b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function useListView(items, { search, sorts = [], defaultSort, filters = [], resetKey, initialFilters } = {}) {
  const [query, setQuery] = useState("");
  const first = sorts.find(s => s.key === defaultSort) || sorts[0];
  const [sortKey, setSortKey] = useState(first?.key || "");
  const [dir, setDir] = useState(first?.dir || "asc");
  const [filterValues, setFilterValues] = useState(() => initialFilters || {});
  const [pageSize, setPageSizeState] = useState(readPageSize);
  const [page, setPage] = useState(1);
  const topRef = useRef(null);

  const list = items || [];
  const filterOptions = useMemo(() => {
    const out = {};
    for (const f of filters) {
      if (f.options) { out[f.key] = f.options; continue; }
      const seen = new Set();
      for (const it of list) {
        const v = f.get(it);
        if (!empty(v)) seen.add(String(v));
      }
      out[f.key] = [...seen].sort((a, b) => compare(a, b)).map(v => ({ value: v, label: v }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, filters.map(f => f.key).join("|")]);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let out = list;
    if (words.length && search) {
      out = out.filter(it => {
        const hay = [].concat(search(it)).filter(x => !empty(x)).join(" ").toLowerCase();
        return words.every(w => hay.includes(w));
      });
    }
    for (const f of filters) {
      const want = filterValues[f.key];
      if (!want) continue;
      out = out.filter(it => (f.match ? f.match(it, want) : String(f.get(it) ?? "") === want));
    }
    const s = sorts.find(x => x.key === sortKey);
    if (s) {
      const sign = dir === "desc" ? -1 : 1;
      out = out.map((it, i) => ({ it, i, v: s.get(it) })).sort((a, b) => {
        const ea = empty(a.v), eb = empty(b.v);
        if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;   // blanks always last
        return sign * compare(a.v, b.v) || a.i - b.i;
      }).map(x => x.it);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query, sortKey, dir, JSON.stringify(filterValues)]);

  // Back to page 1 whenever what's shown changes
  useEffect(() => { setPage(1); }, [query, sortKey, dir, pageSize, JSON.stringify(filterValues), resetKey]);

  const total = results.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const start = (current - 1) * pageSize;
  const pageItems = results.slice(start, start + pageSize);

  return {
    query, setQuery, sorts, sortKey, dir, filters, filterValues, filterOptions,
    setSort(key) {
      const s = sorts.find(x => x.key === key);
      setSortKey(key);
      if (s) setDir(s.dir || "asc");
    },
    setDir,
    setFilter(key, value) { setFilterValues(v => ({ ...v, [key]: value })); },
    clear() { setQuery(""); setFilterValues({}); },
    pageSize,
    setPageSize(n) {
      setPageSizeState(n);
      try { localStorage.setItem(SIZE_KEY, String(n)); } catch (e) {}
    },
    page: current, pages, total, start, pageItems, results,
    goTo(p) {
      setPage(Math.max(1, Math.min(pages, p)));
      try { topRef.current && topRef.current.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {}
    },
    topRef,
    active: !!query.trim() || Object.values(filterValues).some(Boolean),
  };
}

const ctl = {
  padding: "6px 9px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff",
  fontSize: 13, color: INK, fontFamily: "inherit",
};
const pill = on => ({
  ...ctl, cursor: on === null ? "default" : "pointer", minWidth: 32, fontWeight: 600,
  background: on ? INK : "#fff", color: on ? "#fff" : INK, borderColor: on ? INK : LINE,
});

// Search box, filters, sort and rows per page
export function ListControls({ view, placeholder = "Search", children, label = "items" }) {
  return (
    <div ref={view.topRef} style={{ scrollMarginTop: 12, margin: "10px 0 12px" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="search" aria-label="Search" placeholder={placeholder} value={view.query}
          onChange={e => view.setQuery(e.target.value)} style={{ ...ctl, flex: "1 1 220px", minWidth: 160 }} />
        {view.filters.map(f => (
          <select key={f.key} aria-label={`Filter by ${f.label}`} value={view.filterValues[f.key] || ""}
            onChange={e => view.setFilter(f.key, e.target.value)} style={{ ...ctl, maxWidth: 210 }}>
            <option value="">{f.allLabel || `All ${f.plural || f.label.toLowerCase() + "s"}`}</option>
            {(view.filterOptions[f.key] || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {children}
        {view.sorts.length > 0 && (
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <select aria-label="Sort by" value={view.sortKey} onChange={e => view.setSort(e.target.value)} style={ctl}>
              {view.sorts.map(s => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
            </select>
            <button type="button" aria-label={view.dir === "asc" ? "Sorted ascending, click for descending" : "Sorted descending, click for ascending"}
              title={view.dir === "asc" ? "Ascending" : "Descending"}
              onClick={() => view.setDir(view.dir === "asc" ? "desc" : "asc")} style={{ ...ctl, cursor: "pointer", fontWeight: 700, width: 34 }}>
              {view.dir === "asc" ? "↑" : "↓"}
            </button>
          </span>
        )}
        <select aria-label="Rows per page" value={view.pageSize} onChange={e => view.setPageSize(Number(e.target.value))} style={ctl}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n} per page</option>)}
        </select>
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
        <span>
          {view.total === 0 ? "" :
            `Showing ${view.start + 1}–${Math.min(view.start + view.pageSize, view.total)} of ${view.total} ${label}`}
        </span>
        {view.active && (
          <button type="button" onClick={view.clear} style={{ border: "none", background: "none", color: "#1D5FA8", cursor: "pointer", fontSize: 12.5, padding: 0, textDecoration: "underline" }}>
            Clear search and filters
          </button>
        )}
      </div>
    </div>
  );
}

// Page buttons: « ‹ 1 … 4 5 6 … 20 › »
export function Pager({ view }) {
  if (view.pages <= 1) return null;
  const p = view.page, n = view.pages;
  const nums = [];
  for (let i = 1; i <= n; i++) {
    if (i === 1 || i === n || Math.abs(i - p) <= 2) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <nav aria-label="Pages" style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", margin: "14px 0 6px" }}>
      <button type="button" aria-label="First page" disabled={p === 1} onClick={() => view.goTo(1)} style={pill(false)}>«</button>
      <button type="button" aria-label="Previous page" disabled={p === 1} onClick={() => view.goTo(p - 1)} style={pill(false)}>‹ Prev</button>
      {nums.map((x, i) => x === "…"
        ? <span key={`gap${i}`} style={{ padding: "0 4px", color: INK_SOFT }}>…</span>
        : <button type="button" key={x} aria-label={`Page ${x}`} aria-current={x === p ? "page" : undefined}
            onClick={() => view.goTo(x)} style={pill(x === p)}>{x}</button>)}
      <button type="button" aria-label="Next page" disabled={p === n} onClick={() => view.goTo(p + 1)} style={pill(false)}>Next ›</button>
      <button type="button" aria-label="Last page" disabled={p === n} onClick={() => view.goTo(n)} style={pill(false)}>»</button>
      <span style={{ fontSize: 12.5, color: INK_SOFT, marginLeft: 6 }}>Page {p} of {n}</span>
    </nav>
  );
}
