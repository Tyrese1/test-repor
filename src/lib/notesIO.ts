/**
 * Notes Import / Export
 * =====================
 *
 * Pure data-layer for getting notes out of Zakar and back in.
 *
 * Design choices:
 *
 * - Markdown is the export unit. Zakar already stores content as markdown,
 *   and every meaningful competitor (Obsidian, Bear, Notion, Apple Notes via
 *   exporter, Joplin, Logseq, Standard Notes) speaks markdown. Picking JSON
 *   only would lock users in.
 *
 * - The exported .zip contains one .md file per note PLUS a manifest.json
 *   that captures the metadata markdown can't (tags, category, color, pin/
 *   star/archive flags, timestamps). Re-importing a Zakar zip is therefore a
 *   lossless round-trip.
 *
 * - Importing a non-Zakar zip OR loose .md files is best-effort: the file
 *   contents become the note content, the filename (sans extension) becomes
 *   the title, and we infer #hashtags as tags. No category, no color — those
 *   stay default, and the user can re-organize in-app.
 *
 * - We do NOT auto-sort imports. Users importing existing notes have already
 *   organized them; running magicSort over the import would destroy their
 *   structure. Imports are saved with isAutoSorted=false, status="ready",
 *   so the AI worker leaves them alone. Users can manually re-sort later.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

/* ============================================================
   Limits — prevent zip bombs, OOM crashes, and Firestore overflows
   ============================================================ */

/** Hard caps applied during import to keep the browser & backend healthy. */
export const IMPORT_LIMITS = {
  /** Max total upload size (50 MB). Anything bigger is rejected outright
   *  before unzipping — protects against zip bombs at the entry point. */
  maxFileSize: 50 * 1024 * 1024,
  /** Max number of notes per import batch (500). Above this, we ask the user
   *  to split. Protects against runaway loops and unexpected Firestore costs. */
  maxNotes: 500,
  /** Max size of a single note's content (900 KB). Firestore document limit
   *  is 1 MB; we leave headroom for metadata/tags/etc. */
  maxNoteSize: 900 * 1024,
  /** Max combined uncompressed size when expanding a zip (300 MB). Catches
   *  malicious "zip bombs" — files that compress 50KB → 5GB. */
  maxUncompressedSize: 300 * 1024 * 1024,
} as const;

/** A non-fatal issue encountered while parsing a single note inside an
 *  upload. Surface these to the user so they know what didn't import. */
export interface ImportIssue {
  filename: string;
  reason: string;
}

/** Result of parsing an upload. `notes` is what's safe to import; `issues`
 *  is the per-file list of skipped/rejected items the UI should show.
 *  `wasZakarExport` lets the caller skip already-categorized notes when the
 *  source is a Zakar manifest (lossless restore — they were sorted before). */
export interface ImportResult {
  notes: ParsedNote[];
  issues: ImportIssue[];
  wasZakarExport: boolean;
}

/* ============================================================
   Types — the wire format for export/import
   ============================================================ */

export interface ParsedNote {
  /** Note title — required. */
  title: string;
  /** Markdown body. */
  content: string;
  /** Inferred or preserved tags. May be empty. */
  tags: string[];
  /** Preserved category if from a Zakar zip; otherwise default. */
  category?: string;
  /** Preserved flags from Zakar manifest. */
  isStarred?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  backgroundColor?: string;
  /** Original creation time as ISO string, if known. Display-only — Firebase
   *  will set the actual timestamp on save. */
  originalCreatedAt?: string;
}

interface ManifestEntry {
  filename: string;
  title: string;
  category?: string;
  tags?: string[];
  isStarred?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  backgroundColor?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface Manifest {
  app: "zakar";
  version: 1;
  exportedAt: string;
  noteCount: number;
  notes: ManifestEntry[];
}

/** Minimal shape of the in-app Note we need for export. */
export interface ExportableNote {
  id: string;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  isStarred?: boolean;
  isPinned?: boolean;
  isArchived?: boolean;
  backgroundColor?: string;
  createdAt?: { seconds?: number; toDate?: () => Date } | Date | string | null;
  updatedAt?: { seconds?: number; toDate?: () => Date } | Date | string | null;
}

/* ============================================================
   Filename sanitization
   ============================================================ */

/** Make a string safe to use as a filename across Windows/macOS/Linux. */
const sanitizeFilename = (raw: string, maxLen = 80): string => {
  const cleaned = raw
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, "") // illegal chars
    .replace(/\s+/g, " ")
    .trim();
  const trimmed = cleaned.slice(0, maxLen).trim();
  // Avoid reserved Windows names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(trimmed)) {
    return `_${trimmed}`;
  }
  return trimmed || "untitled";
};

