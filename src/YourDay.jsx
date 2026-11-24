// "Your Day" on the main menu: what needs you, and a quick reference for today.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "./brand.js";
import { tileOn, moduleOn } from "./licensing.js";
// Your Day widgets belong to the section their button opens (hidden when that module isn't licensed)
const SHIFT_MODULES = ["leave", "forceback", "activecalls", "command", "recall", "training", "callout", "stats"];
const WIDGET_TILE = { schedule: "schedule", spot: "spot", links: "links", time: "timetracker", oncall: "callout", messages: "messages", bookings: "training", offwork: "offwork", meetings: "meetings", forms: "forms", tickets: "helpdesk", reqs: "procurement" };
import {
  cardStyle, btn, loadShared, money, reqAmount, waitingSummary, canMarkReqPaid, coversDivision,
} from "./App.jsx";
import { Clock, PhoneCall, Calendar, FileText, LifeBuoy, ClipboardList, Users, Activity, Bell, BellOff, Mail, ChevronUp, ChevronDown, ArrowUp, ArrowDown, GripVertical, LayoutGrid, RotateCcw, AlertCircle, School, Truck, CalendarOff } from "lucide-react";
import { DutyBoard } from "./DutyBoard.jsx";
import { setBackground } from "./storage.js";
import ActiveCalls from "./ActiveCalls.jsx";
import WeatherBar from "./Weather.jsx";
import { chime, soundOn, setSoundOn } from "./chime.js";
import { todayISO, payPeriod, pretty, fireShift, commsShifts, dayNum, neededPerShift, unitWord, periodHours, workSettings } from "./shifts.js";
import PunchClock from "./PunchClock.jsx";
import { useSpot, Change, SpotChart, money as spotMoney, METAL_COLOR } from "./Spot.jsx";
import { fetchLinks } from "./QuickLinks.jsx";
import { Coins, Link2, ExternalLink, CalendarClock } from "lucide-react";
import { STATUS as SCHED_STATUS, dayLine } from "./scheduleShared.js";

// Colors are defined here (not imported) because this file is loaded while
// App.jsx is still starting up; values used outside a component must be local.
const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E";
const SAGE = "#2E7D4F", AMBER = "#B26A00", BRASS_DEEP = "#1D5FA8";

const HIDE_KEY = "sgfd-your-day-hidden";
const ACTIVE_TICKET = ["open", "acknowledged", "in_progress", "on_hold", "awaiting_delivery"];
const TICKET_LABEL = { open: "Open", acknowledged: "Acknowledged", in_progress: "Being worked on", on_hold: "On hold", awaiting_delivery: "Awaiting delivery" };
const PRIORITY_COLOR = { Low: "#6B7385", Medium: BRASS_DEEP, High: AMBER, Urgent: BRICK };
const STATUS_TEXT = { pending_auth1: "Awaiting purchaser's signature", pending_auth2: "Awaiting pre-approval", pending_chief: "Awaiting final approval", approved: "Approved, not yet paid" };
const STATUS_COLOR = { pending_auth1: AMBER, pending_auth2: AMBER, pending_chief: AMBER, approved: SAGE };
const telHref = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const hrs = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ident = async () => { try { const x = await window.storage.get("current-identity", false); return x ? x.value : null; } catch (e) { return null; } };

// Everything the main menu needs about the signed-in person
// Checks again every minute (in the background) so new items show up, and dings.
const REFRESH_MS = 60_000;
export function useYourDay() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let stopped = false;
    const load = async bg => {
      setBackground(bg);
      const hdr = { "X-SGFD": "1", ...(bg ? { "X-SGFD-Background": "1" } : {}) };
      let results;
      try {
        results = await Promise.all([
          loadShared("roster", []), loadShared("requisitions", []), loadShared("tickets", []), loadShared("meetings", []),
          loadShared("callouts", []), loadShared("time-entries", []), loadShared("reimbursements", []), ident(),
          fetch("/api/forms/inbox", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/directory/check", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch(moduleOn("messaging") ? "/api/messages/summary" : "/api/notices/summary", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/leave/turn", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/training/todo", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/recall/todo", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/auth/me", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/inv/todo", { headers: hdr }).then(r => (r.ok ? r.json() : null)).catch(() => null),
        ]);
      } finally { setBackground(false); }
      if (stopped) return;
      const [roster, reqs, tickets, meetings, callouts, time, reimb, id, forms, dirCheck, msgs, leave, drills, recall, auth, invTodo] = results;
      const me = roster.find(u => u.id === id);
      if (!me) { setData({ me: null }); return; }
      const today = todayISO();

      const sign = waitingSummary(me, reqs);
      const deskOf = t => t.desk || "helpdesk";
      // New tickets nobody has acknowledged yet, for the desk teams (Help Desk: helpdeskTech; gear: gearTech)
      const newHelp = me.helpdeskTech ? tickets.filter(t => deskOf(t) === "helpdesk" && t.status === "open" && !t.assigneeId).length : 0;
      const newGear = me.gearTech ? tickets.filter(t => deskOf(t) === "gear" && t.status === "open" && !t.assigneeId).length : 0;
      const myGearTickets = tickets.filter(t => deskOf(t) === "gear" && t.assigneeId === me.id && ACTIVE_TICKET.includes(t.status));
      const myTickets = tickets.filter(t => deskOf(t) === "helpdesk" && t.assigneeId === me.id && ACTIVE_TICKET.includes(t.status))
        .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
      const overdue = myTickets.filter(t => t.dueDate && t.dueDate < today).length;
      const live = meetings.filter(m => !m.cancelled);
      const myResponse = m => (m.responses || []).find(r => r.inviteeId === me.id);
      const meetingRequests = live.filter(m => m.date >= today && myResponse(m)?.status === "pending");
      const mine = m => m.organizerId === me.id || ["accepted", "pending"].includes(myResponse(m)?.status);
      const todaysMeetings = live.filter(m => m.date === today && mine(m)).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
      const nextMeeting = live.filter(m => m.date > today && mine(m)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0] || null;
      const reimbToApprove = reimb.filter(r => r.status === "pending_approval" && r.requesterId !== me.id &&
        (["master", "fire_chief"].includes(me.role) || (["approver1", "approver2"].includes(me.role) && coversDivision(me, r.division))));

      const period = payPeriod(today);
      const worked = time.filter(e => e.userId === me.id && e.date >= period.start && e.date <= period.end)
        .reduce((s, e) => s + Number(e.hours || 0), 0);
      const daysLeft = dayNum(period.end) - dayNum(today) + 1;
      const workedToday = time.some(e => e.userId === me.id && e.date === today && Number(e.hours) > 0);
      const target = periodHours(period);
      const need = neededPerShift({ pattern: me.workPattern || "", period, today, remaining: Math.max(0, target - worked), workedToday });

      const myReqs = reqs.filter(r => r.requestedBy === me.name);
      const openReqs = myReqs.filter(r => r.status.startsWith("pending") || r.status === "approved")
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

      const onCall = new Map();
      callouts.filter(e => e.startDate <= today && e.endDate >= today)
        .sort((a, b) => a.division.localeCompare(b.division) || a.position - b.position)
        .forEach(e => { if (!onCall.has(e.division)) onCall.set(e.division, []); onCall.get(e.division).push(e); });

      setData({
        forms: forms ? { updates: [], mine: [], ...forms } : { tasks: [], approvals: [], toReview: [], updates: [], mine: [] },
        confirmDirectory: !!dirCheck?.confirmPending,
        messages: msgs || { unread: 0, important: 0, latest: [] },
        leave: leave && leave.seasonId ? leave : null,
        drills: drills || { confirm: 0, verify: 0, returned: 0 },
        recall: recall || { waiting: [], openBoards: 0 },
        accountRequests: auth?.pendingCount || 0,
        inv: invTodo || { reviewDue: false, trainingDue: null },
        me, today, sign, myTickets, overdue, newHelp, newGear, myGearTickets, meetingRequests, todaysMeetings, nextMeeting, reimbToApprove,
        period, worked, target, remaining: Math.max(0, target - worked), daysLeft, need, pattern: me.workPattern || "", openReqs, onCall,
        paidReady: ["master", "accounting"].includes(me.role) ? reqs.filter(r => canMarkReqPaid(me, r)).length : 0,
      });
    };
    load(false);
    const t = setInterval(() => load(true).catch(() => {}), REFRESH_MS);
    const onTime = () => load(true).catch(() => {});          // after punching out: update the hours
    window.addEventListener("sgfd-time-changed", onTime);
    // Messages arrive live (src/live.js); refresh the counts a moment later
    let msgTimer = null;
    const onMsg = () => { clearTimeout(msgTimer); msgTimer = setTimeout(onTime, 800); };
    window.addEventListener("sgfd-message", onMsg);
    window.addEventListener("sgfd-messages-changed", onMsg);
    return () => { stopped = true; clearInterval(t); clearTimeout(msgTimer); window.removeEventListener("sgfd-time-changed", onTime);
      window.removeEventListener("sgfd-message", onMsg); window.removeEventListener("sgfd-messages-changed", onMsg); };
  }, []);
  return data;
}

