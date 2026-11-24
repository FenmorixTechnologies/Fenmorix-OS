// A soft two-note "ding" made in the browser (no sound file). Browsers only allow
// sound after the person has clicked or typed on the page once, so the audio is
// unlocked on the first interaction.
import { emergencyOn } from "./emergency.js";
const KEY = "sgfd-sound";
let ctx = null;

function unlock() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch (e) { /* no audio */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
}

export function soundOn() { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } }
export function setSoundOn(on) { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* ignore */ } }

export function chime(force = false) {
  if (emergencyOn()) return false;                 // Command Board emergency mode: silent
  if (!force && !soundOn()) return false;
  try {
    unlock();
    if (!ctx || ctx.state !== "running") return false;
    const t = ctx.currentTime;
    const note = (freq, start, length) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(0.12, t + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + start); osc.stop(t + start + length + 0.05);
    };
    note(880, 0, 0.45);      // A5
    note(1318.5, 0.12, 0.6); // E6
    return true;
  } catch (e) { return false; }
}

// ---- Message sounds (each person's choice, on this computer) ---------------------------------
const PREFS = "sgfd-message-alerts";
export function alertPrefs() {
  try { return { sound: true, importantSound: true, desktop: true, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }; }
  catch (e) { return { sound: true, importantSound: true, desktop: true }; }
}
export function setAlertPrefs(p) { try { localStorage.setItem(PREFS, JSON.stringify({ ...alertPrefs(), ...p })); } catch (e) { /* ignore */ } }

function tones(list, volume = 0.12) {
  if (emergencyOn()) return false;
  try {
    unlock();
    if (!ctx || ctx.state !== "running") return false;
    const t = ctx.currentTime;
    for (const [freq, start, length, type] of list) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type || "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(volume, t + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + start); osc.stop(t + start + length + 0.05);
    }
    return true;
  } catch (e) { return false; }
}
// A new message: a short soft "pop"
export function messageTone(force = false) {
  if (!force && !alertPrefs().sound) return false;
  return tones([[660, 0, 0.18], [990, 0.09, 0.32]], 0.1);
}
// An important message: an urgent triple tone, played twice, that can't be mistaken for a chat
export function importantTone(force = false) {
  if (!force && !alertPrefs().importantSound) return false;
  const beeps = [];
  for (const rep of [0, 0.75]) for (const [i, f] of [[0, 1046.5], [1, 784], [2, 1046.5]]) beeps.push([f, rep + i * 0.16, 0.14, "triangle"]);
  return tones(beeps, 0.2);
}
