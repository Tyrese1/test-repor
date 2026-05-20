/**
 * Bubble menu — the floating "format on selection" toolbar.
 *
 * Appears above any text selection in the BlockEditor with quick
 * formatting actions: Bold, Italic, Code, Link, Comment, Color.
 * Dismisses on click-outside, Escape, or empty selection.
 *
 * Built on TipTap v3's <BubbleMenu> component from @tiptap/react/menus,
 * which handles the "appears when text is selected, hides when not"
 * behavior at the ProseMirror plugin level — we just provide the
 * button UI inside it.
 *
 * Design choices:
 *   - Dark pill background (matches mockup) — reads as "system chrome"
 *     against the light editing surface, doesn't compete with content.
 *   - One row of buttons; no submenus on hover. Submenus inside a
 *     selection toolbar are awkward because hovering moves the
 *     selection focus.
 *   - Link button reveals an inline URL input in the same pill (not a
 *     separate popover) — keeps the interaction self-contained.
 *   - Color button reveals a row of swatches inline.
 *   - Comment button is intentionally non-functional in this turn —
 *     it appears in the mockup but threading-comments need their own
 *     data model. Tooltip explains "coming soon" so users aren't
 *     confused by a click that does nothing.
 *
 * What this is NOT (yet):
 *   - No "highlight" color (background tint) — only text color
 *   - No font family / size selectors
 *   - No "more" overflow into a longer toolbar
 *   - No collaborative comment threads (Comment is placeholder UI)
 */

import { useEffect, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Editor } from "@tiptap/core";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Code as CodeIcon,
  Link as LinkIcon,
  Palette,
} from "lucide-react";

interface BubbleMenuBarProps {
  editor: Editor | null;
}

/** Color swatches for text color. Tied to the brand palette so these
 *  feel like first-class options rather than a generic color picker.
 *  "Reset" returns to the default text color (removeMark on textStyle). */
const COLOR_SWATCHES: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Sage", value: "#4f6354" },
  { label: "Rose", value: "#e11d48" },
  { label: "Amber", value: "#d97706" },
  { label: "Sky", value: "#2563eb" },
  { label: "Violet", value: "#7c3aed" },
];

export function BubbleMenuBar({ editor }: BubbleMenuBarProps) {
  // Track which inline panel is open: link input or color swatches.
  // Only one at a time; opening one closes the other. null = neither.
  const [panel, setPanel] = useState<"link" | "color" | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);

  // When the link panel opens, prefill with the current selection's
  // existing href (if any) so users can edit rather than retype.
  // Focus the input immediately so they can start typing.
  useEffect(() => {
    if (panel === "link" && editor) {
      const previous = editor.getAttributes("link").href || "";
      setLinkUrl(previous);
      // Defer focus to next frame so the input has rendered.
      requestAnimationFrame(() => linkInputRef.current?.focus());
    }
  }, [panel, editor]);

  // Close any open panel when the selection changes (user clicked
  // elsewhere). Without this, the link input would persist showing
  // the previous selection's URL.
  useEffect(() => {
    if (!editor) return;
    const handler = () => setPanel(null);
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor]);

  if (!editor) return null;

  const applyLink = () => {
    if (!linkUrl.trim()) {
      // Empty URL → unset existing link
      editor.chain().focus().unsetLink().run();
    } else {
      // Add http:// if no protocol given (otherwise the link won't work)
      const url = /^https?:\/\//i.test(linkUrl) ? linkUrl : `https://${linkUrl}`;
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
    setPanel(null);
    setLinkUrl("");
  };

  const applyColor = (color: string | null) => {
    if (color === null) {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(color).run();
    }
    setPanel(null);
  };

  return (
    <BubbleMenu
      editor={editor}
      // Hide the bubble when the selection is empty OR when we're
      // inside a code block (no formatting makes sense in code).
      shouldShow={({ editor: ed, state }) => {
        const { selection } = state;
        if (selection.empty) return false;
        if (ed.isActive("codeBlock")) return false;
        return true;
      }}
      className="zk-bubble-menu"
    >
      {panel === "link" ? (
        // Link input panel — replaces the buttons row. URL field +
        // commit button. Pressing Enter commits, Escape cancels.
        <div className="zk-bubble-link-panel">
          <input
            ref={linkInputRef}
            type="url"
            placeholder="paste or type a link"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setPanel(null);
              }
            }}
            className="zk-bubble-link-input"
          />
          <button
            type="button"
            onClick={applyLink}
            className="zk-bubble-link-apply"
            title="Apply link (Enter)"
          >
            ↵
          </button>
        </div>
      ) : panel === "color" ? (
        // Color swatch row — replaces the buttons row.
        <div className="zk-bubble-color-panel">
          {COLOR_SWATCHES.map((sw) => (
            <button
              key={sw.label}
              type="button"
              onClick={() => applyColor(sw.value)}
              className="zk-bubble-swatch"
              title={sw.label}
              style={{
                background: sw.value || "transparent",
                border: sw.value ? "none" : "1.5px solid #888",
              }}
              aria-label={sw.label}
            >
              {!sw.value && <span className="zk-bubble-swatch-x">×</span>}
            </button>
          ))}
        </div>
      ) : (
        // Default panel — the six format buttons from the mockup.
        <>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`zk-bubble-btn ${editor.isActive("bold") ? "is-active" : ""}`}
            title="Bold (⌘B)"
            aria-label="Bold"
          >
            <BoldIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`zk-bubble-btn ${editor.isActive("italic") ? "is-active" : ""}`}
            title="Italic (⌘I)"
            aria-label="Italic"
          >
            <ItalicIcon className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`zk-bubble-btn ${editor.isActive("code") ? "is-active" : ""}`}
            title="Inline code"
            aria-label="Code"
          >
            <CodeIcon className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setPanel("link")}
            className={`zk-bubble-btn ${editor.isActive("link") ? "is-active" : ""}`}
            title="Link"
            aria-label="Link"
          >
            <LinkIcon className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setPanel("color")}
            className="zk-bubble-btn"
            title="Text color"
            aria-label="Text color"
          >
            <Palette className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </>
      )}
    </BubbleMenu>
  );
}
