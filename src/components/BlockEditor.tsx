/**
 * Block editor component — TipTap-based replacement for the textarea.
 *
 * Contract with the parent App.tsx:
 *   - Receives `markdown` as the source of truth (we convert to HTML
 *     internally to seed TipTap, but the parent only ever sees markdown).
 *   - Calls `onMarkdownChange(md)` whenever the content changes — this
 *     is what hooks into the auto-save flow.
 *   - Calls `onTitleChange(title)` if title editing is enabled, but
 *     for v1 we keep title as a separate <input> in the parent (less
 *     to break, easier to reason about).
 *
 * Why HTML round-trip instead of TipTap JSON:
 *   TipTap accepts both. HTML is easier to debug ("view source" works),
 *   easier to round-trip with marked + turndown, and easier to swap
 *   out if we ever want to test a different editor later. JSON is
 *   slightly faster but the perf difference is invisible at our scale.
 *
 * What's intentionally NOT in this v1:
 *   - Slash menu (/)
 *   - Custom node types (callout, voice memo, reminder)
 *   - Drag handles per block
 *   - Bubble menu / floating selection toolbar
 *   - Collaborative cursor / multi-user
 *
 * Each of those is its own follow-up turn. Adding them prematurely
 * is the fastest path to a buggy editor.
 */

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TextStyle, Color } from "@tiptap/extension-text-style";

import { mdToHtml, htmlToMd } from "../lib/markdownConversion";
import { SlashCommand } from "./SlashCommand";
import { BubbleMenuBar } from "./BubbleMenuBar";

interface BlockEditorProps {
  /** Initial markdown content. Converted to HTML once on mount. */
  markdown: string;
  /** Called on every content change with the latest markdown. */
  onMarkdownChange: (md: string) => void;
  /** Placeholder shown when the editor is empty. */
  placeholder?: string;
  /** Auto-focus the editor when it mounts (default false). */
  autoFocus?: boolean;
}

export function BlockEditor({
  markdown,
  onMarkdownChange,
  placeholder = "Start writing…",
  autoFocus = false,
}: BlockEditorProps) {
  // ============================================================
  // Track whether the parent's markdown is "external" — i.e. the
  // parent updated it for a reason other than the editor itself
  // (e.g. switched to a different note). When that happens, we
  // re-seed the editor. When the change came from the editor's own
  // onUpdate, we DO NOT re-seed (that would cause cursor jumps and
  // infinite loops).
  // ============================================================
  const lastEmittedRef = useRef<string>(markdown);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We use our own link extension (below) for autolink + open-in-new-tab
        // behavior. Turning it off in StarterKit prevents a double-registered
        // extension warning.
        link: false,
      }),
      Link.configure({
        openOnClick: false, // Don't navigate inside the editor; user must Cmd-click
        autolink: true, // Bare URLs become links automatically
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      Placeholder.configure({
        placeholder,
        // Show the placeholder on every empty block, not just when the
        // whole doc is empty. Helps users understand they can keep typing
        // after pressing Enter.
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
      }),
      TaskList,
      TaskItem.configure({
        nested: true, // Allow nested task lists
      }),
      // TextStyle is the base extension that lets us apply inline
      // styles (like color) via a <span style="..."> wrapper. Color
      // depends on it being registered first.
      TextStyle,
      Color,
      SlashCommand,
    ],
    content: mdToHtml(markdown),
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        // The editor surface inherits zk-prose styles defined in our CSS.
        // Tailwind utilities here cover only the layout role of the
        // contenteditable div itself.
        class: "zk-block-editor focus:outline-none min-h-[300px]",
        spellcheck: "true",
      },
    },
    // CRITICAL: in TipTap v3 with React StrictMode, the editor is created
    // twice in dev. immediatelyRender: false avoids hydration mismatch
    // warnings that fire on first paint. Slight delay on render is
    // imperceptible but the warning is loud.
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      // Convert HTML → MD and emit. We do this on every keystroke; the
      // parent's auto-save effect debounces the actual Firestore write.
      const html = editor.getHTML();
      const md = htmlToMd(html);
      lastEmittedRef.current = md;
      onMarkdownChange(md);
    },
  });

  // ============================================================
  // External markdown change → re-seed editor
  // ============================================================
  // Triggered when the parent passes new markdown that DIDN'T come
  // from us (e.g. user switched to a different note, or AI sorting
  // updated the content while editing was open). We compare against
  // our last-emitted-md to detect "external" changes and re-seed
  // only then. Without this guard we'd loop or scrub the user's
  // cursor every keystroke.
  useEffect(() => {
    if (!editor) return;
    if (markdown === lastEmittedRef.current) return;
    // External change. Re-seed the editor with the new content.
    //
    // We deliberately use the simplest setContent signature (no
    // options) so this is robust across TipTap version differences.
    // The trade-off: setContent emits an onUpdate, which calls
    // onMarkdownChange, which calls our setEditContent — creating
    // one extra render cycle. That's harmless because:
    //   1. The hasEditorTypedRef guard in App.tsx prevents phantom
    //      auto-saves from this kind of noise.
    //   2. The lastEmittedRef check above bails on subsequent
    //      effects when the markdown is already what we last emitted.
    editor.commands.setContent(mdToHtml(markdown));
    lastEmittedRef.current = markdown;
  }, [markdown, editor]);

  // ============================================================
  // Cleanup
  // ============================================================
  useEffect(() => {
    return () => {
      // Tear down the editor when this component unmounts. TipTap
      // doesn't auto-cleanup; missing this leaks ProseMirror state.
      editor?.destroy();
    };
  }, [editor]);

  return (
    <>
      <EditorContent editor={editor} />
      <BubbleMenuBar editor={editor} />
    </>
  );
}
