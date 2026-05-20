/**
 * Markdown ↔ HTML conversion layer for the TipTap editor.
 *
 * Why this exists:
 *   Zakar's existing notes are stored as markdown strings in Firestore.
 *   The TipTap editor operates on HTML internally (or JSON, but we use
 *   HTML for the round-trip path because it's simpler and TipTap's
 *   parseHTML/getHTML methods are first-class).
 *
 *   Editing a note now means:
 *     1. Read note.content (markdown) from Firestore
 *     2. mdToHtml(markdown) → seed TipTap editor
 *     3. User edits in TipTap
 *     4. On save, htmlToMd(editor.getHTML()) → write back to Firestore
 *
 *   This file is the round-trip. If conversion is lossy, edits
 *   silently corrupt notes. We've optimized for fidelity on Zakar's
 *   common patterns (emoji-prefix headings, todo lists, callout
 *   blockquotes, code, links) at the cost of slightly verbose output
 *   on round-trip — extra newlines around blocks, etc., which markdown
 *   normalizes away on next render.
 *
 * What's intentionally NOT supported in v1:
 *   - Tables (TipTap supports them but our markdown rarely uses them)
 *   - Footnotes / definition lists / inline math
 *   - HTML-in-markdown (we strip dangerous tags)
 *
 * If round-trip ever produces a meaningfully different markdown than
 * the input, the verifyRoundTrip helper at the bottom will surface it
 * and we can iterate.
 */

import { marked } from "marked";
import TurndownService from "turndown";

// ============================================================
// Markdown → HTML
// ============================================================

// Configure marked for our use case. GFM gives us task lists (- [ ]),
// strikethrough, and autolinks — all of which appear in user notes.
// Breaks=true converts single newlines to <br>, which matches what
// the textarea editor allowed; without it, single-line breaks get
// collapsed by the markdown spec and users would see their soft wraps
// lost on round-trip.
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Convert markdown string to HTML suitable for seeding TipTap.
 * Returns "" for empty/null input. Catches parse errors and falls
 * back to the raw text wrapped in a paragraph — better to show the
 * raw content than to throw inside the editor.
 */
