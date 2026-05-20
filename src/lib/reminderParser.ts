/**
 * Reminder Parser — extract structured reminder data from natural-language
 * note content.
 *
 * Scope (intentional):
 *   We extract WHAT a reminder says (subject, time, days, frequency). We
 *   do NOT fire notifications, schedule jobs, or do timezone math. This
 *   module is the "intent detector" that lets the UI render reminders as
 *   visible cards (W/T/F/S/S/M/T pills + time + subject) — useful as a
 *   visual log even if the OS isn't pushing alerts.
 *
 *   When/if Zakar grows real notification support, this same parser
 *   becomes the input to a scheduler. Until then, it earns its keep by
 *   making reminder notes scannable at a glance.
 *
 * What we detect:
 *   - "remind me to X every Wednesday at 8am"
 *   - "remind me to X tomorrow at 5pm"
 *   - "X every weekday at 9am"
 *   - "X every day"
 *   - "X on Mondays and Fridays"
 *   - "X in 30 minutes" / "in 2 hours" (relative)
 *   - "X next Monday"
 *
 * What we don't (for now):
 *   - Geofence triggers ("when I walk into the office") — needs native
 *   - Complex recurrences ("every other Tuesday", "first Friday of month")
 *   - Natural-language date math ("the day after next Wednesday")
 *
 * Design choices:
 *   - Pure dependency-free. No date library. The fields we extract are
 *     deliberately small and well-typed; the UI does the rendering.
 *   - Returns null when input doesn't look like a reminder. Callers
 *     check the return value rather than relying on confidence scores.
 *   - Conservative: we'd rather miss a reminder than misclassify a
 *     non-reminder note as one. Users can always tag manually later.
 */

/* ============================================================
   Types
   ============================================================ */

/** Days of the week. 0 = Sunday … 6 = Saturday (matches JS Date.getDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Reminder {
  /** What the user wants to be reminded about. The verb-phrase part of
   *  "remind me to water the basil" → "water the basil". */
  subject: string;
  /** Specific time of day in 24h format ("HH:MM") if mentioned. */
  time?: string;
  /** Active weekdays for recurring reminders. Empty = no specific days. */
  days?: Weekday[];
  /** Recurrence pattern. Driven by `days` for weekly patterns. */
  recurrence?: "once" | "daily" | "weekly" | "weekdays" | "weekends";
  /** Specific date for one-shot reminders ("tomorrow", "next Monday").
   *  ISO date string (YYYY-MM-DD). Set in addition to or instead of `days`. */
  date?: string;
  /** Original phrase that triggered the parse, useful for debugging and
   *  for showing "Why did Zakar mark this as a reminder?" in the UI. */
  source: string;
}

/* ============================================================
   Constants
   ============================================================ */

const DAY_NAMES: Record<string, Weekday> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const WEEKEND: Weekday[] = [0, 6];

// "Reminder verbs" — words that strongly suggest the note is intended as
// a reminder. Presence of one of these is the primary trigger.
const REMINDER_VERBS = [
  "remind me",
  "reminder",
  "don't forget",
  "dont forget",
  "remember to",
];

/* ============================================================
   Helpers
   ============================================================ */

/** Convert a 12h time mention into HH:MM 24h. Accepts "8am", "8 a.m.",
 *  "8:30 PM", "20:00", "noon", "midnight". Returns null if not parseable. */
const parseTime = (raw: string): string | null => {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";

  // 24h format
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h <= 23 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }

  // 12h with am/pm
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = m12[2] ? parseInt(m12[2], 10) : 0;
    const period = m12[3].replace(/\s+/g, "");
    if (h === 12) h = 0;
    if (period === "pm") h += 12;
    if (h <= 23 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }
  return null;
};

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Extract weekday mentions from a phrase. Handles "Mondays", "Tue and Fri",
 *  "weekdays", "weekends", "every day". Returns null if none detected. */
const extractDays = (phrase: string): {
  days: Weekday[];
  recurrence: Reminder["recurrence"];
} | null => {
  const lower = phrase.toLowerCase();
  if (/\bevery\s+day\b|\bdaily\b/.test(lower)) {
    return { days: [0, 1, 2, 3, 4, 5, 6], recurrence: "daily" };
  }
  if (/\bweekdays?\b/.test(lower)) {
    return { days: [...WEEKDAYS], recurrence: "weekdays" };
  }
  if (/\bweekends?\b/.test(lower)) {
    return { days: [...WEEKEND], recurrence: "weekends" };
  }

  const found = new Set<Weekday>();
  // Match individual day names, including plurals ("Mondays")
  const dayMatches = lower.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|weds?|thur?s?|fri|sat)s?\b/g,
  );
  if (dayMatches) {
    for (const d of dayMatches) {
      const trimmed = d.replace(/s$/, "");
      if (DAY_NAMES[trimmed] !== undefined) {
        found.add(DAY_NAMES[trimmed]);
      }
    }
  }
  if (found.size > 0) {
    return {
      days: Array.from(found).sort(),
      recurrence: "weekly",
    };
  }
  return null;
};