// Counts shown on the main-menu tiles
export function tileBadges(d) {
  if (!d?.me) return {};
  return {
    procurement: d.sign.total + d.paidReady,
    helpdesk: d.myTickets.length + (d.newHelp || 0),
    ppe: (d.myGearTickets?.length || 0) + (d.newGear || 0),
    meetings: d.meetingRequests.length,
    reimbursements: d.reimbToApprove.length,
    forms: d.forms.tasks.length + d.forms.approvals.length + d.forms.toReview.length + d.forms.updates.length,
    messages: d.messages?.unread || 0,
    notifications: d.messages?.unread || 0,
    leave: d.leave?.myTurn ? 1 : 0,
    training: (d.drills?.confirm || 0) + (d.drills?.verify || 0) + (d.drills?.returned || 0),
    recall: (d.recall?.waiting?.length || 0) + (d.recall?.openBoards || 0),
  };
}

const Empty = ({ children }) => <div style={{ color: INK_SOFT }}>{children}</div>;
const Ellipsis = ({ children, style }) => <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, ...style }}>{children}</span>;

// How many of each kind of item need this person (a rise in any of them dings)
export function notifyCounts(d) {
  return {
    sign: d.sign.total, paid: d.paidReady, formTasks: d.forms.tasks.length, formUpdates: d.forms.updates.length,
    formApprovals: d.forms.approvals.length, formReview: d.forms.toReview.length, tickets: d.myTickets.length,
    newTickets: (d.newHelp || 0) + (d.newGear || 0), gearTickets: d.myGearTickets?.length || 0,
    meetings: d.meetingRequests.length, reimb: d.reimbToApprove.length, directory: d.confirmDirectory ? 1 : 0,
    messages: d.messages?.unread || 0,
    leave: d.leave?.myTurn ? 1 : 0,
    recall: d.recall?.waiting?.length || 0,
    accounts: d.accountRequests || 0,
    drillConfirm: d.drills?.confirm || 0, drillVerify: d.drills?.verify || 0, drillReturned: d.drills?.returned || 0,
  };
}

