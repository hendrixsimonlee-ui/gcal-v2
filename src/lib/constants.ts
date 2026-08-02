/** Sentinel for the Schedule Builder's space picker: search every room at
 * once, which is the usual case — the AD normally just needs a room, not a
 * particular room. Lives here rather than in the "use server" actions module,
 * which may only export async functions. */
export const ANY_SPACE = "__any__";

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