/** Parse "in N minutes/hours/days" relative time. Returns ISO date if a
 *  day-level offset is implied, plus optional time. */
const parseRelativeOffset = (
  phrase: string,
  now: Date = new Date(),
): { date?: string; time?: string } | null => {
  const m = phrase.match(
    /\bin\s+(\d+)\s+(minute|min|hour|hr|day|week)s?\b/i,
  );
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const target = new Date(now.getTime());
  if (unit === "minute" || unit === "min") {
    target.setMinutes(target.getMinutes() + n);
    return {
      date: isoDate(target),
      time: `${pad2(target.getHours())}:${pad2(target.getMinutes())}`,
    };
  }
  if (unit === "hour" || unit === "hr") {
    target.setHours(target.getHours() + n);
    return {
      date: isoDate(target),
      time: `${pad2(target.getHours())}:${pad2(target.getMinutes())}`,
    };
  }
  if (unit === "day") {
    target.setDate(target.getDate() + n);
    return { date: isoDate(target) };
  }
  if (unit === "week") {
    target.setDate(target.getDate() + n * 7);
    return { date: isoDate(target) };
  }
  return null;
};

/** Parse "tomorrow", "today", "next Monday". Returns ISO date or null. */
const parseDateWord = (
  phrase: string,
  now: Date = new Date(),
): string | null => {
  const lower = phrase.toLowerCase();
  if (/\btoday\b/.test(lower)) return isoDate(now);
  if (/\btomorrow\b/.test(lower)) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return isoDate(t);
  }
  // "next Monday" → the next Monday strictly after today
  const nextDay = lower.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (nextDay) {
    const targetDay = DAY_NAMES[nextDay[1]];
    const today = now.getDay();
    let diff = (targetDay - today + 7) % 7;
    if (diff === 0) diff = 7; // "next" means strictly future
    const t = new Date(now);
    t.setDate(t.getDate() + diff);
    return isoDate(t);
  }
  return null;
};

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/* ============================================================
   Subject extraction
   ============================================================ */

/** Pull the verb phrase out of "remind me to X every…" — i.e. trim away
 *  the trigger phrase ("remind me to") and the schedule clause ("every
 *  Wednesday at 8am"). What's left is what the user actually wants to do. */
const extractSubject = (text: string): string => {
  let s = text.trim();
  // Remove leading reminder verbs
  s = s.replace(
    /^(remind me to|reminder:?|reminder to|don'?t forget to|remember to)\s+/i,
    "",
  );
  // Strip trailing schedule clauses. The patterns below capture the
  // boundary between "the thing to do" and "when to do it".
  const cuts = [
    /\s+every\s+\w[\w\s,]*?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?$/i,
    /\s+(?:on\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\s+(?:and|,)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?)*(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?$/i,
    /\s+(?:tomorrow|today|tonight)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?$/i,
    /\s+next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))?$/i,
    /\s+in\s+\d+\s+(?:minute|min|hour|hr|day|week)s?$/i,
    /\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i,
    /\s+(?:weekdays?|weekends?|daily|every\s+day)$/i,
  ];
  for (const cut of cuts) {
    s = s.replace(cut, "");
  }
  return s.trim().replace(/[.,;:]+$/, "");
};

/* ============================================================
   Main parser
   ============================================================ */

/**
 * Parse note content for reminder intent. Returns a structured `Reminder`
 * if the note looks like one, otherwise null.
 *
 * Strategy:
 *   1. Look for an explicit reminder verb ("remind me", "don't forget",
 *      "remember to"). If absent, bail — the note isn't a reminder.
 *   2. Within the matched sentence, extract:
 *      - day(s) of week
 *      - time of day
 *      - relative offsets ("in 30 minutes")
 *      - date words ("tomorrow", "next Monday")
 *      - the subject (the verb phrase to remember)
 *   3. Reject if no temporal information was found — a "reminder" without
 *      a when is just a regular note.
 */
