/**
 * Full-Text Search Engine for Zakar Notes
 * ========================================
 *
 * A pure, dependency-free search module. No vector embeddings, no fuzzy
 * matching trickery — just predictable, fast, transparent matching that
 * respects the operators users already know from Gmail / GitHub search.
 *
 * Why not Fuse.js / minisearch / lunr?
 *
 *   - We already filter the working set by category/archive/trash before
 *     search runs, so the candidate pool is small (<1000 notes for any
 *     real user). Indexing overhead isn't worth it.
 *   - Users want predictability. "Why didn't this match?" is way easier to
 *     answer when the rules are obvious. Fuzzy ranking creates support load.
 *   - Zero deps = zero supply chain risk on a sensitive search path.
 *
 * Supported syntax (Gmail-style):
 *
 *   plain words         AND-matched anywhere in title/content/tags
 *   "exact phrase"      title or content must contain the phrase verbatim
 *   tag:idea            note has a tag matching "idea" (exact, case-insensitive)
 *   #idea               same as tag:idea
 *   -meeting            note must NOT contain "meeting"
 *   -tag:work           note must NOT have the "work" tag
 *   after:2025-09-01    note created/updated on or after that date
 *   before:2025-12-31   note created/updated on or before that date
 *   has:checkbox        note body contains [ ] or [x] checkbox markdown
 *   has:link            note body contains a markdown or bare URL
 *   has:image           note body contains a markdown image
 *
 * Quick filter shortcuts (usable as filter chips, but also work as text):
 *
 *   is:starred          starred notes
 *   is:pinned           pinned notes
 *   is:locked           password-protected notes
 *   is:shared           publicly shared notes
 *
 * Combine freely:  "Q4 plan" tag:work -draft after:2025-10-01 is:pinned
 */

/* ============================================================
   Types
   ============================================================ */

/** Minimal shape of a Note this module needs. We don't import the full
 *  Note type to avoid a circular dep — App.tsx will pass the right thing. */
export interface SearchableNote {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  isStarred?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  isPublic?: boolean;
  password?: string | null;
  createdAt?: { seconds?: number; toDate?: () => Date } | Date | string | null;
  updatedAt?: { seconds?: number; toDate?: () => Date } | Date | string | null;
}

/** A parsed search query, broken into its constituent operators. */
export interface ParsedQuery {
  /** Plain free-text terms to match (AND). All lowercased. */
  terms: string[];
  /** Exact phrases (in quotes) — must appear verbatim. Case-insensitive. */
  phrases: string[];
  /** Required tags. Lowercased, exact match. */
  requiredTags: string[];
  /** Excluded plain terms. */
  excludedTerms: string[];
  /** Excluded tags. */
  excludedTags: string[];
  /** Required date range (Unix ms). */
  afterMs?: number;
  beforeMs?: number;
  /** has: filters. */
  hasCheckbox?: boolean;
  hasLink?: boolean;
  hasImage?: boolean;
  /** is: filters. */
  isStarred?: boolean;
  isPinned?: boolean;
  isLocked?: boolean;
  isShared?: boolean;
  /** Whether the query has any active operator (i.e. is not just empty). */
  isEmpty: boolean;
  /** The original raw input, for round-tripping into the search bar. */
  raw: string;
}

/** Hit metadata for highlighting in the UI. */
export interface SearchHit {
  note: SearchableNote;
  /** Snippet around the first match in content (max ~140 chars). */
  snippet: string;
  /** Offsets within the snippet to wrap with <mark>. Sorted, non-overlapping. */
  highlights: Array<[number, number]>;
}

/* ============================================================
   Helpers
   ============================================================ */

const lower = (s: string): string => s.toLocaleLowerCase();

/** Convert Firestore Timestamp / Date / ISO / number to milliseconds. */
const toMs = (v: SearchableNote["createdAt"] | undefined): number => {
  if (!v) return 0;
  try {
    if (v instanceof Date) return v.getTime();
    if (typeof v === "string") return new Date(v).getTime() || 0;
    if (typeof v === "number") return v;
    if (typeof v === "object" && v !== null) {
      const obj = v as { seconds?: number; toDate?: () => Date };
      if (typeof obj.toDate === "function") return obj.toDate().getTime();
      if (typeof obj.seconds === "number") return obj.seconds * 1000;
    }
  } catch {
    /* fall through */
  }
  return 0;
};

/** Parse a YYYY-MM-DD date string to a Unix ms timestamp. */
const parseDate = (raw: string): number | undefined => {
  // Accept YYYY-MM-DD or YYYY/MM/DD
  const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return undefined;
  const d = new Date(
    Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)),
  );
  return isNaN(d.getTime()) ? undefined : d.getTime();
};

/* ============================================================
   Query parser
   ============================================================ */

/**
 * Parse a raw search string into a ParsedQuery.
 *
 * Tokenization respects "double quotes" for phrases. Operator names
 * (`tag:`, `after:`, `has:`, `is:`, leading `-`, leading `#`) are recognized
 * before any free-text term.
 */
