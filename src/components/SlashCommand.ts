/**
 * Slash command extension — wires the Suggestion plugin to fire when
 * the user types "/" at the start of an empty paragraph (or after
 * whitespace), and renders the SlashMenu component as a tippy popup
 * positioned at the caret.
 *
 * This is the standard TipTap pattern documented at
 * https://tiptap.dev/docs/editor/api/utilities/suggestion. We adapt
 * it to React + tippy for the popup UI.
 */

import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy from "tippy.js";
import type {
  Instance as TippyInstance,
  GetReferenceClientRect,
} from "tippy.js";
import {
  SlashMenu,
  slashItems,
  type SlashMenuRef,
  type SlashItem,
} from "./SlashMenu";

/**
 * Filter slash items by query — match against title and description.
 * Inlined here (rather than imported from SlashMenu) because Vercel's
 * Rollup resolution was failing to find the export across module
 * boundaries for unclear reasons. Keeping it co-located with the only
 * caller eliminates the cross-module dependency entirely.
 */
function filterSlashItems(query: string): SlashItem[] {
  if (!query) return slashItems;
  const q = query.toLowerCase();
  return slashItems.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q),
  );
}

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        // Allow space inside the query so "code block" matches; the
        // suggestion plugin defaults to allowSpaces:false which would
        // close the menu on the first space.
        allowSpaces: false,
        startOfLine: false,
        // Returns the candidate items for the menu given the current
        // query (text after "/").
        items: ({ query }: { query: string }) => filterSlashItems(query),
        // Called when user selects an item — runs the item's command.
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: any;
          props: SlashItem;
        }) => {
          props.command({ editor, range });
        },
        render: () => {
          let component: ReactRenderer<SlashMenuRef> | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashMenu, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect:
                  props.clientRect as GetReferenceClientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                // No animation — opens instantly. Animations on
                // command palettes feel sluggish.
                animation: false,
              });
            },

            onUpdate: (props: any) => {
              component?.updateProps(props);
              if (!props.clientRect || !popup) return;
              popup[0]?.setProps({
                getReferenceClientRect:
                  props.clientRect as GetReferenceClientRect,
              });
            },

            onKeyDown: (props: any) => {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              // Let the SlashMenu component handle ArrowUp/Down/Enter.
              return component?.ref?.onKeyDown(props) || false;
            },

            onExit: () => {
              popup?.[0]?.destroy();
              component?.destroy();
              popup = null;
              component = null;
            },
          };
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
