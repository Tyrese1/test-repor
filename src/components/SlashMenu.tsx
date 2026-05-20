/**
 * Slash menu — popup that appears when the user types "/" in the
 * BlockEditor. Lists insertable block types matching the mockup's
 * design. Keyboard navigable (up/down arrows, Enter to insert,
 * Escape to dismiss).
 *
 * This component is the *content* of the popup. The popup positioning
 * itself is handled by tippy.js, wired up in the slashCommand extension.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Heading2,
  ListChecks,
  Quote,
  Code,
  Minus,
  List,
  ListOrdered,
} from "lucide-react";

/**
 * Each item describes one block the user can insert. The `command`
 * function receives the editor and the suggestion range so it can
 * delete the "/" trigger and insert the new block in one transaction.
 */
export interface SlashItem {
  title: string;
  description: string;
  shortcut?: string;
  icon: React.ReactNode;
  command: (props: { editor: any; range: any }) => void;
}

export const slashItems: SlashItem[] = [
  {
    title: "Heading",
    description: "A section divider",
    shortcut: "##",
    icon: <Heading2 className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run();
    },
  },
  {
    title: "To-do",
    description: "A checkbox you can tick off later",
    shortcut: "[ ]",
    icon: <ListChecks className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .toggleTaskList()
        .run();
    },
  },
  {
    title: "Bullet list",
    description: "Unordered list of items",
    shortcut: "-",
    icon: <List className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .toggleBulletList()
        .run();
    },
  },
  {
    title: "Numbered list",
    description: "Ordered list of items",
    shortcut: "1.",
    icon: <ListOrdered className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .toggleOrderedList()
        .run();
    },
  },
  {
    title: "Quote",
    description: "For things worth remembering",
    shortcut: ">",
    icon: <Quote className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .toggleBlockquote()
        .run();
    },
  },
  {
    title: "Code block",
    description: "Monospaced, syntax-highlighted",
    shortcut: "```",
    icon: <Code className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .toggleCodeBlock()
        .run();
    },
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    shortcut: "---",
    icon: <Minus className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setHorizontalRule()
        .run();
    },
  },
];

/**
 * Filter items by query — match against title and description so users
 * can type "list" and get bullet+numbered+todo, or "code" and get the
 * code block. Falls back to all items when query is empty.
 */
export function filterSlashItems(query: string): SlashItem[] {
  if (!query) return slashItems;
  const q = query.toLowerCase();
  return slashItems.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q),
  );
}

interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

/**
 * Imperative handle exposed to the suggestion plugin. The plugin needs
 * to forward keyboard events (ArrowUp/ArrowDown/Enter) to this menu
 * via `onKeyDown`. We expose that via useImperativeHandle.
 */
export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    // Reset selection when items change (e.g. user typed to filter).
    useEffect(() => setSelected(0), [items]);

    const select = (i: number) => {
      const item = items[i];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          select(selected);
          return true;
        }
        return false;
      },
    }));

    // Auto-scroll selected item into view when keyboard navigates past
    // the visible portion of the list.
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = listRef.current?.children[selected] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    if (items.length === 0) {
      return (
        <div className="zk-slash-menu zk-slash-menu-empty">
          No matching block.
        </div>
      );
    }

    return (
      <div className="zk-slash-menu" ref={listRef}>
        <div className="zk-slash-menu-header">
          INSERT A BLOCK · TYPE TO FILTER
        </div>
        {items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            className={`zk-slash-item ${selected === i ? "zk-slash-item-active" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => {
              // Prevent the editor from losing focus before the click
              // handler fires — without this, ProseMirror's blur
              // closes the menu before we can act.
              e.preventDefault();
              select(i);
            }}
          >
            <span className="zk-slash-icon">{item.icon}</span>
            <span className="zk-slash-info">
              <span className="zk-slash-name">{item.title}</span>
              <span className="zk-slash-desc">{item.description}</span>
            </span>
            {item.shortcut && (
              <span className="zk-slash-shortcut">{item.shortcut}</span>
            )}
          </button>
        ))}
      </div>
    );
  },
);
SlashMenu.displayName = "SlashMenu";