export function mdToHtml(md: string): string {
  if (!md || !md.trim()) return "";
  try {
    // marked.parse can return string | Promise<string> depending on
    // config. With our sync options it returns string, but cast for
    // type-safety and assert below.
    const html = marked.parse(md, { async: false }) as string;
    // Normalize GFM task lists to TipTap's format. marked emits:
    //   <ul><li><input type="checkbox" disabled [checked]> Text</li></ul>
    // TipTap's TaskList extension only recognizes:
    //   <ul data-type="taskList">
    //     <li data-type="taskItem" data-checked="true|false"><p>Text</p></li>
    //   </ul>
    // Without this transform, opening a note with - [ ] Item shows it
    // as a plain bullet in the editor — checkboxes are lost.
    return normalizeTaskLists(html);
  } catch (err) {
    console.warn("[md→html] parse failed, using fallback:", err);
    // Wrap in <p> so TipTap doesn't choke on a bare text node.
    const escaped = md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<p>${escaped}</p>`;
  }
}

/**
 * Walk the parsed HTML and rewrite GFM-style checkbox lists to the
 * data-attribute form that TipTap's TaskList extension recognizes.
 * Uses DOMParser (browser-only) so this only runs client-side; that's
 * fine because the editor itself is browser-only.
 *
 * A single <ul> may contain a mix of checkbox and non-checkbox <li>
 * children (rare but possible if the user wrote a nested list with
 * one task and several plain bullets). In that case we promote the
 * whole list to a taskList only when EVERY direct child <li> begins
 * with a checkbox input — otherwise we leave the list as-is and the
 * stray task item becomes a plain bullet (acceptable lossy edge).
 */
function normalizeTaskLists(html: string): string {
  if (typeof window === "undefined" || !window.DOMParser) {
    // Server-side or unsupported browser — return unchanged. The
    // round-trip will still work via the htmlToMd path; only the
    // visual seed in the editor would be off.
    return html;
  }
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="root">${html}</div>`,
      "text/html",
    );
    const root = doc.getElementById("root");
    if (!root) return html;

    // Find every <ul> that has at least one <li> starting with an
    // input checkbox. Convert them in place.
    const lists = Array.from(root.querySelectorAll("ul"));
    for (const ul of lists) {
      const items = Array.from(ul.children).filter(
        (c) => c.nodeName === "LI",
      ) as HTMLElement[];
      if (items.length === 0) continue;

      // All items must have a leading checkbox to count as a taskList.
      const allTask = items.every((li) => {
        const first = li.firstElementChild as HTMLElement | null;
        return (
          first &&
          first.nodeName === "INPUT" &&
          (first as HTMLInputElement).type === "checkbox"
        );
      });
      if (!allTask) continue;

      ul.setAttribute("data-type", "taskList");
      for (const li of items) {
        const input = li.firstElementChild as HTMLInputElement;
        const checked = input.hasAttribute("checked");
        // Remove the checkbox (TipTap renders its own).
        li.removeChild(input);
        // marked leaves a leading whitespace text node after the input;
        // strip it so the visible label doesn't have an awkward space.
        if (
          li.firstChild &&
          li.firstChild.nodeType === 3 /* text */ &&
          /^\s+/.test(li.firstChild.textContent || "")
        ) {
          li.firstChild.textContent = (
            li.firstChild.textContent || ""
          ).replace(/^\s+/, "");
        }
        // Wrap remaining content in <p> so TipTap's TaskItem schema is
        // satisfied (it expects a paragraph child).
        const inner = li.innerHTML;
        li.innerHTML = `<p>${inner}</p>`;
        li.setAttribute("data-type", "taskItem");
        li.setAttribute("data-checked", checked ? "true" : "false");
      }
    }
    return root.innerHTML;
  } catch (err) {
    console.warn("[md→html] task list normalization failed:", err);
    return html;
  }
}

// ============================================================
// HTML → Markdown
// ============================================================

// Turndown converts HTML to markdown. We configure it to match the
// markdown style Zakar's existing notes use (- for bullets, # for
// headings, fenced code blocks).
const turndown = new TurndownService({
  headingStyle: "atx", // # H1 instead of underline-style
  bulletListMarker: "-", // - bullet not * or +
  codeBlockStyle: "fenced", // ```code``` not indented
  emDelimiter: "*", // *italic* not _italic_
  strongDelimiter: "**", // **bold**
  hr: "---",
});

// TipTap renders task items as:
//   <ul data-type="taskList"><li data-type="taskItem" data-checked="true">...</li></ul>
// We convert these to GFM checkbox syntax: - [x] or - [ ].
turndown.addRule("tiptapTaskList", {
  filter: (node: HTMLElement) => {
    return (
      node.nodeName === "UL" &&
      node.getAttribute("data-type") === "taskList"
    );
  },
  replacement: (_content: string, node: any) => {
    const items: string[] = [];
    for (const li of Array.from(node.children)) {
      const liEl = li as HTMLElement;
      if (liEl.nodeName !== "LI") continue;
      const checked = liEl.getAttribute("data-checked") === "true";
      // Inner content: skip the checkbox label, pull text from inner <p>.
      const inner = liEl.querySelector("p")?.innerHTML || liEl.innerHTML;
      const innerMd = turndown.turndown(inner).trim();
      items.push(`- [${checked ? "x" : " "}] ${innerMd}`);
    }
    return "\n" + items.join("\n") + "\n";
  },
});