export default function YourDayPanel({ data: d, onOpen }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch (e) { return false; } });
  const toggle = () => setHidden(h => { try { localStorage.setItem(HIDE_KEY, h ? "0" : "1"); } catch (e) {} return !h; });
  const [sound, setSound] = useState(soundOn);
  const layout = useWidgetLayout();
  const prev = useRef(null);
  const counts = d?.me ? notifyCounts(d) : null;
  const countsKey = JSON.stringify(counts);
  useEffect(() => {
    if (!counts) return;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    document.title = total ? `(${total}) ${BRAND.app}` : BRAND.app;
    // Messages have their own sound and pop-up (MessageCenter), so they don't ding here too
    if (prev.current && Object.keys(counts).some(k => k !== "messages" && counts[k] > (prev.current[k] || 0))) {
      if (chime()) window.dispatchEvent(new CustomEvent("sgfd-chime"));
    }
    prev.current = counts;
  }, [countsKey]);
  useEffect(() => () => { document.title = BRAND.app; }, []);
  const toggleSound = () => { const on = !sound; setSound(on); setSoundOn(on); if (on) chime(true); };
  if (!d?.me) return null;
  const first = d.me.name.split(" ")[0];
  const cs = commsShifts(d.today);

  // Action items, most important first
  const signParts = [["auth1", "purchaser's signature", "purchaser's signatures"], ["auth2", "pre-approval", "pre-approvals"], ["chief", "final approval", "final approvals"]]
    .filter(([k]) => d.sign[k] > 0).map(([k, one, many]) => plural(d.sign[k], one, many));
  const actions = [];
  if (d.sign.total) actions.push({
    key: "sign", tone: BRICK, text: `You have ${signParts.join(", ")} to sign.`,
    sub: d.sign.sentToMe ? `${d.sign.sentToMe} ${d.sign.sentToMe === 1 ? "was" : "were"} sent to you directly.` : "",
    button: "Review now", open: () => onOpen("procurement", { tab: "requisitions", filter: "mine" }),
  });
  if (d.messages?.unread) {
    const m = d.messages, one = m.unread === 1 && m.latest[0];
    actions[m.important ? "unshift" : "push"]({
      key: "messages", tone: m.important ? BRICK : BRASS_DEEP,
      text: one ? `${m.latest[0].important ? "Important message" : "New message"} from ${m.latest[0].from}: ${m.latest[0].subject}` : `${plural(m.unread, "unread message", "unread messages")}${m.important ? ` (${m.important} important)` : ""}.`,
      sub: !one ? m.latest.slice(0, 2).map(x => `${x.from}: ${x.subject}`).join(" · ") : "",
      button: "Read", open: () => onOpen("messages", one ? { thread: m.latest[0].id } : {}),
    });
  }
  if (d.recall?.openBoards && !d.recall?.waiting?.length) actions.unshift({
    key: "recallBoard", tone: BRICK, text: `${plural(d.recall.openBoards, "emergency recall is", "emergency recalls are")} open.`,
    sub: "Responses, Aladtec assignments, staffing and roll call are on the board.", button: "Open board", open: () => onOpen("recall"),
  });
  if (d.leave?.myTurn) actions.unshift({
    key: "leave", tone: BRICK, text: `It's your turn to pick leave (${d.leave.year}, pick ${d.leave.myTurn}).`,
    sub: "The rest of your unit waits until you pick.", button: "Pick now", open: () => onOpen("leave"),
  });
  else if (d.leave?.unitUp) actions.push({
    key: "leaveUnit", tone: AMBER, text: `Leave pick: ${d.leave.unitUp} is up in your unit.`,
    sub: "As the unit's leader you can pick or skip for them if they're off.", button: "Open", open: () => onOpen("leave"),
  });
  if (d.drills?.returned) actions.push({
    key: "drillReturned", tone: BRICK, text: d.drills.returned === 1 ? "Training sent back one of your drill logs." : `Training sent back ${d.drills.returned} of your drill logs.`,
    sub: "Fix it and submit it again.", button: "Open", open: () => onOpen("training", { tab: "drills", filter: "returned" }),
  });
  if (d.drills?.confirm) actions.push({
    key: "drillConfirm", tone: AMBER, text: `Confirm your training: ${plural(d.drills.confirm, "drill was", "drills were")} logged with you on the crew.`,
    sub: "Check the date and hours and confirm (or say what's wrong).", button: "Confirm", open: () => onOpen("training", { tab: "drills", filter: "confirm" }),
  });
  if (d.drills?.verify) actions.push({
    key: "drillVerify", tone: AMBER, text: `${plural(d.drills.verify, "drill log is", "drill logs are")} waiting for Training to verify.`,
    sub: "Verified drills count toward everyone's hours.", button: "Review", open: () => onOpen("training", { tab: "drills", filter: "submitted" }),
  });
  if (d.accountRequests) actions.push({
    key: "accounts", tone: AMBER, text: d.accountRequests === 1 ? "1 new account request is waiting for you." : `${d.accountRequests} new account requests are waiting for you.`,
    sub: "Approve them and set their role in User Management.", button: "Review", open: () => onOpen("users"),
  });
  if (d.inv?.reviewDue) actions.push({
    key: "invReview", tone: AMBER, text: "The weekly Investigations access log review is due.", sub: "CJIS: review who opened what, then sign it off.", button: "Review", open: () => onOpen("investigations"),
  });
  if (d.inv?.trainingDue) actions.push({
    key: "invTraining", tone: AMBER, text: `Your CJIS security awareness training is due ${new Date(`${d.inv.trainingDue}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`,
    sub: "Without it, Investigations closes for you on that date. Send the new date to the Chief of Fire Prevention.", button: null, open: null,
  });
  if (d.confirmDirectory) actions.push({
    key: "directory", tone: AMBER, text: "Please confirm your directory card.", sub: "We're checking the whole directory.",
    button: "Check my card", open: () => onOpen("directory", { view: "mine" }),
  });
  if (d.forms.tasks.length) actions.push({
    key: "formtasks", tone: BRICK, text: `${plural(d.forms.tasks.length, "form is", "forms are")} waiting for you to fill out.`,
    sub: d.forms.tasks.slice(0, 2).map(t => t.label).join(", ") + (d.forms.tasks.length > 2 ? "…" : ""),
    button: "Fill out", open: () => onOpen("forms", { tab: "waiting" }),
  });
  if (d.forms.updates.length) actions.push({
    key: "formupdates", tone: SAGE, text: d.forms.updates.length === 1 ? `${d.forms.updates[0].formTitle}: ${d.forms.updates[0].stage}` : `${d.forms.updates.length} of your forms have updates.`,
    sub: d.forms.updates.length > 1 ? d.forms.updates.slice(0, 2).map(s => `${s.formTitle}: ${s.stage}`).join(", ") : "",
    button: "View", open: () => onOpen("forms", { tab: "waiting" }),
  });
  if (d.forms.approvals.length) actions.push({
    key: "formapprovals", tone: AMBER, text: `${plural(d.forms.approvals.length, "form is", "forms are")} waiting for your approval.`,
    sub: "", button: "Review", open: () => onOpen("forms", { tab: "waiting" }),
  });
  if (d.forms.toReview.length) actions.push({
    key: "formreview", tone: BRASS_DEEP, text: `${plural(d.forms.toReview.length, "submitted form needs", "submitted forms need")} your review.`,
    sub: d.forms.toReview.slice(0, 2).map(s => s.formTitle).join(", ") + (d.forms.toReview.length > 2 ? "…" : ""),
    button: "Review forms", open: () => onOpen("forms", { tab: "waiting" }),
  });
  if (d.newHelp) actions.push({
    key: "newhelp", tone: BRICK, text: `${plural(d.newHelp, "new Help Desk ticket needs", "new Help Desk tickets need")} to be acknowledged.`,
    sub: "", button: "Open Help Desk", open: () => onOpen("helpdesk"),
  });
  if (d.newGear) actions.push({
    key: "newgear", tone: BRICK, text: `${plural(d.newGear, "new gear ticket needs", "new gear tickets need")} to be acknowledged.`,
    sub: "", button: "Open gear tickets", open: () => onOpen("ppe", { view: "tickets" }),
  });
  if (d.myGearTickets?.length) actions.push({
    key: "geartickets", tone: AMBER, text: `${plural(d.myGearTickets.length, "gear ticket is", "gear tickets are")} assigned to you.`,
    sub: "", button: "Open gear tickets", open: () => onOpen("ppe", { view: "tickets", assignee: d.me.name }),
  });
  if (d.myTickets.length) actions.push({
    key: "tickets", tone: AMBER, text: `${plural(d.myTickets.length, "help desk ticket is", "help desk tickets are")} assigned to you.`,
    sub: d.overdue ? `${d.overdue} past due.` : "", button: "Open tickets",
    open: () => onOpen("helpdesk", { assignee: d.me.name }),
  });
  if (d.meetingRequests.length) actions.push({
    key: "meetings", tone: BRASS_DEEP, text: `${plural(d.meetingRequests.length, "meeting request is", "meeting requests are")} waiting for your answer.`,
    sub: "", button: "Respond", open: () => onOpen("meetings"),
  });
  if (d.reimbToApprove.length) actions.push({
    key: "reimb", tone: BRASS_DEEP, text: `${plural(d.reimbToApprove.length, "reimbursement is", "reimbursements are")} waiting for approval.`,
    sub: "", button: "Review", open: () => onOpen("reimbursements", { status: "pending_approval" }),
  });
  if (d.paidReady) actions.push({
    key: "paid", tone: SAGE, text: `${plural(d.paidReady, "approved requisition is", "approved requisitions are")} ready to mark paid.`,
    sub: "", button: "Ready to pay", open: () => onOpen("procurement", { tab: "requisitions", filter: "approved" }),
  });

  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  // An emergency recall waiting for my answer goes above everything else
  for (const w of (d.recall?.waiting || []).slice().reverse()) actions.unshift({
    key: `recall-${w.id}`, tone: BRICK, text: `EMERGENCY RECALL: ${w.title}`,
    sub: "Sign up in Aladtec, then tell the Assistant Chief you're coming (or that you can't report safely).", button: "Answer", open: () => onOpen("recall", { recall: w.id }),
  });
  const fire = fireShift(d.today);
  const openForms = d.forms.mine.filter(s => s.open);
  const formLabel = s => s.stage && s.status !== "denied" ? s.stage : s.status === "pending_approval" ? "Waiting for approval"
    : s.reviewed ? "Reviewed" : s.status === "approved" ? "Approved" : s.status === "denied" ? "Denied" : "Submitted";
  const pct = Math.min(1, d.worked / (d.target || 80));

  return (
    <section aria-label="Your day" style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: INK_SOFT, fontWeight: 600 }}>{pretty(d.today, { weekday: "long", month: "long", day: "numeric" })}</div>
          <div style={{ fontSize: "clamp(22px, 2.6vw, 28px)", fontWeight: 800, color: INK, marginTop: 2 }}>{hello}, {first}</div>
          <WeatherBar />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Fire / Comms rotations: only for public-safety installs (a business has no A/B/C shifts) */}
          {SHIFT_MODULES.some(moduleOn) && <>
          {workSettings().rotations.fire && <ShiftChip label="Fire" value={`${fire} shift`} color={BRICK} />}
          {workSettings().rotations.comms && <ShiftChip label="Comms days" value={cs.day} color={BRASS_DEEP} />}
          {workSettings().rotations.comms && <ShiftChip label="Comms nights" value={cs.night} color={INK} />}</>}
          <button onClick={toggleSound} aria-pressed={sound} title="Play a light ding when something new needs you"
            style={{ border: `1px solid ${LINE}`, background: "#fff", color: sound ? INK : INK_SOFT, cursor: "pointer", fontSize: 12.5, padding: "4px 10px", borderRadius: 999, fontFamily: "inherit" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{sound ? <Bell size={14} color={AMBER} fill="#F4B860" /> : <BellOff size={14} />}{sound ? "Sound on" : "Sound off"}</span>
          </button>
          {!hidden && (
            <button onClick={() => layout.setEditing(e => !e)} aria-pressed={layout.editing}
              style={{ border: `1px solid ${layout.editing ? BRASS_DEEP : LINE}`, background: layout.editing ? BRASS_DEEP : "#fff", color: layout.editing ? "#fff" : INK, cursor: "pointer", fontSize: 12.5, padding: "4px 10px", borderRadius: 999, fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <LayoutGrid size={13} /> {layout.editing ? "Done" : "Customize"}
            </button>
          )}
          <button onClick={toggle} style={{ border: "none", background: "none", color: BRASS_DEEP, cursor: "pointer", fontSize: 12.5, padding: "0 4px", textDecoration: "underline" }}>
            {hidden ? "Show widgets" : "Hide widgets"}
          </button>
        </div>
      </div>

      {/* Needs your attention: always shown, even when the widgets are hidden */}
      <div role="status" style={{ ...cardStyle, padding: 0, marginBottom: hidden ? 0 : 16, overflow: "hidden", borderLeft: `4px solid ${actions.length ? BRICK : SAGE}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderBottom: actions.length ? `1px solid ${LINE}` : "none" }}>
          <Activity size={20} color={actions.length ? BRICK : SAGE} strokeWidth={2.2} />
          <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: 0.6 }}>Needs your attention</span>
          {actions.length > 0 && <span style={{ background: BRICK, color: "#fff", borderRadius: 999, fontSize: 11.5, fontWeight: 700, padding: "1px 8px" }}>{actions.length}</span>}
          {actions.length === 0 && <span style={{ fontSize: 13.5, color: SAGE, fontWeight: 600, marginLeft: 6 }}>You're all caught up.</span>}
        </div>
        {actions.map((x, i) => (
          <div key={x.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderTop: i ? `1px solid ${LINE}` : "none", flexWrap: "wrap" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: x.tone, flexShrink: 0 }} />
            <div style={{ flex: "1 1 280px" }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>{x.text}</span>
              {x.sub && <span style={{ fontSize: 13, color: INK_SOFT }}> {x.sub}</span>}
            </div>
            {x.button && <button style={{ ...btn(i === 0 ? "primary" : "outline"), padding: "6px 12px" }} onClick={x.open}>{x.button}</button>}
          </div>
        ))}
      </div>

      {/* Calls open in CAD right now (shows only once CAD is set up) */}
      {moduleOn("activecalls") && <div style={{ marginTop: hidden ? 16 : 0 }}><ActiveCalls /></div>}

      {!hidden && layout.editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, color: INK, background: "#EAF1FB", border: `1px solid #C9DAF2`, borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          <GripVertical size={15} color={BRASS_DEEP} />
          <span style={{ flex: 1 }}>Drag widgets into the order you like, or use the arrows. Your layout is saved to your profile, so it follows you to any device.</span>
          <button onClick={layout.reset} style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }}><RotateCcw size={12} /> Reset layout</button>
          <button onClick={() => layout.setEditing(false)} style={{ ...btn("primary"), padding: "4px 12px", fontSize: 12.5 }}>Done</button>
        </div>
      )}
      {!hidden && (
        <WidgetLayout.Provider value={layout}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))", gap: 16 }}>
          <Widget id="time" icon={Clock} tint={BRASS_DEEP} title="Time this pay period" action="Time Tracker" onAction={() => onOpen("timetracker")}>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, alignItems: "center" }}>
              <Ring pct={pct} color={d.remaining ? BRASS_DEEP : SAGE}>
                <div style={{ fontSize: 22, fontWeight: 800, color: INK, lineHeight: 1 }}>{hrs(d.worked)}</div>
                <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 3 }}>of {d.target || 80} hrs</div>
              </Ring>
              <div style={{ display: "grid", gap: 8 }}>
                <Stat label={`Left to ${d.target || 80}`} value={`${hrs(d.remaining)} h`} color={d.remaining ? BRICK : SAGE} />
                <Stat label={`Needed per ${unitWord(d.pattern, 1)}`} value={!d.remaining ? "Done" : d.need.perShift === null ? "—" : `${hrs(d.need.perShift)} h`} color={INK} />
                <Stat label="Pay day" value={pretty(d.period.payday, { weekday: "short", month: "short", day: "numeric" })} color={INK} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
              {d.need.left} {unitWord(d.pattern, d.need.left)} left · pay period {pretty(d.period.start)} – {pretty(d.period.end)}
              {!d.pattern && <> · <span role="button" tabIndex={0} onClick={() => onOpen("timetracker")} style={{ color: BRASS_DEEP, cursor: "pointer", textDecoration: "underline" }}>set your schedule</span></>}
            </div>
            <PunchClock compact onChange={() => window.dispatchEvent(new CustomEvent("sgfd-time-changed"))} />
          </Widget>

          <Widget id="oncall" icon={PhoneCall} tint={BRICK} title="On call today" action="Call-Out Schedule" onAction={() => onOpen("callout")}>
            {d.onCall.size === 0 && <Empty>No one is listed for today.</Empty>}
            {[...d.onCall].map(([div, list]) => (
              <div key={div} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${LINE}`, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4 }}>{div}</div>
                  <Ellipsis style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{list[0].personName}</Ellipsis>
                  {list.length > 1 && <div style={{ fontSize: 11.5, color: INK_SOFT }}>+{list.length - 1} in call-back order</div>}
                </div>
                {list[0].phone && <a href={telHref(list[0].phone)} style={{ ...btn("outline"), padding: "5px 10px", fontSize: 12.5, textDecoration: "none", whiteSpace: "nowrap" }}>{list[0].phone}</a>}
              </div>
            ))}
          </Widget>

          <MessagesWidget onOpen={onOpen} unread={d.messages?.unread || 0} />
          <OnDutyWidget onOpen={onOpen} />
          <BookingsWidget onOpen={onOpen} />
          <ScheduleWidget onOpen={onOpen} />
          <OffWorkWidget onOpen={onOpen} />
          <SpotWidget onOpen={onOpen} />
          <LinksWidget onOpen={onOpen} />
          <Widget id="meetings" icon={Calendar} tint={SAGE} title="Meetings today" action="Meetings" onAction={() => onOpen("meetings")}>
            {d.todaysMeetings.length === 0 && <Empty>No meetings today.</Empty>}
            {d.todaysMeetings.map(m => (
              <div key={m.id} onClick={() => onOpen("meetings")} style={{ display: "flex", gap: 12, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
                <span style={{ background: "#EAF4EE", color: SAGE, fontWeight: 800, fontSize: 13, borderRadius: 6, padding: "5px 8px", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{m.time || "—"}</span>
                <div style={{ minWidth: 0 }}>
                  <Ellipsis style={{ display: "block", fontWeight: 700 }}>{m.subject}</Ellipsis>
                  {m.location && <Ellipsis style={{ display: "block", fontSize: 12, color: INK_SOFT }}>{m.location}</Ellipsis>}
                </div>
              </div>
            ))}
            {d.nextMeeting && (
              <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 10 }}>
                Next: <b style={{ color: INK }}>{d.nextMeeting.subject}</b>, {pretty(d.nextMeeting.date, { weekday: "short", month: "short", day: "numeric" })} {d.nextMeeting.time}
              </div>
            )}
          </Widget>

          <Widget id="forms" icon={FileText} tint={AMBER} title="Your forms" action="Forms" onAction={() => onOpen("forms", { tab: "mine" })} count={openForms.length}>
            {openForms.length === 0 && <Empty>{d.forms.mine.length ? "Nothing in progress." : "You haven't sent any forms."}</Empty>}
            {openForms.slice(0, 5).map(s => (
              <div key={s.id} onClick={() => onOpen("forms", { submissionId: s.id })}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Ellipsis style={{ display: "block", fontWeight: 700 }}>{s.formTitle}</Ellipsis>
                  <div style={{ fontSize: 11.5, color: INK_SOFT }}>
                    {new Date(s.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{s.noHandler ? " · not assigned yet" : ""}
                  </div>
                </div>
                <Pill color={s.status === "pending_approval" ? AMBER : s.stage ? SAGE : BRASS_DEEP}>{formLabel(s)}</Pill>
              </div>
            ))}
            {openForms.length > 5 && <More>+{openForms.length - 5} more in progress</More>}
          </Widget>

          <Widget id="tickets" icon={LifeBuoy} tint={AMBER} title="Your help desk tickets" action="Help Desk" onAction={() => onOpen("helpdesk", { assignee: d.me.name })} count={d.myTickets.length}>
            {d.myTickets.length === 0 && <Empty>Nothing assigned to you.</Empty>}
            {d.myTickets.slice(0, 5).map(t => (
              <div key={t.id} onClick={() => onOpen("helpdesk", { assignee: d.me.name })}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
                <span title={t.priority} style={{ width: 9, height: 9, borderRadius: "50%", background: PRIORITY_COLOR[t.priority] || INK_SOFT, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Ellipsis style={{ display: "block", fontWeight: 700 }}>{t.subject}</Ellipsis>
                  <div style={{ fontSize: 11.5, color: INK_SOFT }}>
                    {t.priority} · {TICKET_LABEL[t.status]}
                    {t.dueDate && <span style={{ color: t.dueDate < d.today ? BRICK : INK_SOFT, fontWeight: t.dueDate < d.today ? 700 : 400 }}> · {t.dueDate < d.today ? "past due" : "due"} {pretty(t.dueDate)}</span>}
                  </div>
                </div>
              </div>
            ))}
            {d.myTickets.length > 5 && <More>+{d.myTickets.length - 5} more</More>}
          </Widget>

          <Widget id="reqs" icon={ClipboardList} tint={INK} title="Your requisitions" action="Procurement" onAction={() => onOpen("procurement", { tab: "requisitions" })} count={d.openReqs.length}>
            {d.openReqs.length === 0 && <Empty>None in progress.</Empty>}
            {d.openReqs.slice(0, 5).map(r => (
              <div key={r.id} onClick={() => onOpen("procurement", { tab: "requisitions" })}
                style={{ padding: "7px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
                  <Ellipsis style={{ flex: 1, fontWeight: 700 }}>{r.title}</Ellipsis>
                  <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(reqAmount(r))}</span>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: STATUS_COLOR[r.status] || INK_SOFT, marginTop: 1 }}>
                  {STATUS_TEXT[r.status] || r.status}{r.nextSignerName && r.status.startsWith("pending") ? ` · sent to ${r.nextSignerName}` : ""}
                </div>
              </div>
            ))}
            {d.openReqs.length > 5 && <More>+{d.openReqs.length - 5} more in progress</More>}
          </Widget>
        </div>
        </WidgetLayout.Provider>
      )}
    </section>
  );
}

// Today's Aladtec roster, scrollable. Hidden until Aladtec is set up. Checks every 5 minutes
// (the server itself refreshes from Aladtec every 10).
function OnDutyWidget({ onOpen }) {
  const [snap, setSnap] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/directory/duty", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setSnap(j); }, () => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!snap || !snap.configured) return null;
  return (
    <Widget id="duty" icon={Users} tint={BRICK} title="On duty today" action="Fire stations" onAction={() => onOpen("directory", { view: "stations" })}>
      <div role="region" aria-label="On duty today roster" tabIndex={0}
        style={{ maxHeight: 340, overflowY: "auto", paddingRight: 6, marginRight: -6, overscrollBehavior: "contain" }}>
        {snap.error ? <div style={{ color: INK_SOFT }}>{snap.error}</div> : <DutyBoard snap={snap} places={snap.places || []} compact />}
      </div>
      {snap.updatedAt && <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 6 }}>From Aladtec · updated {new Date(snap.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>}
    </Widget>
  );
}

// ---- Widget layout: order + collapsed, saved to the person's profile (/api/prefs "yourDay") ----
const WidgetLayout = createContext(null);
const DEFAULT_ORDER = ["spot", "schedule", "time", "messages", "oncall", "duty", "offwork", "links", "bookings", "meetings", "forms", "tickets", "reqs"];
function useWidgetLayout() {
  const [saved, setSaved] = useState({ order: [], collapsed: [] });
  const [editing, setEditing] = useState(false);
  const [present, setPresent] = useState(() => new Set());
  const timer = useRef(null);
  useEffect(() => {
    fetch("/api/prefs", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } }).then(r => (r.ok ? r.json() : null))
      .then(j => { const y = j?.prefs?.yourDay; if (y) setSaved({ order: Array.isArray(y.order) ? y.order : [], collapsed: Array.isArray(y.collapsed) ? y.collapsed : [] }); }, () => {});
  }, []);
  const store = next => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetch("/api/prefs", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" },
      body: JSON.stringify({ key: "yourDay", value: next }) }).catch(() => {}), 400);
  };
  const update = fn => setSaved(cur => { const next = fn(cur); store(next); return next; });
  const order = useMemo(() => [...saved.order.filter(k => DEFAULT_ORDER.includes(k)), ...DEFAULT_ORDER.filter(k => !saved.order.includes(k))], [saved.order]);
  return {
    editing, setEditing,
    orderOf: id => order.indexOf(id),
    isCollapsed: id => saved.collapsed.includes(id),
    toggle: id => update(c => ({ ...c, collapsed: c.collapsed.includes(id) ? c.collapsed.filter(x => x !== id) : [...c.collapsed, id] })),
    // Move past the next widget that's actually on screen (some only show when set up)
    move: (id, dir) => update(c => {
      const shown = order.filter(k => present.has(k)), i = shown.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= shown.length) return c;
      const next = [...order], a = next.indexOf(shown[i]), b = next.indexOf(shown[j]);
      [next[a], next[b]] = [next[b], next[a]];
      return { ...c, order: next };
    }),
    moveTo: (id, target) => update(c => {
      if (!id || id === target) return c;
      const next = order.filter(k => k !== id);
      next.splice(next.indexOf(target) + (order.indexOf(id) < order.indexOf(target) ? 1 : 0), 0, id);
      return { ...c, order: next };
    }),
    isFirst: id => order.filter(k => present.has(k))[0] === id,
    isLast: id => { const s = order.filter(k => present.has(k)); return s[s.length - 1] === id; },
    register: id => setPresent(p => (p.has(id) ? p : new Set([...p, id]))),
    unregister: id => setPresent(p => { const n = new Set(p); n.delete(id); return n; }),
    reset: () => update(() => ({ order: [], collapsed: [] })),
  };
}

function Widget({ id, icon: Icon, tint, title, action, onAction, count, children }) {
  const L = useContext(WidgetLayout);
  const [over, setOver] = useState(false);
  const on = !WIDGET_TILE[id] || tileOn(WIDGET_TILE[id]);
  useEffect(() => { if (L && id && on) { L.register(id); return () => L.unregister(id); } }, [id, on]);
  if (!on) return null;
  const collapsed = !!(L && id && L.isCollapsed(id));
  const editing = !!(L && L.editing);
  const iconBtn = { border: `1px solid ${LINE}`, background: "#fff", borderRadius: 6, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: INK_SOFT, padding: 0 };
  return (
    <div data-widget={id} draggable={editing}
      onDragStart={e => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={e => { if (editing) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); L.moveTo(e.dataTransfer.getData("text/plain"), id); }}
      style={{ ...cardStyle, padding: 0, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
        order: L && id ? L.orderOf(id) : 0, alignSelf: collapsed ? "start" : "stretch",
        outline: editing ? `2px dashed ${over ? BRASS_DEEP : "#B9C6DA"}` : "none", outlineOffset: -2, cursor: editing ? "grab" : "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: collapsed ? "14px 18px" : "16px 18px 10px" }}>
        {editing && <GripVertical size={18} color={INK_SOFT} aria-hidden="true" style={{ flexShrink: 0, marginRight: -4 }} />}
        <span style={{ color: tint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {Icon && <Icon size={collapsed ? 22 : 26} strokeWidth={1.8} />}
        </span>
        <span style={{ fontSize: collapsed ? 16 : 18, fontWeight: 800, color: INK, flex: 1, minWidth: 0, letterSpacing: -0.2 }}>{title}</span>
        {count > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT, background: "#EEF1F5", borderRadius: 999, padding: "1px 8px" }}>{count}</span>}
        {L && id && (editing ? (
          <span style={{ display: "inline-flex", gap: 4 }}>
            <button type="button" style={iconBtn} aria-label={`Move ${title} earlier`} disabled={L.isFirst(id)} onClick={() => L.move(id, -1)}><ArrowUp size={14} /></button>
            <button type="button" style={iconBtn} aria-label={`Move ${title} later`} disabled={L.isLast(id)} onClick={() => L.move(id, 1)}><ArrowDown size={14} /></button>
          </span>
        ) : (
          <button type="button" style={{ ...iconBtn, border: "none", background: "transparent" }} aria-expanded={!collapsed}
            aria-label={collapsed ? `Show more of ${title}` : `Show less of ${title}`} title={collapsed ? "Show more" : "Show less"} onClick={() => L.toggle(id)}>
            {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        ))}
      </div>
      {!collapsed && <div style={{ fontSize: 13, flex: 1, padding: "0 18px 12px" }}>{children}</div>}
      {!collapsed && action && (
        <button onClick={onAction} style={{ border: "none", borderTop: `1px solid ${LINE}`, background: "#FAFBFC", color: BRASS_DEEP, fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: "9px 18px", textAlign: "left", fontFamily: "inherit" }}>
          Open {action} ›
        </button>
      )}
    </div>
  );
}

// Latest conversations from Messages (own refresh every minute, and when Your Day dings)
function MessagesWidget({ onOpen, unread }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/messages?box=inbox", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setList(j.threads); }, () => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("sgfd-chime", load);
    return () => { alive = false; clearInterval(t); window.removeEventListener("sgfd-chime", load); };
  }, [unread]);
  const when = iso => { const x = new Date(iso); return x.toDateString() === new Date().toDateString() ? x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : x.toLocaleDateString([], { month: "short", day: "numeric" }); };
  return (
    <Widget id="messages" icon={Mail} tint={BRASS_DEEP} title="Messages" action="Messages" onAction={() => onOpen("messages")} count={unread}>
      {list === null && <Empty>Loading…</Empty>}
      {list && list.length === 0 && <Empty>No messages.</Empty>}
      {(list || []).slice(0, 5).map(t => (
        <div key={t.id} role="button" tabIndex={0} onClick={() => onOpen("messages", { thread: t.id })} onKeyDown={e => { if (e.key === "Enter") onOpen("messages", { thread: t.id }); }}
          style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0, background: t.unread ? (t.important ? BRICK : BRASS_DEEP) : "transparent" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <Ellipsis style={{ flex: 1, fontWeight: t.unread ? 800 : 600, fontSize: 13.5, color: INK }}>{t.last && !t.last.mine ? t.last.author : t.from}</Ellipsis>
              <span style={{ fontSize: 11.5, color: INK_SOFT, whiteSpace: "nowrap" }}>{when(t.last?.at || t.createdAt)}</span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
              {t.important && <AlertCircle size={12} color={BRICK} style={{ flexShrink: 0 }} />}
              <Ellipsis style={{ display: "block", fontSize: 12.5, color: t.unread ? INK : INK_SOFT, fontWeight: t.unread ? 600 : 400 }}>{t.subject}</Ellipsis>
            </div>
          </div>
        </div>
      ))}
    </Widget>
  );
}
// Classroom bookings: today and the coming week (from the Facility & Resource Request form and Training)
// Off Work: who's out today and in the next week (what each person shares with this viewer; sick call-outs as "Out sick")
const hm = t => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`; };
const OFF_COLOR = { off: BRASS_DEEP, vacation: SAGE, meeting: "#0E7C86", training: "#7A4FB0", ooo: AMBER, remote: INK_SOFT, other: INK_SOFT, sick: BRICK, leave: INK_SOFT };
// Work schedule (Time Clock module): who's working today, from the schedule; refreshed every 5 minutes
function ScheduleWidget({ onOpen }) { return tileOn("schedule") ? <ScheduleWidgetBody onOpen={onOpen} /> : null; }
function ScheduleWidgetBody({ onOpen }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/schedule/today", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setD(j); }, () => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const here = d?.list?.filter(e => e.status === "working").length || 0;
  return (
    <Widget id="schedule" icon={CalendarClock} tint="#2E7D4F" title="Working today" action="Work Schedule" onAction={() => onOpen("schedule")} count={here}>
      {!d && <Empty>Loading…</Empty>}
      {d && !d.list.length && <Empty>No one is on today's schedule.</Empty>}
      {d && <div style={{ maxHeight: 280, overflowY: "auto" }}>{d.list.map(e => (
        <div key={e.userId} onClick={() => onOpen("schedule")} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
          <span title={SCHED_STATUS[e.status].label} style={{ width: 8, height: 8, borderRadius: 4, background: SCHED_STATUS[e.status].color, flexShrink: 0 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Ellipsis style={{ display: "block", fontWeight: 700 }}>{e.name}</Ellipsis>
            <Ellipsis style={{ display: "block", fontSize: 12, color: INK_SOFT }}>{e.status === "out" ? (e.off?.label || "Out") : dayLine(e)}{e.note ? ` · ${e.note}` : ""}</Ellipsis>
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: SCHED_STATUS[e.status].color, whiteSpace: "nowrap" }}>{SCHED_STATUS[e.status].label}</span>
        </div>))}</div>}
    </Widget>
  );
}

function OffWorkWidget({ onOpen }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/offwork/widget", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setD(j); }, () => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const short = x => pretty(x, { weekday: "short", month: "numeric", day: "numeric" });
  const row = (e, soon) => (
    <div key={e.id} onClick={() => onOpen("offwork")} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: OFF_COLOR[e.kind] || INK_SOFT, flexShrink: 0 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <Ellipsis style={{ display: "block", fontWeight: 700 }}>{e.name}</Ellipsis>
        <Ellipsis style={{ display: "block", fontSize: 12, color: INK_SOFT }}>{e.label}{e.location ? ` · ${e.location}` : ""} · {e.division}</Ellipsis>
      </div>
      <span style={{ fontSize: 12, color: INK_SOFT, whiteSpace: "nowrap", textAlign: "right" }}>{soon ? (e.from === e.to ? short(e.from) : `${short(e.from)}–${short(e.to)}`) : e.to === d.today ? "today" : `until ${short(e.to)}`}
        {(e.startTime || e.endTime) && (soon || e.to === d.today) && <div>{e.startTime && e.startTime > (d.now || "") && !soon ? `leaves ~${hm(e.startTime)}, ` : ""}{e.endTime ? `back ~${hm(e.endTime)}` : ""}</div>}</span>
    </div>
  );
  return (
    <Widget id="offwork" icon={CalendarOff} tint={BRICK} title="Out today" action="Off Work" onAction={() => onOpen("offwork")} count={d?.out?.length || 0}>
      {!d && <Empty>Loading…</Empty>}
      {d && d.out.length === 0 && <Empty>Nobody is out today.</Empty>}
      {d && <div style={{ maxHeight: 260, overflowY: "auto" }}>{d.out.map(e => row(e, false))}</div>}
      {d?.soon?.length > 0 && <>
        <div style={{ fontSize: 11, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, margin: "10px 0 2px" }}>Next 7 days</div>
        {d.soon.slice(0, 5).map(e => row(e, true))}
        {d.soon.length > 5 && <More>+{d.soon.length - 5} more</More>}
      </>}
    </Widget>
  );
}

// Spot prices (module "spot"): the four metals and today's gold chart; same shared poll as the ticker
function SpotWidget({ onOpen }) { return tileOn("spot") ? <SpotWidgetBody onOpen={onOpen} /> : null; }
function SpotWidgetBody({ onOpen }) {
  const { data } = useSpot();
  return (
    <Widget id="spot" icon={Coins} tint="#B08A1E" title="Spot prices" action="Spot Prices" onAction={() => onOpen("spot")}>
      {!data && <Empty>Loading…</Empty>}
      {data && !data.metals?.length && <Empty>{data.configured ? "Waiting for prices…" : "Spot prices aren't set up yet."}</Empty>}
      {data?.metals?.map(m => <div key={m.metal} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${LINE}` }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: METAL_COLOR[m.metal], flexShrink: 0 }} />
        <b style={{ flex: 1 }}>{m.name}</b><span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{spotMoney(m.price)}</span><Change m={m} /></div>)}
      {data?.metals?.length > 0 && <div style={{ marginTop: 8 }}><SpotChart metal="gold" height={70} /></div>}
      {data?.demo && <div style={{ fontSize: 11.5, color: "#8A5A00", marginTop: 4 }}>Demo prices (made up)</div>}
    </Widget>
  );
}

// Quick Links (module "links"): the first eight links shared with this person
function LinksWidget({ onOpen }) {
  const [list, setList] = useState(null);
  useEffect(() => { if (tileOn("links")) fetchLinks().then(j => setList(j.links), () => setList([])); }, []);
  return (
    <Widget id="links" icon={Link2} tint="#2F5E9E" title="Quick links" action="Quick Links" onAction={() => onOpen("links")} count={list?.length || 0}>
      {!list && <Empty>Loading…</Empty>}
      {list && !list.length && <Empty>No links yet.</Empty>}
      {list && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
        {list.slice(0, 8).map(l => <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", gap: 5, alignItems: "center", padding: "5px 0", color: INK, fontWeight: 700, textDecoration: "none", minWidth: 0 }}>
          <ExternalLink size={12} style={{ flexShrink: 0 }} /><Ellipsis>{l.title}</Ellipsis></a>)}</div>}
      {list?.length > 8 && <More>+{list.length - 8} more</More>}
    </Widget>
  );
}

function BookingsWidget({ onOpen }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    const from = todayISO();
    const to = new Date(Date.parse(`${from}T12:00:00`) + 6 * 86400000).toISOString().slice(0, 10);
    const load = () => fetch(`/api/bookings?from=${from}&to=${to}`, { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setList(j.bookings); }, () => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const today = todayISO();
  const todays = (list || []).filter(b => b.day === today);
  const later = (list || []).filter(b => b.day > today);
  const row = b => (
    <div key={b.id} role="button" tabIndex={0} onClick={() => onOpen("training", { tab: "bookings", day: b.day })} onKeyDown={e => { if (e.key === "Enter") onOpen("training", { tab: "bookings", day: b.day }); }}
      style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", borderBottom: `1px solid ${LINE}`, cursor: "pointer", minWidth: 0 }}>
      <span style={{ background: b.status === "approved" ? "#EAF4EE" : "#FFF4DE", color: b.status === "approved" ? SAGE : "#8A5A00", fontWeight: 800, fontSize: 12, borderRadius: 6,
        padding: "4px 7px", fontVariantNumeric: "tabular-nums", flexShrink: 0, textAlign: "center", lineHeight: 1.25 }}>
        {b.start.replace(":", "")}<br />{b.end.replace(":", "")}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Ellipsis style={{ display: "block", fontWeight: 700 }}>{b.title}</Ellipsis>
        <Ellipsis style={{ display: "block", fontSize: 12, color: INK_SOFT }}>{b.room}{b.status !== "approved" ? " · waiting for approval" : ""}{b.contact ? ` · ${b.contact}` : ""}</Ellipsis>
        {b.rotations?.length > 0 && (
          <div style={{ fontSize: 11.5, color: INK, marginTop: 2, display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <Truck size={12} color={BRASS_DEEP} />
            {b.rotations.map(r => <span key={r.id} style={{ whiteSpace: "nowrap" }}>R{r.seq} {r.start.replace(":", "")}: {r.apparatus.map(a => a.unit).join(", ")}</span>)
              .reduce((acc, el, i) => i ? [...acc, <span key={`s${i}`} style={{ color: INK_SOFT }}>·</span>, el] : [el], [])}
          </div>
        )}
        {b.needsRotation && !b.rotations?.length && <div style={{ fontSize: 11.5, color: "#8A5A00", marginTop: 2 }}>Truck rotation needed, not assigned yet</div>}
      </div>
    </div>
  );
  return (
    <Widget id="bookings" icon={School} tint={BRASS_DEEP} title="Classroom bookings" action="All bookings" onAction={() => onOpen("training", { tab: "bookings" })} count={todays.length}>
      {list === null && <Empty>Loading…</Empty>}
      {list && todays.length === 0 && <Empty>No classes booked today.</Empty>}
      {todays.map(row)}
      {later.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, margin: "10px 0 2px" }}>Coming up</div>
          {later.slice(0, 4).map(b => (
            <div key={b.id} onClick={() => onOpen("training", { tab: "bookings", day: b.day })} style={{ fontSize: 12.5, padding: "4px 0", cursor: "pointer", display: "flex", gap: 6, minWidth: 0 }}>
              <b style={{ whiteSpace: "nowrap", color: INK }}>{pretty(b.day, { weekday: "short", month: "numeric", day: "numeric" })}</b>
              <Ellipsis style={{ flex: 1, color: INK_SOFT }}>{b.start.replace(":", "")}–{b.end.replace(":", "")} {b.title} · {b.room}</Ellipsis>
            </div>
          ))}
          {later.length > 4 && <div style={{ fontSize: 12, color: INK_SOFT }}>+{later.length - 4} more this week</div>}
        </>
      )}
    </Widget>
  );
}
function Ring({ pct, color, children }) {
  const r = 44, c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: 104, height: 104 }}>
      <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r={r} fill="none" stroke="#E6EAF0" strokeWidth="9" />
        <circle cx="52" cy="52" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 52 52)" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}
const Stat = ({ label, value, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, borderBottom: `1px dashed ${LINE}`, paddingBottom: 6 }}>
    <span style={{ fontSize: 12.5, color: INK_SOFT }}>{label}</span>
    <span style={{ fontSize: 15, fontWeight: 800, color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
  </div>
);
const ShiftChip = ({ label, value, color }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 999, padding: "4px 10px 4px 6px", fontSize: 12.5 }}>
    <span style={{ background: color, color: "#fff", fontWeight: 800, borderRadius: 999, padding: "1px 8px", fontSize: 12 }}>{value}</span>
    <span style={{ color: INK_SOFT, fontWeight: 600 }}>{label}</span>
  </span>
);
const Pill = ({ color, children }) => (
  <span style={{ fontSize: 11.5, fontWeight: 700, color, border: `1.5px solid ${color}`, background: `${color}12`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>
);
const More = ({ children }) => <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 8 }}>{children}</div>;