export const parseReminder = (
  content: string,
  now: Date = new Date(),
): Reminder | null => {
  if (!content) return null;
  const text = content.replace(/\r\n/g, "\n").trim();
  if (text.length === 0 || text.length > 4000) return null;

  // Find the trigger sentence. We split on sentence-ish boundaries and
  // pick the first one containing a reminder verb. Most reminder phrases
  // fit in a single sentence; multi-sentence reminders are rare.
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  let triggerSentence: string | null = null;
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (REMINDER_VERBS.some((v) => lower.includes(v))) {
      triggerSentence = s;
      break;
    }
  }
  if (!triggerSentence) return null;

  // Extract temporal pieces
  const daysInfo = extractDays(triggerSentence);
  const dateWord = parseDateWord(triggerSentence, now);
  const relative = parseRelativeOffset(triggerSentence, now);

  // Time of day — match "at 8am", "at 8:30 PM", "at 20:00"
  let time: string | undefined;
  const timeMatch = triggerSentence.match(
    /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM|A\.M\.|P\.M\.)|noon|midnight|\d{1,2}:\d{2})\b/,
  );
  if (timeMatch) {
    const parsed = parseTime(timeMatch[1]);
    if (parsed) time = parsed;
  }
  // Loose-context fallback ("8am" or "8 PM" without "at")
  if (!time) {
    const loose = triggerSentence.match(
      /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\b/,
    );
    if (loose) {
      const parsed = parseTime(loose[1]);
      if (parsed) time = parsed;
    }
  }

  // Pull date / time / days from relative offset if present
  let date: string | undefined = dateWord || undefined;
  if (relative) {
    if (relative.date && !date) date = relative.date;
    if (relative.time && !time) time = relative.time;
  }

  // No temporal info at all = not really a reminder. Don't mislabel.
  if (!daysInfo && !date && !time && !relative) {
    return null;
  }

  const subject = extractSubject(triggerSentence);
  if (!subject) return null;

  // Compose the result. Prefer days+recurrence for weekly patterns; fall
  // back to date for one-shot reminders.
  const reminder: Reminder = {
    subject,
    source: triggerSentence.trim(),
  };
  if (time) reminder.time = time;
  if (daysInfo) {
    reminder.days = daysInfo.days;
    reminder.recurrence = daysInfo.recurrence;
  }
  if (date && !daysInfo) {
    reminder.date = date;
    reminder.recurrence = "once";
  }
  return reminder;
};

/* ============================================================
   Display helpers
   ============================================================ */

/** Build the "Every Wednesday · 8:00 AM · Home" subtitle line shown on the
 *  reminder card. Caller can pass a location — we keep that out of the
 *  parser to avoid making this module aware of geolocation. */
export const formatReminderSchedule = (
  reminder: Reminder,
  options?: { location?: string },
): string => {
  const parts: string[] = [];

  if (reminder.recurrence === "daily") {
    parts.push("Every day");
  } else if (reminder.recurrence === "weekdays") {
    parts.push("Weekdays");
  } else if (reminder.recurrence === "weekends") {
    parts.push("Weekends");
  } else if (
    reminder.recurrence === "weekly" &&
    reminder.days &&
    reminder.days.length > 0
  ) {
    if (reminder.days.length === 1) {
      parts.push(`Every ${dayLongName(reminder.days[0])}`);
    } else {
      parts.push(reminder.days.map((d) => dayShortName(d)).join(", "));
    }
  } else if (reminder.date) {
    parts.push(formatDateLabel(reminder.date));
  }

  if (reminder.time) {
    parts.push(format12h(reminder.time));
  }
  if (options?.location) {
    parts.push(options.location);
  }
  return parts.join(" · ");
};

const DAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Single-letter labels for the W/T/F/S/S/M/T pill row.
 *  Order matches W T F S S M T as used in the design (week starts mid). */
const DAY_INITIAL = ["S", "M", "T", "W", "T", "F", "S"];

export const dayLongName = (d: Weekday): string => DAY_LONG[d] || "";
export const dayShortName = (d: Weekday): string => DAY_SHORT[d] || "";
export const dayInitial = (d: Weekday): string => DAY_INITIAL[d] || "";

/** Convert "08:00" → "8:00 AM". */
const format12h = (hhmm: string): string => {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${period}`;
};

/** Friendly date label: "Today", "Tomorrow", "Mon, May 12". */
const formatDateLabel = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 0 && diffDays < 7) return DAY_LONG[d.getDay()];
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};