/** Convert a Firebase Timestamp / Date / ISO string to ISO. */
const toISO = (
  value: ExportableNote["createdAt"] | undefined | null,
): string | undefined => {
  if (!value) return undefined;
  try {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return new Date(value).toISOString();
    if (typeof value === "object" && value !== null) {
      const v = value as { seconds?: number; toDate?: () => Date };
      if (typeof v.toDate === "function") return v.toDate().toISOString();
      if (typeof v.seconds === "number")
        return new Date(v.seconds * 1000).toISOString();
    }
  } catch {
    /* fall through */
  }
  return undefined;
};

/* ============================================================
   EXPORT
   ============================================================ */

/**
 * Build a ZIP blob containing all notes as .md files plus a manifest.json.
 * Returns the Blob ready to be download-attached.
 */
export const exportNotesToZip = (notes: ExportableNote[]): Blob => {
  // Build {filename: bytes} map for fflate
  const files: Record<string, Uint8Array> = {};
  const manifestEntries: ManifestEntry[] = [];

  // Track filename collisions — if two notes have the same title, append
  // a short suffix from the note id to disambiguate.
  const usedNames = new Set<string>();
  const uniqueFilename = (base: string, id: string): string => {
    let name = `${base}.md`;
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    // Append last 6 chars of the id for disambiguation
    const suffix = id.slice(-6);
    name = `${base} (${suffix}).md`;
    usedNames.add(name);
    return name;
  };

  for (const note of notes) {
    const baseName = sanitizeFilename(note.title || "untitled");
    const filename = uniqueFilename(baseName, note.id);

    // Front-matter style header (parseable by Obsidian / Hugo if user moves
    // these elsewhere) plus the body.
    const tags = note.tags || [];
    const fmLines: string[] = ["---", `title: ${JSON.stringify(note.title)}`];
    if (note.category) fmLines.push(`category: ${JSON.stringify(note.category)}`);
    if (tags.length > 0)
      fmLines.push(`tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    const createdISO = toISO(note.createdAt);
    if (createdISO) fmLines.push(`created: ${createdISO}`);
    const updatedISO = toISO(note.updatedAt);
    if (updatedISO) fmLines.push(`updated: ${updatedISO}`);
    fmLines.push("---", "");

    const body = `${fmLines.join("\n")}${note.content || ""}\n`;
    files[`notes/${filename}`] = strToU8(body);

    manifestEntries.push({
      filename: `notes/${filename}`,
      title: note.title,
      category: note.category,
      tags,
      isStarred: note.isStarred,
      isPinned: note.isPinned,
      isArchived: note.isArchived,
      backgroundColor: note.backgroundColor,
      createdAt: createdISO,
      updatedAt: updatedISO,
    });
  }

  const manifest: Manifest = {
    app: "zakar",
    version: 1,
    exportedAt: new Date().toISOString(),
    noteCount: notes.length,
    notes: manifestEntries,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  // Add a friendly README so users opening the zip in Finder understand it
  const readme = [
    "# Zakar Export",
    "",
    `Exported: ${new Date().toLocaleString()}`,
    `Notes: ${notes.length}`,
    "",
    "Each note is a markdown file under `notes/`. The `manifest.json`",
    "preserves Zakar-specific metadata (tags, pinned, starred, etc.)",
    "and is used for lossless re-import.",
    "",
    "You can open these files directly in any markdown editor",
    "(Obsidian, Bear, Typora, VS Code, etc.) — the YAML front-matter",
    "at the top of each file follows the standard Obsidian format.",
    "",
  ].join("\n");
  files["README.md"] = strToU8(readme);

  const zipped = zipSync(files, { level: 6 });
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
};

/* ============================================================
   Alternative export formats — HTML, JSON
   ============================================================
   The default `exportNotesToZip` is the most portable (Markdown opens in
   anything). But power users sometimes want:
   - HTML for printing, archiving, or pasting into a CMS
   - JSON for piping into another app, database, or LLM workflow
   ============================================================ */

/** HTML-escape a piece of text so it's safe to drop into innerHTML. */
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Naive markdown → HTML for export. We don't pull in a full markdown
 *  library here because: (1) the export path runs in the browser tab
 *  with no extra deps available, (2) we only need to render the small
 *  subset of markdown our notes actually use (headings, bold, italic,
 *  bullets, checkboxes, code, links). For anything more sophisticated,
 *  users can re-import the .md zip into a real markdown editor. */
const markdownToHtml = (md: string): string => {
  if (!md) return "";
  // Pre-escape the whole input, then re-introduce HTML for the constructs
  // we recognize. This avoids any risk of unintentional HTML injection
  // from note content.
  let s = escapeHtml(md);

  // Code fences ```lang\n...\n```
  s = s.replace(/```([\s\S]*?)```/g, (_m, body) => `<pre><code>${body}</code></pre>`);
  // Inline code `xyz`
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Headings
  s = s.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  s = s.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  s = s.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  s = s.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  // Bold then italic (order matters — ** before *)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  // Links [text](url)
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // Bare URL autolinks
  s = s.replace(
    /(?<![">])(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // Checkboxes
  s = s.replace(
    /^[\s]*[-*]\s+\[\s\]\s+(.+)$/gm,
    '<div class="todo"><input type="checkbox" disabled> $1</div>',
  );
  s = s.replace(
    /^[\s]*[-*]\s+\[x\]\s+(.+)$/gim,
    '<div class="todo done"><input type="checkbox" checked disabled> <s>$1</s></div>',
  );
  // Bullet lists — wrap consecutive `- ` lines in <ul>
  s = s.replace(/(?:^[\s]*[-*]\s+(.+)$\n?)+/gm, (block) => {
    const items = block
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.replace(/^[\s]*[-*]\s+/, ""))
      .map((l) => `  <li>${l}</li>`)
      .join("\n");
    return `<ul>\n${items}\n</ul>\n`;
  });
  // Paragraphs — split on blank lines, wrap remaining standalone lines
  // that aren't already block-level HTML
  const blocks = s.split(/\n{2,}/).map((b) => {
    const trimmed = b.trim();
    if (!trimmed) return "";
    if (/^<(h[1-6]|ul|ol|pre|div|p|blockquote)\b/.test(trimmed))
      return trimmed;
    return `<p>${trimmed.replace(/\n/g, "<br>\n")}</p>`;
  });
  return blocks.filter(Boolean).join("\n\n");
};

/** Build a single styled HTML document containing all notes. Self-contained
 *  (CSS embedded), prints cleanly, and opens in any browser. */
export const exportNotesAsHtml = (notes: ExportableNote[]): Blob => {
  const css = `
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      max-width: 760px;
      margin: 0 auto;
      padding: 40px 24px;
      color: #2e3431;
      line-height: 1.6;
      background: #fafbf8;
    }
    header { border-bottom: 1px solid #dde5da; padding-bottom: 24px; margin-bottom: 32px; }
    header h1 { margin: 0 0 4px; font-size: 28px; color: #3a4d3e; }
    header p { margin: 0; color: #6b746f; font-size: 13px; }
    .note { background: white; border: 1px solid #dde5da; border-radius: 12px; padding: 24px 28px; margin-bottom: 20px; page-break-inside: avoid; }
    .note h1 { font-size: 22px; margin: 0 0 8px; color: #2e3431; }
    .note h2 { font-size: 18px; margin: 24px 0 8px; }
    .note h3 { font-size: 16px; margin: 20px 0 8px; }
    .note .meta { font-size: 12px; color: #6b746f; margin-bottom: 16px; }
    .note .tags { margin-top: 16px; padding-top: 12px; border-top: 1px solid #f0f3ee; }
    .tag { display: inline-block; background: #d2e8d5; color: #3a4d3e; font-size: 11px; padding: 2px 10px; border-radius: 999px; margin-right: 6px; }
    .note p { margin: 0 0 12px; }
    .note ul, .note ol { padding-left: 24px; margin: 8px 0; }
    .note code { background: #f4f7f2; padding: 1px 6px; border-radius: 4px; font-size: 0.92em; }
    .note pre { background: #f4f7f2; padding: 12px; border-radius: 8px; overflow-x: auto; }
    .note pre code { background: transparent; padding: 0; }
    .note a { color: #4f6354; }
    .note .todo { margin: 4px 0; }
    .note .todo.done { color: #8a948f; }
    @media print {
      body { background: white; padding: 0; }
      .note { border: none; box-shadow: none; padding: 0; margin-bottom: 32px; }
    }
  `;
  const noteHtml = notes
    .map((n) => {
      const created = toISO(n.createdAt) || "";
      const updated = toISO(n.updatedAt) || "";
      const dateLine = [
        n.category && `<strong>${escapeHtml(n.category)}</strong>`,
        created &&
          `Created ${escapeHtml(new Date(created).toLocaleDateString())}`,
        updated &&
          updated !== created &&
          `Updated ${escapeHtml(new Date(updated).toLocaleDateString())}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const tags =
        n.tags && n.tags.length > 0
          ? `<div class="tags">${n.tags
              .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
              .join("")}</div>`
          : "";
      return `<article class="note">
  <h1>${escapeHtml(n.title || "Untitled")}</h1>
  <div class="meta">${dateLine}</div>
  ${markdownToHtml(n.content || "")}
  ${tags}
</article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Zakar Notes Export</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <h1>Zakar Notes Export</h1>
    <p>${notes.length} note${notes.length === 1 ? "" : "s"} · ${new Date().toLocaleString()}</p>
  </header>
  ${noteHtml}
</body>
</html>`;
  return new Blob([html], { type: "text/html;charset=utf-8" });
};

/** Build a single JSON document containing all notes plus metadata. The
 *  shape mirrors the manifest format used inside the .zip export so it can
 *  be re-imported losslessly. JSON is the format power users will reach
 *  for when piping notes into other tools (databases, LLM workflows, CLI
 *  scripts). */
export const exportNotesAsJson = (notes: ExportableNote[]): Blob => {
  const payload = {
    app: "zakar",
    format: "json",
    version: 1,
    exportedAt: new Date().toISOString(),
    noteCount: notes.length,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title || "",
      content: n.content || "",
      category: n.category,
      tags: n.tags || [],
      isStarred: n.isStarred || false,
      isPinned: n.isPinned || false,
      isArchived: n.isArchived || false,
      backgroundColor: n.backgroundColor,
      createdAt: toISO(n.createdAt),
      updatedAt: toISO(n.updatedAt),
    })),
  };
  return new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
};

/** Trigger a browser download for a Blob with a given filename. */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/* ============================================================
   IMPORT
   ============================================================ */

/** Strip YAML front-matter from a markdown string. Returns {body, frontMatter}. */
const stripFrontMatter = (
  raw: string,
): { body: string; meta: Record<string, string> } => {
  const meta: Record<string, string> = {};
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return { body: raw, meta };
  const fm = fmMatch[1];
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { body: raw.slice(fmMatch[0].length), meta };
};

/** Pull #hashtags out of body text. Returns unique, lowercased tags. */
const extractHashtags = (body: string): string[] => {
  const found = body.match(/(?:^|\s)#([a-zA-Z0-9_-]{2,30})\b/g) || [];
  const set = new Set<string>();
  for (const raw of found) set.add(raw.trim().slice(1).toLowerCase());
  return Array.from(set).slice(0, 20); // cap at 20 tags
};

/** Parse a YAML front-matter `tags: [...]` value into a string array. */
const parseTagsValue = (raw: string): string[] => {
  if (!raw) return [];
  const match = raw.match(/^\[(.*)\]$/);
  if (!match) {
    // Could be a YAML list across lines (we don't support multi-line yet)
    // or a single tag — handle the single-tag case
    return raw.replace(/^["']|["']$/g, "").trim()
      ? [raw.replace(/^["']|["']$/g, "").trim()]
      : [];
  }
  const inner = match[1];
  return inner
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
};

/**
 * Parse a single .md file's text into a ParsedNote, with best-effort metadata.
 */
const parseMarkdownFile = (filename: string, raw: string): ParsedNote => {
  const { body, meta } = stripFrontMatter(raw);
  const baseName = filename
    .replace(/^.*\//, "")
    .replace(/\.[Mm][Dd]$/, "")
    .replace(/\.[Mm][Aa][Rr][Kk][Dd][Oo][Ww][Nn]$/, "");

  // Title: front-matter > first H1 in body > filename
  let title: string | undefined;
  if (meta.title) {
    title = meta.title.replace(/^["']|["']$/g, "").trim();
  } else {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  if (!title) title = baseName;

  // Tags: front-matter > inferred hashtags
  let tags: string[] = [];
  if (meta.tags) {
    tags = parseTagsValue(meta.tags);
  }
  if (tags.length === 0) {
    tags = extractHashtags(body);
  }

  return {
    title: title.slice(0, 200),
    content: body.trim(),
    tags,
    category: meta.category
      ? meta.category.replace(/^["']|["']$/g, "").trim()
      : undefined,
    originalCreatedAt: meta.created || undefined,
  };
};

/* ============================================================
   Encoding helpers — make sure we read text correctly regardless of
   what platform / editor produced it.
   ============================================================ */

/** Strip a UTF-8 BOM if present. Some Windows editors add `\uFEFF` at the
 *  start of files; rendered as a literal "?" or invisible weirdness. */
const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

/** Decode bytes as UTF-8 with a BOM strip and graceful fallback. */
const decodeFileBytes = (bytes: Uint8Array): string => {
  // Quick sniff for UTF-16 BOMs — fail loudly rather than silently mangling
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      throw new Error("File appears to be UTF-16 LE — please save it as UTF-8.");
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      throw new Error("File appears to be UTF-16 BE — please save it as UTF-8.");
    }
  }
  return stripBom(strFromU8(bytes));
};

/** Approximate byte length of a string for size validation. */
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Parse an uploaded file into a list of ParsedNotes plus a list of issues
 * for any files that couldn't be imported.
 *
 * Accepts:
 *   - A single .md / .markdown / .txt file → 1 note
 *   - A .zip containing .md files (Zakar export OR generic) → N notes
 *
 * Validation:
 *   - Total upload <= IMPORT_LIMITS.maxFileSize (50 MB)
 *   - Note count <= IMPORT_LIMITS.maxNotes (500)
 *   - Per-note size <= IMPORT_LIMITS.maxNoteSize (~900 KB, Firestore-safe)
 *   - Combined uncompressed zip size <= IMPORT_LIMITS.maxUncompressedSize (300 MB)
 *
 * For Zakar zips, the manifest.json is used to restore tags/category/flags
 * losslessly. For non-Zakar zips, each .md file is parsed independently.
 *
 * Throws on FATAL errors (bad file type, corrupt zip, oversized upload, zip
 * bomb). Returns issues for non-fatal per-file problems (oversized notes,
 * encoding issues, empty files) so the UI can show a per-file rejection list.
 */
export const parseImportFile = async (file: File): Promise<ImportResult> => {
  const lowerName = file.name.toLowerCase();
  const issues: ImportIssue[] = [];

  // Hard reject: oversized upload — applies to BOTH single files and zips.
  if (file.size > IMPORT_LIMITS.maxFileSize) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    const limit = (IMPORT_LIMITS.maxFileSize / 1024 / 1024).toFixed(0);
    throw new Error(
      `This file is ${mb} MB. The maximum upload size is ${limit} MB. Please split it.`,
    );
  }

  /* === Single markdown / text file === */
  if (
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".txt")
  ) {
    let text: string;
    try {
      text = stripBom(await file.text());
    } catch {
      throw new Error(
        "Couldn't read this file. It may be corrupted or use an unsupported encoding.",
      );
    }
    if (!text.trim()) {
      throw new Error("This file is empty.");
    }
    if (utf8Bytes(text) > IMPORT_LIMITS.maxNoteSize) {
      const kb = (IMPORT_LIMITS.maxNoteSize / 1024).toFixed(0);
      throw new Error(
        `This note is too large. Individual notes must be under ${kb} KB.`,
      );
    }
    return { notes: [parseMarkdownFile(file.name, text)], issues, wasZakarExport: false };
  }

  /* === JSON file === */
  // Accept the JSON shape we emit from `exportNotesAsJson`, plus a generic
  // shape: an object with `notes: [...]` OR a bare array of note objects.
  // For each entry we accept any of: title, content, body, text, markdown,
  // and optional category/tags/timestamps. This makes Zakar a friendly
  // landing zone for migrations from other tools that export JSON.
  if (lowerName.endsWith(".json")) {
    let text: string;
    try {
      text = stripBom(await file.text());
    } catch {
      throw new Error("Couldn't read this JSON file.");
    }
    if (!text.trim()) {
      throw new Error("This JSON file is empty.");
    }
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (e: any) {
      throw new Error(
        `That's not valid JSON. ${e?.message || "Check the file with a JSON validator and try again."}`,
      );
    }

    // Detect whether this is a Zakar-shaped JSON export (lossless restore)
    const wasZakarExport =
      parsed &&
      typeof parsed === "object" &&
      parsed.app === "zakar" &&
      Array.isArray(parsed.notes);

    // Normalize to an array of "raw" note objects regardless of shape
    let rawNotes: any[];
    if (Array.isArray(parsed)) {
      rawNotes = parsed;
    } else if (parsed && Array.isArray(parsed.notes)) {
      rawNotes = parsed.notes;
    } else {
      throw new Error(
        "This JSON doesn't contain a recognizable list of notes. Expected either an array of notes, or an object with a `notes` array.",
      );
    }

    if (rawNotes.length === 0) {
      throw new Error("No notes found in this JSON file.");
    }

    if (rawNotes.length > IMPORT_LIMITS.maxNotes) {
      issues.push({
        filename: file.name,
        reason: `JSON contained ${rawNotes.length} notes; importing the first ${IMPORT_LIMITS.maxNotes}. Split your file to import the rest.`,
      });
      rawNotes = rawNotes.slice(0, IMPORT_LIMITS.maxNotes);
    }

    const notes: ParsedNote[] = [];
    for (const raw of rawNotes) {
      if (!raw || typeof raw !== "object") {
        issues.push({ filename: file.name, reason: "Skipped an invalid entry (not an object)." });
        continue;
      }
      const content =
        raw.content ?? raw.body ?? raw.text ?? raw.markdown ?? "";
      // Title preference: explicit field → first non-empty line of body → "Untitled"
      let title: string =
        raw.title ?? raw.name ?? raw.subject ?? "";
      if (!String(title).trim()) {
        const firstLine = String(content || "")
          .split("\n")
          .map((l) => l.replace(/^#+\s*/, "").trim())
          .find((l) => l.length > 0);
        title = firstLine ? firstLine.slice(0, 80) : "Untitled";
      }
      if (!String(content).trim() && !String(title).trim()) {
        issues.push({ filename: file.name, reason: "Skipped an entry with no title or content." });
        continue;
      }
      if (utf8Bytes(String(content)) > IMPORT_LIMITS.maxNoteSize) {
        issues.push({
          filename: file.name,
          reason: `Skipped "${String(title).slice(0, 60)}" — too large.`,
        });
        continue;
      }
      const tags = Array.isArray(raw.tags)
        ? raw.tags.filter((t: any) => typeof t === "string").slice(0, 20)
        : [];
      notes.push({
        title: String(title || "Untitled").slice(0, 200),
        content: String(content || ""),
        category: typeof raw.category === "string" ? raw.category : undefined,
        tags,
        isStarred: !!raw.isStarred,
        isPinned: !!raw.isPinned,
        isArchived: !!raw.isArchived,
        backgroundColor:
          typeof raw.backgroundColor === "string"
            ? raw.backgroundColor
            : undefined,
      });
    }

    if (notes.length === 0) {
      throw new Error("No usable notes in this JSON file.");
    }

    return { notes, issues, wasZakarExport };
  }

  /* === ZIP file === */
  if (lowerName.endsWith(".zip")) {
    let buffer: Uint8Array;
    let unzipped: Record<string, Uint8Array>;
    try {
      buffer = new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new Error("Couldn't read this file. It may be corrupted.");
    }
    try {
      unzipped = unzipSync(buffer);
    } catch {
      throw new Error(
        "This .zip file looks corrupt or isn't a valid zip archive.",
      );
    }

    // Zip-bomb defense — sum the uncompressed byte counts and reject if
    // they exceed the ceiling. We do this BEFORE iterating file contents.
    let totalUncompressed = 0;
    for (const bytes of Object.values(unzipped)) {
      totalUncompressed += bytes.length;
      if (totalUncompressed > IMPORT_LIMITS.maxUncompressedSize) {
        const limit = (
          IMPORT_LIMITS.maxUncompressedSize /
          1024 /
          1024
        ).toFixed(0);
        throw new Error(
          `This .zip expands to more than ${limit} MB and may be malformed.`,
        );
      }
    }

    // Try to find a Zakar manifest first
    let manifest: Manifest | null = null;
    if (unzipped["manifest.json"]) {
      try {
        const parsed = JSON.parse(strFromU8(unzipped["manifest.json"]));
        if (parsed && parsed.app === "zakar" && Array.isArray(parsed.notes)) {
          manifest = parsed;
        }
      } catch {
        /* ignore — treat as generic zip */
      }
    }

    const notes: ParsedNote[] = [];

    /** Try to parse a single file entry; push to issues on rejection. */
    const tryParseEntry = (
      path: string,
      bytes: Uint8Array,
      manifestEntry?: ManifestEntry,
    ): ParsedNote | null => {
      // Skip macOS metadata folders Apple zip insists on adding
      if (path.startsWith("__MACOSX/") || /\/\.DS_Store$/.test(path)) {
        return null;
      }
      // Per-file size guard (early — before decoding)
      if (bytes.length > IMPORT_LIMITS.maxNoteSize) {
        issues.push({
          filename: path,
          reason: `Too large (${(bytes.length / 1024).toFixed(0)} KB)`,
        });
        return null;
      }
      let text: string;
      try {
        text = decodeFileBytes(bytes);
      } catch (e: any) {
        issues.push({
          filename: path,
          reason: e?.message || "Couldn't decode file (check encoding).",
        });
        return null;
      }
      if (!text.trim()) {
        issues.push({ filename: path, reason: "File is empty." });
        return null;
      }
      const parsed = parseMarkdownFile(path, text);
      if (manifestEntry) {
        return {
          ...parsed,
          title: manifestEntry.title || parsed.title,
          tags:
            manifestEntry.tags && manifestEntry.tags.length > 0
              ? manifestEntry.tags
              : parsed.tags,
          category: manifestEntry.category || parsed.category,
          isStarred: manifestEntry.isStarred,
          isPinned: manifestEntry.isPinned,
          isArchived: manifestEntry.isArchived,
          backgroundColor: manifestEntry.backgroundColor,
          originalCreatedAt: manifestEntry.createdAt,
        };
      }
      return parsed;
    };

    if (manifest) {
      // Lossless Zakar restore — walk the manifest order so flags are honored
      for (const entry of manifest.notes) {
        const fileBytes = unzipped[entry.filename];
        if (!fileBytes) {
          issues.push({
            filename: entry.filename,
            reason: "Listed in manifest but missing from zip.",
          });
          continue;
        }
        const parsed = tryParseEntry(entry.filename, fileBytes, entry);
        if (parsed) notes.push(parsed);
      }
    } else {
      // Generic zip — pick up every .md / .markdown / .txt file
      for (const [path, bytes] of Object.entries(unzipped)) {
        const lower = path.toLowerCase();
        if (
          !lower.endsWith(".md") &&
          !lower.endsWith(".markdown") &&
          !lower.endsWith(".txt")
        ) {
          continue;
        }
        // Skip the README.md we ship with Zakar exports
        if (/^readme\.md$/i.test(path.replace(/^.*\//, ""))) continue;

        const parsed = tryParseEntry(path, bytes);
        if (parsed) notes.push(parsed);
      }
    }

    // Hard cap on note count — reject the whole batch above the limit
    // rather than silently truncating.
    if (notes.length > IMPORT_LIMITS.maxNotes) {
      throw new Error(
        `This file contains ${notes.length} notes. The import limit is ${IMPORT_LIMITS.maxNotes} per upload — please split it.`,
      );
    }

    return { notes, issues, wasZakarExport: manifest !== null };
  }

  throw new Error(
    "Unsupported file type. Please upload a .md, .txt, or .zip file.",
  );
};