export const parseSearchQuery = (raw: string): ParsedQuery => {
  const result: ParsedQuery = {
    terms: [],
    phrases: [],
    requiredTags: [],
    excludedTerms: [],
    excludedTags: [],
    isEmpty: true,
    raw: raw,
  };
  if (!raw || !raw.trim()) return result;

  // Tokenize, preserving "quoted phrases"
  const tokenRegex = /-?(?:"[^"]*"|\S+)/g;
  const tokens = raw.match(tokenRegex) || [];

  let touched = false;

  for (let token of tokens) {
    let negated = false;
    if (token.startsWith("-") && token.length > 1) {
      negated = true;
      token = token.slice(1);
    }

    // Quoted phrase
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      const phrase = token.slice(1, -1).trim();
      if (phrase) {
        if (negated) result.excludedTerms.push(lower(phrase));
        else result.phrases.push(lower(phrase));
        touched = true;
      }
      continue;
    }

    // Hashtag shortcut: #foo → tag:foo
    if (token.startsWith("#") && token.length > 1) {
      const tag = lower(token.slice(1));
      if (negated) result.excludedTags.push(tag);
      else result.requiredTags.push(tag);
      touched = true;
      continue;
    }

    // Operator with colon: name:value
    const colonIdx = token.indexOf(":");
    if (colonIdx > 0 && colonIdx < token.length - 1) {
      const name = lower(token.slice(0, colonIdx));
      const value = token.slice(colonIdx + 1);
      const lowerValue = lower(value.replace(/^["']|["']$/g, ""));

      switch (name) {
        case "tag":
          if (lowerValue) {
            if (negated) result.excludedTags.push(lowerValue);
            else result.requiredTags.push(lowerValue);
            touched = true;
          }
          continue;
        case "after": {
          const ms = parseDate(value);
          if (ms !== undefined) {
            result.afterMs = ms;
            touched = true;
          }
          continue;
        }
        case "before": {
          const ms = parseDate(value);
          if (ms !== undefined) {
            // Inclusive end-of-day for the "before:" date
            result.beforeMs = ms + 24 * 60 * 60 * 1000 - 1;
            touched = true;
          }
          continue;
        }
        case "has":
          if (lowerValue === "checkbox") result.hasCheckbox = true;
          else if (lowerValue === "link") result.hasLink = true;
          else if (lowerValue === "image") result.hasImage = true;
          touched = true;
          continue;
        case "is":
          if (lowerValue === "starred") result.isStarred = true;
          else if (lowerValue === "pinned") result.isPinned = true;
          else if (lowerValue === "locked") result.isLocked = true;
          else if (lowerValue === "shared") result.isShared = true;
          touched = true;
          continue;
      }
    }

    // Plain term (or excluded plain term)
    const term = lower(token).trim();
    if (term) {
      if (negated) result.excludedTerms.push(term);
      else result.terms.push(term);
      touched = true;
    }
  }

  result.isEmpty = !touched;
  return result;
};

/* ============================================================
   Predicate helpers
   ============================================================ */

const CHECKBOX_RE = /\[[\sxX]\]/;
const LINK_RE = /\[[^\]]+\]\([^)]+\)|https?:\/\/\S+/;
const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/;

/** Test whether a single note satisfies the parsed query. */
export const matchesQuery = (
  note: SearchableNote,
  q: ParsedQuery,
): boolean => {
  if (q.isEmpty) return true;

  const titleLower = lower(note.title || "");
  const contentLower = lower(note.content || "");
  const tagsLower = (note.tags || []).map(lower);

  // Excluded terms: must NOT appear anywhere
  for (const t of q.excludedTerms) {
    if (
      titleLower.includes(t) ||
      contentLower.includes(t) ||
      tagsLower.some((tg) => tg.includes(t))
    ) {
      return false;
    }
  }
  // Excluded tags: must NOT match exactly
  for (const t of q.excludedTags) {
    if (tagsLower.includes(t)) return false;
  }
  // Required tags: must match exactly
  for (const t of q.requiredTags) {
    if (!tagsLower.includes(t)) return false;
  }
  // Required phrases: must appear verbatim in title or content
  for (const p of q.phrases) {
    if (!titleLower.includes(p) && !contentLower.includes(p)) return false;
  }
  // Required terms: each must appear somewhere
  for (const t of q.terms) {
    if (
      !titleLower.includes(t) &&
      !contentLower.includes(t) &&
      !tagsLower.some((tg) => tg.includes(t))
    ) {
      return false;
    }
  }

  // Date filters — use the most-recent-touched timestamp
  if (q.afterMs !== undefined || q.beforeMs !== undefined) {
    const touched = Math.max(toMs(note.createdAt), toMs(note.updatedAt));
    if (q.afterMs !== undefined && touched < q.afterMs) return false;
    if (q.beforeMs !== undefined && touched > q.beforeMs) return false;
  }

  // has: filters
  if (q.hasCheckbox && !CHECKBOX_RE.test(note.content || "")) return false;
  if (q.hasLink && !LINK_RE.test(note.content || "")) return false;
  if (q.hasImage && !IMAGE_RE.test(note.content || "")) return false;

  // is: filters
  if (q.isStarred && !note.isStarred) return false;
  if (q.isPinned && !note.isPinned) return false;
  if (q.isLocked && !note.password) return false;
  if (q.isShared && !note.isPublic) return false;

  return true;
};

