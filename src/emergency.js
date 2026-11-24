// Emergency mode (Command Board): while it's on, Nexus makes no sounds, pop-ups or desktop notifications. Messages still
// arrive and the chat still works; they just don't interrupt. The command board screen turns it on and off.
let on = false;
export const emergencyOn = () => on;
export function setEmergency(v) {
  if (on === !!v) return;
  on = !!v;
  try { window.dispatchEvent(new CustomEvent("sgfd-emergency", { detail: { on } })); } catch (e) { /* not in a browser */ }
}