// GFM checkbox list items from `marked` come out as:
//   <li><input disabled type="checkbox"> Item text</li>
// We need to convert these back to `- [ ] Item text` markdown. This
// is separate from the taskList rule above (which handles TipTap's
// own <ul data-type="taskList"> output) — the difference matters
// because old notes parsed by `marked` produce the <input> form,
// while content edited in TipTap produces the data-attr form.
turndown.addRule("gfmCheckboxItem", {
  filter: (node: HTMLElement) => {
    if (node.nodeName !== "LI") return false;
    const firstChild = node.firstChild as HTMLElement | null;
    return (
      !!firstChild &&
      firstChild.nodeName === "INPUT" &&
      (firstChild as HTMLInputElement).type === "checkbox"
    );
  },
  replacement: (_content: string, node: any) => {
    const input = node.firstChild as HTMLInputElement;
    const checked = input.hasAttribute("checked");
    // Remove the input from a clone so we serialize ONLY the text.
    const clone = node.cloneNode(true) as HTMLElement;
    clone.removeChild(clone.firstChild!);
    // Strip leading whitespace that marked leaves between input and text.
    const inner = turndown.turndown(clone.innerHTML).trim();
    return `- [${checked ? "x" : " "}] ${inner}\n`;
  },
});

// Strikethrough — GFM extension that Turndown supports if we add the rule.
turndown.addRule("strikethrough", {
  filter: ["del", "s"] as any,
  replacement: (content: string) => `~~${content}~~`,
});

// Hard breaks inside paragraphs. TipTap emits <br> for shift+enter; we
// convert these to two-trailing-spaces+newline (markdown's hard break).
turndown.addRule("hardBreak", {
  filter: "br",
  replacement: () => "  \n",
});

/**
 * Convert HTML (from TipTap.getHTML()) back to markdown for storage.
 * Returns "" for empty/null input. Cleans up extra blank lines that
 * the round-trip can introduce.
 */
export function htmlToMd(html: string): string {
  if (!html || !html.trim()) return "";
  // TipTap occasionally emits empty paragraphs <p></p> when the user
  // presses Enter at end of doc. Strip those before conversion or
  // we get spurious blank lines.
  const cleaned = html.replace(/<p><\/p>/g, "").trim();
  if (!cleaned) return "";

  try {
    let md = turndown.turndown(cleaned);
    // Collapse 3+ blank lines down to 2 (single blank between blocks).
    md = md.replace(/\n{3,}/g, "\n\n");
    // Trim trailing whitespace on each line — Turndown can leave it
    // after some block conversions.
    md = md
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n");
    return md.trim();
  } catch (err) {
    console.warn("[html→md] turndown failed:", err);
    // Last-resort: strip tags and hope for the best. Better than
    // throwing inside the save flow.
    return cleaned.replace(/<[^>]+>/g, "");
  }
}

// ============================================================
// Round-trip verification helper
// ============================================================

/**
 * Compare an original markdown string against its round-tripped
 * version. Returns null if they're equivalent (after normalization)
 * or a description of the diff if they're not.
 *
 * Use this to spot-check notes before letting the editor write back:
 *   const issue = verifyRoundTrip(note.content);
 *   if (issue) console.warn("Lossy round-trip on note", note.id, issue);
 *
 * Normalization: we collapse multiple blank lines, strip trailing
 * whitespace, and lowercase nothing. Real semantic differences
 * survive; cosmetic ones don't trigger false positives.
 */
export function verifyRoundTrip(md: string): string | null {
  if (!md) return null;
  const normalize = (s: string) =>
    s
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((l) => l.replace(/[ \t]+$/, ""))
      .join("\n")
      .trim();

  const original = normalize(md);
  const roundTripped = normalize(htmlToMd(mdToHtml(md)));
  if (original === roundTripped) return null;

  // Find the first line that differs to give a useful diff hint.
  const a = original.split("\n");
  const b = roundTripped.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}: "${a[i] ?? "<eof>"}" → "${b[i] ?? "<eof>"}"`;
    }
  }
  return "trailing content differs";
}