/* ============================================================
   Snippet + highlight extraction
   ============================================================ */

/** Build a snippet of ~140 chars centered on the first matched term. */
export const buildHit = (
  note: SearchableNote,
  q: ParsedQuery,
): SearchHit => {
  const content = note.content || "";
  const terms = [...q.terms, ...q.phrases].filter(Boolean);

  if (terms.length === 0 || !content) {
    return {
      note,
      snippet: content.slice(0, 140) + (content.length > 140 ? "…" : ""),
      highlights: [],
    };
  }

  const lowered = lower(content);
  // Find earliest occurrence among all matched terms
  let firstIdx = -1;
  for (const t of terms) {
    const idx = lowered.indexOf(t);
    if (idx >= 0 && (firstIdx < 0 || idx < firstIdx)) firstIdx = idx;
  }

  // No term matched in content (likely matched in title/tags only)
  if (firstIdx < 0) {
    return {
      note,
      snippet: content.slice(0, 140) + (content.length > 140 ? "…" : ""),
      highlights: [],
    };
  }

  // Center a ~140 char window on the first match
  const WINDOW = 140;
  const start = Math.max(0, firstIdx - 50);
  const end = Math.min(content.length, start + WINDOW);
  const adjustedStart = Math.max(0, end - WINDOW);
  const snippet =
    (adjustedStart > 0 ? "…" : "") +
    content.slice(adjustedStart, end) +
    (end < content.length ? "…" : "");

  // Compute highlight ranges within the snippet
  const snippetLower = lower(snippet);
  const ranges: Array<[number, number]> = [];
  for (const t of terms) {
    let from = 0;
    while (true) {
      const i = snippetLower.indexOf(t, from);
      if (i < 0) break;
      ranges.push([i, i + t.length]);
      from = i + t.length;
    }
  }
  // Merge overlapping/adjacent ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    if (merged.length === 0 || r[0] > merged[merged.length - 1][1]) {
      merged.push([r[0], r[1]]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    }
  }

  return { note, snippet, highlights: merged };
};

/* ============================================================
   Public entrypoint — apply a query to a list of notes
   ============================================================ */

/** Return the subset of notes matching the query, in original order. */
export const filterNotesByQuery = <T extends SearchableNote>(
  notes: T[],
  q: ParsedQuery,
): T[] => {
  if (q.isEmpty) return notes;
  return notes.filter((n) => matchesQuery(n, q));
};

/* ============================================================
   Chip helpers — make individual operators removable from the search bar
   ============================================================ */

/** A single human-readable filter chip extracted from a parsed query. */
export interface FilterChip {
  /** Display label, e.g. `tag:work` or `after: Oct 1, 2025`. */
  label: string;
  /** Substring of the raw query that this chip represents. Removing this
   *  substring yields the query without this filter. */
  rawToken: string;
}

/**
 * Walk the raw query and extract operator chips (tag:, #, after:, before:,
 * has:, is:). Plain words and "phrases" are NOT returned as chips — those
 * stay in the search bar as the textual query. The search bar shows what
 * the user typed; chips are a structural overlay for the *operators* only.
 */
export const extractFilterChips = (raw: string): FilterChip[] => {
  if (!raw || !raw.trim()) return [];
  const tokenRegex = /-?(?:"[^"]*"|\S+)/g;
  const tokens = raw.match(tokenRegex) || [];
  const chips: FilterChip[] = [];
  for (const token of tokens) {
    const negated = token.startsWith("-");
    const body = negated ? token.slice(1) : token;
    if (body.startsWith("#") && body.length > 1) {
      chips.push({
        label: `${negated ? "−" : ""}#${body.slice(1)}`,
        rawToken: token,
      });
      continue;
    }
    const colonIdx = body.indexOf(":");
    if (colonIdx > 0 && colonIdx < body.length - 1) {
      const name = body.slice(0, colonIdx).toLowerCase();
      if (
        name === "tag" ||
        name === "after" ||
        name === "before" ||
        name === "has" ||
        name === "is"
      ) {
        chips.push({
          label: `${negated ? "−" : ""}${body}`,
          rawToken: token,
        });
      }
    }
  }
  return chips;
};

/**
 * Remove a specific token (returned in a FilterChip.rawToken) from a raw
 * query string and return the cleaned-up result. Whitespace is normalized.
 */
export const removeChipFromQuery = (raw: string, token: string): string => {
  if (!raw) return "";
  // Match the exact token surrounded by whitespace boundaries
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
  const cleaned = raw.replace(re, " ").replace(/\s+/g, " ").trim();
  return cleaned;
};
