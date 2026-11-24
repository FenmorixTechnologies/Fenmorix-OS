// Emergency mode: while someone is running an open command board, nothing pushes to their phone or computer.
// The board screen checks in every few seconds; the quiet ends ~30 s after they leave it (or the board is closed).
const until = new Map();
export const markEmergency = userId => until.set(userId, Date.now() + 30_000);
export const clearEmergency = userId => until.delete(userId);
export const inEmergency = userId => (until.get(userId) || 0) > Date.now();
