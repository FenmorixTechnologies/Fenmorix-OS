// The ISO training kind a class most likely counts toward, from its category / title words (PIAL, Training)
export function guessCategory(src) {
  const s = String(src || "").toLowerCase();
  if (/recruit|academy|firefighter i\b|ff ?i\b|ff1|probation/.test(s)) return "recruit";
  if (/new driver|driver.*(new|initial|certification)|initial.*driver/.test(s)) return "new_driver";
  if (/driver|operator|pump op|apparatus op|evoc|aerial op/.test(s)) return "driver";
  if (/officer|leadership|supervis|command staff/.test(s)) return "officer";
  if (/haz ?mat|hazardous/.test(s)) return "hazmat";
  if (/nims|\bics\b|ics-|incident command|incident management/.test(s)) return "ims";
  if (/\bems\b|medical|cpr|bls|als|admin|meeting|paramedic|emt/.test(s)) return "other";
  return "company";
}
