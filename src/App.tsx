import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
// Prism — syntax highlighting for code blocks in note preview /
// shared notes. We load the core + the languages we expect to see
// most often in user notes. Prism is small (~5KB core) so loading
// these languages eagerly is fine; lazy-loading them would add
// flicker on first render.
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markup"; // HTML
import "prismjs/components/prism-css";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-java";
import "prismjs/components/prism-php";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-markdown";
import {
  Plus,
  Search,
  Sparkles,
  Trash2,
  LogOut,
  Brain,
  Tag,
  Clock,
  ChevronRight,
  PanelLeftOpen,
  PanelLeftClose,
  SquarePen,
  ChevronLeft,
  ChevronDown,
  Filter,
  CheckCircle2,
  Lightbulb,
  Key,
  Globe,
  User as UserIcon,
  MoreVertical,
  Settings,
  ShieldCheck,
  X,
  Edit2,
  Save,
  Copy,
  Check,
  LayoutGrid,
  List,
  AlertTriangle,
  Eye,
  EyeOff,
  Star,
  Share2,
  ExternalLink,
  Info,
  HelpCircle,
  Moon,
  Sun,
  Lock,
  Loader2,
  ListChecks,
  Mail,
  FileText,
  MessageSquare,
  MessageCircle,
  CalendarCheck,
  Layers,
  Mic,
  Music,
  RotateCcw,
  Pin,
  PinOff,
  Download,
  Upload,
  Flag,
  Archive,
  History,
  Palette,
  ArchiveRestore,
  Zap,
  Target,
  Split,
  ListTodo,
  Fingerprint,
} from "lucide-react";
import {
  auth,
  db,
  signUpWithEmail,
  signInWithEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  signInWithGoogle,
  logOut,
  FirebaseUser,
  Timestamp,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  onAuthStateChanged,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  setDoc,
  getDoc,
  deleteUserAccount,
} from "./firebase";
// writeBatch isn't re-exported from ./firebase. Import directly — same
// Firestore SDK module the rest of the file uses transitively.
import { writeBatch } from "firebase/firestore";
import {
  magicSort,
  SortedNote,
  FormatType,
  FORMAT_LABELS,
  breakdownTask,
  extractTasks,
  getAI,
} from "./services/aiService";
import {
  isBiometricAvailable,
  enrollBiometric,
  verifyBiometric,
  reauthenticateEmailUser,
  reauthenticateGoogleUser,
  isGoogleUser,
  isEmailUser,
  forgetCredential,
  type LockMethod,
} from "./services/biometric";
import { cn } from "./lib/utils";
import { BlockEditor } from "./components/BlockEditor";
import {
  exportNotesToZip,
  exportNotesAsHtml,
  exportNotesAsJson,
  parseImportFile,
  downloadBlob,
  type ParsedNote,
  type ImportIssue,
} from "./lib/notesIO";
import {
  parseSearchQuery,
  matchesQuery,
  extractFilterChips,
  removeChipFromQuery,
} from "./lib/noteSearch";
import {
  embedNotes,
  askNotes,
  findStaleNotes,
  type RecallAnswer,
} from "./lib/notesRecall";
import {
  parseReminder,
  formatReminderSchedule,
  dayInitial,
  type Reminder,
} from "./lib/reminderParser";
import Markdown from "react-markdown";
import {
  Button,
  IconButton,
  Tooltip,
  Pill,
  Modal,
  ModalHeader,
  ModalFooter,
  Card,
  Toggle,
  categoryToPillVariant,
  categoryToAccentClass,
} from "./ui";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  rectIntersection,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// --- Types ---
interface Note {
  id: string;
  title: string;
  content: string;
  maskedContent: string;
  rawContent: string;
  category: string;
  tags: string[];
  createdAt: Timestamp | any;
  updatedAt: Timestamp | any;
  userId: string;
  isAutoSorted: boolean;
  isStarred?: boolean;
  isPublic?: boolean;
  hasSensitiveData?: boolean;
  // `password` is retained for backward compatibility as a TRUTHY
  // FLAG only — it no longer stores a secret. New locks set it to
  // the literal string "locked". The old text-password flow has
  // been removed; existing notes that still had a real password
  // stored get auto-unlocked on first load (see clearLegacyLocks).
  password?: string;
  // How the user is expected to unlock this note. "biometric" uses
  // WebAuthn / platform authenticator (Touch ID, Face ID, Windows
  // Hello). "account-password" prompts for the user's Firebase
  // account password and verifies via reauthenticateWithCredential.
  // Older locked notes that haven't been re-locked yet will be
  // missing this field; treat that as unlocked.
  lockMethod?: LockMethod;
  lockedAt?: Timestamp | null;
  failedAttempts?: number;
  lockedUntil?: Timestamp | null;
  status?: "processing" | "ready" | "error";
  formatType?: FormatType;
  needsEnhancement?: boolean;
  suggestedEnhancement?: string;
  isTrashed?: boolean;
  trashedAt?: Timestamp | null;
  isPinned?: boolean;
  isArchived?: boolean;
  sortOrder?: number;
  // Optional MD3 color key (e.g. "sage", "rose", "amber"). When set, the
  // note card and modal use the corresponding tonal palette instead of
  // the default white/raised surface. See NOTE_COLOR_TOKENS below.
  backgroundColor?: string;
  /** Cached vector embedding for semantic recall ("Ask my notes"). Stored
   *  as a regular array of floats. Null/missing means not yet embedded. */
  embedding?: number[];
  /** FNV-1a hash of the note's content at the time `embedding` was computed.
   *  When the current content hash differs, the embedding is stale and gets
   *  recomputed on the next recall pass. */
  embeddingHash?: string;
  /** Structured reminder data, derived from natural-language parsing of the
   *  note content. Populated at save time when the note looks like a
   *  reminder (e.g. "remind me to water the basil every Wednesday at 8am").
   *  When set, the card renders with a special reminder treatment. */
  reminder?: {
    subject: string;
    time?: string;
    days?: number[];
    recurrence?: "once" | "daily" | "weekly" | "weekdays" | "weekends";
    date?: string;
    source: string;
  };
}

/* ============================================================
   Per-note background colors — Material Design 3 tonal palette.

   Each color has a light-mode tint (tone 95) and a dark-mode
   tint (tone 20-25), tuned so cards stay readable against
   either app background. Border is always slightly stronger
   than surface to give the card a defined edge.

   `default` = no override; uses the standard raised surface.
   ============================================================ */
export interface NoteColorToken {
  key: string;
  label: string;
  light: string; // surface bg in light mode
  dark: string; // surface bg in dark mode
  borderLight: string;
  borderDark: string;
  swatch: string; // color shown in the picker (mid-tone, visible in both modes)
}

const NOTE_COLOR_TOKENS: NoteColorToken[] = [
  {
    key: "default",
    label: "Default",
    light: "#ffffff",
    dark: "#2d2e31",
    borderLight: "#dde5da",
    borderDark: "rgba(255,255,255,0.06)",
    swatch: "transparent",
  },
  // New palette inspired by the user's mockup — soft pastel tones
  // designed to read as gentle accents rather than saturated brand
  // colors. Each card-color picks up these via the .zk-note-bg-*
  // classes; dark-mode variants are deliberately desaturated.
  {
    key: "rose",
    label: "Coral",
    light: "#f8b9a8",
    dark: "#4a2a23",
    borderLight: "#f0a08c",
    borderDark: "#5e3d33",
    swatch: "#f8b9a8",
  },
  {
    key: "amber",
    label: "Peach",
    light: "#f9c89a",
    dark: "#4a3220",
    borderLight: "#f5b885",
    borderDark: "#5e4435",
    swatch: "#f9c89a",
  },
  {
    key: "sand",
    label: "Sand",
    light: "#fff3a8",
    dark: "#43401f",
    borderLight: "#f5e88f",
    borderDark: "#575433",
    swatch: "#fff3a8",
  },
  {
    key: "mint-light",
    label: "Mint",
    light: "#c8e8d3",
    dark: "#1f3a2b",
    borderLight: "#b0dcc1",
    borderDark: "#314c3f",
    swatch: "#c8e8d3",
  },
  {
    key: "mint",
    label: "Sage",
    light: "#a6dcc9",
    dark: "#1f3935",
    borderLight: "#8fcfb9",
    borderDark: "#314f47",
    swatch: "#a6dcc9",
  },
  {
    key: "ocean",
    label: "Sky",
    light: "#cee0ec",
    dark: "#1f3142",
    borderLight: "#b3d0e0",
    borderDark: "#314558",
    swatch: "#cee0ec",
  },
  {
    key: "sky-deep",
    label: "Ocean",
    light: "#a8c5da",
    dark: "#1f334a",
    borderLight: "#90b5cd",
    borderDark: "#33495e",
    swatch: "#a8c5da",
  },
  {
    key: "lavender",
    label: "Lavender",
    light: "#cabae0",
    dark: "#2f2a3d",
    borderLight: "#b8a6d1",
    borderDark: "#43395a",
    swatch: "#cabae0",
  },
  {
    key: "blush",
    label: "Blush",
    light: "#f0d6dd",
    dark: "#3a2935",
    borderLight: "#dfbcc6",
    borderDark: "#523c47",
    swatch: "#f0d6dd",
  },
  {
    key: "stone",
    label: "Beige",
    light: "#e6dfd0",
    dark: "#33322d",
    borderLight: "#d0c8b8",
    borderDark: "#494538",
    swatch: "#e6dfd0",
  },
  {
    key: "sage",
    label: "Off-white",
    light: "#f5f3ec",
    dark: "#2f2f2c",
    borderLight: "#e2dfd6",
    borderDark: "#3d3d39",
    swatch: "#f5f3ec",
  },
];

const getNoteColorToken = (key?: string): NoteColorToken => {
  if (!key || key === "default") return NOTE_COLOR_TOKENS[0];
  return NOTE_COLOR_TOKENS.find((t) => t.key === key) || NOTE_COLOR_TOKENS[0];
};

/**
 * Maps a color key to the CSS class that drives the card's bg + border.
 * The class itself swaps light/dark values via the `.dark` parent selector,
 * so theme transitions are instant — no React re-render needed.
 */
const noteColorClass = (key?: string): string => {
  const tok = getNoteColorToken(key);
  return `zk-note-bg-${tok.key}`;
};

/**
 * Mood band — a 4px colored stripe rendered on the left edge of the
 * note detail modal. Communicates the note's category at a glance.
 *
 * IMPORTANT: these colors must match the card preview's category
 * indicator (see the per-card colored stripe at ~line 10910). When
 * they diverge, users see one color on the card and a different one
 * after opening the note — the live "Idea" note showed amber on the
 * card but rose on the band before this alignment fix.
 *
 * The accents are deliberately muted (~ 30-50% saturation) so they
 * pair cleanly with any backgroundColor token the user picks. We use
 * gradients top-to-bottom for a subtle organic feel — solid bars feel
 * institutional, gradients feel intentional.
 *
 * Categories that don't match fall through to the default sage so the
 * band always renders something rather than disappearing entirely.
 */
const getMoodBandStyle = (category?: string): React.CSSProperties => {
  const cat = (category || "").toLowerCase();
  // Normalize a few common variants so the lookup catches them.
  if (cat.includes("task") || cat.includes("todo") || cat.includes("to-do")) {
    return {
      // Sage — matches card's `zk-bg-primary` for Task
      background: "linear-gradient(180deg, #8fb89a 0%, #2d5a44 100%)",
    };
  }
  if (cat.includes("personal") || cat.includes("journal")) {
    return {
      // Violet — matches card's `bg-violet-400` for Personal
      background: "linear-gradient(180deg, #c4b5fd 0%, #8b7ec8 100%)",
    };
  }
  if (
    cat.includes("reminder") ||
    cat.includes("event") ||
    cat.includes("appointment")
  ) {
    return {
      // Peach/orange — reminder-specific (card doesn't have its own
      // reminder color but this is the natural extension)
      background: "linear-gradient(180deg, #fdba74 0%, #c2410c 100%)",
    };
  }
  if (cat.includes("web") || cat.includes("article") || cat.includes("link")) {
    return {
      // Sky blue — matches card's `bg-sky-400` for Web Content
      background: "linear-gradient(180deg, #93c5fd 0%, #2563eb 100%)",
    };
  }
  if (
    cat.includes("credential") ||
    cat.includes("password") ||
    cat.includes("auth")
  ) {
    return {
      // Rose — matches card's `bg-rose-400` for Credential
      background: "linear-gradient(180deg, #fda4af 0%, #be185d 100%)",
    };
  }
  if (cat.includes("idea") || cat.includes("note")) {
    return {
      // Amber — matches card's `bg-amber-500` for Idea (PREVIOUSLY
      // used rose, which produced the "yellow on preview, red on
      // detail" mismatch users saw on Idea-categorized notes).
      background: "linear-gradient(180deg, #fcd34d 0%, #d97706 100%)",
    };
  }
  // Default fallback — sage, matching brand
  return {
    background: "linear-gradient(180deg, #8fb89a 0%, #2d5a44 100%)",
  };
};

/**
 * Returns Tailwind class strings for the category badge background
 * and text color. These are designed to:
 *
 *   1. **Match category identity** — the same color family as the
 *      card preview's left stripe and the detail modal's mood band.
 *      A user who learns "rose = credential" sees that signal
 *      consistently across cards, detail modals, and badges.
 *   2. **Work in both light and dark themes** — every entry has a
 *      `bg-X-100` light variant and a `dark:bg-X-900/40` dark variant
 *      with appropriate text contrast, so the badge stays legible
 *      regardless of theme.
 *   3. **Survive on a colored note background** — the muted bg pill
 *      uses ~100-level opacity which has enough body against any of
 *      the user's palette colors (peach, mint, amber, etc.) without
 *      blending in. Previously the badge was hardcoded sage, which
 *      vanished or fought with non-default note colors.
 *
 * Fallback returns a neutral stone tone for unknown/Other categories
 * rather than null or sage — "Other" shouldn't borrow the brand
 * color, it should read as "uncategorized."
 */
/**
 * Extract a leading emoji glyph from a string.
 * Returns [emoji, rest] when the string starts with an emoji,
 * or [null, original] when it doesn't.
 *
 * Used by: note card titles (render emoji bigger), modal H2 pills,
 * blockquote callout detection, and any future surface that wants to
 * surface a leading emoji as a distinct visual element.
 *
 * The regex covers the major emoji ranges plus the optional
 * variation-selector-16 (U+FE0F) which several common emoji rely on
 * for color rendering. We don't try to be exhaustive — Extended_Pictographic
 * isn't reliably supported in all engines — but the pragmatic ranges
 * here catch every emoji the AI sorter currently produces (📌 🎯 💡
 * ⏰ 🛠 ✅ 📞 📧 etc.) plus typical user input.
 */
const extractLeadingEmojiTopLevel = (
  text: string,
): [string | null, string] => {
  if (!text) return [null, text];
  const m = text.match(
    /^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}]\uFE0F?)\s*/u,
  );
  if (!m) return [null, text];
  return [m[1], text.slice(m[0].length)];
};

/**
 * Find the FIRST emoji glyph anywhere in a string. Used on note
 * cards to give each note a visual identity emoji even when the
 * title doesn't have a leading one — common case: email-forwarded
 * notes where the title is the email subject (plain text) but the
 * AI-sorted body has emoji-prefixed headings like "## 🎯 Hook".
 *
 * Returns the first emoji match, or null if none found anywhere in
 * the text. Same regex ranges as extractLeadingEmojiTopLevel but
 * without the start-of-string anchor.
 *
 * Performance: this is O(n) over the text. We cap the scan at the
 * first 500 chars since the goal is "show me the dominant emoji"
 * and notes that don't have one in the first paragraph almost
 * certainly don't have one worth surfacing.
 */
const findFirstEmojiInContent = (text: string): string | null => {
  if (!text) return null;
  const scan = text.length > 500 ? text.slice(0, 500) : text;
  const m = scan.match(
    /([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}]\uFE0F?)/u,
  );
  return m ? m[1] : null;
};

const getCategoryBadgeClass = (category?: string): string => {
  const cat = (category || "").toLowerCase();
  if (cat.includes("task") || cat.includes("todo") || cat.includes("to-do")) {
    // Aligned to mockup tokens: lighter sage-mint bg, deeper sage text.
    // Was bg-[#d2e8d5]/text-[#2d5a44]; mockup uses #e8f3ee/#2d5a44 for
    // a more delicate, modern pill that reads as accent rather than
    // brand-loud.
    return "bg-[#e8f3ee] dark:bg-[#2d5a44]/40 text-[#2d5a44] dark:text-[#a8d0b0]";
  }
  if (cat.includes("personal") || cat.includes("journal")) {
    return "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300";
  }
  if (
    cat.includes("reminder") ||
    cat.includes("event") ||
    cat.includes("appointment")
  ) {
    return "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300";
  }
  if (cat.includes("web") || cat.includes("article") || cat.includes("link")) {
    return "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300";
  }
  if (
    cat.includes("credential") ||
    cat.includes("password") ||
    cat.includes("auth")
  ) {
    return "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300";
  }
  if (cat.includes("idea") || cat.includes("note")) {
    return "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300";
  }
  if (cat.includes("meeting")) {
    return "bg-[#d2e8d5] dark:bg-[#2d5a44]/40 text-[#2d5a44] dark:text-[#a8d0b0]";
  }
  // Default ("Other" or anything unmapped) — neutral stone tone so it
  // doesn't claim any category-specific color identity. Reads as
  // "this note is uncategorized" rather than "this note is sage."
  return "bg-stone-100 dark:bg-stone-700/40 text-stone-700 dark:text-stone-300";
};

/**
 * Text-only category color — for places where we want the category's
 * visual identity but no pill background (e.g. the modal's top strip
 * crumb line, where badges with backgrounds would compete with
 * surrounding chrome). Mirrors getCategoryBadgeClass color choices
 * so the text color matches what the user sees in the body pill.
 *
 * Each value uses a saturated tone for light theme and a softened
 * version for dark theme, so the category reads clearly on both.
 * Critically, these tones also work over user-colored note
 * backgrounds (yellow/peach/blush) because they're saturated text
 * on transparent surface — no background tint to clash with the
 * note's own color.
 */
const getCategoryTextClass = (category?: string): string => {
  const cat = (category || "").toLowerCase();
  if (cat.includes("task") || cat.includes("todo") || cat.includes("to-do")) {
    return "text-[#2d5a44] dark:text-[#a8d0b0]";
  }
  if (cat.includes("personal") || cat.includes("journal")) {
    return "text-violet-700 dark:text-violet-300";
  }
  if (
    cat.includes("reminder") ||
    cat.includes("event") ||
    cat.includes("appointment")
  ) {
    return "text-orange-700 dark:text-orange-300";
  }
  if (cat.includes("web") || cat.includes("article") || cat.includes("link")) {
    return "text-sky-700 dark:text-sky-300";
  }
  if (
    cat.includes("credential") ||
    cat.includes("password") ||
    cat.includes("auth")
  ) {
    return "text-rose-700 dark:text-rose-300";
  }
  if (cat.includes("idea") || cat.includes("note")) {
    return "text-amber-700 dark:text-amber-300";
  }
  if (cat.includes("meeting")) {
    return "text-[#2d5a44] dark:text-[#a8d0b0]";
  }
  // Default — neutral stone, so unmapped categories don't claim a
  // misleading color identity.
  return "text-stone-700 dark:text-stone-300";
};

/**
 * Estimate reading time from text length. Uses 230 words/minute (the
 * documented average for adult readers on a screen). Returns "< 1 min"
 * for very short notes so we never say "0 min" or "1 min" when the
 * content is two sentences.
 */
const estimateReadingTime = (text: string): string => {
  if (!text) return "< 1 min";
  // Word count via whitespace split is good enough for this purpose;
  // it's slightly imprecise on dense punctuation but never off by enough
  // to matter for a reading-time hint.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.ceil(words / 230);
  if (minutes <= 0) return "< 1 min";
  if (minutes === 1) return "1 min read";
  return `${minutes} min read`;
};

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  autoSortEnabled: boolean;
  // When true, notes that contain passwords, API keys, credentials,
  // or other sensitive patterns are automatically locked with the
  // biometric/account-password flow after AI sorting. Replaces the
  // old "sensitive data detected" alert banner.
  autoLockSensitiveNotes: boolean;
  /** BCP 47 language tag (e.g. "en-US", "fr-FR", "es-ES").
   *  Used for: (1) voice-to-text recognition language,
   *  (2) AI prompt instruction so Magic Sort responds in this language. */
  defaultLanguage?: string;
  createdAt: Timestamp | any;
  role?: "admin" | "user";
}

// --- Constants ---

/**
 * Supported languages for voice-to-text and AI responses.
 * BCP 47 language tags. Selected for broad Web Speech API coverage
 * across Chrome / Edge / Safari, plus regional variants for users
 * outside the US/UK. Keep this curated rather than exhaustive —
 * a 200-item dropdown is worse UX than a focused list.
 */
const SUPPORTED_LANGUAGES: {
  code: string;
  label: string;
  nativeLabel: string;
}[] = [
  {
    code: "en-US",
    label: "English (United States)",
    nativeLabel: "English (US)",
  },
  {
    code: "en-GB",
    label: "English (United Kingdom)",
    nativeLabel: "English (UK)",
  },
  {
    code: "en-NG",
    label: "English (Nigeria)",
    nativeLabel: "English (Nigeria)",
  },
  { code: "en-IN", label: "English (India)", nativeLabel: "English (India)" },
  {
    code: "en-AU",
    label: "English (Australia)",
    nativeLabel: "English (Australia)",
  },
  { code: "en-CA", label: "English (Canada)", nativeLabel: "English (Canada)" },
  { code: "es-ES", label: "Spanish (Spain)", nativeLabel: "Español (España)" },
  { code: "es-MX", label: "Spanish (Mexico)", nativeLabel: "Español (México)" },
  { code: "fr-FR", label: "French (France)", nativeLabel: "Français" },
  { code: "fr-CA", label: "French (Canada)", nativeLabel: "Français (Canada)" },
  { code: "de-DE", label: "German", nativeLabel: "Deutsch" },
  { code: "it-IT", label: "Italian", nativeLabel: "Italiano" },
  {
    code: "pt-BR",
    label: "Portuguese (Brazil)",
    nativeLabel: "Português (Brasil)",
  },
  {
    code: "pt-PT",
    label: "Portuguese (Portugal)",
    nativeLabel: "Português (Portugal)",
  },
  { code: "nl-NL", label: "Dutch", nativeLabel: "Nederlands" },
  { code: "sv-SE", label: "Swedish", nativeLabel: "Svenska" },
  { code: "ar-SA", label: "Arabic (Saudi Arabia)", nativeLabel: "العربية" },
  { code: "ar-EG", label: "Arabic (Egypt)", nativeLabel: "العربية (مصر)" },
  { code: "hi-IN", label: "Hindi", nativeLabel: "हिन्दी" },
  {
    code: "zh-CN",
    label: "Chinese (Mandarin, Simplified)",
    nativeLabel: "中文 (简体)",
  },
  { code: "zh-TW", label: "Chinese (Traditional)", nativeLabel: "中文 (繁體)" },
  { code: "ja-JP", label: "Japanese", nativeLabel: "日本語" },
  { code: "ko-KR", label: "Korean", nativeLabel: "한국어" },
  { code: "ru-RU", label: "Russian", nativeLabel: "Русский" },
  { code: "tr-TR", label: "Turkish", nativeLabel: "Türkçe" },
  { code: "pl-PL", label: "Polish", nativeLabel: "Polski" },
  { code: "id-ID", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
  { code: "th-TH", label: "Thai", nativeLabel: "ไทย" },
  { code: "vi-VN", label: "Vietnamese", nativeLabel: "Tiếng Việt" },
];

/** Map a BCP 47 code to its label for use in AI prompts. */
const languageLabel = (code: string | undefined): string => {
  if (!code) return "English";
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === code);
  return found ? found.label : "English";
};

const detectSensitiveData = (content: string): boolean => {
  // Common patterns for actual keys/secrets. We use two passes:
  //   strong patterns (always credential) and
  //   loose patterns (only credential when keyword nearby).
  // The loose threshold is 12+ chars because the user's actual
  // password like "louroersa4q74qiouiq4" (20 chars) was being
  // missed by the previous 32-char floor. 12 is short enough to
  // catch most real passwords while long enough to skip casual
  // words like "password is hunter2".
  const patterns = [
    /[a-zA-Z0-9]{12,}/, // Long alphanumeric strings (passwords, keys)
    /AIza[0-9A-Za-z-_]{35}/, // Google API Key pattern
    /sk-[a-zA-Z0-9]{20,}/, // OpenAI/Stripe style keys
    /gh[oprs]_[a-zA-Z0-9]{36}/, // GitHub tokens
    /ey[a-zA-Z0-9-_]+\.ey[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/, // JWT pattern
  ];

  const sensitiveKeywords = [
    "password",
    "pwd",
    "secret",
    "login",
    "credentials",
    "api_key",
    "apikey",
    "private key",
    "secret key",
    "access token",
    "auth token",
    "passphrase",
    "credit card",
    "cvv",
    "pin code",
  ];

  // Phrases that indicate it's just an error log or documentation, not a real key
  const exclusionPhrases = [
    "api key not valid",
    "invalid api key",
    "please pass a valid api key",
    "missing api key",
    "error: apierror",
    "failed to load resource",
    "status: 400",
    "status: 401",
    "status: 403",
  ];

  const lowerContent = content.toLowerCase();

  // If it contains exclusion phrases, it's likely a log or error message about a key, not the key itself
  if (exclusionPhrases.some((phrase) => lowerContent.includes(phrase))) {
    // Still check if there's a long string that looks like a real key despite the error message
    return patterns.some((pattern) => pattern.test(content));
  }

  const hasKeyword = sensitiveKeywords.some((keyword) =>
    lowerContent.includes(keyword),
  );
  const hasPattern = patterns.some((pattern) => pattern.test(content));

  // To reduce false positives, require BOTH a keyword and a pattern
  // to be present. Exception: if there's a strong pattern match (JWT,
  // API key format) without context, still flag it — a 40-char
  // alphanumeric string is almost always a credential.
  // This means "remember your password" won't trigger, but
  // "password: abc123..." will.
  if (hasKeyword && hasPattern) return true;
  
  // Standalone strong patterns (JWT, known API key formats) trigger
  // even without keywords since they're unambiguous.
  const strongPatterns = [
    /AIza[0-9A-Za-z-_]{35}/, // Google API Key
    /sk-[a-zA-Z0-9]{20,}/, // OpenAI/Stripe
    /gh[oprs]_[a-zA-Z0-9]{36}/, // GitHub tokens
    /ey[a-zA-Z0-9-_]+\.ey[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/, // JWT
  ];
  if (strongPatterns.some((pattern) => pattern.test(content))) return true;

  return false;
};

/**
 * Client-side fallback to mask sensitive values in a note's content.
 * Used when the AI didn't generate a maskedContent field, so the
 * Reveal/Hide toggle has *something* to switch between. We mask:
 *   - Lines that contain a credential keyword (password, secret,
 *     api_key, ...) followed by a colon/equals/dash separator
 *     and a value — the value after the separator gets redacted.
 *   - Standalone strong patterns (JWT, known API key formats).
 * Other lines are left untouched.
 */
const maskSensitiveData = (content: string): string => {
  if (!content) return content;
  const credentialKeywords = [
    "password",
    "pwd",
    "passphrase",
    "secret",
    "api_key",
    "apikey",
    "api key",
    "access token",
    "auth token",
    "authentication token",
    "private key",
    "secret key",
    "credentials",
    "credential",
    "cvv",
    "pin code",
    "pin",
  ];

  const maskValue = (v: string): string => {
    const trimmed = v.trim();
    if (!trimmed) return v;
    // Keep first 2 + last 2 chars for very long values (gives
    // a hint that the value IS there), otherwise fully mask.
    if (trimmed.length > 8) {
      return `${trimmed.slice(0, 2)}${"•".repeat(8)}${trimmed.slice(-2)}`;
    }
    return "•".repeat(Math.max(6, trimmed.length));
  };

  return content
    .split("\n")
    .map((line) => {
      const lower = line.toLowerCase();
      // Check if this line has a credential keyword + separator
      // (colon, equals, dash) followed by a value. This pattern
      // matches "Password: abc123", "API_KEY = xyz", "Secret - foo".
      const hasCredentialPattern = credentialKeywords.some((kw) => {
        // Build a regex that looks for the keyword followed by
        // optional whitespace, a separator, and then a value.
        const pattern = new RegExp(
          `\\b${kw.replace(/\s+/g, "[\\s_-]*")}\\s*[:=\\-]\\s*.+`,
          "i",
        );
        return pattern.test(line);
      });

      if (hasCredentialPattern) {
        // Mask everything AFTER the first colon/equals/dash.
        // Handle bullet points (•, *, -) and numbered lists at
        // the start of the line.
        return line.replace(
          /^(\s*[•\-*]?\s*[^:=\-\n]+\s*[:=\-]\s*)(.+)$/,
          (_m, prefix, value) => `${prefix}${maskValue(value)}`,
        );
      }

      // No credential keyword — mask only standalone strong patterns
      return line
        .replace(/AIza[0-9A-Za-z\-_]{35}/g, "[REDACTED]")
        .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED]")
        .replace(/gh[oprs]_[a-zA-Z0-9]{36}/g, "[REDACTED]")
        .replace(
          /ey[a-zA-Z0-9\-_]+\.ey[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+/g,
          "[REDACTED]",
        );
    })
    .join("\n");
};

// Client-side category detection for real-time "smart trigger" feedback
const detectCategory = (
  content: string,
): { label: string; color: string; bg: string } | null => {
  if (!content || content.length < 3) return null;
  const lower = content.toLowerCase();

  // URL detection → Web Content
  if (/https?:\/\/\S+/i.test(content)) {
    return {
      label: "Web Content",
      color: "#0284c7",
      bg: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300",
    };
  }
  // Credentials — require BOTH a keyword AND a pattern that looks
  // like an actual credential value (long alphanumeric string, JWT,
  // known API key format). Just the word "password" alone shouldn't
  // trigger "Credential" — the user might be writing about password
  // management, not pasting an actual credential.
  const credKeywords = /password\s*[:=]|api[\s_-]?key\s*[:=]|secret[\s_-]?key\s*[:=]|access[\s_-]?token\s*[:=]|passphrase\s*[:=]/i;
  const credPatterns = /[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{10,}|AIza[a-zA-Z0-9_-]{30,}|gh[oprs]_[a-zA-Z0-9]{20,}/;
  if (credKeywords.test(lower) && credPatterns.test(content)) {
    return {
      label: "Credential",
      color: "#f43f5e",
      bg: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
    };
  }
  // Task triggers
  if (
    /^todo[s]?:|^task[s]?:|remember to|need to|don't forget|[-*]\s*\[\s*\]/im.test(
      content,
    ) ||
    /^(buy|call|email|finish|complete|send|review|update)\s/i.test(lower)
  ) {
    return {
      label: "Task",
      color: "#2d5a44",
      bg: "bg-[#d2e8d5] dark:bg-[#2d5a44]/40 text-[#2d5a44] dark:text-[#a8d0b0]",
    };
  }
  // Meeting
  if (
    /meeting|agenda|attendees|action items|follow[\s-]?up|sync[\s-]?up|standup/i.test(
      lower,
    )
  ) {
    return {
      label: "Meeting",
      color: "#2d5a44",
      bg: "bg-[#d2e8d5] dark:bg-[#2d5a44]/40 text-[#2d5a44] dark:text-[#a8d0b0]",
    };
  }
  // Ideas
  if (
    /^idea[s]?:|^thought[s]?:|what if|thinking about|brainstorm|concept:/i.test(
      lower,
    )
  ) {
    return {
      label: "Idea",
      color: "#f59e0b",
      bg: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    };
  }
  return null;
};

// Paired header + placeholder prompts that rotate together to tell a cohesive brand story.
// Each entry represents one "mood" — the header and placeholder are designed to feel like
// a single conversation with the user.
const CAPTURE_PROMPTS: { header: string; placeholder: string }[] = [
  {
    header: "What's on your mind?",
    placeholder: "Just start typing — we'll sort out the chaos...",
  },
  {
    header: "Unload your thoughts",
    placeholder: "Dump it all here. We'll turn the mess into magic...",
  },
  {
    header: "Capture the spark",
    placeholder: "Raw ideas, half-thoughts, brilliant flashes — all welcome...",
  },
  {
    header: "Clear your head",
    placeholder: "Empty your mental cache. We'll organize the rest...",
  },
  {
    header: "Notes, meet paper",
    placeholder: "Pour it out. Structure is our job, not yours...",
  },
  {
    header: "Think out loud",
    placeholder: "Say it how you'd say it. We'll make it make sense...",
  },
  {
    header: "Whatever's rattling around",
    placeholder: "Big ideas, tiny reminders, random musings — type freely...",
  },
  {
    header: "Drop it here",
    placeholder: "No pressure, no format. Just your thoughts, captured...",
  },
  {
    header: "Speak your mind",
    placeholder: "Talk to me like I'm your future self. I'll remember...",
  },
  {
    header: "The unfiltered version",
    placeholder: "Messy is fine. Chaotic is welcome. Clarity comes later...",
  },
];

const PLACEHOLDERS = CAPTURE_PROMPTS.map((p) => p.placeholder);

// --- Components ---

const CategoryIcon = ({
  category,
  className,
}: {
  category: string;
  className?: string;
}) => {
  switch (category) {
    case "Task":
      return <CheckCircle2 className={cn("text-emerald-500", className)} />;
    case "Idea":
      return <Lightbulb className={cn("text-amber-500", className)} />;
    case "Credential":
      return <Key className={cn("text-emerald-500", className)} />;
    case "Web Content":
      return <Globe className={cn("text-blue-500", className)} />;
    case "Personal":
      return <UserIcon className={cn("text-purple-500", className)} />;
    default:
      return <Brain className={cn("zk-text-faint", className)} />;
  }
};

/**
 * Tailwind bg-color class for a category's accent dot. Used in the
 * sidebar's categories section where the mockup specifies a 2px
 * colored dot rather than a Lucide icon. Same color identity as the
 * card preview's category stripe so the visual language carries
 * across surfaces. Defaults to gray for unknowns.
 */
const getCategoryDotClass = (category: string): string => {
  const cat = category.toLowerCase();
  if (cat === "task" || cat.includes("todo")) return "bg-emerald-400";
  if (cat === "idea") return "bg-amber-400";
  if (cat === "credential" || cat.includes("password")) return "bg-teal-400";
  if (cat === "web content" || cat.includes("article") || cat.includes("link"))
    return "bg-indigo-400";
  if (cat === "personal" || cat.includes("journal")) return "bg-pink-400";
  if (cat.includes("reminder")) return "bg-orange-400";
  if (cat === "other" || cat === "uncategorized") return "bg-gray-400";
  return "bg-gray-400";
};

// Import the Firebase configuration
import firebaseConfig from "../firebase-applet-config.json";

// ===== Drag-and-drop helper components =====

// Wraps a note card to make it draggable + sortable
function SortableNoteWrapper({
  id,
  isSelected,
  children,
  disabled,
  staleness = 0,
}: {
  id: string;
  isSelected: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  staleness?: number; // 0 (fresh) to 1 (very old, not actioned)
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  // Map staleness 0..1 to a visible-but-faded range. Old unactioned notes
  // recede so fresh items pop. Hover restores full opacity.
  const baseOpacity = isDragging ? 0.4 : 1 - staleness * 0.45;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // No transition during drag — cards snap to their new positions
    // instead of sliding. The reflow animation that dnd-kit applies by
    // default makes drags feel laggy; per-user feedback, instant feels
    // better. We keep ONLY the opacity fade for staleness/dragging
    // visual feedback, since that's a state cue (not motion).
    transition: "opacity 200ms ease-out",
    opacity: baseOpacity,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onMouseEnter={(e) => {
        if (staleness > 0) {
          (e.currentTarget as HTMLDivElement).style.opacity = isDragging
            ? "0.4"
            : "1";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.opacity = String(baseOpacity);
      }}
      className={cn(
        "relative",
        isSelected &&
          "ring-2 ring-[#2d5a44] ring-offset-2 ring-offset-[#f4f7f2] dark:ring-offset-[#202124] rounded-2xl",
      )}
    >
      {children}
    </div>
  );
}

/**
 * Compute a staleness factor (0 = fresh, 1 = very stale) for a note.
 * Pinned, starred, and recently-updated notes are always 0.
 * Notes without open tasks decay slower than notes WITH open tasks
 * (an unactioned task list IS the kind of thing we want to gently surface).
 */
function computeNoteStaleness(note: Note): number {
  if (note.isPinned || note.isStarred) return 0;
  const updatedMs =
    note.updatedAt instanceof Timestamp
      ? note.updatedAt.toMillis()
      : note.createdAt instanceof Timestamp
        ? note.createdAt.toMillis()
        : Date.now();
  const ageDays = (Date.now() - updatedMs) / (1000 * 60 * 60 * 24);
  if (ageDays < 30) return 0;
  // Linear ramp from day 30 to day 120, then plateau at 1
  return Math.min(1, (ageDays - 30) / 90);
}

// Droppable sidebar item — lets notes be dragged onto it
function DroppableSidebarItem({
  id,
  isOver,
  children,
}: {
  id: string;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver: hovered } = useDroppable({ id });
  const active = isOver || hovered;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative transition-all rounded-xl",
        active &&
          "ring-2 ring-[#2d5a44] ring-offset-1 ring-offset-[#f9faf7] dark:ring-offset-[#202124] bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/40",
      )}
    >
      {children}
      {active && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <span
            className="px-2 py-0.5 zk-bg-primary text-white text-[10px] font-bold rounded-full shadow-md"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Drop here
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MasonryGrid — Google Keep / Pinterest-style packed grid
   ============================================================
   Why we need this:
   - CSS grid with `auto-rows-max items-start` still aligns each row to the
     same baseline within a row, so a 50-line note next to a 2-line note
     leaves the short side empty.
   - CSS multi-column (`column-count`) lays out top-to-bottom in column 1,
     THEN column 2 — which breaks chronological left-to-right reading.

   What we do:
   - Split children round-robin across N columns based on viewport width.
     Card index `i` goes into column `i % N`. This preserves chronological
     order across columns (newest → top-left, then top-of-col2, etc.) while
     letting each column flow naturally to its own height.
   - Re-measure column count on resize so masonry adapts to window width.

   Tradeoffs vs. height-aware masonry (smallest-column-first):
   - Round-robin doesn't always pack as tight. But it's deterministic,
     stable across re-renders, and doesn't require measuring DOM heights
     (which is expensive for large note lists).
   - Adjacent notes tend to have similar lengths anyway, so visual density
     in practice is close to optimal.
   ============================================================ */
/* ============================================================
   Expanded-card context
   ============================================================
   The masonry packs cards then identifies columns that ended noticeably
   shorter than the tallest column. For each short column, the LAST card
   (the one nearest the gap) is marked "expanded" — its line-clamp drops
   so the full content shows, filling the void. This is opt-in per card
   and changes only the body text height, never the layout dimensions.

   We use a context (instead of a prop drill) because cards live deep in
   render trees behind SortableNoteWrappers and AnimatePresence wrappers
   that don't forward arbitrary props. A context is a single read on each
   card, no plumbing.
   ============================================================ */
const ExpandedCardsContext = React.createContext<Set<string>>(new Set());

/** Renders the body preview text with line-clamp. When this card has been
 *  marked expanded by the masonry (because it's the last card in a short
 *  column), the clamp is removed so the full content shows. The
 *  containing column grows to match — filling what would otherwise be a
 *  visible void at the bottom of the grid. */
function CardBodyText({
  noteId,
  text,
}: {
  noteId: string;
  text: string;
}) {
  const expanded = React.useContext(ExpandedCardsContext);
  const isExpanded = expanded.has(noteId);
  return (
    <p
      className={cn(
        "text-[#6b746f] dark:text-[#d4d8d3] leading-relaxed text-[13px] whitespace-pre-line",
        // Standard cards clamp to 8 lines so they stay roughly comparable
        // across the grid. Expanded cards drop the clamp entirely so they
        // can grow into a column-bottom gap. Cap at 32 lines so we never
        // produce something absurdly long for a single piece of content
        // (otherwise a 5,000-word note would fill the entire viewport).
        isExpanded ? "line-clamp-[32]" : "line-clamp-[8]",
      )}
      style={{ fontFamily: "'Manrope', sans-serif" }}
    >
      {text}
    </p>
  );
}

function MasonryGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [columnCount, setColumnCount] = useState(() => {
    if (typeof window === "undefined") return 1;
    return computeColumnCount(window.innerWidth);
  });

  // Live height map: card key → measured pixel height. Populated by a
  // ResizeObserver attached to each card wrapper. Once a card is
  // measured, subsequent reflows use the real height instead of the
  // heuristic estimate. Keyed off React keys so we don't lose data
  // when an unrelated card is added/removed.
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<string, number>
  >({});
  const measurementRef = useRef<Record<string, number>>({});
  measurementRef.current = measuredHeights;

  useEffect(() => {
    const onResize = () => {
      const w = wrapperRef.current?.clientWidth ?? window.innerWidth;
      setColumnCount(computeColumnCount(w));
      // Width change invalidates heights — a card that's 200px tall in a
      // 4-col layout becomes 320px in 2-col. Wipe measurements so the
      // ResizeObserver re-records as cards re-render.
      setMeasuredHeights({});
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Peel single-child wrappers (AnimatePresence/Fragment) so we see the
  // real card array, not one wrapper in column 0.
  let items = React.Children.toArray(children);
  if (items.length === 1) {
    const only = items[0] as React.ReactElement;
    const inner = (only.props as { children?: React.ReactNode } | undefined)
      ?.children;
    if (inner !== undefined && inner !== null) {
      items = React.Children.toArray(inner);
    }
  }

  // ============================================================
  // Smallest-column-first packing with measured heights
  // ============================================================
  // Strategy:
  //   1. For each card, look up its measured height. If none yet, fall
  //      back to the heuristic estimate so the first paint isn't blank.
  //   2. Place each card into whichever column is currently shortest.
  //   3. ResizeObserver fires after paint, fills in real heights, and
  //      triggers a reflow with accurate data — eliminating the gaps
  //      that come from heuristic drift.
  //
  // This means a tiny "settle" can happen on first load: rough layout →
  // ~16ms later → tight layout. In practice users perceive the second
  // pass as the only one. Reflows on subsequent renders (filtering,
  // adding notes) are gap-free because measurements are already cached.
  const columns: React.ReactNode[][] = Array.from(
    { length: columnCount },
    () => [],
  );
  const colHeights: number[] = new Array(columnCount).fill(0);
  // Track the key of the LAST card placed into each column. If a column
  // ends short of the tallest column by enough, we mark that last card
  // as "expanded" so its body text grows to fill the gap.
  const colLastKey: (string | null)[] = new Array(columnCount).fill(null);

  for (const item of items) {
    // Pick the shortest column. Tie-break left-to-right so chronological
    // order is preserved among equal-height columns (newest stays top-left).
    let target = 0;
    for (let c = 1; c < columnCount; c++) {
      if (colHeights[c] < colHeights[target]) target = c;
    }
    const key = (item as React.ReactElement)?.key as string | null;
    const measured = key ? measuredHeights[key] : undefined;
    const h = measured ?? estimateCardHeight(item);
    columns[target].push(
      <MasonryItem
        key={key ?? undefined}
        itemKey={key ?? ""}
        onMeasure={(measuredKey, height) => {
          // Only update state if the height meaningfully changed. Avoids
          // a feedback loop where small sub-pixel jitter causes endless
          // reflows. 4px tolerance is well below human perception but
          // above typical browser sub-pixel rounding.
          const prev = measurementRef.current[measuredKey];
          if (prev === undefined || Math.abs(prev - height) > 4) {
            setMeasuredHeights((m) => ({ ...m, [measuredKey]: height }));
          }
        }}
      >
        {item}
      </MasonryItem>,
    );
    colHeights[target] += h;
    if (key) colLastKey[target] = key;
  }

  // Compute which cards should expand to fill column-bottom gaps.
  //
  // The tallest column anchors the visible bottom of the grid. Every
  // column shorter than (tallest − GAP_TOLERANCE) has a real visible gap
  // worth filling. For each such column, the last placed card is a good
  // candidate — it sits closest to the gap, so growing it pushes nothing
  // around. Cards in the only-or-tallest column are NOT expanded; they're
  // already pinning the bottom.
  //
  // GAP_TOLERANCE = 120px. Below that, the void isn't worth the visual
  // inconsistency of one card being arbitrarily taller than its peers.
  const expandedKeys = useMemo(() => {
    const expanded = new Set<string>();
    if (columnCount <= 1) return expanded; // single-column = no gap to fill
    const maxH = Math.max(...colHeights);
    const GAP_TOLERANCE = 120;
    for (let c = 0; c < columnCount; c++) {
      const gap = maxH - colHeights[c];
      if (gap >= GAP_TOLERANCE && colLastKey[c]) {
        expanded.add(colLastKey[c]!);
      }
    }
    return expanded;
    // colHeights/colLastKey are derived from items + measuredHeights, so
    // those plus columnCount are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, measuredHeights, columnCount]);

  return (
    <ExpandedCardsContext.Provider value={expandedKeys}>
      <div
        ref={wrapperRef}
        className={cn("grid gap-4 items-start", className)}
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        }}
      >
        {columns.map((col, i) => (
          <div key={i} className="flex flex-col gap-4">
            <AnimatePresence mode="popLayout">{col}</AnimatePresence>
          </div>
        ))}
      </div>
    </ExpandedCardsContext.Provider>
  );
}

/**
 * Wrapper that measures its own rendered height after paint. We use a
 * ResizeObserver instead of useLayoutEffect+getBoundingClientRect because
 * note cards' heights change AFTER mount (images load, fonts swap,
 * line-clamps settle) and we want to keep packing accurate through all
 * of that. The observer fires on every change cheaply.
 */
function MasonryItem({
  children,
  itemKey,
  onMeasure,
}: {
  children: React.ReactNode;
  itemKey: string;
  onMeasure: (key: string, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !itemKey) return;
    // Measure once on mount, then on every size change. The observer
    // delivers the latest size, so multiple rapid changes coalesce.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        if (height > 0) onMeasure(itemKey, height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemKey, onMeasure]);
  return <div ref={ref}>{children}</div>;
}

/**
 * Estimate the rendered height of a card child without measuring the DOM.
 * Walks the props tree looking for the actual note data and computes a
 * rough pixel estimate from content length, presence of image, checklist
 * items, etc. Doesn't need to be exact — it just needs to be RELATIVELY
 * accurate so "smallest-column-first" picks the right column.
 *
 * Default ~280px (a typical short note card with title + a few lines).
 * Each ~80 chars adds ~22px (one line of text at our line-height).
 * Checklist items add more vertical real estate per item.
 */
function estimateCardHeight(node: React.ReactNode): number {
  // Try to find a `data-recall-height` prop set by the caller, or fall
  // back to inspecting props for a `note` object.
  const el = node as React.ReactElement | undefined;
  if (!el || typeof el !== "object") return 280;
  const props = (el.props as any) || {};
  // Caller can pass an explicit hint to skip estimation entirely
  if (typeof props["data-recall-height"] === "number") {
    return props["data-recall-height"];
  }
  // Walk one level deep for the note object — note cards typically pass
  // it as a prop or have it nested inside SortableNoteWrapper.
  const note = props.note || props.children?.props?.note;
  if (!note) return 280;
  const content: string =
    note.maskedContent || note.content || note.rawContent || "";
  const titleLen = (note.title || "").length;
  let h = 90; // base padding + title row
  h += Math.ceil(titleLen / 30) * 24; // additional title lines if long
  h += Math.min(Math.ceil(content.length / 80) * 22, 22 * 14); // capped at ~14 lines (note cards line-clamp)
  if (note.tags && note.tags.length > 0) h += 32; // tag row
  if (note.hasSensitiveData) h += 8; // banner padding
  if (/\!\[.*\]\(/.test(content)) h += 200; // markdown image
  return h;
}

/** Pick column count by container/viewport width. Mirrors the classic Keep
 *  responsiveness: dense packing on wide screens, single column on phones. */
function computeColumnCount(width: number): number {
  if (width < 640) return 1; // sm
  if (width < 900) return 2; // md
  if (width < 1280) return 3; // lg
  if (width < 1680) return 4; // xl
  return 5; // 2xl+
}

/* ============================================================
   ReminderBadge — visual treatment for notes with reminder data
   ============================================================
   Renders an inline mini-card BELOW the note title showing:
     - the subject ("Water the basil")
     - the schedule line ("Every Wednesday · 8:00 AM · Home")
     - a W/T/F/S/S/M/T pill row with active days filled
   The badge appears on the regular note card alongside the rest of the
   content, so the reminder is visible when scanning the grid without
   demanding its own dedicated screen or notification permission.
   ============================================================ */

function ReminderBadge({
  reminder,
}: {
  reminder: Reminder;
}) {
  // Day-of-week pill row. The order is Sun-Mon-Tue-Wed-Thu-Fri-Sat to
  // match JS Date.getDay() — this is the convention the parser uses.
  // Active days get a sage fill; inactive days get a faint gray pill so
  // the row reads as a calendar at a glance.
  const dayOrder: number[] = [0, 1, 2, 3, 4, 5, 6];
  // For weekly reminders show all 7 pills with active ones filled. For
  // one-shot reminders (no weekday set) we hide the pill row entirely —
  // it'd be misleading to show day pills when no day pattern applies.
  const showDays =
    reminder.recurrence === "weekly" ||
    reminder.recurrence === "weekdays" ||
    reminder.recurrence === "weekends" ||
    reminder.recurrence === "daily";
  const activeDays = new Set(reminder.days || []);

  return (
    <div
      // Material Design 3 — tertiary-container palette (warm/notification).
      //   Light: surface #FFEDEA, on-surface #3E2723, outline #FFCDD2
      //   Dark:  surface #3E2723, on-surface #FFCDD2, outline #5D4037
      // Active day pill uses Material's "primary" sage (existing brand
      // primary, deepened slightly for AA contrast on the warm surface).
      className="mt-2 mb-3 px-3 py-2.5 rounded-xl bg-[#FFEDEA] dark:bg-[#3E2723] border border-[#FFCDD2] dark:border-[#5D4037]"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <p className="text-[13px] font-bold text-[#3E2723] dark:text-[#FFCDD2] leading-tight">
        {reminder.subject}
      </p>
      <p className="text-[11px] text-[#5D4037] dark:text-[#FFAB91] mt-0.5 leading-tight">
        {formatReminderSchedule(reminder)}
      </p>
      {showDays && (
        <div className="flex items-center gap-1 mt-2">
          {dayOrder.map((d) => {
            const isActive = activeDays.has(d);
            return (
              <span
                key={d}
                className={cn(
                  "w-6 h-6 flex items-center justify-center rounded-md text-[10px] font-bold transition-colors",
                  isActive
                    ? // Active = filled. Sage on light, brand-tertiary on dark.
                      "bg-[#1f4534] text-white dark:bg-[#FFAB91] dark:text-[#3E2723]"
                    : // Inactive = subtle, blends with the warm surface.
                      "bg-white/60 dark:bg-black/20 text-[#8D6E63] dark:text-[#5D4037]",
                )}
              >
                {dayInitial(d as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TodaysFocus — ADHD "what should I do now?"
   Scans all notes, surfaces the top 3 most actionable items.
   Scoring signals:
   - Pinned notes with open tasks (highest priority)
   - Urgency keywords in content (urgent, asap, today, deadline, due)
   - Recency (last 7 days = fresh)
   - Open task count (more open = more salient)
   ============================================================ */
const URGENCY_WORDS =
  /\b(urgent|asap|today|tomorrow|deadline|due|overdue|priority)\b/i;

interface FocusItem {
  note: Note;
  taskLine: string; // the original line as it appears in content (for replacement)
  taskText: string; // clean display text without "- [ ]"
  score: number;
  isUrgent: boolean;
  isPinned: boolean;
}

function TodaysFocus({
  notes,
  onOpenNote,
  onCompleteTask,
}: {
  notes: Note[];
  onOpenNote: (n: Note) => void;
  onCompleteTask: (noteId: string, taskLine: string) => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const stored = localStorage.getItem("zakar_focus_dismissed");
    if (!stored) return new Set();
    try {
      const arr = JSON.parse(stored) as string[];
      return new Set(arr);
    } catch {
      return new Set();
    }
  });
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("zakar_focus_collapsed") === "true";
  });
  // "Just one thing" mode — strips the list to the single highest-priority
  // item. For ADHD users who need zero choice. Persists across sessions.
  const [oneThingMode, setOneThingMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("zakar_focus_one_thing") === "true";
  });

  // Persist dismissed set
  useEffect(() => {
    localStorage.setItem(
      "zakar_focus_dismissed",
      JSON.stringify(Array.from(dismissed)),
    );
  }, [dismissed]);

  useEffect(() => {
    localStorage.setItem("zakar_focus_collapsed", String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    localStorage.setItem("zakar_focus_one_thing", String(oneThingMode));
  }, [oneThingMode]);

  // Reset dismissals at midnight so tasks reappear fresh the next day
  useEffect(() => {
    const lastReset = localStorage.getItem("zakar_focus_last_reset");
    const today = new Date().toDateString();
    if (lastReset !== today) {
      setDismissed(new Set());
      localStorage.setItem("zakar_focus_last_reset", today);
    }
  }, []);

  const items = React.useMemo<FocusItem[]>(() => {
    const now = Date.now();
    const candidates: FocusItem[] = [];

    // Tolerant open-checkbox regex: matches `[ ]`, `[  ]`, `[]`, tabs, etc.
    // Captures only truly unchecked boxes (not [x] / [X])
    const OPEN_TASK_RE = /^(\s*)[-*]\s*\[[\s]*\](?!\()/;

    for (const note of notes) {
      if (note.isTrashed || note.isArchived) continue;

      // Prefer rawContent for task detection (pre-AI-mask) so we catch tasks
      // even when sensitive data masking is active.
      const content = note.rawContent || note.content || "";
      const lines = content.split("\n");
      const openTaskLines = lines.filter((l) => OPEN_TASK_RE.test(l));
      if (openTaskLines.length === 0) continue;

      // Use the first open task as the displayed one
      const firstTask = openTaskLines[0];
      const taskText = firstTask
        .replace(/^(\s*)[-*]\s*\[[\s]*\]\s*/, "")
        .replace(/\*\*/g, "")
        .trim();
      if (!taskText) continue;

      const dismissKey = `${note.id}::${firstTask}`;
      if (dismissed.has(dismissKey)) continue;

      const isUrgent =
        URGENCY_WORDS.test(content) || URGENCY_WORDS.test(taskText);
      const isPinned = !!note.isPinned;
      const updatedMs =
        note.updatedAt instanceof Timestamp
          ? note.updatedAt.toMillis()
          : note.createdAt instanceof Timestamp
            ? note.createdAt.toMillis()
            : now;
      const ageDays = (now - updatedMs) / (1000 * 60 * 60 * 24);

      // Score: higher = more surfaced
      let score = 0;
      if (isPinned) score += 50;
      if (isUrgent) score += 40;
      score += Math.min(openTaskLines.length * 3, 20); // cap influence
      if (ageDays < 1) score += 15;
      else if (ageDays < 3) score += 10;
      else if (ageDays < 7) score += 5;
      else if (ageDays > 30) score -= 5; // stale

      candidates.push({
        note,
        taskLine: firstTask,
        taskText,
        score,
        isUrgent,
        isPinned,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, oneThingMode ? 1 : 3);
  }, [notes, dismissed, oneThingMode]);

  if (items.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 max-w-3xl mx-auto w-full"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[#2d5a44] dark:text-[#8fb89a]" />
          <h3
            className="text-[11px] font-bold uppercase tracking-[0.18em] zk-text-secondary dark:zk-text-muted"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {oneThingMode ? "Just this one thing" : "Today's focus"}
          </h3>
          {!oneThingMode && (
            <span className="text-[10px] font-medium zk-text-faint dark:zk-text-muted">
              {items.length} {items.length === 1 ? "thing" : "things"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOneThingMode(!oneThingMode)}
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md transition-all active:scale-95",
              oneThingMode
                ? "bg-[#c6e3ca] text-[#2c3d30] dark:bg-[#3d5142] dark:text-[#a8c9ac] ring-1 ring-[#2d5a44]/20 dark:ring-[#6b8f72]/30"
                : "zk-text-faint hover:zk-text-secondary dark:zk-text-muted dark:hover:zk-text",
            )}
            title={
              oneThingMode
                ? "Show top 3 instead"
                : "Just one thing — reduce to the single most important task"
            }
          >
            {oneThingMode ? "Show all" : "Just one"}
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[10px] font-semibold uppercase tracking-wider zk-text-faint hover:zk-text-secondary dark:zk-text-muted dark:hover:zk-text transition-colors"
          >
            {isCollapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2">
              {items.map((item) => (
                <motion.div
                  key={`${item.note.id}-${item.taskLine}`}
                  layout
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 4, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="group flex items-center gap-3 px-4 py-3 bg-white dark:bg-[#282929] rounded-xl border border-[#dde5da] dark:border-white/[0.06] hover:border-[#2d5a44]/30 dark:hover:border-white/[0.12] transition-all cursor-pointer"
                  onClick={(e) => {
                    // Don't open the note if they clicked a button
                    if ((e.target as HTMLElement).closest("button")) return;
                    onOpenNote(item.note);
                  }}
                >
                  {/* Check-off button */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onCompleteTask(item.note.id, item.taskLine);
                    }}
                    className="w-5 h-5 rounded-full border-2 border-[#cfd4cf] dark:border-white/20 hover:border-[#2d5a44] hover:bg-[#2d5a44]/10 dark:hover:border-[#8fb89a] dark:hover:bg-[#2d5a44]/20 flex items-center justify-center transition-all flex-shrink-0 active:scale-90"
                    aria-label="Mark done"
                    title="Mark as done"
                  >
                    <Check
                      className="w-3 h-3 text-[#2d5a44] dark:text-[#8fb89a] opacity-0 group-hover:opacity-100 transition-opacity"
                      strokeWidth={3}
                    />
                  </button>

                  {/* Task text + note context */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[14px] zk-text dark:zk-text leading-snug truncate"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {item.taskText}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] zk-text-muted dark:zk-text-muted truncate max-w-[180px]">
                        from "{item.note.title || "Untitled"}"
                      </span>
                      {item.isPinned && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2d5a44] dark:text-[#8fb89a]">
                          <Pin className="w-2.5 h-2.5" strokeWidth={2.5} />
                          Pinned
                        </span>
                      )}
                      {item.isUrgent && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                          <Zap className="w-2.5 h-2.5" strokeWidth={2.5} />
                          Urgent
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dismiss (not today) button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDismissed((prev) => {
                        const next = new Set(prev);
                        next.add(`${item.note.id}::${item.taskLine}`);
                        return next;
                      });
                    }}
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 zk-text-faint hover:zk-text-secondary hover:bg-[#eaf0e8] dark:hover:bg-white/[0.05] transition-all flex-shrink-0"
                    aria-label="Not today"
                    title="Not today — hide until tomorrow"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/* ============================================================
   RelatedNotes — Mem-style "you wrote something similar before"

   When editing a note, scans all other notes for relatedness and
   surfaces 2-3 of the most similar ones below the editor.

   Scoring: keyword Jaccard similarity on normalized content tokens,
   boosted by shared tags and same-category. Debounced to 400ms so
   we don't thrash on every keystroke.
   ============================================================ */

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "them",
  "their",
  "my",
  "your",
  "our",
  "his",
  "her",
  "as",
  "if",
  "so",
  "no",
  "not",
  "yes",
  "just",
  "get",
  "got",
  "go",
  "up",
  "down",
  "out",
  "not",
  "than",
  "then",
  "too",
  "from",
  "by",
  "about",
  "into",
  "over",
  "after",
  "under",
  "before",
  "between",
  "during",
  "through",
  "because",
  "while",
]);

function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  const tokens = text
    .toLowerCase()
    // Strip markdown symbols but keep word chars
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function RelatedNotes({
  currentNote,
  draftTitle,
  draftContent,
  allNotes,
  onSelect,
}: {
  currentNote: Note;
  draftTitle: string;
  draftContent: string;
  allNotes: Note[];
  onSelect: (n: Note) => void;
}) {
  const [debouncedContent, setDebouncedContent] = useState(draftContent);
  const [debouncedTitle, setDebouncedTitle] = useState(draftTitle);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedContent(draftContent);
      setDebouncedTitle(draftTitle);
    }, 400);
    return () => clearTimeout(id);
  }, [draftContent, draftTitle]);

  const related = React.useMemo(() => {
    // Only show related if current note has meaningful content
    const queryTokens = tokenize(`${debouncedTitle} ${debouncedContent}`);
    if (queryTokens.size < 3) return [];

    const currentTags = new Set(currentNote.tags || []);
    const currentCategory = currentNote.category;

    const scored = allNotes
      .filter((n) => n.id !== currentNote.id && !n.isTrashed && !n.isArchived)
      .map((n) => {
        const noteTokens = tokenize(`${n.title} ${n.content}`);
        let score = jaccardSimilarity(queryTokens, noteTokens);

        // Boost: shared tags count strongly
        const sharedTags = (n.tags || []).filter((t) => currentTags.has(t));
        score += sharedTags.length * 0.05;

        // Small boost for same category
        if (n.category === currentCategory && currentCategory) {
          score += 0.02;
        }

        return { note: n, score, sharedTags };
      })
      .filter((item) => item.score > 0.08) // minimum relevance threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return scored;
  }, [debouncedTitle, debouncedContent, allNotes, currentNote]);

  if (related.length === 0) return null;

  return (
    <div className="mt-6 mb-12 flex-none" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-3.5 h-3.5 text-[#2d5a44] dark:text-[#8fb89a]" />
        <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] zk-text-secondary dark:zk-text-muted">
          Related notes you wrote
        </h4>
      </div>
      <div className="space-y-2">
        {related.map(({ note, sharedTags }) => {
          const relativeTime = (() => {
            const now = Date.now();
            const ts =
              note.createdAt instanceof Timestamp
                ? note.createdAt.toMillis()
                : now;
            const days = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
            if (days < 1) return "today";
            if (days === 1) return "yesterday";
            if (days < 7) return `${days} days ago`;
            if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
            if (days < 365) return `${Math.floor(days / 30)} months ago`;
            return `${Math.floor(days / 365)} years ago`;
          })();

          return (
            <button
              key={note.id}
              onClick={() => onSelect(note)}
              className="w-full text-left group flex items-start gap-3 p-3 bg-white dark:bg-[#282929] rounded-xl border border-[#dde5da] dark:border-white/[0.06] hover:border-[#2d5a44]/30 dark:hover:border-white/[0.14] transition-all active:scale-[0.99]"
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-[13px] font-semibold zk-text dark:zk-text truncate leading-snug"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {note.title || "Untitled"}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] zk-text-muted dark:zk-text-muted">
                    {relativeTime}
                  </span>
                  {note.category && (
                    <>
                      <span className="text-[10px] zk-text-faint">·</span>
                      <span className="text-[10px] zk-text-muted dark:zk-text-muted">
                        {note.category}
                      </span>
                    </>
                  )}
                  {sharedTags.length > 0 && (
                    <>
                      <span className="text-[10px] zk-text-faint">·</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#2d5a44] dark:text-[#8fb89a]">
                        #{sharedTags[0]}
                        {sharedTags.length > 1 && ` +${sharedTags.length - 1}`}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 zk-text-faint group-hover:text-[#2d5a44] dark:group-hover:text-[#8fb89a] transition-colors flex-shrink-0 mt-0.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   ProcessingDot — breathing green indicator shown on a note
   card while its AI enhancement is still running in the background.
   ============================================================ */

function ProcessingDot() {
  return (
    <div className="relative flex items-center justify-center flex-shrink-0 ml-1">
      <span className="absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75 animate-ping" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
    </div>
  );
}

/* ============================================================
   WhereLeftOff — "Continue where you left off" card.
   Shows the most-recently-edited note when the user returns
   after a gap of 6+ hours. ADHD users often forget their
   working context — this picks up the thread for them.

   Lifecycle:
   1. On mount, check zakar_last_visit_ms.
   2. If gap >= 6h, treat this as a "return". Show the card.
   3. After this render, update zakar_last_visit_ms = now so
      we don't keep showing it within the same session.
   4. User can dismiss for the day (key keyed by note id).
   ============================================================ */
const RESUME_GAP_MS = 6 * 60 * 60 * 1000; // 6 hours

function WhereLeftOff({
  notes,
  onOpenNote,
}: {
  notes: Note[];
  onOpenNote: (n: Note) => void;
}) {
  // Read the prior visit timestamp BEFORE we overwrite it. Capture once
  // per mount so every render uses the same anchor, otherwise the gap
  // would shrink to zero on the first repaint.
  const [priorVisitMs] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const raw = localStorage.getItem("zakar_last_visit_ms");
    return raw ? parseInt(raw, 10) || 0 : 0;
  });

  // Update the visit timestamp once on mount (after read). We deliberately
  // do this in an effect so the read above can capture the previous value.
  useEffect(() => {
    localStorage.setItem("zakar_last_visit_ms", String(Date.now()));
  }, []);

  const [dismissedId, setDismissedId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("zakar_resume_dismissed");
    if (!stored) return null;
    try {
      const { id, day } = JSON.parse(stored) as { id: string; day: string };
      return day === new Date().toDateString() ? id : null;
    } catch {
      return null;
    }
  });

  const candidate = React.useMemo<Note | null>(() => {
    const now = Date.now();
    // Only show if there was a meaningful gap since last visit
    const gap = priorVisitMs ? now - priorVisitMs : 0;
    if (priorVisitMs === 0 || gap < RESUME_GAP_MS) return null;

    // Pick the most-recently updated non-trashed/archived note that was
    // touched BEFORE the current session started.
    const eligible = notes
      .filter((n) => !n.isTrashed && !n.isArchived)
      .filter((n) => {
        const ts =
          n.updatedAt instanceof Timestamp
            ? n.updatedAt.toMillis()
            : n.createdAt instanceof Timestamp
              ? n.createdAt.toMillis()
              : 0;
        return ts > 0 && ts <= priorVisitMs;
      })
      .sort((a, b) => {
        const aMs =
          a.updatedAt instanceof Timestamp
            ? a.updatedAt.toMillis()
            : a.createdAt instanceof Timestamp
              ? a.createdAt.toMillis()
              : 0;
        const bMs =
          b.updatedAt instanceof Timestamp
            ? b.updatedAt.toMillis()
            : b.createdAt instanceof Timestamp
              ? b.createdAt.toMillis()
              : 0;
        return bMs - aMs;
      });

    const top = eligible[0];
    if (!top) return null;
    if (dismissedId === top.id) return null;
    return top;
  }, [notes, priorVisitMs, dismissedId]);

  if (!candidate) return null;

  // Pull up to 2 open tasks from the note
  const openTasks: string[] = (() => {
    const content = candidate.rawContent || candidate.content || "";
    const lines = content.split("\n");
    const opens: string[] = [];
    for (const l of lines) {
      if (/^(\s*)[-*]\s*\[[\s]*\](?!\()/.test(l)) {
        const text = l
          .replace(/^(\s*)[-*]\s*\[[\s]*\]\s*/, "")
          .replace(/\*\*/g, "")
          .trim();
        if (text) opens.push(text);
        if (opens.length === 2) break;
      }
    }
    return opens;
  })();

  // Friendly "X hours/days ago"
  const updatedMs =
    candidate.updatedAt instanceof Timestamp
      ? candidate.updatedAt.toMillis()
      : candidate.createdAt instanceof Timestamp
        ? candidate.createdAt.toMillis()
        : Date.now();
  const ago = (() => {
    const diff = Date.now() - updatedMs;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  })();

  const handleDismiss = () => {
    setDismissedId(candidate.id);
    localStorage.setItem(
      "zakar_resume_dismissed",
      JSON.stringify({ id: candidate.id, day: new Date().toDateString() }),
    );
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 max-w-3xl mx-auto w-full"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-4 h-4 text-[#2d5a44] dark:text-[#8fb89a]" />
          <h3
            className="text-[11px] font-bold uppercase tracking-[0.18em] zk-text-secondary dark:zk-text-muted"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Where you left off
          </h3>
          <span className="text-[10px] font-medium zk-text-faint dark:zk-text-muted">
            {ago}
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-[10px] font-semibold uppercase tracking-wider zk-text-faint hover:zk-text-secondary dark:zk-text-muted dark:hover:zk-text transition-colors"
          aria-label="Dismiss"
        >
          Not now
        </button>
      </div>

      <button
        onClick={() => onOpenNote(candidate)}
        className="w-full text-left group flex flex-col gap-2 px-5 py-4 bg-white dark:bg-[#282929] rounded-2xl border border-[#dde5da] dark:border-white/[0.06] hover:border-[#2d5a44]/30 dark:hover:border-white/[0.14] hover:shadow-md dark:hover:shadow-none transition-all active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-3">
          <p
            className="text-[15px] font-bold zk-text dark:zk-text leading-snug truncate flex-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {candidate.title || "Untitled"}
          </p>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#2d5a44] dark:text-[#a8c9ac] flex-shrink-0">
            Continue
            <ChevronRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
        {openTasks.length > 0 ? (
          <div className="space-y-1 mt-1">
            {openTasks.map((task, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[12px] zk-text-secondary dark:zk-text-muted"
              >
                <span className="w-3 h-3 rounded-full border-[1.5px] border-[#cfd4cf] dark:border-white/20 flex-shrink-0" />
                <span className="truncate">{task}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] zk-text-muted dark:zk-text-muted line-clamp-1">
            {(candidate.content || "")
              .replace(/[#*`>_\[\]]/g, "")
              .trim()
              .slice(0, 120)}
          </p>
        )}
      </button>
    </motion.section>
  );
}

/* ============================================================
   Flashback — Spaced resurfacing of older notes.

   Once a day, surfaces ONE note that's 30+ days old and still
   has open tasks or substantive content. Helps ADHD users
   reconnect with thoughts that would otherwise quietly die in
   the archive.

   Three actions:
   - "Still relevant" → bumps updatedAt so the note re-enters
     the active rotation
   - "Archive" → moves to archive (intentional letting-go)
   - "Snooze" → hides this specific note for 30 days

   The component picks ONE note per day (deterministic by
   date + note count) so it doesn't change as the user uses
   the app. Different note tomorrow.
   ============================================================ */

const FLASHBACK_MIN_AGE_DAYS = 30;
const FLASHBACK_SNOOZE_DAYS = 30;

interface FlashbackSnooze {
  id: string;
  until: number; // ms epoch
}

function Flashback({
  notes,
  onOpenNote,
  onMarkRelevant,
  onArchive,
}: {
  notes: Note[];
  onOpenNote: (n: Note) => void;
  onMarkRelevant: (noteId: string) => Promise<void>;
  onArchive: (noteId: string) => Promise<void>;
}) {
  // Persist snoozes per-note. Each entry: { id, until: ms }
  const [snoozes, setSnoozes] = useState<FlashbackSnooze[]>(() => {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem("zakar_flashback_snoozes");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as FlashbackSnooze[];
      // Drop expired snoozes on load
      const now = Date.now();
      return Array.isArray(parsed)
        ? parsed.filter((s) => s && s.until > now)
        : [];
    } catch {
      return [];
    }
  });

  // Persist whenever snoozes change
  useEffect(() => {
    localStorage.setItem("zakar_flashback_snoozes", JSON.stringify(snoozes));
  }, [snoozes]);

  // Track which note we've shown today so it doesn't shift mid-day.
  // If the user dismisses, we'll let the choice re-roll tomorrow.
  const todayKey = React.useMemo(() => new Date().toDateString(), []);

  const [todayDismissed, setTodayDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const raw = localStorage.getItem("zakar_flashback_dismissed_day");
    return raw === todayKey;
  });

  // Build the eligible candidate pool deterministically
  const candidate = React.useMemo<Note | null>(() => {
    if (todayDismissed) return null;
    const now = Date.now();
    const minAgeMs = FLASHBACK_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
    const snoozeMap = new Map<string, number>(
      snoozes.map((s) => [s.id, s.until]),
    );

    const eligible = notes.filter((n) => {
      if (n.isTrashed || n.isArchived) return false;
      const updatedMs =
        n.updatedAt instanceof Timestamp
          ? n.updatedAt.toMillis()
          : n.createdAt instanceof Timestamp
            ? n.createdAt.toMillis()
            : 0;
      if (!updatedMs || now - updatedMs < minAgeMs) return false;
      // Honor active snoozes
      const snoozedUntil = snoozeMap.get(n.id);
      if (snoozedUntil && snoozedUntil > now) return false;
      // Require substantive content OR open tasks
      const content = n.rawContent || n.content || "";
      const hasOpenTask = /^(\s*)[-*]\s*\[[\s]*\](?!\()/m.test(content);
      const hasBody = content.trim().length > 50;
      return hasOpenTask || hasBody;
    });

    if (eligible.length === 0) return null;

    // Sort by oldest first — these need attention most
    eligible.sort((a, b) => {
      const aMs = a.updatedAt instanceof Timestamp ? a.updatedAt.toMillis() : 0;
      const bMs = b.updatedAt instanceof Timestamp ? b.updatedAt.toMillis() : 0;
      return aMs - bMs;
    });

    // Deterministic pick: same note all day, even as the list changes.
    // Rotate through the top 5 so users see variety across days.
    const dayHash = todayKey.split("").reduce((h, c) => {
      return ((h << 5) - h + c.charCodeAt(0)) | 0;
    }, 0);
    const topPool = eligible.slice(0, Math.min(5, eligible.length));
    const idx = Math.abs(dayHash) % topPool.length;
    return topPool[idx];
  }, [notes, snoozes, todayDismissed, todayKey]);

  const [isWorking, setIsWorking] = useState(false);

  if (!candidate) return null;

  // Friendly age string
  const updatedMs =
    candidate.updatedAt instanceof Timestamp
      ? candidate.updatedAt.toMillis()
      : candidate.createdAt instanceof Timestamp
        ? candidate.createdAt.toMillis()
        : Date.now();
  const ageDays = Math.floor((Date.now() - updatedMs) / (1000 * 60 * 60 * 24));
  const ageLabel = (() => {
    if (ageDays < 60) return `${ageDays} days ago`;
    if (ageDays < 365) return `${Math.floor(ageDays / 30)} months ago`;
    const years = Math.floor(ageDays / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  })();

  // Pull a content preview
  const preview = (() => {
    const content = candidate.rawContent || candidate.content || "";
    return content
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/^[-*]\s*\[[\s]*\]\s*/gm, "• ")
      .replace(/^[-*]\s*\[[xX]\]\s*/gm, "✓ ")
      .replace(/^[-*]\s+/gm, "• ")
      .trim()
      .slice(0, 180);
  })();

  const dismissForToday = () => {
    setTodayDismissed(true);
    localStorage.setItem("zakar_flashback_dismissed_day", todayKey);
  };

  const handleStillRelevant = async () => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      await onMarkRelevant(candidate.id);
      dismissForToday();
    } finally {
      setIsWorking(false);
    }
  };

  const handleArchiveNote = async () => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      await onArchive(candidate.id);
      dismissForToday();
    } finally {
      setIsWorking(false);
    }
  };

  const handleSnooze = () => {
    const until = Date.now() + FLASHBACK_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
    setSnoozes((prev) => {
      const without = prev.filter((s) => s.id !== candidate.id);
      return [...without, { id: candidate.id, until }];
    });
    dismissForToday();
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 max-w-3xl mx-auto w-full"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] zk-text-secondary dark:zk-text-muted">
            Flashback — still relevant?
          </h3>
          <span className="text-[10px] font-medium zk-text-faint dark:zk-text-muted">
            {ageLabel}
          </span>
        </div>
        <button
          onClick={dismissForToday}
          className="text-[10px] font-semibold uppercase tracking-wider zk-text-faint hover:zk-text-secondary dark:zk-text-muted dark:hover:zk-text transition-colors"
          title="Hide for today"
        >
          Skip
        </button>
      </div>

      <div className="bg-white dark:bg-[#282929] rounded-2xl border border-amber-200/40 dark:border-amber-500/15 overflow-hidden">
        <button
          onClick={() => onOpenNote(candidate)}
          className="block w-full text-left px-5 pt-4 pb-3 hover:bg-amber-50/30 dark:hover:bg-amber-500/[0.04] transition-colors"
        >
          <p
            className="text-[15px] font-bold zk-text dark:zk-text leading-snug truncate"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {candidate.title || "Untitled"}
          </p>
          {preview && (
            <p className="text-[12px] zk-text-secondary dark:zk-text-muted mt-1.5 line-clamp-2 leading-relaxed">
              {preview}
            </p>
          )}
        </button>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-[#dde5da] dark:border-white/[0.05] bg-[#f4f7f2]/40 dark:bg-black/10">
          <button
            onClick={handleStillRelevant}
            disabled={isWorking}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#a8d4ae] dark:bg-[#3d5142] text-[#1f3424] dark:text-[#d4e8d8] text-[11px] font-bold rounded-lg hover:bg-[#90c499] dark:hover:bg-[#4a6151] transition-all active:scale-95 disabled:opacity-50"
            title="Bump this note back to the top"
          >
            <Sparkles className="w-3 h-3" />
            Still relevant
          </button>
          <button
            onClick={handleArchiveNote}
            disabled={isWorking}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 zk-text-secondary dark:zk-text-muted text-[11px] font-semibold rounded-lg hover:bg-[#eaf0e8] dark:hover:bg-white/[0.05] transition-all active:scale-95 disabled:opacity-50"
            title="Move to archive (you can always restore)"
          >
            <Archive className="w-3 h-3" />
            Archive
          </button>
          <button
            onClick={handleSnooze}
            disabled={isWorking}
            className="ml-auto flex items-center justify-center gap-1 px-3 py-1.5 zk-text-faint hover:zk-text-secondary dark:zk-text-muted dark:hover:zk-text text-[11px] font-medium rounded-lg hover:bg-[#eaf0e8] dark:hover:bg-white/[0.05] transition-all active:scale-95 disabled:opacity-50"
            title="Hide this note for 30 days"
          >
            <Clock className="w-3 h-3" />
            Snooze 30d
          </button>
        </div>
      </div>
    </motion.section>
  );
}

/**
 * Copy button for code blocks. Lives outside the main App
 * component so it has its own local state — each instance manages
 * its own "copied!" feedback independently. Stateless / pure
 * presentational, talks to navigator.clipboard via the standard
 * async API with a sync execCommand fallback for older browsers.
 */
function ZkCodeCopyButton({
  text,
  variant = "default",
}: {
  text: string;
  variant?: "default" | "header";
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for very old browsers without the async API.
        // execCommand is deprecated but still functional everywhere
        // that lacks navigator.clipboard.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied or some other failure — leave
      // the button quiet rather than throwing a visible error.
    }
  };
  if (variant === "header") {
    // Header variant — matches the reference: a small pill button
    // with just an icon (no "Copy Code" label — the icon is
    // universally understood and the bar is tight on space).
    // Theme-aware (sage in light, sage-tinted on slate in dark).
    // Sits in the code block's header strip so it's always
    // visible without hover.
    return (
      <button
        type="button"
        onClick={handleCopy}
        className="zk-code-copy-btn flex items-center justify-center w-7 h-7 rounded-md active:scale-90 transition-all"
        style={{ fontFamily: "var(--font-sans)" }}
        aria-label="Copy code"
        title="Copy code"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all"
      style={{ fontFamily: "var(--font-sans)" }}
      aria-label="Copy code"
      title="Copy code"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

/**
 * Syntax-highlighted code block. Matches the reference design:
 * deep ink surface (both light/dark theme since code = dark UI by
 * convention), language label top-left, line numbers down the
 * gutter, copy button top-right. Heuristically auto-detects the
 * language if the markdown didn't specify one.
 */
function ZkCodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}) {
  // Heuristic language detection when nothing was specified.
  const detectedLang = (() => {
    if (language) return language.toLowerCase();
    const c = code;
    if (/^\s*(def |import |from \w+ import|class \w+\(|print\()/m.test(c))
      return "python";
    if (/^\s*(function |const |let |var |=>)/m.test(c)) return "javascript";
    if (/^\s*(interface |type \w+ =|export (interface|type))/m.test(c))
      return "typescript";
    if (/^\s*(#!\/|echo |export [A-Z_]+=)/m.test(c)) return "bash";
    if (/^\s*\{[\s\S]*"[a-zA-Z_]+"\s*:/.test(c)) return "json";
    if (/^\s*(<\?php|\$\w+\s*=)/m.test(c)) return "php";
    if (/^\s*(package main|fmt\.Print|func \w+)/m.test(c)) return "go";
    if (/^\s*(fn \w+|let mut |use std::)/m.test(c)) return "rust";
    if (/^\s*<\/?[a-zA-Z]+/.test(c)) return "markup";
    return "text";
  })();

  // Friendly display name for the header.
  const displayLang = (() => {
    const m: Record<string, string> = {
      js: "JavaScript",
      javascript: "JavaScript",
      jsx: "JSX",
      ts: "TypeScript",
      typescript: "TypeScript",
      tsx: "TSX",
      py: "Python",
      python: "Python",
      rb: "Ruby",
      ruby: "Ruby",
      go: "Go",
      rs: "Rust",
      rust: "Rust",
      java: "Java",
      kt: "Kotlin",
      swift: "Swift",
      c: "C",
      cpp: "C++",
      cs: "C#",
      php: "PHP",
      html: "HTML",
      markup: "HTML",
      css: "CSS",
      scss: "SCSS",
      json: "JSON",
      yaml: "YAML",
      yml: "YAML",
      xml: "XML",
      sh: "Shell",
      bash: "Bash",
      zsh: "Zsh",
      sql: "SQL",
      md: "Markdown",
      markdown: "Markdown",
      text: "Code",
    };
    return m[detectedLang] || detectedLang;
  })();

  // Prism-highlight the code. Wrap in try so unknown language
  // (or load failure) falls back to plain text without crashing.
  const highlightedHtml = (() => {
    try {
      const grammar =
        (Prism.languages as any)[detectedLang] || Prism.languages.markup;
      return Prism.highlight(code, grammar, detectedLang);
    } catch {
      // Plain text fallback. Escape HTML so the raw code isn't
      // interpreted as markup when injected via innerHTML.
      return code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  })();

  // Split lines for the line-number gutter. We render line numbers
  // as a separate column rather than via CSS counters because
  // counters don't play nicely with html2canvas on PDF export.
  const lineCount = code.split("\n").length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  return (
    <div
      className="zk-code-block my-5 group relative rounded-2xl overflow-hidden shadow-sm"
    >
      {/* Header row — language label + copy button. Theme-adaptive
          surface and divider. No green tint anywhere; we use slate /
          off-white tones so the block reads as "code editor" and
          doesn't compete with the editorial sage palette of the
          note body. */}
      <div className="zk-code-block-header flex items-center justify-between px-5 pt-3.5 pb-2.5">
        <span
          className="zk-code-block-lang text-[12.5px] font-semibold select-none tracking-wide"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {displayLang}{displayLang === "Code" ? "" : " Snippet"}
        </span>
        <ZkCodeCopyButton text={code} variant="header" />
      </div>
      <div className="zk-code-block-body flex font-mono text-[13.5px] leading-[1.7] overflow-x-auto">
        {/* Line-number gutter */}
        <div
          className="zk-code-block-gutter select-none flex-shrink-0 text-right pl-5 pr-4 py-4"
          style={{
            fontFamily:
              "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
          }}
          aria-hidden="true"
        >
          {lineNumbers.map((n) => (
            <div key={`ln-${n}`}>{n}</div>
          ))}
        </div>
        {/* Code body */}
        <pre
          className="zk-code-block-pre m-0 py-4 pr-5 flex-1 min-w-0 whitespace-pre"
          style={{
            fontFamily:
              "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
            tabSize: 2,
            background: "transparent",
          }}
        >
          <code
            className={`language-${detectedLang}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
    </div>
  );
}

export default function App() {
  console.log(
    "App component rendering... Auth Domain:",
    firebaseConfig.authDomain,
  );
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [dump, setDump] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("zakar_dump") || "";
    }
    return "";
  });
  const [isProcessing, setIsProcessing] = useState(false);
  // Tracks noteIds currently being enhanced. Survives modal close so the
  // breathing green dot stays visible on the card until the AI finishes.
  const [processingNotes, setProcessingNotes] = useState<Set<string>>(
    new Set(),
  );
  const [welcomeMessage] = useState(() => {
    const messages = [
      {
        headline: "Your thoughts, beautifully organized.",
        subtitle: "Dump it all in. Let AI turn chaos into clarity.",
      },
      {
        headline: "Think freely. We'll sort the rest.",
        subtitle: "A calm space where every brain dump finds its place.",
      },
      {
        headline: "From scattered thoughts to structured notes.",
        subtitle: "Just type what's on your mind — zakar handles the rest.",
      },
      {
        headline: "Clear your mind. Keep what matters.",
        subtitle: "The AI-powered notebook that thinks with you.",
      },
      {
        headline: "Every idea deserves a home.",
        subtitle: "Capture now, organize later. That's the zakar way.",
      },
      {
        headline: "Brain full? Dump it here.",
        subtitle: "Watch your messy notes transform into something beautiful.",
      },
      {
        headline: "Stop organizing. Start thinking.",
        subtitle: "Let your brain breathe — we'll handle the filing.",
      },
      {
        headline: "Where raw thoughts become refined notes.",
        subtitle: "Paste, type, or ramble. AI does the tidying up.",
      },
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  });
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [formatType, setFormatType] = useState<FormatType>("auto");
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  /** Tracks whether the user WANTS to be recording. Separate from isRecording
   *  state because the Web Speech API auto-stops after silence and we need to
   *  know whether to restart. Stays true between auto-restarts; flips false
   *  only when the user explicitly clicks Stop. */
  const userWantsRecordingRef = useRef(false);
  /** Accumulated finalized transcripts across auto-restart cycles. The Web
   *  Speech API resets event.results every time recognition restarts, so we
   *  buffer finalized text here to avoid losing it between cycles. */
  const finalTranscriptRef = useRef("");
  /** Index into the current recognition session's `event.results` array
   *  marking how many results have already been promoted into
   *  finalTranscriptRef. Critical for preventing duplication: in
   *  `continuous=true` mode, finalized results PERSIST in the event.results
   *  array for the lifetime of the session. Without this guard, every
   *  onresult fire would re-promote ALL prior finals and the transcript
   *  would compound exponentially ("this is what I like to do" written
   *  10+ times after a few seconds of speaking). Reset to 0 on each
   *  recognition.start() so a new session starts from index 0 fresh. */
  const promotedUpToRef = useRef(0);
  /** Debounce token for auto-restart. Some browsers fire onend twice in a
   *  row; this prevents racing restarts. */
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ref to the capture-modal textarea so we can auto-scroll it during
   *  voice input — without this, voice-to-text gets hidden below the fold
   *  once the transcript exceeds the visible height. */
  const dumpTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Ref for the edit-mode title textarea. Used to set the initial
   *  height to scrollHeight when the modal opens with an already-long
   *  title, so the textarea renders pre-wrapped instead of collapsed
   *  to one line. */
  const titleTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("zakar_active_category");
    return stored && stored !== "null" ? stored : null;
  });
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  // Navigation stack for "back" inside the note modal — populated when a user
  // jumps to a related note. When empty, the back button is hidden.
  const [noteNavStack, setNoteNavStack] = useState<Note[]>([]);

  // Clear the navigation stack whenever the modal fully closes
  useEffect(() => {
    if (!selectedNote) {
      setNoteNavStack([]);
      setIsColorPickerOpen(false);
    }
  }, [selectedNote]);

  // Close bulk dropdowns when user taps outside or selection clears.
  // (Effect placed below the state declarations so it can reference them.)
  // Multi-select + drag-drop state
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(
    new Set(),
  );
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  /** When a drag is in flight, is the dragged note pinned? Used to disable
   *  drop targets on the other side of the pin boundary so dnd-kit refuses
   *  to accept cross-pin drops. Without this, users can drop a pinned note
   *  into the unpinned region (or vice-versa) and the drag silently
   *  no-ops, looking like a buggy snap-back. With it, the wrong-side
   *  cards don't even register as drop targets — the drag stays
   *  visually contained to its own group. */
  const draggedNoteIsPinned = useMemo(() => {
    if (!activeDragId) return null;
    const dragged = notes.find((n) => n.id === activeDragId);
    return dragged ? !!dragged.isPinned : null;
  }, [activeDragId, notes]);
  const [dragOverSidebarKey, setDragOverSidebarKey] = useState<string | null>(
    null,
  );
  // Bulk-select bar dropdowns. Use explicit state instead of CSS
  // group-hover because mobile devices don't fire :hover at all.
  const [bulkDropdownOpen, setBulkDropdownOpen] = useState<
    null | "category" | "color"
  >(null);

  // Profile popover (avatar selector) state. Declared early so the
  // outside-click effect below can reference it.
  const [showProfilePopover, setShowProfilePopover] = useState(false);

  // Close bulk dropdowns when user taps outside or when selection clears.
  // Necessary on mobile where there's no :hover to dismiss them.
  useEffect(() => {
    if (selectedNoteIds.size === 0) {
      setBulkDropdownOpen(null);
      return;
    }
    if (!bulkDropdownOpen) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-bulk-dropdown]")) return;
      setBulkDropdownOpen(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [bulkDropdownOpen, selectedNoteIds.size]);

  // Close profile popover (avatar selector) on outside click. The existing
  // overlay-div approach was fragile across stacking contexts; this catches
  // every pointer event globally and only closes when the click is OUTSIDE
  // any element marked [data-profile-popover].
  useEffect(() => {
    if (!showProfilePopover) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-profile-popover]")) return;
      setShowProfilePopover(false);
    };
    // pointerdown fires before the click, so the popover closes cleanly
    // even if the user clicks another button.
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [showProfilePopover]);
  const [isEditing, setIsEditing] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  /** Transient "just saved" state — shown for ~1.8s after a save
   *  completes so the user sees confirmation, then fades. Without
   *  this the indicator would vanish the instant the save finished,
   *  which feels jumpy: spinner appears, spinner disappears, nothing
   *  to acknowledge the save happened. */
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  // When isAutoSaving flips from true → false, kick off the flash.
  // Use a ref to track the previous value so we only trigger on the
  // transition, not on initial mount (where isAutoSaving is already
  // false).
  const wasAutoSavingRef = useRef(false);
  useEffect(() => {
    if (wasAutoSavingRef.current && !isAutoSaving) {
      // Save just completed.
      setShowSavedFlash(true);
      const t = setTimeout(() => setShowSavedFlash(false), 1800);
      wasAutoSavingRef.current = false;
      return () => clearTimeout(t);
    }
    wasAutoSavingRef.current = isAutoSaving;
  }, [isAutoSaving]);
  /** Has the user typed in the editor since entering edit mode? Used
   *  to gate auto-save: TipTap's markdown round-trip produces slightly
   *  different output than the original (whitespace, blank lines) even
   *  when no content actually changed, which would trigger phantom
   *  auto-saves the moment edit mode opens. We flip this to true on
   *  the first user-driven edit; until then, auto-save is suppressed.
   *  Reset to false in openNote and when entering edit mode. */
  const hasEditorTypedRef = useRef(false);
  const [isProtecting, setIsProtecting] = useState(false);
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false);
  const [isRemovingPassword, setIsRemovingPassword] = useState(false);
  const [isResettingPasswordConfirm, setIsResettingPasswordConfirm] =
    useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  // Auto-resize the title textarea whenever editTitle changes or
  // edit mode opens. Without this, the textarea renders at rows={1}
  // single-line height even when the title is long enough to wrap to
  // 2-3 lines — user would see a clipped collapsed input until they
  // typed a character. useLayoutEffect runs synchronously before
  // paint so the wrap is in place by the first frame the user sees.
  React.useLayoutEffect(() => {
    const el = titleTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editTitle, isEditing]);
  // AI "Break it down" — processes the current editContent into atomic steps
  const [isBreakingDown, setIsBreakingDown] = useState(false);
  // AI "Extract tasks" — scans editContent for implicit action items
  const [isExtractingTasks, setIsExtractingTasks] = useState(false);
  // Toast shown after breakdown / extraction so user sees what was added
  const [aiActionToast, setAiActionToast] = useState<{
    kind: "breakdown" | "extract";
    count: number;
    at: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inboxEmailCopied, setInboxEmailCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  // When true, the note detail view shows the raw content even
  // when the note contains sensitive data. Default false → we
  // render the AI-generated maskedContent (with ******** /
  // [REDACTED] in place of credentials). The Eye icon next to
  // the "Edited Xm ago" line toggles this.
  const [revealSensitive, setRevealSensitive] = useState(false);

  /** Inline "+ Add tag" UI state. When open, the pill in the tag row
   *  collapses to an input. Enter commits, Escape cancels, blur
   *  commits if there's text (so users can click outside to save).
   *  Kept simple: one pending tag at a time, no autocomplete. */
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  /** Add a tag to the currently-selected note. Normalizes by stripping
   *  leading `#`, trimming, lowercasing, and deduplicating. Empty or
   *  duplicate tags are silently ignored — no error UI for the most
   *  common case ("user pressed enter on empty input"). */
  const commitTag = async () => {
    if (!selectedNote) return;
    const normalized = tagDraft
      .trim()
      .replace(/^#+/, "")
      .toLowerCase()
      .replace(/\s+/g, "-");
    setAddingTag(false);
    setTagDraft("");
    if (!normalized) return;
    const existing = (selectedNote.tags || []).map((t) => t.toLowerCase());
    if (existing.includes(normalized)) return;
    const newTags = [...(selectedNote.tags || []), normalized];
    try {
      await updateDoc(doc(db, "notes", selectedNote.id), {
        tags: newTags,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };
  /** Remove a tag from the currently-open note. Matches case-
   *  insensitively against the existing tags array so legacy mixed-
   *  case tags still get caught. No confirm dialog — tags are cheap
   *  to add back if mis-clicked. */
  const removeTag = async (tagToRemove: string) => {
    if (!selectedNote) return;
    const target = tagToRemove.toLowerCase();
    const newTags = (selectedNote.tags || []).filter(
      (t) => t.toLowerCase() !== target,
    );
    try {
      await updateDoc(doc(db, "notes", selectedNote.id), {
        tags: newTags,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [sortBy, setSortBy] = useState<
    "newest" | "oldest" | "alphabetical" | "custom"
  >(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("zakar_sortBy");
      if (
        saved === "newest" ||
        saved === "oldest" ||
        saved === "alphabetical" ||
        saved === "custom"
      ) {
        return saved;
      }
    }
    return "newest";
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    if (typeof window !== "undefined") {
      // Always force grid on mobile (under md breakpoint = 768px)
      if (window.matchMedia("(max-width: 767px)").matches) return "grid";
      return (
        (localStorage.getItem("zakar_viewMode") as "grid" | "list") || "grid"
      );
    }
    return "grid";
  });
  const [sharedNote, setSharedNote] = useState<Note | null>(null);
  const [isCheckingShare, setIsCheckingShare] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return !!params.get("share");
  });
  const [isSharing, setIsSharing] = useState(false);
  const shareDropdownRef = useRef<HTMLDivElement | null>(null);
  // Close the share dropdown when the user clicks anywhere outside
  // of it. Without this, the dropdown stays open after the user
  // finishes copying the link / toggling visibility — which traps
  // them with a panel they can't dismiss unless they click the
  // share icon again. The listener self-attaches only while the
  // dropdown is open to avoid running on every click app-wide.
  useEffect(() => {
    if (!isSharing) return;
    const handle = (e: MouseEvent) => {
      const el = shareDropdownRef.current;
      if (el && !el.contains(e.target as Node)) {
        setIsSharing(false);
      }
    };
    // Use mousedown rather than click so the dropdown closes
    // *before* the underlying element fires its own click —
    // matches how every other "click outside to close" panel
    // (color picker, more menu, slash menu) behaves.
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isSharing]);
  const [pendingShare, setPendingShare] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [trashedToast, setTrashedToast] = useState<{
    id: string;
    title: string;
    timeout: NodeJS.Timeout;
  } | null>(null);
  // Generic action toast for archive/pin/star/unpin/unstar/unarchive
  const [actionToast, setActionToast] = useState<{
    action:
      | "archived"
      | "unarchived"
      | "pinned"
      | "unpinned"
      | "starred"
      | "unstarred";
    noteId: string;
    title: string;
    timeout: NodeJS.Timeout;
    undoFn: () => Promise<void>;
  } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("zakar_sidebarCollapsed") === "true";
    }
    return false;
  });
  // Y coordinate for the sidebar rail tooltips (Open/Close/Settings/Profile).
  // Captured onMouseEnter so position:fixed pills land next to the button.
  const [railTipY, setRailTipY] = useState(0);
  const [railTipLabel, setRailTipLabel] = useState<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [captureBarVisible, setCaptureBarVisible] = useState<boolean>(false);
  const [showGreetingWave, setShowGreetingWave] = useState(true);
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState<{
    type: "single" | "empty";
    id?: string;
  } | null>(null);

  // Fun character avatars for users without profile photos
  const AVATAR_OPTIONS = [
    {
      id: "sage",
      bg: "#d2e8d5",
      // Calm zen character — closed eyes, gentle smile
      svg: (
        <g>
          <circle cx="50" cy="50" r="50" fill="#d2e8d5" />
          <circle cx="50" cy="48" r="28" fill="#f5e6d3" />
          <path
            d="M 38 45 Q 40 44 42 45"
            stroke="#2d5a44"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 58 45 Q 60 44 62 45"
            stroke="#2d5a44"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 42 58 Q 50 64 58 58"
            stroke="#2d5a44"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="35" cy="55" r="3" fill="#f4a09c" opacity="0.6" />
          <circle cx="65" cy="55" r="3" fill="#f4a09c" opacity="0.6" />
          <path
            d="M 32 28 Q 50 18 68 28 Q 70 32 65 35 Q 50 28 35 35 Q 30 32 32 28"
            fill="#2d5a44"
          />
        </g>
      ),
    },
    {
      id: "spark",
      bg: "#ffe9c7",
      // Curious wide-eyed character — alert, ready for ideas
      svg: (
        <g>
          <circle cx="50" cy="50" r="50" fill="#ffe9c7" />
          <circle cx="50" cy="50" r="28" fill="#f5d0a9" />
          <circle cx="40" cy="47" r="4.5" fill="#3d2e1f" />
          <circle cx="60" cy="47" r="4.5" fill="#3d2e1f" />
          <circle cx="41" cy="45.5" r="1.5" fill="white" />
          <circle cx="61" cy="45.5" r="1.5" fill="white" />
          <circle cx="50" cy="60" r="3" fill="#c97a5a" />
          <path
            d="M 43 66 Q 50 70 57 66"
            stroke="#3d2e1f"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M 28 32 Q 40 22 50 25 Q 60 22 72 32 Q 72 38 68 40 Q 50 32 32 40 Q 28 38 28 32"
            fill="#8b6f47"
          />
        </g>
      ),
    },
    {
      id: "zen",
      bg: "#e0d4f0",
      // Playful mischievous character — winking, playful smile
      svg: (
        <g>
          <circle cx="50" cy="50" r="50" fill="#e0d4f0" />
          <circle cx="50" cy="50" r="28" fill="#d4a373" />
          <path
            d="M 36 46 L 44 46"
            stroke="#2e1e0e"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="60" cy="47" r="4" fill="#2e1e0e" />
          <circle cx="61" cy="45.5" r="1.2" fill="white" />
          <path
            d="M 42 60 Q 50 68 58 60"
            stroke="#2e1e0e"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="36" cy="56" r="2.5" fill="#e8847a" opacity="0.7" />
          <circle cx="64" cy="56" r="2.5" fill="#e8847a" opacity="0.7" />
          <path
            d="M 28 35 Q 35 25 50 28 Q 65 25 72 35 Q 72 42 68 42 Q 60 35 50 36 Q 40 35 32 42 Q 28 42 28 35"
            fill="#2e1e0e"
          />
        </g>
      ),
    },
  ];

  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("zakar_avatar") || null;
    }
    return null;
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return (
        (localStorage.getItem("theme") as "light" | "dark") ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light")
      );
    }
    return "light";
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [pendingVerificationName, setPendingVerificationName] = useState("");
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [verificationResent, setVerificationResent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [promptIndex, setPromptIndex] = useState(0);
  const placeholder = CAPTURE_PROMPTS[promptIndex].placeholder;
  const captureHeader = CAPTURE_PROMPTS[promptIndex].header;
  // Modal-only emoji prefixed version — adds a contextual emoji to the prompt in the capture modal
  const CAPTURE_EMOJIS: Record<string, string> = {
    "What's on your mind?": "✨",
    "Unload your thoughts": "📋",
    "Capture the spark": "⚡",
    "Clear your head": "💭",
    "Notes, meet paper": "📝",
    "Think out loud": "🗣️",
    "Whatever's rattling around": "🎲",
    "Drop it here": "📥",
    "Speak your mind": "💬",
    "The unfiltered version": "🌱",
  };
  const captureHeaderWithEmoji = `${CAPTURE_EMOJIS[captureHeader] || "✨"} ${captureHeader}`;
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  // Per-note color picker dropdown — open/closed
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  // Close color picker when user clicks outside, mirroring the
  // share-card behaviour. Without this users get stuck looking
  // at a panel they can't dismiss without finding the palette
  // icon again — annoying on a colored note where the palette
  // icon blends into the surface.
  useEffect(() => {
    if (!isColorPickerOpen) return;
    const handle = (e: MouseEvent) => {
      const el = colorPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setIsColorPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [isColorPickerOpen]);
  /** Action overflow menu — consolidates secondary actions (color,
   *  lock, copy, share, star, edit, trash) into one ⋯ dropdown so the
   *  top-right action row stays clean and never wraps. Primary
   *  actions (pin, view original) remain inline. The menu is its own
   *  popover; selecting an item either runs the action immediately or
   *  hands off to an existing popover (color picker, share menu)
   *  whose state we already track separately. */
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "account" | "preferences" | "data"
  >("preferences");
  // Import/export state
  const [isExporting, setIsExporting] = useState(false);
  // User preference: should imported notes be re-sorted by Magic Sort?
  // Default: false (preserve original organization). Persists in localStorage.
  const [importSortWithAI, setImportSortWithAI] = useState<boolean>(() => {
    try {
      return localStorage.getItem("zakar_import_sort_with_ai") === "1";
    } catch {
      return false;
    }
  });

  /** Lightweight one-line toast (info/success/error) shown briefly at
   *  bottom-center. We have a richer notification UI for imports; this is
   *  the simple flavor for one-shot messages like "Sort mode changed". */
  const [toast, setToast] = useState<{
    message: string;
    kind: "info" | "success" | "error";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (
    message: string,
    kind: "info" | "success" | "error" = "info",
  ) => {
    setToast({ message, kind });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };

  const [importStatus, setImportStatus] = useState<{
    /** Top-level pipeline stage. Two-phase design:
     *    parsing  → reading the uploaded file
     *    importing → bulk-saving notes raw to Firestore (fast)
     *    sorting   → AI-organizing each saved note in the background (slow)
     *    done      → final summary
     *    error     → fatal upload-level error
     *  Splitting "importing" from "sorting" lets users see their notes appear
     *  immediately, then watch them get organized one by one. */
    state: "idle" | "parsing" | "importing" | "sorting" | "done" | "error";
    progress?: { current: number; total: number };
    message?: string;
  }>({ state: "idle" });
  const importFileInputRef = useRef<HTMLInputElement>(null);
  /** Cancellation flag for the import loop. Set true via the toast's Cancel
   *  button; the loop checks it between iterations and exits gracefully.
   *  We use a ref (not state) so the running loop sees the latest value
   *  without needing to be re-rendered. */
  const importCancelRef = useRef(false);
  /** State for the post-import error/recovery banner shown in Settings. */
  const [importLastResult, setImportLastResult] = useState<{
    success: number;
    failed: number;
    aiSortFailures: number;
    skipped: number;
    cancelled: boolean;
  } | null>(null);
  /** Bulk-sort recovery state — used by "Sort all unsorted notes" in Settings. */
  const [bulkSortStatus, setBulkSortStatus] = useState<{
    state: "idle" | "running" | "done" | "error";
    progress?: { current: number; total: number };
    message?: string;
  }>({ state: "idle" });
  const bulkSortCancelRef = useRef(false);

  /** "Ask my notes" (Tier 1 RAG) — modal open state, current question,
   *  in-flight loading state, and the latest answer (with cited hits). */
  const [askOpen, setAskOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  /** When non-null, indexing is running. Shown as a small "Indexing N/M"
   *  hint while we embed any unindexed notes before the first query. */
  const [askIndexing, setAskIndexing] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [askAnswer, setAskAnswer] = useState<RecallAnswer | null>(null);
  /** Side metadata for the answer: how long it took, how many sources
   *  contributed, and a confidence indicator derived from the top hit's
   *  similarity score. Lets the UI render the "High confidence ·
   *  Answered in 0.4s · 6 sources" header from your design reference. */
  const [askMeta, setAskMeta] = useState<{
    durationMs: number;
    confidence: "high" | "medium" | "low";
  } | null>(null);
  /** Cancel flag for in-flight indexing — flipped when modal closes. */
  const askCancelRef = useRef(false);

  /** When the user clicks a source citation in the Ask modal, we open the
   *  note in detail view BUT keep the Ask modal mounted (hidden) so they
   *  can return to the answer with one click. This flag tracks that
   *  "previewing-from-ask" mode so the note detail can show a "Back to
   *  answer" affordance and the Ask modal knows to re-show on close. */
  const [askPreviewingSource, setAskPreviewingSource] = useState(false);

  /** When an import is found to contain duplicates of existing notes, we
   *  pause and ask the user how to proceed. This holds the parsed notes
   *  plus the duplicate breakdown so the loop can resume after they pick. */
  const [importDupePrompt, setImportDupePrompt] = useState<{
    parsed: ParsedNote[];
    issues: ImportIssue[];
    wasZakarExport: boolean;
    duplicateIndices: Set<number>;
  } | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const isDeletingAccountRef = useRef(false);
  const [isVerifyingForDeletion, setIsVerifyingForDeletion] = useState(false);
  const isVerifyingForDeletionRef = useRef(false);
  const deletionStartedAtRef = useRef<number>(0);
  const goodbyeEmailSentRef = useRef(false);
  const welcomeEmailTriggeredRef = useRef(false);

  // Sync refs with state
  useEffect(() => {
    isDeletingAccountRef.current = isDeletingAccount;
  }, [isDeletingAccount]);

  useEffect(() => {
    isVerifyingForDeletionRef.current = isVerifyingForDeletion;
  }, [isVerifyingForDeletion]);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(
    null,
  );
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isIdentityVerified, setIsIdentityVerified] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [tick, setTick] = useState(0);

  // --- Auto-save Brain Dump to LocalStorage ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (dump.trim()) {
        localStorage.setItem("zakar_dump", dump);
        setIsSavingDraft(true);
        const timeoutId = setTimeout(() => setIsSavingDraft(false), 1000);
        return () => clearTimeout(timeoutId);
      } else {
        localStorage.removeItem("zakar_dump");
        setIsSavingDraft(false);
      }
    }
  }, [dump]);

  // --- Lockout Timer Refresh ---
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (
      showPasswordInput &&
      selectedNote?.lockedUntil &&
      getTimestampMillis(selectedNote.lockedUntil) > Date.now()
    ) {
      interval = setInterval(() => {
        setTick((prev) => prev + 1);
      }, 60000);
    }
    return () => clearInterval(interval);
  }, [showPasswordInput, selectedNote]);

  // --- Greeting wave — auto-dismiss after 3 minutes ---
  useEffect(() => {
    if (user) {
      setShowGreetingWave(true);
      const timer = setTimeout(() => setShowGreetingWave(false), 30000); // 30 sec
      return () => clearTimeout(timer);
    } else {
      setShowGreetingWave(false);
    }
  }, [user?.uid]);

  // --- Randomize Prompt on Login & when capture modal opens ---
  useEffect(() => {
    if (user) {
      setPromptIndex(Math.floor(Math.random() * CAPTURE_PROMPTS.length));
    }
  }, [user]);

  useEffect(() => {
    if (showCaptureModal) {
      setPromptIndex(Math.floor(Math.random() * CAPTURE_PROMPTS.length));
    }
  }, [showCaptureModal]);

  // --- Voice Input Setup ---
  const dumpBeforeVoiceRef = useRef("");

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      // Multiple alternatives per phrase. Web Speech API normally
      // returns just one interpretation (the engine's top guess); for
      // unusual diction — sung lyrics, accents, technical jargon —
      // the second-place interpretation is often closer to truth.
      // We still consume [0] as the primary, but having alternatives
      // available means we can offer the user a "did you mean?" path
      // in future turns. 3 is the sweet spot: enough variety, no
      // noticeable engine slowdown.
      recognition.maxAlternatives = 3;
      // Initial language — the toggleVoiceInput handler also re-applies
      // this on each start so settings changes take effect immediately.
      recognition.lang = profile?.defaultLanguage || "en-US";

      recognition.onresult = (event: any) => {
        // The Web Speech API's `event.results` is CUMULATIVE within a
        // single recognition session: every finalized result stays in
        // the array for the rest of the session. If we re-iterate from
        // index 0 on every fire and accumulate ALL finals into our
        // persistent buffer, we end up promoting the same phrase
        // repeatedly — the user sees "this is what I like to do"
        // duplicated as many times as recognition fires events.
        //
        // Fix: track how far we've already promoted (`promotedUpToRef`)
        // and only consider results AT or AFTER that index for the
        // final-buffer promotion. Interim results still come from the
        // tail of the array and replace each other naturally.
        let newFinal = "";
        let interim = "";
        let highestFinalIdx = promotedUpToRef.current;
        for (let i = 0; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            // Only promote results we haven't promoted before.
            if (i >= promotedUpToRef.current) {
              newFinal += transcript;
              highestFinalIdx = i + 1;
            }
          } else {
            // Interim block: only the trailing not-yet-final results,
            // which always appear at the end of the array.
            interim += transcript;
          }
        }
        // Advance the watermark so the next fire skips what we just promoted.
        promotedUpToRef.current = highestFinalIdx;

        // Append newly-finalized text to the persistent buffer (which
        // also survives auto-restarts of the recognition session).
        if (newFinal) {
          const trimmedNew = newFinal.trim();
          if (trimmedNew) {
            finalTranscriptRef.current = finalTranscriptRef.current
              ? `${finalTranscriptRef.current} ${trimmedNew}`
              : trimmedNew;
          }
        }

        // Combine: original dump + persistent finals + current interim
        const base = dumpBeforeVoiceRef.current;
        const allVoice = (
          finalTranscriptRef.current +
          (interim ? " " + interim : "")
        ).trim();
        if (allVoice) {
          setDump(base ? `${base}\n${allVoice}` : allVoice);
        }
      };

      recognition.onerror = (event: any) => {
        // Error categories from the Web Speech spec, plus how we handle them:
        //  - "no-speech"      → user paused; auto-restart will re-engage
        //  - "audio-capture"  → mic access lost; try once via auto-restart
        //  - "network"        → transient; auto-restart
        //  - "aborted"        → we called stop() ourselves; expected, ignore
        //  - "not-allowed"    → permission denied; FATAL, give up
        //  - "service-not-allowed" → browser policy; FATAL
        //  - "language-not-supported" → bad lang code; FATAL
        const recoverable = ["no-speech", "audio-capture", "network"];
        const fatal = [
          "not-allowed",
          "service-not-allowed",
          "language-not-supported",
        ];
        if (fatal.includes(event.error)) {
          console.error("Speech recognition fatal error:", event.error);
          userWantsRecordingRef.current = false;
          setIsRecording(false);
          return;
        }
        if (event.error === "aborted") {
          // We initiated this stop — let onend handler decide what to do
          return;
        }
        if (recoverable.includes(event.error)) {
          // onend will fire next; auto-restart will handle the bounce-back
          console.warn(
            `Speech recognition recoverable error (${event.error}); will auto-restart.`,
          );
          return;
        }
        // Unknown error — be conservative and stop
        console.error("Speech recognition error:", event.error);
        userWantsRecordingRef.current = false;
        setIsRecording(false);
      };

      recognition.onend = () => {
        // Critical fix: the Web Speech API auto-stops on silence (~3-5s of
        // pause) and at unpredictable intervals during long sessions, even
        // with continuous=true. If the USER hasn't asked to stop, we kick
        // it back on. This is the standard pattern for keeping voice input
        // running through pauses.
        if (userWantsRecordingRef.current && recognitionRef.current) {
          // Debounce: some browsers fire onend twice quickly during the
          // same handoff. Bumped to 250ms because 150ms wasn't enough on
          // some Chrome versions to fully release the previous session
          // before .start() throws InvalidStateError.
          if (restartTimerRef.current) {
            clearTimeout(restartTimerRef.current);
          }
          // Retry chain: if .start() throws InvalidStateError (means the
          // engine is still spinning down), back off and retry up to 3x
          // before giving up. This is the most common cause users see of
          // "mic stops in the middle of recording" — the previous session
          // hadn't finished tearing down yet.
          let retries = 0;
          const tryStart = () => {
            if (!userWantsRecordingRef.current || !recognitionRef.current) {
              return;
            }
            try {
              // Reset the result-promotion watermark — a fresh start()
              // means a new event.results array indexed from 0.
              promotedUpToRef.current = 0;
              recognitionRef.current.start();
              // Keep isRecording true — we never visually "stopped"
            } catch (e: any) {
              if (e?.name === "InvalidStateError" && retries < 3) {
                retries++;
                // Exponential-ish backoff: 250 → 500 → 1000ms
                const delay = 250 * Math.pow(2, retries - 1);
                restartTimerRef.current = setTimeout(tryStart, delay);
                return;
              }
              if (e?.name !== "InvalidStateError") {
                console.error("Speech auto-restart failed:", e);
                userWantsRecordingRef.current = false;
                setIsRecording(false);
              }
              // InvalidStateError after retries: engine thinks it's still
              // recording, so visual state is correct anyway.
            }
          };
          restartTimerRef.current = setTimeout(tryStart, 250);
          return;
        }
        // User explicitly stopped — release the mic indicator
        setIsRecording(false);
      };

      recognitionRef.current = recognition;

      // When the user returns to the tab after switching away, the engine
      // may have been throttled off by the browser. If the user still wants
      // to be recording, give it a kick. This handles the "mic dies when I
      // tab away to read something" failure mode.
      const onVisibilityChange = () => {
        if (
          document.visibilityState === "visible" &&
          userWantsRecordingRef.current &&
          recognitionRef.current
        ) {
          try {
            // Fresh session = fresh result indexing; reset watermark.
            promotedUpToRef.current = 0;
            recognitionRef.current.start();
          } catch (e: any) {
            // InvalidStateError = already running, fine
            if (e?.name !== "InvalidStateError") {
              console.warn("Voice resume on tab-focus failed:", e);
            }
          }
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      // Stash for cleanup
      (recognition as any).__visibilityHandler = onVisibilityChange;
    }

    return () => {
      userWantsRecordingRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
      }
      if (recognitionRef.current) {
        const handler = (recognitionRef.current as any).__visibilityHandler;
        if (handler) {
          document.removeEventListener("visibilitychange", handler);
        }
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) return;
    if (isRecording) {
      // Stop = user intent flips false BEFORE calling stop(), so onend
      // doesn't try to auto-restart us.
      userWantsRecordingRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsRecording(false);
    } else {
      // Start = capture current dump, reset accumulators, set intent on
      dumpBeforeVoiceRef.current = dump.trim();
      finalTranscriptRef.current = "";
      // Reset result-promotion watermark — new session, new event.results.
      promotedUpToRef.current = 0;
      // Apply the user's preferred language right before starting so
      // language changes in settings take effect without a page reload.
      try {
        recognitionRef.current.lang = profile?.defaultLanguage || "en-US";
      } catch {}
      try {
        userWantsRecordingRef.current = true;
        recognitionRef.current.start();
        setIsRecording(true);
      } catch (e) {
        userWantsRecordingRef.current = false;
        console.error("Failed to start speech recognition:", e);
      }
    }
  };

  // Auto-scroll the capture textarea so live voice-to-text stays visible
  // as it accumulates. Without this, the user has to manually scroll to
  // see the latest words, which feels broken during a recording. We only
  // scroll while actively recording (preserves cursor position when typing
  // manually) and only push to bottom — never up — so we don't fight the
  // user if they intentionally scroll back to review earlier text.
  useEffect(() => {
    if (!isRecording) return;
    const el = dumpTextareaRef.current;
    if (!el) return;
    // Scroll only if the user is roughly at the bottom already; if they've
    // scrolled up to review what they said, don't yank them down.
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [dump, isRecording]);

  // ⌘K / Ctrl+K — open Ask my notes. We bail early if the user is typing
  // in any input/textarea/contenteditable so the shortcut never hijacks
  // text editing. Only available when there are notes to ask against.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "k" && e.key !== "K") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (!notesLoaded || notes.length < 5) return;
      e.preventDefault();
      setAskOpen(true);
      setAskAnswer(null);

      setAskMeta(null);
      setAskQuestion("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notesLoaded, notes.length]);

  // When the user closes the note detail view, automatically reset the
  // "previewing-from-Ask" flag so the Ask modal becomes visible again.
  // This is what makes "click source → read note → close → land back on
  // your answer" feel seamless without explicit state management.
  useEffect(() => {
    if (selectedNote === null && askPreviewingSource) {
      setAskPreviewingSource(false);
    }
  }, [selectedNote, askPreviewingSource]);

  useEffect(() => {
    localStorage.setItem("zakar_viewMode", viewMode);
  }, [viewMode]);

  // --- Persist Sort Mode ---
  useEffect(() => {
    localStorage.setItem("zakar_sortBy", sortBy);
  }, [sortBy]);

  // --- Force grid view on mobile (under md = 768px) ---
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const handle = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setViewMode("grid");
    };
    // Check immediately (in case user is already under md after mount)
    handle(mql);
    mql.addEventListener("change", handle);
    return () => mql.removeEventListener("change", handle);
  }, []);

  // --- Persist Sidebar State ---
  useEffect(() => {
    localStorage.setItem("zakar_sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // --- Persist active category so a refresh keeps the user on the same view ---
  useEffect(() => {
    if (activeCategory === null) {
      localStorage.removeItem("zakar_active_category");
    } else {
      localStorage.setItem("zakar_active_category", activeCategory);
    }
  }, [activeCategory]);

  // --- Mobile drawer: force expanded when open; close on viewport resize to desktop ---
  useEffect(() => {
    if (mobileDrawerOpen && sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [mobileDrawerOpen, sidebarCollapsed]);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const close = () => setMobileDrawerOpen(false);
    mql.addEventListener("change", close);
    return () => mql.removeEventListener("change", close);
  }, []);

  // --- Close drawer when user navigates to a different category ---
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [activeCategory]);

  // --- Scroll-aware FAB: watch if capture bar is visible inside the scrollable main ---
  useEffect(() => {
    if (activeCategory === "Trash" || activeCategory === "Archive") {
      setCaptureBarVisible(false);
      return;
    }

    let rafIds: number[] = [];
    let timeoutIds: ReturnType<typeof setTimeout>[] = [];
    let mainEl: HTMLElement | null = null;
    let handler: (() => void) | null = null;
    let mutationObserver: MutationObserver | null = null;

    const compute = () => {
      const el = document.getElementById("zakar-capture-bar");
      const mEl = document.querySelector(
        'main[aria-label="Notes content"]',
      ) as HTMLElement | null;
      if (!el || !mEl) {
        // Capture bar not yet in DOM — assume NOT visible so FAB can show.
        // Better to show a redundant FAB briefly than to hide a missing
        // capture bar's FAB indefinitely.
        setCaptureBarVisible(false);
        return false;
      }
      const mainRect = mEl.getBoundingClientRect();
      const barRect = el.getBoundingClientRect();
      const isVisible =
        barRect.bottom > mainRect.top && barRect.top < mainRect.bottom;
      setCaptureBarVisible(isVisible);
      return true;
    };

    const setup = () => {
      if (!compute()) return; // elements not ready yet

      mainEl = document.querySelector(
        'main[aria-label="Notes content"]',
      ) as HTMLElement | null;
      if (!mainEl) return;

      handler = () => compute();
      mainEl.addEventListener("scroll", handler, { passive: true });
      window.addEventListener("resize", handler);
    };

    // Run compute immediately on effect (synchronous attempt)
    compute();

    // Also schedule multiple retry attempts — the capture bar might not be in
    // the DOM yet on first mount (notes loading), and scroll position may not
    // be restored yet. Try at increasing delays.
    rafIds.push(requestAnimationFrame(setup));
    timeoutIds.push(setTimeout(setup, 100));
    timeoutIds.push(setTimeout(setup, 300));
    timeoutIds.push(setTimeout(setup, 800));

    // Also watch for the capture bar being added to the DOM later
    mutationObserver = new MutationObserver(() => {
      const el = document.getElementById("zakar-capture-bar");
      if (el && !handler) {
        // Element just appeared — run full setup
        setup();
      } else if (el && handler) {
        // Element exists, just recompute in case layout changed
        compute();
      }
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      rafIds.forEach((id) => cancelAnimationFrame(id));
      timeoutIds.forEach((id) => clearTimeout(id));
      if (mainEl && handler) {
        mainEl.removeEventListener("scroll", handler);
      }
      if (handler) {
        window.removeEventListener("resize", handler);
      }
      if (mutationObserver) {
        mutationObserver.disconnect();
      }
    };
  }, [activeCategory, showCaptureModal, selectedNote, notesLoaded]);

  // --- Theme Management ---
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    // Use the View Transitions API when available — gives us a Material-style
    // cross-fade across the whole UI without any per-element transitions.
    // Falls back to instant swap on browsers that don't support it.
    type DocumentWithViewTransition = Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };
    const docVT = document as DocumentWithViewTransition;
    if (typeof docVT.startViewTransition === "function") {
      docVT.startViewTransition(() => {
        setTheme((prev) => (prev === "light" ? "dark" : "light"));
      });
    } else {
      setTheme((prev) => (prev === "light" ? "dark" : "light"));
    }
  };

  // --- Initialization & Share Handling ---
  // We keep a ref to the active shared-note snapshot unsubscriber so
  // we can tear it down on cleanup. Without this, navigating away
  // from a shared note would leak a Firestore listener.
  const sharedNoteUnsubRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");

    const checkShare = async () => {
      // Check if in iframe
      try {
        setIsInIframe(window.self !== window.top);
      } catch (e) {
        setIsInIframe(true);
      }

      if (shareId) {
        // Use onSnapshot so the shared view stays in sync when the
        // owner edits the note. Previous implementation called
        // getDoc once, so viewers were stuck on a stale snapshot
        // until they refreshed. With onSnapshot, every save by the
        // owner flows through to anyone holding the share link.
        try {
          const noteRef = doc(db, "notes", shareId);
          let firstUpdate = true;
          const unsubscribe = onSnapshot(
            noteRef,
            (noteSnap) => {
              if (noteSnap.exists()) {
                const data = noteSnap.data() as Note;
                if (data.isPublic) {
                  setSharedNote({ id: noteSnap.id, ...data });
                } else {
                  // Owner turned sharing off — flip the view to the
                  // unavailable state without forcing a refresh.
                  setSharedNote({
                    id: noteSnap.id,
                    ...data,
                    isPublic: false,
                    _shareUnavailable: true,
                  } as Note & { _shareUnavailable?: boolean });
                }
              } else {
                // Note got deleted while the viewer had it open —
                // surface the unavailable state.
                setSharedNote({
                  id: shareId,
                  title: "",
                  content: "",
                  maskedContent: "",
                  rawContent: "",
                  category: "",
                  tags: [],
                  createdAt: Timestamp.now(),
                  updatedAt: Timestamp.now(),
                  userId: "",
                  isAutoSorted: false,
                  isPublic: false,
                  _shareUnavailable: true,
                } as Note & { _shareUnavailable?: boolean });
              }
              if (firstUpdate) {
                firstUpdate = false;
                setLoading(false);
                setIsCheckingShare(false);
              }
            },
            (error) => {
              console.error("Error subscribing to shared note:", error);
              // Permission denied or the rules disallow reading —
              // mirror the same unavailable fallback the old code
              // used so the viewer sees something coherent.
              setSharedNote({
                id: shareId,
                title: "",
                content: "",
                maskedContent: "",
                rawContent: "",
                category: "",
                tags: [],
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                userId: "",
                isAutoSorted: false,
                isPublic: false,
                _shareUnavailable: true,
              } as Note & { _shareUnavailable?: boolean });
              if (firstUpdate) {
                firstUpdate = false;
                setLoading(false);
                setIsCheckingShare(false);
              }
            },
          );
          // Stash the unsubscribe so the effect cleanup can call it.
          sharedNoteUnsubRef.current = unsubscribe;
          return true;
        } catch (error) {
          console.error("Error fetching shared note:", error);
          setSharedNote({
            id: shareId,
            title: "",
            content: "",
            maskedContent: "",
            rawContent: "",
            category: "",
            tags: [],
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            userId: "",
            isAutoSorted: false,
            isPublic: false,
            _shareUnavailable: true,
          } as Note & { _shareUnavailable?: boolean });
          setLoading(false);
          setIsCheckingShare(false);
          return true;
        }
      }
      setIsCheckingShare(false);
      return false;
    };

    const setupAuth = () => {
      return onAuthStateChanged(auth, (currentUser) => {
        console.log("Auth state changed:", {
          uid: currentUser?.uid,
          isDeleting: isDeletingAccountRef.current,
          isVerifying: isVerifyingForDeletionRef.current,
        });
        setUser(currentUser);
        setIsAuthReady(true);
        if (!currentUser) {
          setNotes([]);
          setLoading(false);
          setNotesLoaded(false);
          // Clear auth form fields
          setEmail("");
          setPassword("");
          setDisplayName("");
          setAuthError(null);
          setIsSignUp(false);
          setIsForgotPassword(false);
          setResetEmailSent(false);
          setVerificationEmailSent(false);
          setPendingVerificationEmail("");
          setPendingVerificationName("");
          // Reset deletion and settings states
          setIsSettingsOpen(false);
          setIsDeleteConfirmOpen(false);
          setDeleteAccountError(null);
          setDeleteConfirmName("");
          setIsIdentityVerified(false);
          setIsVerifyingForDeletion(false);
          isVerifyingForDeletionRef.current = false;

          // Delay resetting isDeletingAccount to catch late-firing snapshots
          if (isDeletingAccountRef.current) {
            console.log(
              "User logged out during deletion. Keeping guard active for 5s...",
            );
            const deletingUid = localStorage.getItem("zakar_last_deleting_uid");
            setTimeout(() => {
              console.log("Resetting isDeletingAccount guard.");
              setIsDeletingAccount(false);
              isDeletingAccountRef.current = false;
              deletionStartedAtRef.current = 0;
              goodbyeEmailSentRef.current = false;
              if (deletingUid) {
                localStorage.removeItem(`zakar_deleting_${deletingUid}`);
                localStorage.removeItem("zakar_last_deleting_uid");
              }
            }, 5000);
          } else {
            setIsDeletingAccount(false);
            goodbyeEmailSentRef.current = false;
          }
        }
      });
    };

    checkShare();
    setupAuth();

    // Safety timeout: if loading takes more than 10 seconds, force it to false
    const safetyTimeout = setTimeout(() => {
      setLoading((currentLoading) => {
        if (currentLoading) {
          console.warn(
            "Loading safety timeout reached. Forcing loading to false.",
          );
          return false;
        }
        return currentLoading;
      });
    }, 10000);

    return () => {
      clearTimeout(safetyTimeout);
      // Tear down the shared-note snapshot subscription so we don't
      // leak a Firestore listener if the component unmounts (e.g.
      // hot-reload, route change).
      if (sharedNoteUnsubRef.current) {
        sharedNoteUnsubRef.current();
        sharedNoteUnsubRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedNote) {
      setIsSharing(false);
      setIsEditing(false);
      setShowRaw(false); setRevealSensitive(false);
    }
  }, [selectedNote]);

  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second for accurate lockout countdowns.
  //
  // CRITICAL: this interval used to run unconditionally, which caused
  // the entire App to re-render every second. That broke text
  // selection in the note modal — users couldn't highlight content
  // with the mouse and Cmd+C, because the selection got cleared on
  // every re-render before they could copy. By gating the interval
  // behind "there's actually a locked note in view," we avoid the
  // 1Hz re-render storm in the common case (no lockout active).
  useEffect(() => {
    const hasActiveLockout =
      selectedNote?.lockedUntil &&
      getTimestampMillis(selectedNote.lockedUntil) > currentTime;
    if (!hasActiveLockout) return;
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [selectedNote?.lockedUntil, currentTime]);

  // Sync selectedNote with latest data from notes array (e.g. background updates from mobile)
  useEffect(() => {
    if (selectedNote) {
      const updatedNote = notes.find((n) => n.id === selectedNote.id);
      if (updatedNote) {
        // If password was removed on another device, unlock automatically
        if (selectedNote.password && !updatedNote.password) {
          setShowPasswordInput(false);
          setEditTitle(updatedNote.title);
          setEditContent(updatedNote.rawContent || updatedNote.content);
        }

        // If note was locked on another device, force password input screen
        if (
          !showPasswordInput &&
          updatedNote.lockedUntil &&
          getTimestampMillis(updatedNote.lockedUntil) > currentTime
        ) {
          setShowPasswordInput(true);
        }

        // Simple comparison to check if we need to update the state
        const hasChanged =
          updatedNote.title !== selectedNote.title ||
          updatedNote.content !== selectedNote.content ||
          updatedNote.password !== selectedNote.password ||
          updatedNote.isStarred !== selectedNote.isStarred ||
          updatedNote.isPublic !== selectedNote.isPublic ||
          updatedNote.isPinned !== selectedNote.isPinned ||
          updatedNote.isArchived !== selectedNote.isArchived ||
          updatedNote.failedAttempts !== selectedNote.failedAttempts ||
          updatedNote.isTrashed !== selectedNote.isTrashed ||
          getTimestampMillis(updatedNote.lockedUntil) !==
            getTimestampMillis(selectedNote.lockedUntil);

        if (hasChanged) {
          // While editing, only sync metadata (star, share, password, lock) —
          // don't overwrite content/title to prevent race conditions with auto-save
          if (isEditing) {
            setSelectedNote((prev) =>
              prev
                ? {
                    ...prev,
                    password: updatedNote.password,
                    isStarred: updatedNote.isStarred,
                    isPublic: updatedNote.isPublic,
                    isPinned: updatedNote.isPinned,
                    isArchived: updatedNote.isArchived,
                    failedAttempts: updatedNote.failedAttempts,
                    lockedUntil: updatedNote.lockedUntil,
                    isTrashed: updatedNote.isTrashed,
                    trashedAt: updatedNote.trashedAt,
                  }
                : prev,
            );
          } else {
            setSelectedNote(updatedNote);
          }
        }
      } else if (!sharedNote) {
        // Note was deleted on another device (and it's not a shared note view)
        setSelectedNote(null);
        setShowPasswordInput(false);
      }
    }
  }, [notes, selectedNote, sharedNote, isEditing]);

  // Auto-save effect
  useEffect(() => {
    if (!isEditing || !selectedNote) return;

    const timeoutId = setTimeout(async () => {
      // Don't auto-save if content is too long
      if (editContent.length > 50000) return;

      // Don't auto-save until the user has actually typed something.
      // The TipTap editor's markdown round-trip on initial load can
      // produce a slightly different string (whitespace normalization)
      // than the original — without this guard, every note open would
      // trigger a phantom auto-save with no real user changes.
      if (!hasEditorTypedRef.current && editTitle === selectedNote.title) {
        return;
      }

      // Don't auto-save if nothing changed. We compare against `content`
      // (the sorted/displayed version), NOT `rawContent`, because that's
      // what we initialized editContent from in openNote.
      if (
        editTitle === selectedNote.title &&
        editContent === selectedNote.content
      )
        return;

      // Re-parse reminder from the edited content so the reminder badge
      // updates dynamically. If the user changes "every Wednesday" to
      // "every Saturday", the badge should reflect that on the next
      // preview refresh, not stick to the original parse from save time.
      // We pass null when the parse returns nothing so a previously-set
      // reminder gets cleared if the user removes the reminder language.
      const newReminder = parseReminder(editContent);

      setIsAutoSaving(true);
      try {
        // Build the update payload. We update `content` (the displayed
        // version) and leave `rawContent` UNTOUCHED — that's the user's
        // original input, preserved for the "View Original" toggle.
        // Overwriting rawContent would break that toggle and lose the
        // user's pre-sort source.
        const hasSensitive = detectSensitiveData(editContent);

        // Quick category re-detection. We don't re-run the full AI
        // sort on every keystroke (too expensive), but we DO want
        // the card preview's category badge to track what the user
        // just typed. Mirror the AI sanitizer's keyword heuristic:
        // sensitive content → Credential; the rest stays as-is so
        // we don't accidentally demote a meaningfully-categorized
        // note (e.g. an "Idea" note where the user happened to
        // paste a long alphanumeric reference).
        const lower = `${editTitle}\n${editContent}`.toLowerCase();
        let nextCategory: string | undefined = undefined;
        if (hasSensitive) {
          nextCategory = "Credential";
        } else if (
          // Demote out of "Credential" if it no longer looks like one
          selectedNote.category === "Credential"
        ) {
          nextCategory = "Other";
        } else if (
          // Promote to clearer category if the user added obvious
          // task signals to a previously-"Other" note.
          selectedNote.category === "Other" &&
          (lower.includes("todo") ||
            lower.includes("[ ]") ||
            /^[-*+]\s*\[/m.test(editContent))
        ) {
          nextCategory = "Task";
        }

        const payload: any = {
          title: editTitle,
          content: editContent,
          updatedAt: Timestamp.now(),
          // Clear the AI-generated masked preview when the user
          // manually edits the note — otherwise the card preview
          // keeps showing the stale pre-edit snippet (it prefers
          // maskedContent over content for the card body). The
          // next AI sort or post-sort pass will regenerate it.
          maskedContent: null,
          // Re-detect sensitive data on the new content so the
          // hasSensitiveData flag (and the auto-lock decision)
          // reflect what the user just typed. detectSensitiveData
          // returns true/false based on regex patterns over the
          // current text — no AI call needed.
          hasSensitiveData: hasSensitive,
        };
        if (nextCategory && nextCategory !== selectedNote.category) {
          payload.category = nextCategory;
        }
        // Reminder needs explicit handling: use null to clear a previous
        // reminder if the new content has none, otherwise set the parsed
        // value. Firestore accepts null for field deletion semantics here.
        payload.reminder = newReminder ?? null;

        await updateDoc(doc(db, "notes", selectedNote.id), payload);
      } catch (error) {
        console.error("Auto-save failed:", error);
      } finally {
        setIsAutoSaving(false);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [editTitle, editContent, isEditing, selectedNote]);

  const getTimestampMillis = (timestamp: any): number => {
    if (!timestamp) return 0;
    try {
      if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
      if (timestamp instanceof Date) return timestamp.getTime();
      if (typeof timestamp === "number") return timestamp;
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? 0 : date.getTime();
    } catch (e) {
      return 0;
    }
  };

  // Strip markdown syntax for clean text preview
  // Render user avatar — photo, selected avatar, or default icon
  const renderAvatar = (size: "sm" | "md" | "lg" = "md") => {
    const sizeClasses = { sm: "w-7 h-7", md: "w-9 h-9", lg: "w-16 h-16" };
    if (user?.photoURL) {
      return (
        <div
          className={cn(
            sizeClasses[size],
            "rounded-full overflow-hidden flex-shrink-0",
          )}
        >
          <img
            src={user.photoURL}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      );
    }
    const avatar = AVATAR_OPTIONS.find((a) => a.id === selectedAvatar);
    if (avatar) {
      return (
        <div
          className={cn(
            sizeClasses[size],
            "rounded-full overflow-hidden flex-shrink-0",
          )}
        >
          <svg viewBox="0 0 100 100" className="w-full h-full">
            {avatar.svg}
          </svg>
        </div>
      );
    }
    // Default fallback — use the first character avatar
    const defaultAv = AVATAR_OPTIONS[0];
    return (
      <div
        className={cn(
          sizeClasses[size],
          "rounded-full overflow-hidden flex-shrink-0",
        )}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {defaultAv.svg}
        </svg>
      </div>
    );
  };

  // ============================================================
  // Markdown component overrides — editorial polish for read-mode
  // ============================================================
  // Phase 1 of the editor mockup: upgrade how content RENDERS without
  // touching how it's edited. Each custom component below maps a
  // standard markdown element to the editorial style from the mockup
  // (emoji-pill headings, callout-card blockquotes, sage-tinted bold,
  // serif italics, refined code chips). The textarea editor still
  // produces plain markdown — we just render it more beautifully.
  //
  // Two non-obvious tricks:
  // 1. Heading emoji-pill: if a heading starts with an emoji glyph,
  //    we extract it and render a colored avatar pill BEFORE the
  //    heading text. Reuses the emoji prefixes the AI already adds to
  //    sorted notes (📌, 🎯, 💡, ⏰, 🛠, ✅ etc.) — zero migration.
  // 2. Callout blockquote: if a blockquote starts with an emoji, it
  //    becomes a sage-tinted card with the emoji as an icon. Otherwise
  //    it renders as the editorial italic quote. Two looks, one
  //    syntax, decided automatically by content.

  /** Extract a leading emoji from string content. Returns [emoji, rest]
   *  or [null, original] if no emoji is present. We use a permissive
   *  regex that catches both standard emoji ranges and modifier
   *  sequences, but bail if the match would also capture text. */
  const extractLeadingEmoji = (text: string): [string | null, string] => {
    if (!text) return [null, text];
    // Match emoji (or emoji + variation/skin-tone modifier) at the start,
    // followed by optional whitespace. The Extended_Pictographic property
    // covers most emoji but isn't supported in all engines, so we use a
    // pragmatic Unicode property class that catches the common cases.
    const m = text.match(
      /^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}]\uFE0F?)\s*/u,
    );
    if (!m) return [null, text];
    return [m[1], text.slice(m[0].length)];
  };

  /** Normalize children to a string when possible, for emoji extraction.
   *  React-markdown gives us children as an array of strings or elements.
   *  We only attempt extraction when the FIRST child is a plain string,
   *  to avoid mangling complex content. */
  const childrenToLeadString = (children: any): string | null => {
    if (typeof children === "string") return children;
    if (Array.isArray(children) && typeof children[0] === "string") {
      return children[0];
    }
    return null;
  };

  /** Replace the leading string in a children array with a new value.
   *  Returns a new array preserving any non-string children that follow
   *  (e.g. inline `<code>`, `<strong>`, etc.). */
  const replaceLeadString = (children: any, newLead: string): any => {
    if (typeof children === "string") return newLead;
    if (Array.isArray(children)) {
      return [newLead, ...children.slice(1)];
    }
    return children;
  };

  const markdownComponents = {
    a: ({ href, children, ...props }: any) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#2d5a44] dark:text-[#8fb89a] hover:text-[#1f4534] dark:hover:text-[#a8d0b0] transition-colors"
        style={{
          textDecoration: "underline",
          textUnderlineOffset: "3px",
          textDecorationColor: "rgba(143, 184, 154, 0.5)",
          textDecorationThickness: "1px",
        }}
        {...props}
      >
        {children}
      </a>
    ),

    // Inline code — sage-tinted chip on paper-soft background.
    // Distinguish inline `code` from block ```code``` by checking the
    // `inline` prop react-markdown provides. Block code falls through
    // to the default <pre><code> rendering.
    code: ({ inline, className, children, ...props }: any) => {
      if (inline) {
        return (
          <code
            className="font-mono text-[0.9em] px-1.5 py-0.5 rounded bg-[#f4f7f2] dark:bg-[#282929] text-[#1f4534] dark:text-[#8fb89a] border border-[#dde5da]/60 dark:border-white/[0.05]"
            style={{
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
            {...props}
          >
            {children}
          </code>
        );
      }
      // Block code: keep default rendering inside <pre>
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },

    // Block code wrapper — editorial dark surface matching the
    // reference design: language label top-left, copy button
    // top-right, deep ink background, mono font.
    //
    // Implementation notes:
    //  • react-markdown passes the language via `node.properties`
    //    on the child <code> element (className like
    //    "language-javascript"). We dig into that to display the
    //    label.
    //  • The copy button extracts text via children traversal —
    //    no DOM ref needed, since the children are React nodes we
    //    can walk recursively.
    //  • Dark surface in BOTH light/dark theme. Matches the
    //    reference screenshot. Code is a dark UI affordance by
    //    convention (terminals, code editors, etc) — keeping
    //    it dark in light mode reads as intentional rather than
    //    a theming bug.
    pre: ({ children, ...props }: any) => {
      // Extract language from the inner <code className="language-xxx">
      let language: string | null = null;
      const child: any = Array.isArray(children) ? children[0] : children;
      if (child?.props?.className) {
        const match = String(child.props.className).match(/language-(\w+)/);
        if (match) {
          language = match[1];
        }
      }
      // Recursively pull plain text from children for copy-to-clipboard.
      const extractText = (node: any): string => {
        if (node == null || node === false) return "";
        if (typeof node === "string" || typeof node === "number")
          return String(node);
        if (Array.isArray(node)) return node.map(extractText).join("");
        if (node.props?.children) return extractText(node.props.children);
        return "";
      };
      const codeText = extractText(children).replace(/\n$/, "");
      // Render via the standalone ZkCodeBlock so it can do its own
      // Prism syntax highlighting and detect the language if the
      // markdown didn't specify one (heuristic on the code body).
      return <ZkCodeBlock code={codeText} language={language} {...props} />;
    },

    // Bold — sage-deep tint, slightly more weight for emphasis.
    strong: ({ children, ...props }: any) => (
      <strong
        className="font-semibold text-[#1f4534] dark:text-[#a8d0b0]"
        {...props}
      >
        {children}
      </strong>
    ),

    // Italic — Fraunces serif italic, the editorial flourish.
    em: ({ children, ...props }: any) => (
      <em
        className="italic text-[#2e3431] dark:zk-text"
        style={{ fontFamily: "var(--font-display)" }}
        {...props}
      >
        {children}
      </em>
    ),

    // H2 with emoji-pill prefix detection.
    h2: ({ children, ...props }: any) => {
      const lead = childrenToLeadString(children);
      const [emoji, rest] = lead
        ? extractLeadingEmoji(lead)
        : [null, lead || ""];
      if (emoji) {
        const restChildren = replaceLeadString(children, rest);
        return (
          <h2
            className="flex items-center gap-3 mt-10 mb-3 zk-text dark:zk-text"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(22px, 2.4vw, 28px)",
              fontWeight: 600,
              letterSpacing: "-0.015em",
              lineHeight: 1.25,
            }}
            {...props}
          >
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#eaf0e8] dark:bg-[#2d5a44]/40 flex-shrink-0"
              style={{ fontSize: "26px", lineHeight: 1 }}
            >
              {emoji}
            </span>
            <span className="min-w-0">{restChildren}</span>
          </h2>
        );
      }
      return (
        <h2
          className="mt-10 mb-3 zk-text dark:zk-text"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 2.4vw, 28px)",
            fontWeight: 600,
            letterSpacing: "-0.015em",
            lineHeight: 1.25,
          }}
          {...props}
        >
          {children}
        </h2>
      );
    },

    // H3 — same family but lighter, no pill.
    h3: ({ children, ...props }: any) => (
      <h3
        className="mt-6 mb-2 text-[18px] zk-text dark:zk-text"
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          lineHeight: 1.4,
        }}
        {...props}
      >
        {children}
      </h3>
    ),

    // Blockquote — auto-callout when leading emoji present, else
    // editorial italic quote. Detection is on the first child of the
    // first child (blockquote > paragraph > text) since markdown wraps
    // quote content in a paragraph. We dig one level for the emoji.
    blockquote: ({ children, ...props }: any) => {
      // The blockquote's children are usually [<p>...</p>] (one paragraph
      // wrapper). To check for an emoji prefix, we have to peek inside
      // the paragraph's children. If we can't, render as editorial quote.
      let calloutEmoji: string | null = null;
      let calloutChildren: any = children;
      try {
        const arr = React.Children.toArray(children);
        if (arr.length > 0 && React.isValidElement(arr[0])) {
          const firstEl = arr[0] as React.ReactElement;
          const firstProps = firstEl.props as { children?: any } | undefined;
          const innerChildren = firstProps?.children;
          const lead = childrenToLeadString(innerChildren);
          if (lead) {
            const [emoji, rest] = extractLeadingEmoji(lead);
            if (emoji) {
              calloutEmoji = emoji;
              const newInner = replaceLeadString(innerChildren, rest);
              const newFirst = React.cloneElement(firstEl, {}, newInner);
              calloutChildren = [newFirst, ...arr.slice(1)];
            }
          }
        }
      } catch {
        // If anything breaks, fall through to default rendering.
      }

      if (calloutEmoji) {
        return (
          <div
            className="my-5 pl-14 pr-5 py-4 rounded-xl bg-[#eaf0e8] dark:bg-[#2d5a44]/15 relative"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            <span
              aria-hidden="true"
              className="absolute left-5 top-4 inline-flex items-center justify-center w-7 h-7 text-[18px]"
            >
              {calloutEmoji}
            </span>
            <div className="text-[14px] zk-text dark:zk-text leading-relaxed [&_p]:m-0 [&_p+p]:mt-2 [&_strong]:text-[#1f4534] [&_strong]:dark:text-[#a8d0b0]">
              {calloutChildren}
            </div>
          </div>
        );
      }

      // Editorial quote — left border, serif italic, brand-tinted.
      // We use inline `borderLeft` style as a guaranteed fallback
      // because some Tailwind JIT setups have stripped the
      // `border-l-[3px]` arbitrary class on production builds in
      // the past, leaving the bar invisible while the text still
      // rendered (the exact user-reported bug).
      return (
        <blockquote
          className="border-l-[4px] border-[#2d5a44] dark:border-[#8fb89a] pl-5 my-6 italic text-[#3a5a46] dark:text-[#c5dbc9] [&_p]:m-0 [&_p+p]:mt-2"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.05em",
            lineHeight: "1.7",
            borderLeftWidth: "4px",
            borderLeftStyle: "solid",
            borderLeftColor: "var(--zk-quote-bar, #2d5a44)",
            paddingLeft: "1.25rem",
            margin: "1.5rem 0",
          }}
          {...props}
        >
          {children}
        </blockquote>
      );
    },

    // Horizontal rule — soft brand-tinted divider, more breath.
    hr: ({ ...props }: any) => (
      <hr
        className="my-8 border-0 border-t border-[#dde5da]/60 dark:border-white/[0.06]"
        {...props}
      />
    ),

    /**
     * List item — filter out empty bullets that AI-sorted output
     * sometimes produces. The sorter occasionally emits markdown like
     *   ## ✅ Task List
     *   -
     *   - [ ] Real task
     * where the bare `-` becomes a visible empty bullet between the
     * heading and real items (see user screenshot of "Task List"
     * with a stray dot under it). Returning null when the item's
     * recursive text content is empty hides the artifact without
     * affecting real list items.
     */
    li: ({ children, ...props }: any) => {
      // Recursively check if the children have ANY non-whitespace
      // text content. React.Children.toArray + a walker is the
      // cleanest way without flattening the tree manually.
      const hasText = (nodes: any): boolean => {
        if (nodes == null || nodes === false) return false;
        if (typeof nodes === "string") return nodes.trim().length > 0;
        if (typeof nodes === "number") return true;
        if (Array.isArray(nodes)) return nodes.some(hasText);
        if (React.isValidElement(nodes)) {
          const props = nodes.props as { children?: any } | undefined;
          return hasText(props?.children);
        }
        return false;
      };
      if (!hasText(children)) return null;
      return <li {...props}>{children}</li>;
    },
  };

  const stripMarkdown = (text: string): string => {
    return text
      .replace(/#{1,6}\s*/g, "") // headings
      .replace(/\*\*(.+?)\*\*/g, "$1") // bold
      .replace(/\*(.+?)\*/g, "$1") // italic
      .replace(/`{1,3}[^`]*`{1,3}/g, "") // code blocks/inline
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
      .replace(/^[\s]*[-*+]\s*/gm, "") // list items
      .replace(/^[\s]*\d+\.\s*/gm, "") // numbered lists
      .replace(/\[[ x]\]\s*/gi, "") // checkboxes
      .replace(/>\s*/g, "") // blockquotes
      .replace(/---+/g, "") // horizontal rules
      // Preserve paragraph and line structure for readable previews.
      // Previously all newlines collapsed into spaces, which made every
      // sorted note read as a single run-on sentence in the card preview.
      // We collapse 3+ blank lines down to a paragraph break, keep single
      // line breaks intact, and let CSS `whitespace-pre-line` render them.
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  /**
   * Repair markdown bold markers that the AI accidentally split across lines.
   * react-markdown (CommonMark) requires ** to open and close on the same line
   * inside a single paragraph/bullet — so input like:
   *
   *   - **01:00 PM
   *   - 01:30 PM EDT**: Website Loading...
   *
   * leaves stray asterisks on screen. This walks the doc line-by-line, and
   * for each line counts unescaped ** pairs. If a line has an odd count, it
   * appends a closing ** at line end and prepends an opening ** to the next
   * non-empty line — preserving the bold visually without merging list items.
   */
  const repairMarkdown = (text: string): string => {
    if (!text) return text;
    // First pass: detect runs of single-backtick "code lines" and
    // bundle them into a fenced code block. The AI sometimes wraps
    // each line of a shell script in single backticks, which
    // renders as a chain of inline <code> chips with broken
    // whitespace between them (visible bug: AVD Initialization
    // Script screenshot). Two or more consecutive such lines
    // become one ```fenced``` block.
    {
      const lines = text.split("\n");
      const out: string[] = [];
      let i = 0;
      const isBacktickLine = (line: string) => /^`[^`]+`$/.test(line.trim());
      while (i < lines.length) {
        if (isBacktickLine(lines[i])) {
          let j = i;
          while (j < lines.length && isBacktickLine(lines[j])) j++;
          if (j - i >= 2) {
            out.push("```");
            for (let k = i; k < j; k++) {
              out.push(lines[k].trim().replace(/^`|`$/g, ""));
            }
            out.push("```");
            i = j;
            continue;
          }
        }
        out.push(lines[i]);
        i++;
      }
      text = out.join("\n");
    }

    if (text.indexOf("**") === -1) return text;
    const lines = text.split("\n");
    let carryOpen = false; // a previous line left a ** unclosed
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // Count ** occurrences (ignore \** escapes). Simple non-greedy scan.
      const matches = line.match(/\*\*/g);
      const count = matches ? matches.length : 0;

      if (carryOpen) {
        // Find the start of content (skip leading whitespace + bullet markers
        // like "- ", "* ", "+ ", or ordered list "1. ")
        const m = line.match(/^(\s*(?:[-*+]\s+|\d+\.\s+)?)(.*)$/);
        if (m && m[2].length > 0) {
          line = `${m[1]}**${m[2]}`;
          carryOpen = false;
        } else {
          // Empty or marker-only line — keep carrying
          lines[i] = line;
          continue;
        }
      }

      // Recount after potential prepend
      const matches2 = line.match(/\*\*/g);
      const count2 = matches2 ? matches2.length : 0;

      if (count2 % 2 === 1) {
        // Odd number of ** on this line — close it at the end and carry the
        // open marker forward to the next line.
        line = line + "**";
        carryOpen = true;
      }

      lines[i] = line;
    }
    // If we ended with an unclosed marker, just drop it (safer than leaving it open)
    if (carryOpen) {
      const last = lines.length - 1;
      if (last >= 0 && lines[last].endsWith("**")) {
        lines[last] = lines[last].slice(0, -2);
      }
    }
    // Final safety net: if any individual line STILL has an odd count of **
    // (e.g. due to nested edge cases the carry logic above missed), strip the
    // leftover orphan markers so the user never sees raw asterisks on screen.
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\*\*/g);
      if (m && m.length % 2 === 1) {
        // Remove the LAST occurrence of ** — most likely the orphan
        const idx = lines[i].lastIndexOf("**");
        if (idx >= 0) {
          lines[i] = lines[i].slice(0, idx) + lines[i].slice(idx + 2);
        }
      }
    }
    // Run bare-URL autolinking AFTER all the bold-repair work so we don't
    // wrap URLs that happen to live inside fixed-up bold spans. This means
    // every site that uses `repairMarkdown(...)` gets clickable bare URLs
    // for free — no per-call-site changes needed.
    return linkifyBareUrls(lines.join("\n"));
  };

  /**
   * Auto-linkify bare URLs that aren't already inside markdown link syntax.
   *
   * Why this exists: CommonMark (which react-markdown speaks by default)
   * does NOT auto-link bare URLs — only ones wrapped in <angle brackets>
   * or [labels](urls) become clickable. We don't have remark-gfm installed,
   * so a sorted note like "see the docs at https://example.com" would
   * render as plain text with no hyperlink. This walks line-by-line, skips
   * any line that already looks like a markdown link, code block, or
   * already-wrapped URL, and wraps remaining bare http(s) URLs in <…>
   * so CommonMark's autolink rule kicks in.
   *
   * Conservative on purpose:
   *   - Skips fenced code blocks (``` ... ```)
   *   - Skips inline code spans (`...`)
   *   - Skips URLs already inside [text](url) or <url>
   *   - Strips trailing punctuation (. , ; : !) so "see https://x.com." links to https://x.com
   */
  const linkifyBareUrls = (text: string): string => {
    if (!text || text.indexOf("http") === -1) return text;

    const lines = text.split("\n");
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Track triple-backtick code fences — leave their contents alone
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      // Find http(s) URLs not already inside a markdown link or autolink.
      // The negative lookbehind `(?<![(<])` is sketchy in older browsers but
      // supported everywhere we care about. Trailing-punctuation stripped.
      lines[i] = line.replace(
        /(?<![(<\w])(https?:\/\/[^\s<>()\[\]'"]+)/g,
        (match) => {
          // Strip trailing punctuation that's almost certainly NOT part of
          // the URL (period/comma at end of sentence, etc.)
          const trailingMatch = match.match(/^(.*?)([.,;:!?)\]]+)$/);
          let url = match;
          let trail = "";
          if (trailingMatch) {
            url = trailingMatch[1];
            trail = trailingMatch[2];
          }
          // Don't double-wrap if this URL is already inside backticks
          // somewhere on the line — heuristic check
          return `<${url}>${trail}`;
        },
      );
    }
    return lines.join("\n");
  };

  // Converts markdown to HTML for rich-text clipboard copy
  // Detect standalone quotes in content and convert to markdown blockquotes
  const preprocessQuotes = (text: string): string => {
    return text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        // Match lines that are wrapped in quotes and stand alone (not already a blockquote)
        if (
          !trimmed.startsWith(">") &&
          /^[""\u201C](.{15,})[""\u201D]$/.test(trimmed)
        ) {
          return `> ${trimmed}`;
        }
        // Match lines starting with quote attribution pattern like "— Author"
        if (/^[-—–]\s*[A-Z]/.test(trimmed) && trimmed.length < 80) {
          return `> *${trimmed}*`;
        }
        return line;
      })
      .join("\n");
  };

  const markdownToHtml = (text: string, forPdf: boolean = false): string => {
    // Some AI outputs (and pasted shell scripts) come in as a run of
    // lines each wrapped in single backticks like:
    //   `line one`
    //   `line two`
    //   `line three`
    // That round-trips into a chain of inline <code> chips with
    // whitespace text nodes between them, which renders as broken
    // prose — not a code block (visible bug: the AVD Initialization
    // Script screenshot). Bundle any run of 2+ such lines into a
    // single fenced ```code block``` so the rest of the pipeline
    // treats it as one preserved block.
    text = (() => {
      const lines = text.split("\n");
      const out: string[] = [];
      let i = 0;
      const isBacktickLine = (line: string) => {
        const t = line.trim();
        // Whole line is `…` and contains no inner backtick.
        return /^`[^`]+`$/.test(t);
      };
      while (i < lines.length) {
        if (isBacktickLine(lines[i])) {
          // Scan ahead for the run
          let j = i;
          while (j < lines.length && isBacktickLine(lines[j])) j++;
          const runLen = j - i;
          if (runLen >= 2) {
            // Bundle the run into a fenced block. Strip the
            // surrounding backticks from each line.
            out.push("```");
            for (let k = i; k < j; k++) {
              out.push(lines[k].trim().replace(/^`|`$/g, ""));
            }
            out.push("```");
            i = j;
            continue;
          }
        }
        out.push(lines[i]);
        i++;
      }
      return out.join("\n");
    })();

    let html = text
      // Fenced code blocks (must be before inline processing). We
      // emit the SAME structured layout as the in-app ZkCodeBlock
      // component — language label top-left, copy-icon-free header
      // (PDFs don't need an interactive button), syntax-highlighted
      // code body. This keeps PDF code blocks visually consistent
      // with what the user sees on screen.
      .replace(/```([a-zA-Z0-9_+-]*)?\n?([\s\S]*?)```/g, (_full, langRaw, body) => {
        const lang = String(langRaw || "").toLowerCase();
        // Friendly display label — keep in sync with ZkCodeBlock.
        const labelMap: Record<string, string> = {
          js: "JavaScript", javascript: "JavaScript",
          ts: "TypeScript", typescript: "TypeScript",
          jsx: "JSX", tsx: "TSX",
          py: "Python", python: "Python",
          rb: "Ruby", ruby: "Ruby",
          go: "Go", rs: "Rust", rust: "Rust",
          java: "Java", kt: "Kotlin", swift: "Swift",
          c: "C", cpp: "C++", cs: "C#",
          php: "PHP", html: "HTML", markup: "HTML",
          css: "CSS", scss: "SCSS",
          json: "JSON", yaml: "YAML", yml: "YAML", xml: "XML",
          sh: "Shell", bash: "Bash", zsh: "Zsh",
          sql: "SQL", md: "Markdown", markdown: "Markdown",
        };
        const label = labelMap[lang] || (lang ? lang : "Code");
        const raw = String(body).replace(/^\n/, "").replace(/\n$/, "");
        // Prism highlighting if we have a grammar for this lang.
        let highlighted: string;
        try {
          const grammar = (Prism.languages as any)[lang] || Prism.languages.markup;
          highlighted = Prism.highlight(raw, grammar, lang || "markup");
        } catch {
          // Fall back to escaped plain text on unknown languages.
          highlighted = raw
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        }
        // The styling lives in the .zpdf-render .zpdf-code-block-*
        // rules — see the PDF stylesheet block below.
        return `<div class="zpdf-code-block"><div class="zpdf-code-block-header"><span class="zpdf-code-block-lang">${label}</span></div><pre class="zpdf-code-block-body"><code class="language-${lang || 'markup'}">${highlighted}</code></pre></div>`;
      })
      // Headings (with or without space after #)
      .replace(
        /^######\s*(.+)$/gm,
        '<h6 style="font-size:13px;font-weight:700;margin:10px 0 4px">$1</h6>',
      )
      .replace(
        /^#####\s*(.+)$/gm,
        '<h5 style="font-size:13px;font-weight:700;margin:10px 0 4px">$1</h5>',
      )
      .replace(
        /^####\s*(.+)$/gm,
        '<h4 style="font-size:14px;font-weight:700;margin:12px 0 4px">$1</h4>',
      )
      .replace(
        /^###\s*(.+)$/gm,
        '<h3 style="font-size:16px;font-weight:700;margin:14px 0 6px">$1</h3>',
      )
      .replace(
        /^##\s*(.+)$/gm,
        '<h2 style="font-size:18px;font-weight:700;margin:16px 0 6px">$1</h2>',
      )
      .replace(
        /^#\s*(.+)$/gm,
        '<h1 style="font-size:20px;font-weight:700;margin:18px 0 8px">$1</h1>',
      )
      // Bold + italic
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      // Inline code
      .replace(
        /`([^`]+)`/g,
        '<code style="background:#f2f4f1;padding:1px 5px;border-radius:4px;font-family:monospace;font-size:13px">$1</code>',
      )
      // Links
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" style="color:#2d5a44;text-decoration:underline">$1</a>',
      )
      // Images → alt text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "<em>[$1]</em>")
      // Horizontal rules
      .replace(
        /^---+$/gm,
        '<hr style="border:none;border-top:1px solid #e5e9e5;margin:12px 0">',
      );
      // Blockquotes are handled per-line in the loop below so we can
      // group consecutive `> ` lines into a single <blockquote>
      // with proper styling (rather than one element per line).

    // Process lines into lists and paragraphs
    const lines = html.split("\n");
    let result = "";
    let inUl = false;
    let inOl = false;
    // Separate tracker for checkbox groups so they wrap in a styled card
    // (matching the in-app checklist look) instead of a plain <ul>.
    let inChecklist = false;
    const closeChecklist = () => {
      if (inChecklist) {
        result += "</div>";
        inChecklist = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Checkbox items (checked)
      const checkedMatch = line.match(/^(\s*)[-*+]\s+\[x\]\s*(.*)/i);
      if (checkedMatch) {
        // Both PDF and on-screen render checkboxes as actual
        // checkbox cards. (Previously PDF converted them to plain
        // bullets, but the user wants them visible as real
        // checkboxes in downloaded PDFs.)
        if (inUl) {
          result += "</ul>";
          inUl = false;
        }
        if (inOl) {
          result += "</ol>";
          inOl = false;
        }
        if (!inChecklist) {
          // Open the checklist card. Padding + rounded edges + thin border
          // matches the in-app checklist look.
          result +=
            '<div class="zpdf-checklist" style="margin:14px 0;padding:4px 0;background:transparent">';
          inChecklist = true;
        }
        // Strikethrough that's bulletproof under html2canvas: insert a
        // Unicode combining-long-stroke (\u0336) after every character.
        // The browser renders this as a real strike line through each glyph,
        // and html2canvas captures it correctly because it's part of the
        // text content, not an overlay or text-decoration that html2canvas
        // mis-positions.
        //
        // Apply only to text content, NOT to HTML tag characters
        // (<strong>, <em>, etc.) — otherwise the tags become visible text
        // in the output.
        const applyStrike = (s: string): string => {
          let out = "";
          let inTag = false;
          for (const ch of s) {
            if (ch === "<") {
              inTag = true;
              out += ch;
            } else if (ch === ">") {
              inTag = false;
              out += ch;
            } else if (inTag) {
              out += ch;
            } else {
              out += ch + "\u0336";
            }
          }
          return out;
        };
        const strikeText = applyStrike(checkedMatch[2]);
        // Use flex layout with align-items:flex-start so the row grows
        // when text wraps — fixed-height was clipping multi-line items
        // on top of each other.
        result += `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
          <div style="flex-shrink:0;width:18px;height:18px;margin-top:2px;border-radius:50%;background:#506455;line-height:0">
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style="display:block">
              <path d="M5 9.2 L7.8 12 L13 6.8" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
          </div>
          <span style="flex:1;color:#9aaa9f;line-height:1.55">${strikeText}</span>
        </div>`;
        continue;
      }

      // Checkbox items (unchecked)
      const uncheckedMatch = line.match(/^(\s*)[-*+]\s+\[\s*\]\s*(.*)/);
      if (uncheckedMatch) {
        // Render as a real checkbox card (same in PDF and on-screen).
        if (inUl) {
          result += "</ul>";
          inUl = false;
        }
        if (inOl) {
          result += "</ol>";
          inOl = false;
        }
        if (!inChecklist) {
          result +=
            '<div class="zpdf-checklist" style="margin:14px 0;padding:4px 0;background:transparent">';
          inChecklist = true;
        }
        result += `<div style="display:flex;align-items:flex-start;gap:12px;padding:4px 0">
          <div style="flex-shrink:0;width:18px;height:18px;margin-top:2px;border-radius:50%;border:2px solid #aeb3af;background:#ffffff;box-sizing:border-box"></div>
          <span style="flex:1;color:#1a1c19;line-height:1.55">${uncheckedMatch[2]}</span>
        </div>`;
        continue;
      }

      // Any non-checkbox line ends the checklist group
      closeChecklist();

      // Blockquote — lines starting with ">" (with optional space).
      // We collect consecutive `>` lines into one <blockquote> so
      // multi-line quotes render as a single visual unit.
      const quoteMatch = line.match(/^>\s?(.*)$/);
      if (quoteMatch) {
        if (inUl) {
          result += "</ul>";
          inUl = false;
        }
        if (inOl) {
          result += "</ol>";
          inOl = false;
        }
        // Scan forward to gather the rest of the blockquote run.
        const quoteLines: string[] = [quoteMatch[1]];
        let j = i + 1;
        while (j < lines.length) {
          const m = lines[j].match(/^>\s?(.*)$/);
          if (!m) break;
          quoteLines.push(m[1]);
          j++;
        }
        // Render with an explicit left border bar and sage tint
        // so it reads as a quote in both clipboard HTML and PDF
        // captures. Padding + radius mirror the in-app editorial
        // style. Italic emphasis is the visual hallmark.
        const body = quoteLines.join("<br>");
        result += `<blockquote style="border-left:4px solid #2d5a44;padding:10px 18px;margin:14px 0;font-style:italic;color:#2e3431;background:rgba(45,90,68,0.05);border-radius:0 10px 10px 0">${body}</blockquote>`;
        // Skip the consumed lines.
        // (i is increased by the outer for-loop, so subtract one.)
        i = j - 1;
        continue;
      }

      // Unordered list items
      const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
      if (ulMatch) {
        if (inOl) {
          result += "</ol>";
          inOl = false;
        }
        if (!inUl) {
          result += '<ul style="padding-left:20px;margin:4px 0;list-style:none">';
          inUl = true;
        }
        result += `<li style="margin:2px 0"><span class="zpdf-li-text">${ulMatch[2]}</span></li>`;
        continue;
      }

      // Ordered list items
      const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);
      if (olMatch) {
        if (inUl) {
          result += "</ul>";
          inUl = false;
        }
        if (!inOl) {
          result += '<ol style="padding-left:20px;margin:4px 0">';
          inOl = true;
        }
        result += `<li style="margin:2px 0"><span class="zpdf-li-text">${olMatch[2]}</span></li>`;
        continue;
      }

      // Skip if it's already an HTML tag (heading, hr, pre, blockquote).
      // These shouldn't get sucked into a <li>, so close any open list first.
      if (line.match(/^<(h[1-6]|hr|pre|blockquote)/)) {
        if (inUl) {
          result += "</ul>";
          inUl = false;
        }
        if (inOl) {
          result += "</ol>";
          inOl = false;
        }
        result += line;
        continue;
      }

      // Empty line → if we're inside a list and the NEXT non-empty
      // line is also a list item, keep the list open (this is the
      // user's intent — "* a\n\n* b" should be one list with two
      // items, not two separate lists). Otherwise close the list
      // and emit a <br>.
      if (line.trim() === "") {
        if (inUl || inOl) {
          // Peek ahead for the next non-empty line.
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === "") j++;
          const next = j < lines.length ? lines[j] : "";
          const nextIsListItem =
            /^(\s*)[-*+]\s+/.test(next) || /^(\s*)\d+\.\s+/.test(next);
          if (nextIsListItem) {
            // Stay inside the current list — skip the blank line.
            continue;
          }
          // Real paragraph break → close the list.
          if (inUl) {
            result += "</ul>";
            inUl = false;
          }
          if (inOl) {
            result += "</ol>";
            inOl = false;
          }
        }
        result += "<br>";
        continue;
      }

      // Close open lists (we got here because the line isn't a list
      // item, isn't empty, isn't a passthrough tag → it's prose).
      if (inUl) {
        result += "</ul>";
        inUl = false;
      }
      if (inOl) {
        result += "</ol>";
        inOl = false;
      }

      // Regular paragraph
      result += `<p style="margin:4px 0">${line}</p>`;
    }

    if (inUl) result += "</ul>";
    if (inOl) result += "</ol>";
    closeChecklist();

    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#2e3431">${result}</div>`;
  };

  // Copy as rich text (HTML) so it pastes formatted in email/docs/etc.
  const copyRichText = async (markdown: string) => {
    try {
      const html = markdownToHtml(markdown);
      const plainText = markdown
        .replace(/#{1,6}\s+/g, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
        .replace(/^[-*+]\s+\[x\]\s*/gim, "✓ ")
        .replace(/^[-*+]\s+\[\s*\]\s*/gm, "☐ ")
        .replace(/^[-*+]\s+/gm, "• ")
        .trim();

      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    } catch (err) {
      // Fallback: plain text copy if ClipboardItem not supported
      console.warn("Rich copy failed, falling back to plain text:", err);
      navigator.clipboard.writeText(markdown);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "...";
    try {
      // Handle both Firestore Timestamp and JS Date
      const date =
        typeof timestamp.toDate === "function"
          ? timestamp.toDate()
          : timestamp instanceof Date
            ? timestamp
            : new Date(timestamp);
      if (isNaN(date.getTime())) return "...";
      return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch (e) {
      console.error("Error formatting date:", e);
      return "...";
    }
  };

  /**
   * Returns a "Edited X ago" string ONLY when:
   *   1. The note has actually been edited after creation (updatedAt > createdAt
   *      by at least 60s — 60s margin avoids showing "edited just now" for
   *      notes whose initial save and Magic Sort completion produce slightly
   *      different timestamps)
   *   2. The edit was within the last 7 days
   * Returns null otherwise so the UI knows to hide the badge entirely.
   */
  const formatEditedAgo = (createdAt: any, updatedAt: any): string | null => {
    if (!createdAt || !updatedAt) return null;
    try {
      const created =
        typeof createdAt.toDate === "function"
          ? createdAt.toDate()
          : new Date(createdAt);
      const updated =
        typeof updatedAt.toDate === "function"
          ? updatedAt.toDate()
          : new Date(updatedAt);
      if (isNaN(created.getTime()) || isNaN(updated.getTime())) return null;

      const editedMs = updated.getTime() - created.getTime();
      // Less than 60s difference → counts as "not edited" (covers the
      // initial-save → AI-sort timestamp drift)
      if (editedMs < 60_000) return null;

      const ageMs = Date.now() - updated.getTime();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      if (ageMs > SEVEN_DAYS) return null;

      const minutes = Math.floor(ageMs / 60_000);
      if (minutes < 1) return "Edited just now";
      if (minutes < 60) return `Edited ${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `Edited ${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `Edited ${days}d ago`;
    } catch {
      return null;
    }
  };

  const formatFullDate = (timestamp: any) => {
    if (!timestamp) return "...";
    try {
      const date =
        typeof timestamp.toDate === "function"
          ? timestamp.toDate()
          : new Date(timestamp);
      return date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: true,
      });
    } catch (e) {
      console.error("Error formatting full date:", e);
      return "...";
    }
  };

  const formatLockoutTime = (millis: number) => {
    const minutes = Math.ceil(millis / 60000);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24)
      return `${hours} hour${hours !== 1 ? "s" : ""}${remainingMinutes > 0 ? `, ${remainingMinutes} min` : ""}`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days} day${days !== 1 ? "s" : ""}${remainingHours > 0 ? `, ${remainingHours} hr` : ""}`;
  };

  // --- Auth & Profile ---
  useEffect(() => {
    if (!user || !isAuthReady || !user.emailVerified) return;

    console.log(`Setting up profile listener for user: ${user.uid}`);
    const userDocRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      async (snapshot) => {
        // Use live auth state to be absolutely sure about current status
        const currentUser = auth.currentUser;
        const now = Date.now();

        // Check localStorage for cross-tab deletion status
        const globalDeletionFlag = localStorage.getItem(
          `zakar_deleting_${user.uid}`,
        );
        const lastDeletingUid = localStorage.getItem("zakar_last_deleting_uid");
        const isRecentlyDeleted =
          now - deletionStartedAtRef.current < 60000 ||
          globalDeletionFlag === "true" ||
          lastDeletingUid === user.uid;

        if (snapshot.exists()) {
          console.log("Profile found in Firestore.");
          const existingProfile = snapshot.data() as UserProfile;
          setProfile(existingProfile);

          // Send welcome email for email-verified accounts on first login after verification
          // (Google users go through the else branch; email users have a pre-existing profile)
          const authCreationTime = user.metadata.creationTime
            ? new Date(user.metadata.creationTime).getTime()
            : 0;
          const isNewAccount = now - authCreationTime < 86400000;
          const globalWelcomeSent = localStorage.getItem(
            `zakar_welcome_sent_${user.uid}`,
          );
          const sessionWelcomeSent = sessionStorage.getItem(
            `zakar_welcome_sent_${user.uid}`,
          );

          if (
            existingProfile.email &&
            isNewAccount &&
            user.emailVerified &&
            !globalWelcomeSent &&
            !sessionWelcomeSent &&
            !welcomeEmailTriggeredRef.current &&
            !isDeletingAccountRef.current &&
            !goodbyeEmailSentRef.current
          ) {
            console.log(
              `Triggering welcome email for verified account: ${existingProfile.email}`,
            );
            welcomeEmailTriggeredRef.current = true;
            sessionStorage.setItem(`zakar_welcome_sent_${user.uid}`, "true");
            localStorage.setItem(`zakar_welcome_sent_${user.uid}`, "true");

            const apiUrl = `${window.location.origin}/api/send-welcome`;
            fetch(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: existingProfile.email,
                name: existingProfile.displayName,
              }),
            })
              .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                  console.log("Welcome email sent successfully:", data);
                } else {
                  console.error("Welcome email failed:", data);
                }
              })
              .catch((err) =>
                console.error("Failed to trigger welcome email:", err),
              );
          }
        } else {
          // Skip profile creation if:
          // 1. We are in the middle of deleting (state/ref check)
          // 2. We are verifying for deletion (SSO re-auth check)
          // 3. We just started deleting (timestamp/localStorage check)
          // 4. User is already logged out (live auth check)
          // 5. User UID has changed or doesn't match the listener's scope (consistency check)
          // 6. Goodbye email was already sent
          if (
            isDeletingAccountRef.current ||
            isVerifyingForDeletionRef.current ||
            isRecentlyDeleted ||
            !currentUser ||
            currentUser.uid !== user.uid ||
            goodbyeEmailSentRef.current ||
            globalDeletionFlag === "true" ||
            lastDeletingUid === user.uid
          ) {
            console.log(
              "Skipping profile creation: Deleting, verifying, logged out, or UID mismatch.",
              {
                isDeleting: isDeletingAccountRef.current,
                isVerifying: isVerifyingForDeletionRef.current,
                isRecentlyDeleted,
                hasUser: !!currentUser,
                uidMatch: currentUser?.uid === user.uid,
                goodbyeSent: goodbyeEmailSentRef.current,
                globalDeletion: globalDeletionFlag === "true",
                lastDeletingUidMatch: lastDeletingUid === user.uid,
              },
            );
            return;
          }

          console.log(
            "User profile not found in Firestore. Creating initial profile...",
          );

          // Create initial profile
          const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || "",
            displayName: user.displayName || "User",
            photoURL: user.photoURL || "",
            autoSortEnabled: true,
            autoLockSensitiveNotes: true,
            createdAt: serverTimestamp(),
          };

          try {
            console.log("Attempting to create profile for:", user.uid);
            await setDoc(userDocRef, newProfile);
            console.log("Profile created successfully in Firestore.");
            setProfile(newProfile);

            // Trigger welcome email ONLY if:
            // 1. The account was created VERY recently (within the last 2 minutes)
            // 2. We are not in the middle of deleting or verifying
            // 3. We haven't already sent a welcome email in this session OR globally recently
            const authCreationTime = user.metadata.creationTime
              ? new Date(user.metadata.creationTime).getTime()
              : 0;
            const isNewAccount = now - authCreationTime < 86400000; // 24 hours — covers time to verify email
            const sessionWelcomeSent = sessionStorage.getItem(
              `zakar_welcome_sent_${user.uid}`,
            );
            const globalWelcomeSent = localStorage.getItem(
              `zakar_welcome_sent_${user.uid}`,
            );

            console.log("Checking if welcome email should be sent:", {
              isNewAccount,
              authCreationTime: user.metadata.creationTime,
              isDeleting: isDeletingAccountRef.current,
              isVerifying: isVerifyingForDeletionRef.current,
              sessionWelcomeSent: !!sessionWelcomeSent,
              globalWelcomeSent: !!globalWelcomeSent,
              welcomeTriggered: welcomeEmailTriggeredRef.current,
            });

            if (
              newProfile.email &&
              isNewAccount &&
              user.emailVerified &&
              !isDeletingAccountRef.current &&
              !isVerifyingForDeletionRef.current &&
              !sessionWelcomeSent &&
              !globalWelcomeSent &&
              !goodbyeEmailSentRef.current &&
              !welcomeEmailTriggeredRef.current &&
              globalDeletionFlag !== "true"
            ) {
              console.log(
                `Triggering welcome email for ${newProfile.email}...`,
              );
              welcomeEmailTriggeredRef.current = true;
              sessionStorage.setItem(`zakar_welcome_sent_${user.uid}`, "true");
              localStorage.setItem(`zakar_welcome_sent_${user.uid}`, "true");

              const apiUrl = `${window.location.origin}/api/send-welcome`;
              fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: newProfile.email,
                  name: newProfile.displayName,
                }),
              })
                .then(async (res) => {
                  const data = await res.json().catch(() => ({}));
                  if (res.ok) {
                    console.log("Welcome email sent successfully:", data);
                  } else {
                    console.error("Welcome email failed to send:", data);
                  }
                })
                .catch((err) =>
                  console.error("Failed to trigger welcome email fetch:", err),
                );
            } else {
              console.log("Welcome email skipped. Reason(s):", {
                noEmail: !newProfile.email,
                notNewAccount: !isNewAccount,
                isDeleting: isDeletingAccountRef.current,
                isVerifying: isVerifyingForDeletionRef.current,
                alreadySentInSession: !!sessionWelcomeSent,
                goodbyeAlreadySent: goodbyeEmailSentRef.current,
                globalDeletion: globalDeletionFlag === "true",
              });
            }
          } catch (error) {
            console.error("Error creating profile:", error);
            handleFirestoreError(
              error,
              OperationType.CREATE,
              `users/${user.uid}`,
            );

            // Fallback: try to fetch if it already exists
            try {
              const directDoc = await getDoc(userDocRef);
              if (directDoc?.exists()) {
                console.log(
                  "Profile found via direct fetch after setDoc failure.",
                );
                setProfile(directDoc.data() as UserProfile);
              }
            } catch (e) {
              console.error("Direct fetch fallback failed:", e);
            }
          }
        }
      },
      (error) => {
        console.error("Profile listener error:", error);
        setLoading(false); // Prevent endless loading on error
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      },
    );

    return () => {
      console.log("Cleaning up profile listener.");
      unsubscribe();
    };
  }, [user, isAuthReady]);

  // --- Notes Listener ---
  // Tracks whether we've already run the legacy-password clearance
  // for the current user. The clearance walks any notes that still
  // carry a real text password (anything other than the new
  // "locked" flag value) and unlocks them, per the spec change to
  // biometric-only locking. We run it exactly once per session
  // when the first batch of notes lands.
  const legacyLocksClearedRef = useRef<string | null>(null);
  // Guards the one-time restore of a previously-open note from
  // localStorage on the first notes snapshot. Without this guard,
  // closing a note would silently re-open it on the next snapshot.
  const selectedNoteRestoredRef = useRef(false);

  // Persist the open note's id so refresh-while-viewing keeps the
  // same note in view. Cleared when the user closes the note.
  useEffect(() => {
    if (!user?.uid) return;
    try {
      if (selectedNote?.id) {
        localStorage.setItem(
          `zakar_selectedNote_${user.uid}`,
          selectedNote.id,
        );
      } else {
        localStorage.removeItem(`zakar_selectedNote_${user.uid}`);
      }
    } catch {
      // localStorage can be full / blocked — non-fatal.
    }
  }, [selectedNote?.id, user?.uid]);

  useEffect(() => {
    if (!user || !isAuthReady) return;

    const notesQuery = query(
      collection(db, "notes"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      notesQuery,
      (snapshot) => {
        console.log("Notes snapshot received:", snapshot.docs.length, "docs");
        const fetchedNotes = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Note[];
        console.log("Fetched notes:", fetchedNotes);
        setNotes(fetchedNotes);
        setLoading(false);
        setNotesLoaded(true);
        // Sync selectedNote with live data so status/content updates reflect in the modal
        setSelectedNote((prev) => {
          if (!prev) {
            // First load — if there's a persisted note id in
            // localStorage, restore it. This makes refresh-while-
            // viewing keep the same note open instead of dropping
            // back to the list. We only do this on the FIRST notes
            // snapshot per session (guarded by the ref) so a later
            // snapshot doesn't re-open a note the user has closed.
            if (
              !selectedNoteRestoredRef.current &&
              user?.uid &&
              typeof window !== "undefined"
            ) {
              selectedNoteRestoredRef.current = true;
              const stored = localStorage.getItem(
                `zakar_selectedNote_${user.uid}`,
              );
              if (stored) {
                const found = fetchedNotes.find((n) => n.id === stored);
                if (found && !found.isTrashed) return found;
              }
            }
            return prev;
          }
          const updated = fetchedNotes.find((n) => n.id === prev.id);
          return updated ? { ...prev, ...updated } : prev;
        });

        // ONE-TIME LEGACY LOCK CLEARANCE — per the password-flow
        // migration. Any note whose `password` field still contains
        // a real text password (anything not equal to the new
        // "locked" flag literal) is force-unlocked: we wipe the
        // password, failed-attempts counter, and lockedUntil
        // timestamp. The user no longer needs to remember the old
        // text password; biometric is the new flow. We deliberately
        // run this exactly once per user per session so a save mid-
        // session doesn't undo the migration.
        if (legacyLocksClearedRef.current !== user.uid) {
          legacyLocksClearedRef.current = user.uid;
          // Match ONLY truly legacy passwords — anything that isn't
          // the literal string "locked" AND doesn't start with
          // "locked:" (the new method-encoded format like
          // "locked:biometric"). Without the second check, the
          // migration would strip every new auto-lock fresh notes
          // get the moment they're created — defeating the
          // auto-lock feature entirely.
          const legacy = fetchedNotes.filter(
            (n) =>
              n.password &&
              n.password !== "locked" &&
              !n.password.startsWith("locked:"),
          );
          if (legacy.length > 0) {
            (async () => {
              try {
                const batch = writeBatch(db);
                legacy.forEach((n) => {
                  // Only clear fields that actually exist in the
                  // notes schema. Firestore security rules whitelist
                  // updatable fields and reject any update that
                  // includes unknown ones — `lockMethod` and
                  // `lockedAt` were considered earlier but never
                  // shipped (we encode the lock method inside the
                  // `password` field as "locked:biometric" etc),
                  // so attempting to write them caused
                  // "Missing or insufficient permissions" errors
                  // for every signed-in user.
                  batch.update(doc(db, "notes", n.id), {
                    password: null,
                    failedAttempts: 0,
                    lockedUntil: null,
                  });
                });
                await batch.commit();
                console.log(
                  `[migration] Cleared legacy password on ${legacy.length} note(s).`,
                );
              } catch (err) {
                console.error(
                  "[migration] Failed to clear legacy locks:",
                  err,
                );
              }
            })();
          }
        }
      },
      (error) => {
        console.error("Notes snapshot error:", error);
        setLoading(false); // Prevent endless loading on error
        handleFirestoreError(error, OperationType.LIST, "notes");
      },
    );

    return () => unsubscribe();
  }, [user, isAuthReady]);

  /**
   * Backfill sortOrder for externally-created notes when in Custom mode.
   *
   * Notes saved by paths OTHER than the React app (e.g. email-in via the
   * server, or any future webhook/integration) don't know what sort
   * mode the user is in — that preference lives in localStorage on the
   * client. Without intervention, those notes arrive with no sortOrder
   * and the comparator buries them at the bottom of Custom-mode views.
   *
   * This effect catches them: when in Custom mode, find any unpinned,
   * non-trashed note that has no sortOrder and assign one above all
   * existing sortOrders. Pinned notes are skipped because their order
   * is governed by their own sortOrder logic in the same comparator —
   * giving them a Custom-mode sortOrder would re-shuffle the pin row.
   *
   * We use a ref-tracked Set to avoid re-issuing writes for the same
   * note across re-renders (Firestore would dedupe, but it'd still cost
   * round-trips and could fight with concurrent writes from other
   * sources). Once a backfill is attempted for a note, we don't try
   * again in this session even if the write somehow fails — better to
   * skip than to loop.
   */
  const backfilledOrderRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (sortBy !== "custom") return;
    if (!notesLoaded || notes.length === 0) return;

    const needsBackfill = notes.filter(
      (n) =>
        !n.isTrashed &&
        !n.isPinned &&
        typeof n.sortOrder !== "number" &&
        !backfilledOrderRef.current.has(n.id),
    );
    if (needsBackfill.length === 0) return;

    // Compute the current ceiling once. New notes get values above it.
    const maxOrder = notes.reduce((max, n) => {
      const o = typeof n.sortOrder === "number" ? n.sortOrder : -Infinity;
      return o > max ? o : max;
    }, -Infinity);
    const base = maxOrder === -Infinity ? 0 : maxOrder;

    // Sort needs-backfill by createdAt descending so the NEWEST emailed-in
    // note ends up with the highest sortOrder = top of grid. If two
    // emails arrived in quick succession, the more recent one wins.
    const sorted = [...needsBackfill].sort(
      (a, b) =>
        getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt),
    );

    // Batch the writes — could be up to 500 notes when a user first
    // flips into Custom mode after having a large library. A single
    // batch is one Firestore round-trip instead of N. Firestore's
    // batch limit is 500 ops, which matches our import cap, so we're
    // safe writing the whole array in one go.
    const batch = writeBatch(db);
    sorted.forEach((note, idx) => {
      const newOrder = base + (sorted.length - idx) * 1000;
      backfilledOrderRef.current.add(note.id);
      batch.update(doc(db, "notes", note.id), { sortOrder: newOrder });
    });
    batch.commit().catch((err) => {
      console.warn(
        `[custom-sort] sortOrder backfill batch failed:`,
        err,
      );
      // The set keeps the IDs so we don't retry forever. User can drag
      // any individual note to manually set its sortOrder.
    });
    // Note: we depend on `notes` so this re-runs when new notes arrive,
    // and on `sortBy` so flipping into Custom mode triggers a one-time
    // backfill of any pre-existing notes that lack sortOrder.
  }, [notes, sortBy, notesLoaded]);

  // --- Actions ---

  /* ============================================================
   * IMPORT FILE → CAPTURE BAR
   * Lets the user pick a local document and drop its text content
   * into the capture textarea — analogous to ChatGPT's upload
   * affordance. Supports common text formats (.txt, .md, .html,
   * .json) plus .docx via mammoth. Legacy .doc (binary) cannot be
   * reliably parsed client-side, so we ask the user to save as
   * .docx and retry. The imported file becomes ONE new note;
   * the AI sorter still runs on it like any other capture.
   * ============================================================ */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const stripHtml = (html: string): string => {
    // Very lightweight HTML → text. We use DOMParser so we honor
    // the document's text content without pulling in a parser lib.
    // Newlines after block elements keep paragraphs separated.
    try {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      // Insert newlines after common block elements
      dom.querySelectorAll(
        "p, br, div, li, h1, h2, h3, h4, h5, h6, tr, pre, blockquote",
      ).forEach((el) => {
        if (el.tagName === "BR") {
          el.replaceWith("\n");
        } else {
          el.append("\n");
        }
      });
      return (dom.body.textContent || "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } catch {
      // Fallback: strip tags with a regex if DOMParser is unavailable
      return html.replace(/<[^>]+>/g, "").trim();
    }
  };

  const handleFileImport = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setImportError(null);
    const file = e.target.files?.[0];
    // Reset the input value so picking the same file twice fires onChange
    if (e.target) e.target.value = "";
    if (!file) return;

    const MAX_BYTES = 5 * 1024 * 1024; // 5MB cap on imports
    if (file.size > MAX_BYTES) {
      setImportError(
        "File is larger than 5MB. Try a smaller file or paste the text directly.",
      );
      return;
    }

    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() : "";

    setImportingFile(true);
    try {
      let text = "";
      if (ext === "docx") {
        // mammoth converts .docx to a plain-text or HTML representation.
        // We pull HTML and then strip it so headings + lists are
        // preserved in the captured content.
        try {
          const mammoth = await import("mammoth");
          const buf = await file.arrayBuffer();
          const { value: html } = await mammoth.convertToHtml({
            arrayBuffer: buf,
          });
          text = stripHtml(html);
        } catch (docxErr: any) {
          const msg = docxErr?.message || "";
          if (
            msg.includes("central directory") ||
            msg.includes("zip") ||
            msg.includes("End of data")
          ) {
            throw new Error(
              "This file appears to be corrupted or isn't a valid .docx file. Try opening it in Word, saving a fresh copy, and importing that instead.",
            );
          }
          throw new Error(
            `Couldn't read this .docx file: ${msg.slice(0, 100)}. The file may be corrupted — try a different copy.`,
          );
        }
      } else if (ext === "doc") {
        // Legacy binary .doc is not parseable in the browser. Tell
        // the user to convert it and retry; we deliberately do not
        // attempt a partial parse because the result would be garbage.
        throw new Error(
          'Legacy ".doc" files aren\'t supported here. Open the file in Word and save it as ".docx", then try again.',
        );
      } else if (ext === "html" || ext === "htm") {
        const raw = await file.text();
        text = stripHtml(raw);
      } else if (ext === "json") {
        const raw = await file.text();
        try {
          // Pretty-print so the JSON is readable as a note body.
          const parsed = JSON.parse(raw);
          text = JSON.stringify(parsed, null, 2);
        } catch {
          // Not valid JSON — keep the raw text, the user may want
          // to fix it inside the note.
          text = raw;
        }
      } else if (ext === "md" || ext === "markdown" || ext === "txt" || !ext) {
        // Plain text and markdown — read as-is.
        text = await file.text();
      } else {
        throw new Error(
          `Unsupported file type ".${ext}". Try .md, .txt, .html, .json, or .docx.`,
        );
      }

      text = text.replace(/\r\n/g, "\n").trim();
      if (!text) {
        throw new Error(
          "Couldn't pull any text out of that file. It might be empty or scanned-image-only.",
        );
      }

      // Cap at the same 50k limit the textarea enforces. We import as
      // ONE note (the user's preference); truncate with a clear marker
      // rather than silently dropping content.
      const MAX_CHARS = 50000;
      if (text.length > MAX_CHARS) {
        text =
          text.slice(0, MAX_CHARS - 200) +
          "\n\n…[content truncated — original file exceeded 50,000 characters]";
      }

      // Prepend a tiny source line so the user sees where the content
      // came from. Kept minimal so the AI sorter can still title from
      // the body.
      const sourceLine = `_Imported from ${file.name}_\n\n`;
      const next = (sourceLine + text).slice(0, 50000);
      setDump(next);
      if (user?.uid) {
        try {
          localStorage.setItem(`zakar_dump_${user.uid}`, next);
        } catch {
          // localStorage may be full or blocked — non-fatal.
        }
      }
    } catch (err: any) {
      setImportError(err?.message || "Failed to import that file.");
    } finally {
      setImportingFile(false);
    }
  };

  const handleDump = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dump.trim() || !user) return;
    if (dump.length > 50000) {
      alert("Dump content exceeds the 50,000 character limit.");
      return;
    }

    // Stop voice recording if active. Clear user intent so the auto-restart
    // handler in onend doesn't bounce recognition back on after we submit.
    if (isRecording && recognitionRef.current) {
      userWantsRecordingRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsRecording(false);
    }

    const rawContent = dump;
    const selectedFormat = formatType;
    setDump("");
    setFormatType("auto");
    localStorage.removeItem("zakar_dump");

    // If the user captured a new note while reading another one, close
    // the open note so they can see their just-captured note appear at
    // the top of the list. Without this, the new note is invisible
    // behind the open-note overlay until the user manually closes it.
    if (selectedNote) {
      setSelectedNote(null);
      setRevealSensitive(false);
    }

    try {
      // Detect reminder intent from the raw dump BEFORE we save. The
      // parser is conservative — returns null unless the text contains
      // both an explicit reminder verb ("remind me", "don't forget") AND
      // some temporal information. So this only fires for actual reminders.
      const rawReminder = parseReminder(rawContent);

      // In CUSTOM sort mode, every existing visible note has a sortOrder
      // (or eventually will after a drag), and the comparator places
      // notes-with-sortOrder ABOVE notes-without. So a brand-new note
      // saved without a sortOrder ends up at the BOTTOM of the grid,
      // which is the opposite of what the user expects.
      //
      // Fix: if we're in custom mode, give the new note a sortOrder
      // higher than any existing note's. This pins it to the top, then
      // any subsequent drag refines its position.
      let newSortOrder: number | undefined;
      if (sortBy === "custom") {
        const maxOrder = notes.reduce((max, n) => {
          const o = typeof n.sortOrder === "number" ? n.sortOrder : -Infinity;
          return o > max ? o : max;
        }, -Infinity);
        // +1000 leaves room for fractional inserts via drag without
        // requiring a renumbering pass. Same gap size used by handleDragEnd.
        newSortOrder = (maxOrder === -Infinity ? 0 : maxOrder) + 1000;
      }

      // 1. Save the note immediately with raw content so it appears instantly
      // Status is 'processing' so the UI can show a subtle sorting indicator
      const noteId = await saveNote({
        title: rawContent.substring(0, 80).trim() || "New Note",
        content: rawContent,
        maskedContent: rawContent,
        rawContent: rawContent,
        category: "Other",
        tags: [],
        isAutoSorted: false,
        status: profile?.autoSortEnabled ? "processing" : "ready",
        formatType: selectedFormat,
        ...(rawReminder ? { reminder: rawReminder } : {}),
        ...(newSortOrder !== undefined ? { sortOrder: newSortOrder } : {}),
      });

      // POST-CREATE VISIBILITY GUARANTEE — make absolutely sure the
      // user can see their new note. Without these the new note can
      // get hidden by an active category/starred filter, or buried
      // by sort order, or be invisible because the user is currently
      // looking at a previously-opened note that occupies the
      // detail panel.
      // 1. Close the currently-open detail view so the list is visible.
      setSelectedNote(null);
      // 2. Reset to the "All" view so a non-All filter doesn't hide
      //    the new note (which has category "Other" until AI sorts it).
      //    NOTE: the All view is represented by `activeCategory === null`,
      //    not the literal string "All". Setting it to "All" would
      //    make the filter try to match `note.category === "All"` which
      //    is never true — leaving the user looking at an empty list
      //    with "No all notes" heading (user-reported bug).
      if (activeCategory !== null) {
        setActiveCategory(null);
      }
      // 3. Scroll the notes list back to the top so the new card is
      //    in viewport. We do this on a microtask so React has
      //    flushed the setSelectedNote(null) re-render first.
      Promise.resolve().then(() => {
        try {
          const scroller =
            document.querySelector('[data-notes-scroll-region]') ||
            window;
          if (scroller === window) {
            window.scrollTo({ top: 0, behavior: "smooth" });
          } else {
            (scroller as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
          }
        } catch {
          // non-fatal
        }
      });

      // 2. Only sort if Magic Sort is enabled
      if (profile?.autoSortEnabled) {
        // Sort in the background — don't block the UI
        // The onSnapshot listener will auto-update the note when sorting finishes
        magicSort(rawContent, selectedFormat, profile?.defaultLanguage)
          .then(async (sorted) => {
            try {
              // Check if note still exists and is not trashed — user may have deleted it mid-process
              const noteSnap = await getDoc(doc(db, "notes", noteId));
              if (!noteSnap.exists()) {
                // Note was permanently deleted during processing — abort the update
                return;
              }
              const noteData = noteSnap.data() as
                | { isTrashed?: boolean }
                | undefined;
              if (noteData?.isTrashed) {
                // Note was trashed during processing — don't apply AI sort, just mark ready
                await updateDoc(doc(db, "notes", noteId), {
                  status: "ready",
                  updatedAt: serverTimestamp(),
                });
                return;
              }

              await updateDoc(doc(db, "notes", noteId), {
                title: sorted.title,
                content: sorted.content,
                maskedContent: sorted.maskedContent,
                category: sorted.category,
                tags: sorted.tags,
                isAutoSorted: !sorted.isError,
                status: sorted.isError ? "error" : "ready",
                updatedAt: serverTimestamp(),
              });

              // POST-SORT AUTO-LOCK: re-evaluate sensitive content
              // after AI sort, since the user may have pasted raw
              // credentials that only the AI fully formatted. Also
              // catches the case where category came back as
              // "Credential". We never trigger biometric enrollment
              // here — see the inline createNote auto-lock for the
              // rationale.
              try {
                const noteSnapAfter = await getDoc(doc(db, "notes", noteId));
                if (noteSnapAfter.exists()) {
                  const noteAfter = noteSnapAfter.data() as Note;
                  const isCredentialCategory =
                    (sorted.category || "").toLowerCase().includes("credential");
                  const hasSensitive = detectSensitiveData(
                    [
                      noteAfter.content,
                      noteAfter.rawContent,
                      sorted.title,
                    ]
                      .filter(Boolean)
                      .join("\n"),
                  );
                  const shouldLock =
                    (isCredentialCategory || hasSensitive) &&
                    profile?.autoLockSensitiveNotes !== false &&
                    !noteAfter.password &&
                    !noteAfter.isTrashed;
                  if (shouldLock) {
                    let lockMethodFlag: LockMethod = "account-password";
                    if (user) {
                      const alreadyEnrolled = !!localStorage.getItem(
                        `zakar_webauthn_credid_${user.uid}`,
                      );
                      if (alreadyEnrolled) lockMethodFlag = "biometric";
                    }
                    await updateDoc(doc(db, "notes", noteId), {
                      password: `locked:${lockMethodFlag}`,
                      hasSensitiveData: true,
                      failedAttempts: 0,
                      lockedUntil: null,
                    });
                    console.log(
                      `[auto-lock post-sort] Locked note ${noteId} (category=${sorted.category}, method=${lockMethodFlag})`,
                    );
                  }
                }
              } catch (autoLockErr) {
                console.warn(
                  "[auto-lock post-sort] failed:",
                  autoLockErr,
                );
              }
            } catch (updateError) {
              console.error("Background sort update failed:", updateError);
              try {
                await updateDoc(doc(db, "notes", noteId), {
                  status: "ready",
                  updatedAt: serverTimestamp(),
                });
              } catch (e) {
                console.error("Failed to reset note status:", e);
              }
            }
          })
          .catch((error) => {
            console.error("Background magicSort failed:", error);
            // Check existence before trying to update
            getDoc(doc(db, "notes", noteId))
              .then((snap) => {
                if (snap.exists()) {
                  return updateDoc(doc(db, "notes", noteId), {
                    status: "ready",
                    updatedAt: serverTimestamp(),
                  });
                }
              })
              .catch((e) => console.error("Failed to reset note status:", e));
          });
      } else {
        // Magic Sort disabled — save as ready immediately
        await updateDoc(doc(db, "notes", noteId), {
          status: "ready",
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("Error in handleDump:", error);
    }
  };

  const handleRetryProcessing = async (note: Note) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "notes", note.id), { status: "processing" });

      // Sort in background
      magicSort(note.rawContent || note.content)
        .then(async (sorted) => {
          try {
            await updateDoc(doc(db, "notes", note.id), {
              title: sorted.title,
              content: sorted.content,
              maskedContent: sorted.maskedContent,
              category: sorted.category,
              tags: sorted.tags,
              isAutoSorted: !sorted.isError,
              status: sorted.isError ? "error" : "ready",
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            console.error("Retry update failed:", error);
            await updateDoc(doc(db, "notes", note.id), {
              status: "ready",
            }).catch(() => {});
          }
        })
        .catch(async (error) => {
          console.error("Retry processing failed:", error);
          await updateDoc(doc(db, "notes", note.id), { status: "ready" }).catch(
            () => {},
          );
        });
    } catch (error) {
      console.error("Retry processing failed:", error);
    }
  };

  const saveNote = async (noteData: Partial<Note>): Promise<string> => {
    if (!user) return "";
    const finalNote = {
      ...noteData,
      userId: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isStarred: false,
      isPublic: false,
      isPinned: false,
      isArchived: false,
      isTrashed: false,
      trashedAt: null,
      hasSensitiveData:
        profile?.autoLockSensitiveNotes !== false
          ? detectSensitiveData(noteData.rawContent || noteData.content || "")
          : false,
      failedAttempts: 0,
      lockedUntil: null,
      status: noteData.status || "ready",
    };
    const docRef = await addDoc(collection(db, "notes"), finalNote);

    // AUTO-LOCK: if the note contains sensitive data (passwords,
    // API keys, credentials) AND the user has auto-lock enabled,
    // lock it immediately after creation. We DO NOT trigger biometric
    // enrollment here — that requires a user gesture and would
    // interrupt the capture flow. Instead, we set the lock method
    // based on what's already available:
    //   - If the user has previously enrolled biometric on this
    //     device → use biometric.
    //   - Otherwise → use account-password (the unlock prompt will
    //     ask for biometric / account password at unlock time).
    if (
      finalNote.hasSensitiveData &&
      profile?.autoLockSensitiveNotes !== false &&
      !finalNote.password
    ) {
      try {
        // Decide method without prompting. Even if biometric is
        // technically available on the device, prefer account-password
        // for auto-lock unless the user has already enrolled — so we
        // never silently trigger a "scan your fingerprint" popup
        // mid-capture.
        let lockMethodFlag: LockMethod = "account-password";
        if (user) {
          const alreadyEnrolled =
            !!localStorage.getItem(`zakar_webauthn_credid_${user.uid}`);
          if (alreadyEnrolled) {
            lockMethodFlag = "biometric";
          }
        }
        await updateDoc(doc(db, "notes", docRef.id), {
          password: `locked:${lockMethodFlag}`,
          failedAttempts: 0,
          lockedUntil: null,
        });
        console.log(
          `[auto-lock] Locked sensitive note ${docRef.id} with method: ${lockMethodFlag}`,
        );
      } catch (autoLockErr) {
        // Non-fatal: the note was saved, just not auto-locked.
        console.warn(
          "[auto-lock] Failed to auto-lock sensitive note:",
          autoLockErr,
        );
      }
    }

    return docRef.id;
  };

  /**
   * Export all of the user's non-trashed notes as a downloadable .zip
   * containing one .md file per note plus a manifest.json for lossless
   * round-trip import.
   */
  /** Export format chooser — when set, the format-picker popover shows.
   *  Cleared after a format is picked or the user cancels. */
  const [exportPickerOpen, setExportPickerOpen] = useState(false);

  const handleExportAllNotes = async (
    format: "markdown" | "html" | "json" = "markdown",
  ) => {
    if (!user || isExporting) return;
    try {
      setIsExporting(true);
      // Active notes only — skip trashed. (Users can restore from trash first
      // if they want them included.)
      const exportable = notes
        .filter((n) => !n.isTrashed && !n.password)
        .map((n) => ({
          id: n.id,
          title: n.title || "Untitled",
          content: n.content || "",
          category: n.category,
          tags: n.tags,
          isStarred: n.isStarred,
          isPinned: n.isPinned,
          isArchived: n.isArchived,
          backgroundColor: n.backgroundColor,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        }));

      if (exportable.length === 0) {
        alert("You don't have any notes to export yet.");
        return;
      }

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);

      // Format-specific export. Each format produces a single Blob the user
      // downloads. Markdown is a .zip of .md files; HTML and JSON are
      // single self-contained files for portability.
      if (format === "html") {
        const blob = exportNotesAsHtml(exportable);
        downloadBlob(blob, `zakar-export-${stamp}.html`);
      } else if (format === "json") {
        const blob = exportNotesAsJson(exportable);
        downloadBlob(blob, `zakar-export-${stamp}.json`);
      } else {
        const blob = exportNotesToZip(exportable);
        downloadBlob(blob, `zakar-export-${stamp}.zip`);
      }
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
      setExportPickerOpen(false);
    }
  };

  /**
   * Compute a fast, non-cryptographic content fingerprint for duplicate
   * detection on import. We hash (lowercased title + first 500 chars of
   * body) — this is robust to whitespace/case differences but discriminates
   * legitimate non-duplicates that share a title (e.g. two notes both named
   * "Untitled"). We use FNV-1a 32-bit because:
   *   - It's tiny (~12 lines), no crypto-subtle async, no library
   *   - Collisions on this dataset shape are vanishingly rare
   *   - Same fingerprint = same content for our purposes
   * If we ever need cryptographic guarantees we can swap to SHA-256.
   */
  const fingerprint = (title: string, content: string): number => {
    const normalized =
      (title || "").toLowerCase().trim() +
      "\n" +
      (content || "").slice(0, 500).toLowerCase().trim();
    let h = 2166136261; // FNV-1a 32-bit offset basis
    for (let i = 0; i < normalized.length; i++) {
      h ^= normalized.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  };

  /** Build a Set of fingerprints for the user's existing non-trashed notes,
   *  used to detect re-imports. Computed fresh per import — cheap (~1ms for
   *  1000 notes) and keeps it accurate as the library changes. */
  const buildExistingFingerprintSet = (): Set<number> => {
    const set = new Set<number>();
    for (const n of notes) {
      if (n.isTrashed) continue;
      set.add(fingerprint(n.title, n.rawContent || n.content));
    }
    return set;
  };

  /**
   * Handle a user-selected import file (.md / .zip). Two-phase pipeline:
   *
   *   Phase 1: bulk-save raw notes to Firestore (fast, ~200ms each).
   *   Phase 2: AI-sort each saved note via magicSort (slow, ~3s each).
   *
   * Phase 2 only runs if the user opted in via the import settings toggle.
   * When the source is a Zakar export, phase 2 ALSO skips notes that already
   * have a non-default category — those were sorted before export, no need
   * to spend Gemini calls re-sorting them.
   *
   * The user can cancel mid-import via the toast's Cancel button (sets
   * importCancelRef.current = true). The loop checks this between iterations
   * and exits gracefully, leaving phase-1 imports in place.
   */
  const handleImportFile = async (file: File) => {
    if (!user) return;
    importCancelRef.current = false;
    setImportLastResult(null);
    setImportStatus({ state: "parsing", message: "Reading file…" });

    let result: {
      notes: ParsedNote[];
      issues: ImportIssue[];
      wasZakarExport: boolean;
    };
    try {
      result = await parseImportFile(file);
    } catch (err: any) {
      // Fatal upload error — give the user actionable info, not just "failed"
      const message = err?.message || "Couldn't read this file.";
      setImportStatus({ state: "error", message });
      setImportLastResult({
        success: 0,
        failed: 0,
        aiSortFailures: 0,
        skipped: 0,
        cancelled: false,
      });
      return;
    }

    const { notes: parsed, issues, wasZakarExport } = result;

    if (parsed.length === 0) {
      const issueSummary =
        issues.length > 0
          ? ` ${issues.length} file${issues.length === 1 ? "" : "s"} skipped.`
          : "";
      setImportStatus({
        state: "error",
        message: `No notes found in this file.${issueSummary}`,
      });
      setImportLastResult({
        success: 0,
        failed: 0,
        aiSortFailures: 0,
        skipped: issues.length,
        cancelled: false,
      });
      return;
    }

    // Duplicate detection — fingerprint each parsed note against the user's
    // existing library. If any matches, pause and ask the user how to handle
    // them (skip dupes / import everything / cancel). The decision dispatches
    // through to runImportPipeline below.
    const existingFps = buildExistingFingerprintSet();
    const duplicateIndices = new Set<number>();
    for (let i = 0; i < parsed.length; i++) {
      const fp = fingerprint(parsed[i].title, parsed[i].content);
      if (existingFps.has(fp)) duplicateIndices.add(i);
    }

    if (duplicateIndices.size > 0) {
      // Reset the active toast — we're going to show a modal for input
      setImportStatus({ state: "idle" });
      setImportDupePrompt({ parsed, issues, wasZakarExport, duplicateIndices });
      return;
    }

    // No duplicates — proceed straight through
    await runImportPipeline(parsed, issues, wasZakarExport);
  };

  /**
   * The actual phase-1 + phase-2 import pipeline. Extracted from
   * handleImportFile so the duplicate-prompt modal can invoke it AFTER
   * the user has decided what to do with detected duplicates.
   */
  const runImportPipeline = async (
    parsed: ParsedNote[],
    issues: ImportIssue[],
    wasZakarExport: boolean,
  ) => {
    setImportStatus({
      state: "importing",
      progress: { current: 0, total: parsed.length },
    });

    /* ===== PHASE 1: Import all notes raw =====
       Save each parsed note to Firestore unsorted. Fast (~200ms/note), so
       progress updates feel responsive and notes appear in the UI right
       away. We collect the resulting (id, rawContent, category) for phase 2. */
    let success = 0;
    let failed = 0;
    let cancelled = false;
    const importedForSort: Array<{
      id: string;
      rawContent: string;
      category: string;
    }> = [];

    // If we're in custom sort mode, imported notes need sortOrder values
    // or they'll all sink to the bottom (see comparator notes). We
    // assign DESCENDING values starting above the current max — this
    // way the FIRST imported note ends up at the top of the visible
    // grid (matching how a fresh capture lands), and subsequent
    // imports fall in below it but still above existing notes.
    let nextImportSortOrder: number | null = null;
    if (sortBy === "custom") {
      const maxOrder = notes.reduce((max, n) => {
        const o = typeof n.sortOrder === "number" ? n.sortOrder : -Infinity;
        return o > max ? o : max;
      }, -Infinity);
      // Reserve enough room for the whole batch with a 100-step gap each.
      nextImportSortOrder =
        (maxOrder === -Infinity ? 0 : maxOrder) + parsed.length * 100;
    }

    for (let i = 0; i < parsed.length; i++) {
      if (importCancelRef.current) {
        cancelled = true;
        break;
      }
      const p = parsed[i];
      const noteCategory = p.category || "Uncategorized";
      try {
        const payload: Partial<Note> = {
          title: p.title,
          content: p.content,
          rawContent: p.content,
          maskedContent: p.content,
          category: noteCategory,
          tags: p.tags || [],
          isAutoSorted: false,
          isStarred: p.isStarred || false,
          isPinned: p.isPinned || false,
          isArchived: p.isArchived || false,
          status: "ready",
        };
        if (p.backgroundColor) payload.backgroundColor = p.backgroundColor;
        if (nextImportSortOrder !== null) {
          payload.sortOrder = nextImportSortOrder;
          nextImportSortOrder -= 100; // next note slots just below this one
        }
        const newId = await saveNote(payload);
        success++;
        if (importSortWithAI && newId) {
          importedForSort.push({
            id: newId,
            rawContent: p.content,
            category: noteCategory,
          });
        }
      } catch (err) {
        console.error("Failed to import note:", p.title, err);
        failed++;
      }
      setImportStatus({
        state: "importing",
        progress: { current: i + 1, total: parsed.length },
      });
    }

    /* ===== PHASE 2: AI-sort each imported note =====
       SMART SKIP: For Zakar exports, only re-sort notes whose category
       wasn't preserved (i.e. "Uncategorized"). Zakar exports include
       category metadata, so re-running the AI on already-categorized notes
       just burns Gemini quota for no benefit. Non-Zakar imports have no
       reliable category, so we sort all of them. */
    const sortQueue = importedForSort.filter((item) => {
      if (!wasZakarExport) return true; // sort everything from non-Zakar sources
      // Zakar source: only sort if the category wasn't already set
      return !item.category || item.category === "Uncategorized";
    });
    const skippedFromSort = importedForSort.length - sortQueue.length;

    let aiSortFailures = 0;
    if (importSortWithAI && sortQueue.length > 0 && !importCancelRef.current) {
      for (let i = 0; i < sortQueue.length; i++) {
        if (importCancelRef.current) {
          cancelled = true;
          break;
        }
        const item = sortQueue[i];
        // Set the "starting note i" progress, THEN yield to the event loop
        // so React actually paints the update before we block on magicSort
        // for ~3 seconds. Without the microtask flush, React 18 batches this
        // setter with the previous iteration's end-of-iteration setter,
        // leaving small (1-2 note) imports looking frozen at 100% the whole
        // time. The 0ms timeout is the cheapest way to force a paint.
        setImportStatus({
          state: "sorting",
          progress: { current: i, total: sortQueue.length },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Mark this specific note as "processing" so its card shows the
        // pulsing green dot. We reset to "ready" (or "error") after sort.
        try {
          await updateDoc(doc(db, "notes", item.id), {
            status: "processing",
          });
        } catch {
          /* doc might already be gone if user trashed instantly — fall through */
        }

        try {
          const sorted = await magicSort(
            item.rawContent,
            "auto",
            profile?.defaultLanguage,
          );

          // Re-check: did the user trash this note while we were waiting on
          // the AI? If so, abandon the update — writing over a trashed note
          // surprises users who already moved on. This mirrors the regular
          // handleAdd path's mid-process trash check.
          const noteSnap = await getDoc(doc(db, "notes", item.id));
          if (!noteSnap.exists()) {
            // Permanently deleted — nothing to update
            continue;
          }
          const data = noteSnap.data() as { isTrashed?: boolean } | undefined;
          if (data?.isTrashed) {
            // Trashed during sort — just clear the processing state
            await updateDoc(doc(db, "notes", item.id), {
              status: "ready",
            }).catch(() => {});
            continue;
          }

          if (sorted.isError) {
            aiSortFailures++;
            console.warn(
              `[import] magicSort returned isError=true for note ${item.id}. Check VITE_GEMINI_API_KEY.`,
            );
            // Reset status so the green dot stops pulsing on a failed note
            await updateDoc(doc(db, "notes", item.id), {
              status: "ready",
            }).catch(() => {});
          } else {
            await updateDoc(doc(db, "notes", item.id), {
              title: sorted.title,
              content: sorted.content,
              maskedContent: sorted.maskedContent,
              category: sorted.category,
              tags: sorted.tags,
              isAutoSorted: true,
              status: "ready",
              updatedAt: serverTimestamp(),
            });
          }
        } catch (sortErr) {
          aiSortFailures++;
          console.warn(`[import] magicSort threw for ${item.id}:`, sortErr);
          // CRITICAL: reset status on throw so the dot doesn't pulse forever
          await updateDoc(doc(db, "notes", item.id), {
            status: "ready",
          }).catch(() => {});
        }
        setImportStatus({
          state: "sorting",
          progress: { current: i + 1, total: sortQueue.length },
        });
      }
    }

    // Build a human result message
    const parts: string[] = [];
    if (cancelled) {
      parts.push(
        `Cancelled. ${success} note${success === 1 ? "" : "s"} imported before stop.`,
      );
    } else {
      parts.push(`Imported ${success} note${success === 1 ? "" : "s"}.`);
    }
    if (failed > 0) parts.push(`${failed} failed to save.`);
    if (issues.length > 0)
      parts.push(`${issues.length} file${issues.length === 1 ? "" : "s"} skipped.`);
    if (importSortWithAI && skippedFromSort > 0) {
      parts.push(
        `Skipped AI sort for ${skippedFromSort} already-organized note${skippedFromSort === 1 ? "" : "s"}.`,
      );
    }
    if (importSortWithAI && aiSortFailures > 0) {
      parts.push(
        `AI sort failed on ${aiSortFailures} note${aiSortFailures === 1 ? "" : "s"} — saved as-is.`,
      );
    }

    // Persist the result so Settings can show recovery options
    setImportLastResult({
      success,
      failed,
      aiSortFailures,
      skipped: issues.length,
      cancelled,
    });

    setImportStatus({
      state: "done",
      message: parts.join(" "),
    });

    // Auto-clear the toast after a few seconds; the persistent result
    // banner in Settings stays until dismissed or replaced.
    setTimeout(() => setImportStatus({ state: "idle" }), 7000);
  };

  /** User-initiated cancel from the import progress toast. The currently
   *  in-flight magicSort call still completes, but the loop will not start
   *  another iteration. Phase-1 notes already saved are kept. */
  const cancelImport = () => {
    importCancelRef.current = true;
  };

  /**
   * Bulk-sort recovery: AI-organize every note in the user's library that
   * isn't already auto-sorted (and isn't trashed/archived/locked). Useful
   * after a partial AI failure during import, OR for users who imported
   * without AI sort but later changed their mind.
   *
   * Same loop pattern as phase 2 of import — magicSort + updateDoc per
   * note, with cancel via bulkSortCancelRef.
   */
  const handleBulkSortUnsorted = async () => {
    if (!user || bulkSortStatus.state === "running") return;
    bulkSortCancelRef.current = false;

    const candidates = notes.filter(
      (n) =>
        !n.isAutoSorted &&
        !n.isTrashed &&
        !n.isArchived &&
        !n.password &&
        (n.rawContent || n.content),
    );

    if (candidates.length === 0) {
      setBulkSortStatus({
        state: "done",
        message: "All your notes are already organized.",
      });
      setTimeout(() => setBulkSortStatus({ state: "idle" }), 4000);
      return;
    }

    setBulkSortStatus({
      state: "running",
      progress: { current: 0, total: candidates.length },
    });

    let sorted = 0;
    let failedSort = 0;
    let cancelled = false;

    for (let i = 0; i < candidates.length; i++) {
      if (bulkSortCancelRef.current) {
        cancelled = true;
        break;
      }
      const note = candidates[i];
      setBulkSortStatus({
        state: "running",
        progress: { current: i, total: candidates.length },
      });
      // Same flush trick as the import sort loop — guarantees React paints
      // the new progress value before we block on magicSort. Otherwise
      // small bulk-sort runs (1-3 notes) appear frozen at 0% then jump to
      // done, with no intermediate movement visible.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Mark the in-flight note "processing" so its card pulses the dot
      try {
        await updateDoc(doc(db, "notes", note.id), { status: "processing" });
      } catch {
        /* fall through — doc may have been deleted */
      }

      try {
        const result = await magicSort(
          note.rawContent || note.content,
          "auto",
          profile?.defaultLanguage,
        );

        // Re-check trash state mid-flight: user may have moved this note
        // to trash while the AI was thinking. Don't overwrite trashed notes.
        const snap = await getDoc(doc(db, "notes", note.id));
        if (!snap.exists()) {
          continue;
        }
        const data = snap.data() as { isTrashed?: boolean } | undefined;
        if (data?.isTrashed) {
          await updateDoc(doc(db, "notes", note.id), {
            status: "ready",
          }).catch(() => {});
          continue;
        }

        if (result.isError) {
          failedSort++;
          await updateDoc(doc(db, "notes", note.id), {
            status: "ready",
          }).catch(() => {});
        } else {
          await updateDoc(doc(db, "notes", note.id), {
            title: result.title,
            content: result.content,
            maskedContent: result.maskedContent,
            category: result.category,
            tags: result.tags,
            isAutoSorted: true,
            status: "ready",
            updatedAt: serverTimestamp(),
          });
          sorted++;
        }
      } catch (err) {
        console.warn(`[bulk-sort] failed for ${note.id}:`, err);
        failedSort++;
        await updateDoc(doc(db, "notes", note.id), {
          status: "ready",
        }).catch(() => {});
      }
      setBulkSortStatus({
        state: "running",
        progress: { current: i + 1, total: candidates.length },
      });
    }

    const parts: string[] = [];
    if (cancelled) {
      parts.push(
        `Cancelled. Sorted ${sorted} of ${candidates.length} note${candidates.length === 1 ? "" : "s"}.`,
      );
    } else {
      parts.push(`Sorted ${sorted} note${sorted === 1 ? "" : "s"}.`);
    }
    if (failedSort > 0) parts.push(`${failedSort} failed.`);

    setBulkSortStatus({ state: "done", message: parts.join(" ") });
    setTimeout(() => setBulkSortStatus({ state: "idle" }), 6000);
  };

  /** Cancel the in-flight bulk sort. */
  const cancelBulkSort = () => {
    bulkSortCancelRef.current = true;
  };

  /**
   * "Ask my notes" — runs the recall pipeline.
   *   1. Embed any notes that are stale or missing an embedding (lazy backfill)
   *   2. Embed the question
   *   3. Score, retrieve top hits, generate a grounded answer
   *
   * The first call from a user with many existing notes will spend a few
   * seconds on indexing. Subsequent calls only embed newly-edited notes.
   * We persist embeddings to Firestore as we compute them so the cost is
   * truly one-time per note (not per session).
   */
  const handleAskNotes = async (question: string) => {
    const q = question.trim();
    if (!q || !user) return;
    setAskLoading(true);
    setAskAnswer(null);

    setAskMeta(null);
    askCancelRef.current = false;

    try {
      const ai = await getAI();
      if (!ai) {
        setAskAnswer({
          text: "AI isn't configured for this app. Please contact support if this is unexpected.",
          hits: [],
        });
        return;
      }

      // Lazy index: embed anything that's stale or never embedded. This
      // amortizes cost — first ask is slow if you have a big library, but
      // every subsequent ask is fast because embeddings are persisted.
      //
      // CRITICAL: We collect freshly-computed embeddings into a local map
      // as the commit callback fires. The closure-captured `notes` array
      // does NOT update synchronously after Firestore writes — the
      // onSnapshot listener fires async and React state updates on the
      // next tick. Without this map, `askNotes` below would run against
      // the pre-embedding snapshot of `notes` and find zero candidates,
      // even though we just persisted vectors for all of them.
      const freshEmbeddings = new Map<
        string,
        { embedding: number[]; embeddingHash: string }
      >();
      const stale = findStaleNotes(notes as any);
      if (stale.length > 0) {
        setAskIndexing({ done: 0, total: stale.length });
        await embedNotes(
          ai,
          notes as any,
          async (id, embedding, embeddingHash) => {
            // Persist to Firestore for future sessions
            await updateDoc(doc(db, "notes", id), {
              embedding,
              embeddingHash,
            });
            // ALSO stash in the local map so we can answer this question
            // immediately, without waiting for the snapshot listener.
            freshEmbeddings.set(id, { embedding, embeddingHash });
          },
          (done, total) => setAskIndexing({ done, total }),
          () => askCancelRef.current,
        );
        setAskIndexing(null);
        if (askCancelRef.current) {
          setAskLoading(false);
          return;
        }
      }

      // Merge freshly-computed embeddings into the notes array we pass to
      // askNotes. Notes that already had a valid embedding from a previous
      // session keep theirs; notes we just embedded get the merged version.
      const mergedNotes = (notes as any[]).map((n) => {
        const fresh = freshEmbeddings.get(n.id);
        if (fresh) {
          return {
            ...n,
            embedding: fresh.embedding,
            embeddingHash: fresh.embeddingHash,
          };
        }
        return n;
      });

      // Time the answer generation so we can show "Answered in Xs" in the
      // result header. Only counts the askNotes call itself — the indexing
      // pass that runs before is shown via its own progress bar.
      const t0 = performance.now();
      const answer = await askNotes(ai, q, mergedNotes, {
        topK: 6,
        minScore: 0.3,
      });
      const durationMs = performance.now() - t0;

      // Confidence: combines retrieval quality with the model's own
      // self-assessment. With topK now capped at 3 and the relative-gap
      // filter active, the hits we DO get back are pre-filtered for
      // relevance — so a single strong hit should already register as
      // high confidence (we wouldn't have surfaced it otherwise).
      //
      // Signals weighed:
      //   - top hit score (how relevant is the BEST match)
      //   - second hit score (corroboration, when it exists)
      //   - groundedNotFound flag (the model's own admission)
      //
      // Cutoffs are calibrated for the gemini-embedding-001 768-dim
      // space we use. A score ≥0.65 on this scale is a strong match
      // for whole-note embeddings; ≥0.7 is very strong.
      let confidence: "high" | "medium" | "low" = "low";
      const topScore = answer.hits[0]?.score ?? 0;
      const secondScore = answer.hits[1]?.score ?? 0;

      if (topScore >= 0.65) {
        // Strong top hit, with or without corroboration. The retrieval
        // pipeline already filtered out weak matches, so a top hit at
        // this level means the answer is genuinely there.
        confidence = "high";
      } else if (topScore >= 0.55) {
        // Solid top hit but not a slam dunk. Two solid hits = stronger
        // signal than one (corroboration), so still medium even if both
        // are 0.55-0.64.
        confidence = "medium";
      }
      // groundedNotFound forces low — even with high retrieval scores
      // the model itself said the notes don't contain the answer.
      // (Now uses the stricter detection from notesRecall.ts that
      // doesn't false-positive on disclaimer preambles.)
      if (answer.groundedNotFound) confidence = "low";

      setAskMeta({ durationMs, confidence });
      setAskAnswer(answer);
    } catch (err) {
      console.error("[ask] failed:", err);
      setAskAnswer({
        text: "Sorry, something went wrong. Please try again.",
        hits: [],
      });
      setAskMeta(null);
    } finally {
      setAskLoading(false);
      setAskIndexing(null);
    }
  };


  /** Click the hidden file input to trigger the OS file picker. */
  const triggerImportPicker = () => {
    if (
      importStatus.state === "parsing" ||
      importStatus.state === "importing" ||
      importStatus.state === "sorting"
    )
      return;
    importFileInputRef.current?.click();
  };

  /** Toggle the "sort imports with AI" preference and persist to localStorage. */
  const toggleImportSortWithAI = () => {
    const next = !importSortWithAI;
    setImportSortWithAI(next);
    try {
      localStorage.setItem("zakar_import_sort_with_ai", next ? "1" : "0");
    } catch {
      /* localStorage unavailable — no-op */
    }
  };

  const deleteNote = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (note?.password) {
      alert("This note is locked. Please remove the password before deleting.");
      return;
    }
    try {
      // Soft-delete: move to trash instead of permanent deletion
      await updateDoc(doc(db, "notes", id), {
        isTrashed: true,
        trashedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (selectedNote?.id === id) {
        setSelectedNote(null);
      }
    } catch (error) {
      console.error("Soft-delete failed:", error);
      handleFirestoreError(error, OperationType.UPDATE, `notes/${id}`);
    }
  };

  const trashWithUndo = (note: Note) => {
    if (note.password) {
      alert("This note is locked. Remove the password first.");
      return;
    }
    // Clear any existing toast timeout
    if (trashedToast) {
      clearTimeout(trashedToast.timeout);
    }
    // Immediately trash
    deleteNote(note.id);
    // Show undo toast with auto-dismiss
    const timeout = setTimeout(() => {
      setTrashedToast(null);
    }, 5000);
    setTrashedToast({ id: note.id, title: note.title, timeout });
  };

  const undoTrash = () => {
    if (!trashedToast) return;
    clearTimeout(trashedToast.timeout);
    restoreNote(trashedToast.id);
    setTrashedToast(null);
  };

  const dismissTrashToast = () => {
    if (trashedToast) {
      clearTimeout(trashedToast.timeout);
      setTrashedToast(null);
    }
  };

  const restoreNote = async (id: string) => {
    try {
      await updateDoc(doc(db, "notes", id), {
        isTrashed: false,
        trashedAt: null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Restore failed:", error);
      handleFirestoreError(error, OperationType.UPDATE, `notes/${id}`);
    }
  };

  const permanentlyDeleteNote = async (id: string) => {
    try {
      await deleteDoc(doc(db, "notes", id));
      if (selectedNote?.id === id) {
        setSelectedNote(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `notes/${id}`);
    }
  };

  const emptyTrash = async () => {
    const trashedNotes = notes.filter((n) => n.isTrashed);
    try {
      await Promise.all(
        trashedNotes.map((n) => deleteDoc(doc(db, "notes", n.id))),
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, "notes/trash");
    }
  };

  // Auto-delete notes that have been in trash for 7+ days
  useEffect(() => {
    if (!user) return;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const expiredNotes = notes.filter((n) => {
      if (!n.isTrashed || !n.trashedAt) return false;
      const trashedTime =
        n.trashedAt instanceof Timestamp
          ? n.trashedAt.toMillis()
          : n.trashedAt?.seconds
            ? n.trashedAt.seconds * 1000
            : 0;
      return trashedTime > 0 && trashedTime < sevenDaysAgo;
    });
    expiredNotes.forEach((n) => {
      deleteDoc(doc(db, "notes", n.id)).catch((err) =>
        console.error("Auto-delete expired trash failed:", err),
      );
    });
  }, [notes, user]);

  const toggleAutoSort = async () => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        autoSortEnabled: !profile.autoSortEnabled,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const toggleSensitiveDataDetection = async () => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        autoLockSensitiveNotes: !(profile as any).autoLockSensitiveNotes,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const updateDefaultLanguage = async (code: string) => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        defaultLanguage: code,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  // ===== DnD Sensors =====
  const dndSensors = useSensors(
    // Desktop: mouse drag with small distance threshold (8px) to distinguish clicks from drags
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Mobile: require a 250ms long-press with tolerance before activating drag.
    // This prevents scrolling from being hijacked as a drag.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ===== Multi-select helpers =====
  const toggleNoteSelection = (
    noteId: string,
    mode: "toggle" | "range" | "single",
    visibleIds: string[],
  ) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (mode === "single") {
        next.clear();
        next.add(noteId);
      } else if (mode === "toggle") {
        if (next.has(noteId)) next.delete(noteId);
        else next.add(noteId);
      } else if (mode === "range" && lastSelectedId) {
        const startIdx = visibleIds.indexOf(lastSelectedId);
        const endIdx = visibleIds.indexOf(noteId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = [
            Math.min(startIdx, endIdx),
            Math.max(startIdx, endIdx),
          ];
          for (let i = from; i <= to; i++) next.add(visibleIds[i]);
        } else {
          next.add(noteId);
        }
      } else {
        next.add(noteId);
      }
      return next;
    });
    setLastSelectedId(noteId);
  };

  const clearSelection = () => {
    setSelectedNoteIds(new Set());
    setLastSelectedId(null);
  };

  // ===== Batch actions =====
  const batchAction = async (
    action:
      | "trash"
      | "archive"
      | "unarchive"
      | "pin"
      | "unpin"
      | "star"
      | "unstar"
      | "delete",
  ) => {
    const ids = Array.from(selectedNoteIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(
        ids.map((id) => {
          const ref = doc(db, "notes", id);
          switch (action) {
            case "trash":
              return updateDoc(ref, {
                isTrashed: true,
                trashedAt: serverTimestamp(),
              });
            case "archive":
              return updateDoc(ref, { isArchived: true, isPinned: false });
            case "unarchive":
              return updateDoc(ref, { isArchived: false });
            case "pin":
              return updateDoc(ref, { isPinned: true });
            case "unpin":
              return updateDoc(ref, { isPinned: false });
            case "star":
              return updateDoc(ref, { isStarred: true });
            case "unstar":
              return updateDoc(ref, { isStarred: false });
            case "delete":
              return deleteDoc(ref);
          }
        }),
      );
      clearSelection();
    } catch (error) {
      console.error("Batch action failed:", error);
    }
  };

  const batchSetCategory = async (category: string) => {
    const ids = Array.from(selectedNoteIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(
        ids.map((id) =>
          updateDoc(doc(db, "notes", id), {
            category,
            // Flag so AI doesn't re-categorize on next edit
            isAutoSorted: false,
          }),
        ),
      );
      clearSelection();
    } catch (error) {
      console.error("Batch category change failed:", error);
    }
  };

  const batchSetColor = async (colorKey: string) => {
    const ids = Array.from(selectedNoteIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(
        ids.map((id) =>
          updateDoc(doc(db, "notes", id), {
            backgroundColor: colorKey,
            updatedAt: Timestamp.now(),
          }),
        ),
      );
      clearSelection();
    } catch (error) {
      console.error("Batch color change failed:", error);
    }
  };

  // ===== Drag handlers =====
  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveDragId(id);
    // If the dragged note isn't already selected, select only it
    if (!selectedNoteIds.has(id)) {
      setSelectedNoteIds(new Set([id]));
      setLastSelectedId(id);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined;
    if (overId && typeof overId === "string" && overId.startsWith("sidebar-")) {
      setDragOverSidebarKey(overId.replace("sidebar-", ""));
    } else {
      setDragOverSidebarKey(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    setDragOverSidebarKey(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const draggedIds = selectedNoteIds.has(activeId)
      ? Array.from(selectedNoteIds)
      : [activeId];

    // Case 1: dropped on a sidebar target
    if (typeof overId === "string" && overId.startsWith("sidebar-")) {
      const targetKey = overId.replace("sidebar-", "");
      try {
        await Promise.all(
          draggedIds.map((id) => {
            const ref = doc(db, "notes", id);
            switch (targetKey) {
              case "Trash":
                return updateDoc(ref, {
                  isTrashed: true,
                  trashedAt: serverTimestamp(),
                });
              case "Archive":
                return updateDoc(ref, {
                  isArchived: true,
                  isPinned: false,
                });
              case "Starred":
                return updateDoc(ref, { isStarred: true });
              case "All":
                // Restore from archive/trash
                return updateDoc(ref, {
                  isTrashed: false,
                  isArchived: false,
                });
              case "Locked":
                // Can't set password via drag (needs user input) — no-op
                return Promise.resolve();
              case "Shared":
                return updateDoc(ref, { isPublic: true });
              default:
                // Category targets (Task, Idea, Credential, etc.)
                return updateDoc(ref, {
                  category: targetKey,
                  isAutoSorted: false,
                });
            }
          }),
        );
        clearSelection();
      } catch (error) {
        console.error("Drag-to-sidebar failed:", error);
      }
      return;
    }

    // Case 2: reorder within the notes grid.
    //
    // IMPORTANT: per the sort comparator (B+C), sortOrder is only honored
    // for PINNED notes. For unpinned notes, the sort uses max(createdAt,
    // updatedAt) and ignores sortOrder entirely.
    //
    // So we only do the reorder write when BOTH dragged and target are
    // pinned (reordering within the pinned group). For unpinned notes,
    // we silently skip the write — otherwise the user would see the note
    // animate to the new position, then snap back when the data refreshes,
    // which is more confusing than just not allowing the drag.
    if (activeId !== overId) {
      const draggedNote = filteredNotes.find((n) => n.id === activeId);
      const targetNote = filteredNotes.find((n) => n.id === overId);
      if (!draggedNote || !targetNote) return;

      // Reorder rules depend on the active sort mode:
      //   - "custom"  → drag-reorder works for ALL notes (manual order wins)
      //   - "newest"/"oldest"/"alphabetical" → drag-reorder works for PINNED
      //     notes (sortOrder is honored only for them), AND for unpinned
      //     notes IF the user is willing to switch to Custom sort mode.
      //
      // To match Google Keep's drag-anywhere feel, an unpinned drag
      // automatically flips sortBy to "custom" — same as Keep's mental
      // model where any drag implies "I want to manage the order myself".
      // We show a toast so the change isn't silent.
      //
      // Either way, both notes must be on the same side of the pin
      // boundary — we never let a drag mix pinned and unpinned notes.
      const sameGroup = draggedNote.isPinned === targetNote.isPinned;
      if (!sameGroup) return;

      // Cross-time-group drags would re-bucket the note awkwardly (a Today
      // note dragged into Last Week wouldn't actually change its date).
      // We only allow drags within the same time group when sortBy is
      // newest/oldest. Custom sort has no time groups so this doesn't apply.
      // The check happens by comparing the time-group label of both notes.
      if (sortBy !== "custom" && !draggedNote.isPinned) {
        // Auto-flip to Custom sort so the drag actually persists. Saved
        // to localStorage immediately so a refresh keeps the new mode.
        setSortBy("custom");
        try {
          localStorage.setItem("zakar_sortBy", "custom");
        } catch {
          /* non-fatal */
        }
        // Subtle toast so users know what just happened. Auto-dismisses.
        showToast(
          "Now sorting manually. Change back in the sort menu.",
          "info",
        );
      }

      // Build the reorder array scoped to the SAME group as the dragged
      // note. If we used the full filteredNotes here, an unpinned drag
      // could end up with `prev` being a pinned note (or vice versa),
      // and `seedFor(prev)` would pull in a sortOrder from the wrong
      // group — the resulting midpoint would be meaningless for the
      // unpinned ordering and the visual position wouldn't match the
      // computed sortOrder. Scoping the array fixes the "drag last
      // unpinned to first slot doesn't work" bug.
      const groupNotes = filteredNotes.filter(
        (n) => !!n.isPinned === !!draggedNote.isPinned,
      );
      const allNoteIds = groupNotes.map((n) => n.id);
      const oldIdx = allNoteIds.indexOf(activeId);
      const newIdx = allNoteIds.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1) return;

      // Simulate the reorder locally to find the notes that now surround the dragged note
      const reordered = arrayMove(groupNotes, oldIdx, newIdx);
      const movedIdx = reordered.findIndex((n) => n.id === activeId);
      const prev = reordered[movedIdx - 1];
      const next = reordered[movedIdx + 1];

      // Compute a sortOrder that sits between prev and next.
      // Higher sortOrder = earlier in list (because sort is `bOrder - aOrder`).
      // Strategy:
      //   - If moved to top (no prev): new = (next.sortOrder ?? 0) + 1000
      //   - If moved to bottom (no next): new = (prev.sortOrder ?? 0) - 1000
      //   - If between: new = midpoint of prev and next's sortOrder
      // Fall back to createdAt-derived seed if a neighbor has no sortOrder yet.
      const seedFor = (n: Note | undefined): number => {
        if (!n) return 0;
        if (typeof n.sortOrder === "number") return n.sortOrder;
        const ms = getTimestampMillis(n.createdAt);
        // Convert ms timestamp to a comparable sortOrder (divide to avoid huge numbers)
        return Math.floor(ms / 1000);
      };

      const prevOrder = seedFor(prev);
      const nextOrder = seedFor(next);
      let newOrder: number;
      if (!prev) {
        // Top of list: greater than next
        newOrder = nextOrder + 1000;
      } else if (!next) {
        // Bottom of list: less than prev
        newOrder = prevOrder - 1000;
      } else {
        // Between: midpoint
        newOrder = (prevOrder + nextOrder) / 2;
      }

      // Avoid collision: if the midpoint equals a neighbor exactly (float precision),
      // pad the gap by rewriting both neighbors.
      const writes: Promise<void>[] = [];
      writes.push(
        updateDoc(doc(db, "notes", activeId), { sortOrder: newOrder }).catch(
          (e) => console.error("Reorder main write failed:", e),
        ) as Promise<void>,
      );

      // If multi-selected, move the others just after the primary one
      if (draggedIds.length > 1) {
        let gap = 500;
        draggedIds.forEach((id) => {
          if (id === activeId) return;
          writes.push(
            updateDoc(doc(db, "notes", id), {
              sortOrder: newOrder - gap,
            }).catch((e) =>
              console.error("Reorder batch write failed:", e),
            ) as Promise<void>,
          );
          gap += 500;
        });
      }

      try {
        await Promise.all(writes);
      } catch (error) {
        console.error("Reorder failed:", error);
      }
    }
  };

  // Show a generic action toast with Undo
  const showActionToast = (
    action:
      | "archived"
      | "unarchived"
      | "pinned"
      | "unpinned"
      | "starred"
      | "unstarred",
    note: Note,
    undoFn: () => Promise<void>,
  ) => {
    if (actionToast) clearTimeout(actionToast.timeout);
    const timeout = setTimeout(() => setActionToast(null), 4000);
    setActionToast({
      action,
      noteId: note.id,
      title: note.title,
      timeout,
      undoFn,
    });
  };

  const undoActionToast = async () => {
    if (!actionToast) return;
    clearTimeout(actionToast.timeout);
    try {
      await actionToast.undoFn();
    } catch (e) {
      console.error("Undo failed:", e);
    }
    setActionToast(null);
  };

  const dismissActionToast = () => {
    if (actionToast) {
      clearTimeout(actionToast.timeout);
      setActionToast(null);
    }
  };

  const toggleStar = async (note: Note) => {
    try {
      const newStarred = !note.isStarred;
      await updateDoc(doc(db, "notes", note.id), {
        isStarred: newStarred,
      });
      if (selectedNote?.id === note.id) {
        setSelectedNote({ ...selectedNote, isStarred: newStarred });
      }
      showActionToast(newStarred ? "starred" : "unstarred", note, async () => {
        await updateDoc(doc(db, "notes", note.id), {
          isStarred: !newStarred,
        });
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notes/${note.id}`);
    }
  };

  const togglePin = async (note: Note) => {
    try {
      const newPinned = !note.isPinned;
      await updateDoc(doc(db, "notes", note.id), {
        isPinned: newPinned,
      });
      if (selectedNote?.id === note.id) {
        setSelectedNote({ ...selectedNote, isPinned: newPinned });
      }
      showActionToast(newPinned ? "pinned" : "unpinned", note, async () => {
        await updateDoc(doc(db, "notes", note.id), {
          isPinned: !newPinned,
        });
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notes/${note.id}`);
    }
  };

  const toggleArchive = async (note: Note) => {
    try {
      const newArchived = !note.isArchived;
      const prevPinned = note.isPinned ?? false;
      await updateDoc(doc(db, "notes", note.id), {
        isArchived: newArchived,
        isPinned: false, // Unpin when archiving
      });
      if (selectedNote?.id === note.id) {
        if (newArchived) {
          setSelectedNote(null); // Close detail when archiving
        } else {
          setSelectedNote({ ...selectedNote, isArchived: false });
        }
      }
      showActionToast(
        newArchived ? "archived" : "unarchived",
        note,
        async () => {
          await updateDoc(doc(db, "notes", note.id), {
            isArchived: !newArchived,
            // Restore prior pin state when undoing archive
            isPinned: newArchived ? prevPinned : false,
          });
        },
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notes/${note.id}`);
    }
  };

  const toggleShare = async (note: Note) => {
    try {
      const newPublic = !note.isPublic;
      await updateDoc(doc(db, "notes", note.id), {
        isPublic: newPublic,
      });
      if (selectedNote?.id === note.id) {
        setSelectedNote({ ...selectedNote, isPublic: newPublic });
      }
      // Auto-close share popover when unsharing
      if (!newPublic) {
        setTimeout(() => setIsSharing(false), 300);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notes/${note.id}`);
    }
  };

  const handleCopyShareLink = (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}?share=${id}`;
    navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => {
      setShareCopied(false);
      setIsSharing(false);
    }, 1500);
  };

  // Auto-dismiss AI action toast after 3.5s
  useEffect(() => {
    if (!aiActionToast) return;
    const t = setTimeout(() => setAiActionToast(null), 3500);
    return () => clearTimeout(t);
  }, [aiActionToast]);

  /* ============================================================
     handleBreakdown — take current editContent, call AI to split
     into 3-6 atomic steps, append them as checkboxes to the content.
     Does NOT save to Firestore — auto-save will pick up the change.
     ============================================================ */
  const handleBreakdown = async () => {
    if (isBreakingDown) return;
    if (!selectedNote) return;
    const source = editContent.trim();
    if (source.length < 3) {
      alert("Write something first, then I can break it down.");
      return;
    }

    // Capture everything BEFORE await — closing the modal mid-process
    // shouldn't cancel the AI work or lose the result.
    const noteId = selectedNote.id;
    const wasPublic = !!selectedNote.isPublic;
    const sourceContent = editContent;

    setIsBreakingDown(true);
    setProcessingNotes((prev) => {
      const next = new Set(prev);
      next.add(noteId);
      return next;
    });

    try {
      const result = await breakdownTask(source);
      if (result.isError || result.steps.length === 0) {
        alert(
          result.errorMessage ||
            "Couldn't break this down right now. Try again in a moment.",
        );
        return;
      }
      const stepsBlock = result.steps.map((s) => `- [ ] ${s}`).join("\n");
      const updated =
        sourceContent.trim().length > 0
          ? `${sourceContent.replace(/\s+$/, "")}\n\n**Next steps:**\n${stepsBlock}\n`
          : `**Next steps:**\n${stepsBlock}\n`;

      // Persist to Firestore unconditionally — survives modal close.
      try {
        await updateDoc(doc(db, "notes", noteId), {
          content: updated,
          rawContent: updated,
          updatedAt: Timestamp.now(),
          isPublic: wasPublic,
        });
      } catch (firestoreErr) {
        handleFirestoreError(
          firestoreErr,
          OperationType.UPDATE,
          `notes/${noteId}`,
        );
        return;
      }

      // Update local editor state ONLY if the user is still editing this same note.
      setSelectedNote((prev) =>
        prev && prev.id === noteId ? { ...prev, content: updated } : prev,
      );
      if (selectedNote && selectedNote.id === noteId && isEditing) {
        setEditContent(updated);
      }

      setAiActionToast({
        kind: "breakdown",
        count: result.steps.length,
        at: Date.now(),
      });
    } catch (e) {
      console.error("Breakdown handler error:", e);
      alert("Couldn't break this down. Try again in a moment.");
    } finally {
      setIsBreakingDown(false);
      setProcessingNotes((prev) => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  };

  /* ============================================================
     handleExtractTasks — scan current editContent for implicit
     action items, append as checkboxes. Skips if AI finds nothing.
     ============================================================ */
  const handleExtractTasks = async () => {
    if (isExtractingTasks) return;
    if (!selectedNote) return;
    const source = editContent.trim();
    if (source.length < 10) {
      alert("Write some notes first, then I can pull out action items.");
      return;
    }

    const noteId = selectedNote.id;
    const wasPublic = !!selectedNote.isPublic;
    const sourceContent = editContent;

    setIsExtractingTasks(true);
    setProcessingNotes((prev) => {
      const next = new Set(prev);
      next.add(noteId);
      return next;
    });

    try {
      const result = await extractTasks(source);
      if (result.isError) {
        alert(
          result.errorMessage ||
            "Couldn't extract tasks right now. Try again in a moment.",
        );
        return;
      }
      if (result.tasks.length === 0) {
        setAiActionToast({
          kind: "extract",
          count: 0,
          at: Date.now(),
        });
        return;
      }
      const tasksBlock = result.tasks.map((t) => `- [ ] ${t}`).join("\n");
      const updated = `${sourceContent.replace(/\s+$/, "")}\n\n**Action items:**\n${tasksBlock}\n`;

      try {
        await updateDoc(doc(db, "notes", noteId), {
          content: updated,
          rawContent: updated,
          updatedAt: Timestamp.now(),
          isPublic: wasPublic,
        });
      } catch (firestoreErr) {
        handleFirestoreError(
          firestoreErr,
          OperationType.UPDATE,
          `notes/${noteId}`,
        );
        return;
      }

      setSelectedNote((prev) =>
        prev && prev.id === noteId ? { ...prev, content: updated } : prev,
      );
      if (selectedNote && selectedNote.id === noteId && isEditing) {
        setEditContent(updated);
      }

      setAiActionToast({
        kind: "extract",
        count: result.tasks.length,
        at: Date.now(),
      });
    } catch (e) {
      console.error("Extract tasks handler error:", e);
      alert("Couldn't extract tasks. Try again in a moment.");
    } finally {
      setIsExtractingTasks(false);
      setProcessingNotes((prev) => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  };

  const handleUpdateNote = async () => {
    if (!selectedNote) return;
    if (editContent.length > 50000) {
      alert("Note content exceeds the 50,000 character limit.");
      return;
    }
    // Capture everything we need BEFORE awaiting — so closing the modal
    // mid-process doesn't strand the enhancement. The promise continues
    // independently regardless of whether selectedNote is still the same.
    const noteId = selectedNote.id;
    const wasPublic = !!selectedNote.isPublic;
    const rawContent = editContent;
    const localTitle = editTitle;
    const localContent = editContent;

    setIsProcessing(true);
    setProcessingNotes((prev) => {
      const next = new Set(prev);
      next.add(noteId);
      return next;
    });
    // Close the editor immediately — the enhancement continues in background.
    // The breathing green dot on the card tells the user it's still processing.
    setIsEditing(false);

    try {
      const sorted = await magicSort(
        rawContent,
        "auto",
        profile?.defaultLanguage,
      );
      const hasSensitiveData =
        profile?.autoLockSensitiveNotes !== false
          ? detectSensitiveData(rawContent)
          : false;

      // Always apply the AI-sorted output. The user explicitly clicked
      // "Enhance Now" — they want the structured version, regardless of
      // their default Auto-Sort setting. (The Auto-Sort toggle controls
      // what happens automatically on save; this button is the manual
      // override.)
      const updateData = !sorted.isError
        ? {
            title: sorted.title,
            content: sorted.content,
            maskedContent: sorted.maskedContent,
            category: sorted.category,
            tags: sorted.tags,
            rawContent: rawContent,
            isAutoSorted: true,
            status: "ready" as const,
            updatedAt: Timestamp.now(),
            isPublic: wasPublic,
            hasSensitiveData,
          }
        : {
            // AI failed — preserve user's manual text and flag the error
            title: localTitle,
            content: localContent,
            rawContent: localContent,
            isAutoSorted: false,
            status: "error" as const,
            updatedAt: Timestamp.now(),
            isPublic: wasPublic,
            hasSensitiveData,
          };

      await updateDoc(doc(db, "notes", noteId), updateData);

      // Only update local selectedNote if the user is STILL viewing this same
      // note. If they've navigated away, the onSnapshot listener will pick up
      // the update anyway, keeping the UI in sync.
      setSelectedNote((prev) =>
        prev && prev.id === noteId
          ? ({ ...prev, ...(updateData as Note) } as Note)
          : prev,
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notes/${noteId}`);
    } finally {
      setIsProcessing(false);
      setProcessingNotes((prev) => {
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    }
  };

  /* ============================================================
   * NOTE LOCK / UNLOCK — biometric edition
   * ------------------------------------------------------------
   * Replaces the old per-note text-password flow. Locks are now
   * verified via WebAuthn (Touch ID / Face ID / Windows Hello) for
   * Google-SSO users, or by re-entering the Firebase account
   * password for email/password users. The note document no longer
   * stores a secret; it stores only a flag (password === "locked:<method>")
   * plus the lock method encoded in the same field.
   *
   * Failed-attempt throttling is preserved for the account-password
   * path so a stolen device can't brute-force the account password.
   * Biometric attempts are throttled by the OS itself, so we don't
   * count them.
   * ============================================================ */

  // Extract lock method from a note's password field. Format is
  // "locked:<method>" (e.g. "locked:biometric", "locked:account-password").
  const extractLockMethod = (note: Note | null): LockMethod => {
    if (!note) return isEmailUser(user) ? "account-password" : "biometric";
    const pw = note.password || "";
    if (pw.startsWith("locked:")) {
      const m = pw.split(":")[1] as LockMethod;
      if (m === "biometric" || m === "account-password") return m;
    }
    if (note.lockMethod === "biometric" || note.lockMethod === "account-password") {
      return note.lockMethod;
    }
    return isEmailUser(user) ? "account-password" : "biometric";
  };
  const handleVerifyPassword = async () => {
    if (!user || !selectedNote || !selectedNote.password) return;

    if (
      selectedNote.lockedUntil &&
      getTimestampMillis(selectedNote.lockedUntil) > currentTime
    ) {
      const remaining = Math.ceil(
        (getTimestampMillis(selectedNote.lockedUntil) - currentTime) / 60000,
      );
      setPasswordError(`Note locked for ${remaining} more minutes.`);
      return;
    }

    setIsVerifyingPassword(true);
    setPasswordError("");
    try {
      const method = extractLockMethod(selectedNote);

      let verified = false;
      if (method === "biometric") {
        try {
          await verifyBiometric(user);
          verified = true;
        } catch (err: any) {
          // Biometric failed or was cancelled. If this device never
          // enrolled, fall back to account re-auth so the user
          // isn't stranded. Email users use password, Google users
          // use the OAuth popup.
          if (isEmailUser(user) && passwordInput.trim()) {
            try {
              await reauthenticateEmailUser(user, passwordInput);
              verified = true;
            } catch {
              verified = false;
            }
          } else if (isGoogleUser(user) && !isEmailUser(user)) {
            // Trigger Google re-auth popup as a fallback.
            try {
              await reauthenticateGoogleUser(user);
              verified = true;
            } catch {
              verified = false;
            }
          } else {
            throw err;
          }
        }
      } else {
        // account-password path — re-enter Firebase account password.
        if (!passwordInput) {
          setPasswordError("Enter your account password to unlock.");
          setIsVerifyingPassword(false);
          return;
        }
        try {
          await reauthenticateEmailUser(user, passwordInput);
          verified = true;
        } catch {
          verified = false;
        }
      }

      if (verified) {
        await updateDoc(doc(db, "notes", selectedNote.id), {
          failedAttempts: 0,
          lockedUntil: null,
        });
        setShowPasswordInput(false);
        setPasswordInput("");
        setPasswordError("");
        setEditTitle(selectedNote.title);
        setEditContent(selectedNote.rawContent || selectedNote.content);
        setIsEditing(false);
      } else {
        const newAttempts = (selectedNote.failedAttempts || 0) + 1;
        let lockedUntil = null;
        if (newAttempts >= 3) {
          lockedUntil = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);
        }
        await updateDoc(doc(db, "notes", selectedNote.id), {
          failedAttempts: newAttempts,
          lockedUntil,
        });
        if (newAttempts >= 3) {
          setPasswordError(
            "Too many failed attempts. Note locked for 30 minutes.",
          );
        } else {
          setPasswordError(
            `Verification failed. ${3 - newAttempts} attempts remaining.`,
          );
        }
      }
    } catch (error: any) {
      const msg = error?.message || "Couldn't verify identity.";
      setPasswordError(msg);
    } finally {
      setIsVerifyingPassword(false);
    }
  };

  const handleSetPassword = async () => {
    if (!user || !selectedNote) return;
    setIsProtecting(true);
    setPasswordError("");
    try {
      // Pick a method based on what the device + account support.
      // WebAuthn is preferred when available; otherwise we fall
      // back to the user's account password (re-auth at unlock).
      const canBiometric = await isBiometricAvailable();
      let method: LockMethod = canBiometric ? "biometric" : "account-password";

      if (method === "biometric") {
        // Enroll a credential on this device (or reuse the existing
        // one — enrollBiometric overwrites the stored credential id
        // if the user re-locks).
        try {
          await enrollBiometric(user);
        } catch (err: any) {
          // If enrollment fails (cancelled, no authenticator paired),
          // fall back to account password for email users and abort
          // with a clear message for Google users on devices without
          // a paired authenticator.
          if (isEmailUser(user)) {
            method = "account-password";
          } else {
            throw err;
          }
        }
      }

      await updateDoc(doc(db, "notes", selectedNote.id), {
        // We encode the lock method into the password field itself
        // to avoid Firestore security rules rejecting new fields
        // like `lockMethod` or `lockedAt`. The password field is
        // already allowed by the rules. Format: "locked:<method>".
        // All the existing `!n.password` truthy checks still work
        // because "locked:biometric" is truthy.
        password: `locked:${method}`,
        failedAttempts: 0,
        lockedUntil: null,
      });
      setSelectedNote({
        ...selectedNote,
        password: `locked:${method}`,
        lockMethod: method,
      });
      setIsPasswordModalOpen(false);
      setPasswordInput("");
      setPasswordError("");
    } catch (error: any) {
      // Show a user-friendly message instead of the raw Firestore
      // error JSON blob (which includes userId, email, providerData —
      // both ugly and a privacy leak inside the UI).
      const raw = error?.message || "";
      let msg = "Couldn't lock this note. Please try again.";
      if (raw.includes("permission-denied") || raw.includes("insufficient permissions")) {
        msg = "Permission denied. Your Firestore security rules may need updating to allow the lockMethod field. Check your rules and try again.";
      } else if (raw.includes("Enrollment was cancelled")) {
        msg = "Biometric enrollment was cancelled. Tap the button to try again.";
      } else if (raw.includes("not available")) {
        msg = "Biometric authentication isn't available on this device. Try a different browser or device.";
      }
      setPasswordError(msg);
      console.error("Lock note error:", error);
    } finally {
      setIsProtecting(false);
    }
  };

  const handleRemovePassword = async () => {
    if (!user || !selectedNote) return;
    setIsRemovingPassword(true);
    setPasswordError("");
    try {
      // Require re-verification before removing the lock — otherwise
      // anyone with momentary access to the open note could strip
      // protection silently.
      const method = extractLockMethod(selectedNote);

      if (method === "biometric") {
        await verifyBiometric(user);
      } else {
        if (!passwordInput) {
          setPasswordError(
            "Enter your account password to remove the lock.",
          );
          setIsRemovingPassword(false);
          return;
        }
        await reauthenticateEmailUser(user, passwordInput);
      }

      await updateDoc(doc(db, "notes", selectedNote.id), {
        password: null,
        failedAttempts: 0,
        lockedUntil: null,
      });
      setSelectedNote({
        ...selectedNote,
        password: undefined,
        lockMethod: undefined,
      });
      setIsPasswordModalOpen(false);
      setPasswordInput("");
      setPasswordError("");
    } catch (error: any) {
      const raw = error?.message || "";
      let msg = "Couldn't remove the lock. Please try again.";
      if (raw.includes("permission-denied") || raw.includes("insufficient permissions")) {
        msg = "Permission denied. Please check your Firestore rules.";
      } else if (raw.includes("cancelled")) {
        msg = "Verification was cancelled.";
      }
      setPasswordError(msg);
    } finally {
      setIsRemovingPassword(false);
    }
  };

  const handleResetNotePassword = async () => {
    // Kept for compatibility with the password-modal "Reset" entry
    // point. In the biometric flow there is no per-note password to
    // reset; closing this screen returns the user to the standard
    // unlock prompt where they can use biometric or account
    // password instead.
    if (!user || !selectedNote) return;
    setIsResettingPassword(true);
    setShowPasswordInput(false);
    setPasswordError("");
    setPasswordInput("");
  };

  const handleConfirmReset = async () => {
    // No-op in the new flow — locks are tied to the account, not to
    // a per-note text password, so there's nothing to "reset" here.
    // We close the reset UI and let the user choose biometric or
    // account-password unlock.
    setIsResettingPassword(false);
    setIsResettingPasswordConfirm(false);
    setPasswordInput("");
    setPasswordError("");
  };

  const openNote = (note: Note) => {
    if (note.password) {
      setSelectedNote(note);
      setShowPasswordInput(true);
      setPasswordInput("");
      setPasswordError("");
      return;
    }
    setSelectedNote(note);
    setEditTitle(note.title);

    // Passive backfill — silently bring old notes up to current
    // schema. When detection logic (or any other derive-from-content
    // logic) improves, old notes don't automatically benefit because
    // their stored fields were computed under the older rules. Here
    // we re-derive every field that's a pure function of content +
    // current code, and if it disagrees with what's stored, we
    // write the corrected value back. The user sees no UI for this —
    // it just means tomorrow's bug fix applies to yesterday's notes
    // the moment they're opened.
    //
    // We DON'T touch fields the user can set themselves (tags,
    // category if the user manually moved it, etc.) — only fields
    // that are 100% derived from `content`.
    try {
      const currentHasSensitive = detectSensitiveData(note.content || "");
      const updates: Record<string, unknown> = {};
      if (
        currentHasSensitive !== !!note.hasSensitiveData &&
        currentHasSensitive
      ) {
        updates.hasSensitiveData = true;
      }
      if (Object.keys(updates).length > 0) {
        // Fire-and-forget — no await, no error blocking. If the
        // write fails (offline, rules glitch, doc gone) the next
        // open will retry.
        updateDoc(doc(db, "notes", note.id), updates).catch((err) => {
          console.warn("[backfill] passive update skipped:", err);
        });
      }
    } catch (err) {
      console.warn("[backfill] detection failed:", err);
    }

    // Edit the SORTED content (what the user sees in preview), not the
    // raw original. Editing the raw content would surprise users who
    // see one thing and expect to edit that. We deliberately preserve
    // rawContent untouched on save so the "View Original" toggle keeps
    // working — users can flip back to see what they originally typed
    // before AI sorting reorganized it.
    setEditContent(note.content);
    setIsEditing(false);
    setCopied(false);
    setShowRaw(false); setRevealSensitive(false);
    // Reset the editor's "user typed" flag for the new note. Without
    // this, if the user opens a second note after editing a first
    // one, the flag from the previous session would still be true.
    hasEditorTypedRef.current = false;
    // Reset inline tag editor — don't carry an open tag input across
    // notes. If the user was mid-typing a tag, that state should die
    // with the previous note.
    setAddingTag(false);
    setTagDraft("");
    setIsMoreMenuOpen(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse the search query once per render, memoized so chips below the
  // search bar can also read it without re-parsing.
  const parsedSearchQuery = React.useMemo(
    () => parseSearchQuery(searchQuery),
    [searchQuery],
  );

  const filteredNotes = React.useMemo(() => {
    return notes
      .filter((note) => {
        // Trash view: only show trashed notes
        if (activeCategory === "Trash") {
          return !!note.isTrashed;
        }
        // Archive view: only show archived notes (not trashed)
        if (activeCategory === "Archive") {
          return !!note.isArchived && !note.isTrashed;
        }
        // All other views: exclude trashed AND archived notes
        if (note.isTrashed) return false;
        if (note.isArchived) return false;

        // ALWAYS show notes that are still processing, regardless of
        // category filter. A newly-captured note arrives with
        // status: "processing" before the AI has assigned a
        // category. Without this carve-out, if the user has the
        // "Task" or "Idea" filter active when they capture, their
        // brand new note vanishes from the list (since its
        // category hasn't been set yet) — leaving them thinking
        // capture failed.
        const isProcessing = note.status === "processing";
        if (isProcessing) {
          return matchesQuery(note, parsedSearchQuery);
        }

        // Use the new full-text search engine instead of basic substring match.
        // matchesQuery handles plain terms, "exact phrases", tag:, #tag,
        // -negation, after:/before: dates, has:, is: filters and combinations.
        const matchesSearch = matchesQuery(note, parsedSearchQuery);
        const matchesCategory =
          activeCategory === "Starred"
            ? note.isStarred
            : activeCategory === "Locked"
              ? !!note.password
              : activeCategory === "Shared"
                ? note.isPublic
                : activeCategory
                  ? note.category === activeCategory
                  : true;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        // In trash view, sort by trashed date (most recent first)
        if (activeCategory === "Trash") {
          const aTime =
            a.trashedAt instanceof Timestamp
              ? a.trashedAt.toMillis()
              : a.trashedAt?.seconds
                ? a.trashedAt.seconds * 1000
                : 0;
          const bTime =
            b.trashedAt instanceof Timestamp
              ? b.trashedAt.toMillis()
              : b.trashedAt?.seconds
                ? b.trashedAt.seconds * 1000
                : 0;
          return bTime - aTime;
        }
        // Pinned notes always float to the top (regardless of sort mode)
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;

        // CUSTOM sort mode — manual drag-reorder wins for ALL notes.
        // Notes with sortOrder come first (in descending sortOrder).
        // Notes without sortOrder fall back to creation date so brand-new
        // notes still appear at the top until the user drags them.
        if (sortBy === "custom") {
          const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : null;
          const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : null;
          if (aOrder !== null && bOrder !== null) return bOrder - aOrder;
          if (aOrder !== null) return -1;
          if (bOrder !== null) return 1;
          return (
            getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt)
          );
        }

        // For PINNED notes only, honor manual drag-and-drop sortOrder.
        // For everything else, sortOrder is ignored — date wins.
        // (This keeps drag-reorder useful for organizing your top-pinned
        // notes without freezing all your other notes in place.)
        if (sortBy === "newest") {
          if (a.isPinned && b.isPinned) {
            const aOrder = typeof a.sortOrder === "number" ? a.sortOrder : null;
            const bOrder = typeof b.sortOrder === "number" ? b.sortOrder : null;
            if (aOrder !== null && bOrder !== null) return bOrder - aOrder;
            if (aOrder !== null) return -1;
            if (bOrder !== null) return 1;
          }
          // "Newest" = most recently TOUCHED (created or edited).
          // Editing an old note bumps it to the top, like Apple Notes / Keep.
          const aTouched = Math.max(
            getTimestampMillis(a.createdAt),
            getTimestampMillis(a.updatedAt),
          );
          const bTouched = Math.max(
            getTimestampMillis(b.createdAt),
            getTimestampMillis(b.updatedAt),
          );
          return bTouched - aTouched;
        }
        if (sortBy === "oldest")
          return (
            getTimestampMillis(a.createdAt) - getTimestampMillis(b.createdAt)
          );
        if (sortBy === "alphabetical") return a.title.localeCompare(b.title);
        return 0;
      });
  }, [notes, parsedSearchQuery, activeCategory, sortBy]);

  // Group notes by time period (or Pinned/Others when pinned exist).
  //
  // Two grouping modes share this path:
  //   - "newest": Pinned (if any) → Today / Yesterday / This Week / Earlier
  //   - "custom": Pinned (if any) → All other notes in their drag-set order
  //
  // Why custom mode also uses groupedNotes:
  //   Without it, custom mode falls through to flat-view where pinned and
  //   unpinned notes render in a single mixed grid with no visible header,
  //   making the pin row hard to spot. By giving custom mode its own
  //   two-group structure (Pinned + everything-else), users get the same
  //   "Pinned" section header they're used to from Newest mode, and each
  //   group lives in its own SortableContext so drag-reorder scoping
  //   keeps working correctly.
  //
  // Why oldest and alphabetical modes also use groupedNotes:
  //   In every sort mode, pinned notes should stand out from the rest
  //   of the library — that's what "pinned" means. Without grouping in
  //   oldest/alphabetical modes, pinned notes flow inline with regular
  //   notes (e.g. a pinned note from 2020 buried among other 2020
  //   notes in oldest mode, or a pinned note titled "Apple" mixed
  //   with other "A" notes in alphabetical mode). All four sort modes
  //   get a Pinned group at the top, with the rest of the notes
  //   sorted normally underneath in a single "Notes" group.
  const groupedNotes = React.useMemo(() => {
    if (searchQuery || viewMode === "list") return null;

    const pinned: Note[] = [];
    const unpinned: Note[] = [];
    filteredNotes.forEach((note) => {
      if (note.isPinned) pinned.push(note);
      else unpinned.push(note);
    });

    const groups: { label: string; notes: Note[] }[] = [];
    if (pinned.length > 0) groups.push({ label: "Pinned", notes: pinned });

    if (
      sortBy === "custom" ||
      sortBy === "oldest" ||
      sortBy === "alphabetical"
    ) {
      // For non-newest modes: one "Notes" group below Pinned. We don't
      // sub-group by time/letter because either:
      //   - custom: user explicitly opted into manual ordering
      //   - oldest: time buckets would feel inverted on an oldest
      //     sort (would users want "Earlier" at the top?)
      //   - alphabetical: letter buckets would add more headers than
      //     necessary; users already see titles ordered.
      // The single "Notes" header is enough to mark "everything below
      // is the rest of the library."
      if (unpinned.length > 0) {
        groups.push({ label: "Notes", notes: unpinned });
      }
      return groups;
    }

    // "newest" mode: the historical behavior — sub-bucket by time.
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const thisWeek = new Date(today.getTime() - 7 * 86400000);

    const timeGroups: { label: string; notes: Note[] }[] = [
      { label: "Today", notes: [] },
      { label: "Yesterday", notes: [] },
      { label: "This Week", notes: [] },
      { label: "Earlier", notes: [] },
    ];

    unpinned.forEach((note) => {
      // Use most-recently-touched timestamp so editing an old note moves
      // it from "Earlier" to "Today" — matches the "newest" sort order.
      const ts = Math.max(
        getTimestampMillis(note.createdAt),
        getTimestampMillis(note.updatedAt),
      );
      if (ts >= today.getTime()) timeGroups[0].notes.push(note);
      else if (ts >= yesterday.getTime()) timeGroups[1].notes.push(note);
      else if (ts >= thisWeek.getTime()) timeGroups[2].notes.push(note);
      else timeGroups[3].notes.push(note);
    });

    timeGroups.forEach((g) => {
      if (g.notes.length > 0) groups.push(g);
    });
    return groups;
  }, [filteredNotes, sortBy, searchQuery, viewMode]);

  // Helper: count checked/total tasks in a note
  const getTaskCounts = (content: string) => {
    const lines = content.split("\n");
    const tasks = lines.filter((l) => /^(\s*)[-*]\s*\[[\sx]\]/i.test(l));
    const done = tasks.filter((l) => /[-*]\s*\[x\]/i.test(l));
    return { done: done.length, total: tasks.length };
  };

  const categories = React.useMemo(() => {
    return Array.from(
      new Set(notes.filter((n) => !n.isTrashed).map((n) => n.category)),
    ).filter(Boolean);
  }, [notes]);

  const counts = React.useMemo(() => {
    const active = notes.filter((n) => !n.isTrashed && !n.isArchived);
    const c: Record<string, number> = {
      All: active.length,
      Starred: active.filter((n) => n.isStarred).length,
      Locked: active.filter((n) => !!n.password).length,
      Shared: active.filter((n) => n.isPublic).length,
      Archive: notes.filter((n) => n.isArchived && !n.isTrashed).length,
      Trash: notes.filter((n) => n.isTrashed).length,
    };
    active.forEach((note) => {
      if (note.category) {
        c[note.category] = (c[note.category] || 0) + 1;
      }
    });
    return c;
  }, [notes]);

  if (sharedNote) {
    // Show unavailable page if note doesn't exist or sharing was turned off
    if ((sharedNote as any)._shareUnavailable) {
      return (
        <div className="min-h-screen zk-surface-muted dark:zk-surface flex flex-col items-center justify-center p-6 transition-colors duration-300">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-sm w-full text-center"
          >
            {/* Fun ghost illustration */}
            <svg
              viewBox="0 0 200 180"
              className="w-48 h-44 mx-auto mb-8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Ghost body */}
              <ellipse
                cx="100"
                cy="155"
                rx="45"
                ry="6"
                fill="currentColor"
                className="text-slate-200 dark:text-[#242b27]"
              />
              <path
                d="M60 95 C60 65 75 45 100 45 C125 45 140 65 140 95 L140 140 L130 130 L120 140 L110 130 L100 140 L90 130 L80 140 L70 130 L60 140 Z"
                fill="currentColor"
                className="text-[#d2e8d5] dark:text-[#2d5a44]/40"
                stroke="#2d5a44"
                strokeWidth="2"
              />
              {/* Eyes */}
              <circle
                cx="85"
                cy="90"
                r="5"
                fill="currentColor"
                className="zk-text dark:zk-text"
              />
              <circle
                cx="115"
                cy="90"
                r="5"
                fill="currentColor"
                className="zk-text dark:zk-text"
              />
              {/* Mouth — surprised O */}
              <ellipse
                cx="100"
                cy="108"
                rx="4"
                ry="5"
                fill="currentColor"
                className="zk-text dark:zk-text"
              />
              {/* Broken link chain */}
              <path
                d="M45 75 L55 85"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="zk-text-faint"
              />
              <path
                d="M40 80 L50 80"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="zk-text-faint"
              />
              <path
                d="M155 75 L145 85"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="zk-text-faint"
              />
              <path
                d="M160 80 L150 80"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className="zk-text-faint"
              />
              {/* Sparkles */}
              <circle
                cx="50"
                cy="55"
                r="2"
                fill="currentColor"
                className="text-[#6b8f72]"
              />
              <circle
                cx="155"
                cy="60"
                r="1.5"
                fill="currentColor"
                className="text-[#6b8f72]"
              />
              <circle
                cx="45"
                cy="105"
                r="1.5"
                fill="currentColor"
                className="text-[#6b8f72]"
              />
            </svg>

            <h2
              className="text-2xl font-bold zk-text dark:zk-text mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Poof! This note vanished
            </h2>
            <p
              className="zk-text-muted dark:zk-text-muted mb-2 leading-relaxed text-sm"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              The owner stopped sharing this note, or it may have been deleted.
              Either way, there's nothing to see here.
            </p>
            <p
              className="zk-text-faint dark:zk-text-muted mb-8 text-xs"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              If you think this is a mistake, ask the owner to share it again.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setSharedNote(null);
                  window.history.replaceState({}, "", window.location.pathname);
                }}
                className="w-full px-6 py-3.5 text-white rounded-2xl font-bold transition-all active:scale-95"
                style={{
                  backgroundColor: "#2d5a44",
                  fontFamily: "var(--font-display)",
                }}
              >
                Try zakar — It's Free
              </button>
              <p
                className="text-[11px] zk-text-faint dark:zk-text-muted"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                The AI-powered brain dump that organizes your thoughts.
              </p>
            </div>
          </motion.div>
        </div>
      );
    }

    return (
      <div
        className="min-h-screen flex flex-col relative"
        style={{
          backgroundColor: "var(--shared-bg)",
          overflowX: "clip",
        }}
        onPointerMove={(e) => {
          // Update the spotlight position. Coordinates relative to the
          // wrapper which is the document scroll root for the share page.
          const wrapper = e.currentTarget as HTMLDivElement;
          const rect = wrapper.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const spot = wrapper.querySelector(
            ".zakar-shared-bg-spot",
          ) as HTMLDivElement | null;
          if (spot) {
            spot.style.setProperty("--zk-spot-x", `${x}px`);
            spot.style.setProperty("--zk-spot-y", `${y}px`);
          }
        }}
        onPointerLeave={(e) => {
          // Move spotlight off-screen so it disappears smoothly
          const spot = (e.currentTarget as HTMLDivElement).querySelector(
            ".zakar-shared-bg-spot",
          ) as HTMLDivElement | null;
          if (spot) {
            spot.style.setProperty("--zk-spot-x", "50%");
            spot.style.setProperty("--zk-spot-y", "-200%");
          }
        }}
      >
        <style>{`
          :root { --shared-bg: #f4f7f2; --shared-nav-bg: #f4f7f2; }
          .dark { --shared-bg: #202124; --shared-nav-bg: #202124; }

          /* Dotted background — uniform sage dot grid, faint by default
             with bright dots clustered under the cursor. Implementation:

             We render TWO stacked elements (.zakar-shared-bg = faint base,
             .zakar-shared-bg-spot = bright copy masked to cursor area).
             The spotlight layer's mask is a radial-gradient centered on
             --zk-spot-x/--zk-spot-y, so only dots within ~140px of the
             cursor become visible. When the mouse leaves, JS resets the
             coordinates off-screen and the spotlight vanishes.

             Theme colors preserved: sage #2d5a44 light, mint #8fb89a dark.
          */
          .zakar-shared-bg {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background-color: var(--shared-bg);
            /* Faint baseline dots — uniform 24px grid */
            background-image:
              radial-gradient(circle at 1.5px 1.5px, rgba(79, 99, 84, 0.18) 1.2px, transparent 0);
            background-size: 24px 24px;
            /* Top-half mask so dots don't compete with article */
            -webkit-mask-image: linear-gradient(
              to bottom,
              rgba(0, 0, 0, 1) 0%,
              rgba(0, 0, 0, 0.9) 35%,
              rgba(0, 0, 0, 0.4) 55%,
              transparent 70%
            );
            mask-image: linear-gradient(
              to bottom,
              rgba(0, 0, 0, 1) 0%,
              rgba(0, 0, 0, 0.9) 35%,
              rgba(0, 0, 0, 0.4) 55%,
              transparent 70%
            );
          }
          .dark .zakar-shared-bg {
            background-image:
              radial-gradient(circle at 1.5px 1.5px, rgba(143, 184, 154, 0.18) 1.2px, transparent 0);
          }

          /* Spotlight layer — same dots but bright, masked to cursor area */
          .zakar-shared-bg-spot {
            position: absolute;
            inset: 0;
            pointer-events: none;
            /* Bright sage dots, same 24px grid, perfectly aligned with base */
            background-image:
              radial-gradient(circle at 1.5px 1.5px, rgba(79, 99, 84, 0.85) 1.5px, transparent 0);
            background-size: 24px 24px;
            /* Composite mask: cursor radial AND top-half fade */
            -webkit-mask-image:
              radial-gradient(
                circle 140px at var(--zk-spot-x, 50%) var(--zk-spot-y, -200%),
                rgba(0, 0, 0, 1) 0%,
                rgba(0, 0, 0, 0.6) 50%,
                transparent 80%
              ),
              linear-gradient(
                to bottom,
                rgba(0, 0, 0, 1) 0%,
                rgba(0, 0, 0, 0.9) 35%,
                rgba(0, 0, 0, 0.4) 55%,
                transparent 70%
              );
            -webkit-mask-composite: source-in;
            mask-image:
              radial-gradient(
                circle 140px at var(--zk-spot-x, 50%) var(--zk-spot-y, -200%),
                rgba(0, 0, 0, 1) 0%,
                rgba(0, 0, 0, 0.6) 50%,
                transparent 80%
              ),
              linear-gradient(
                to bottom,
                rgba(0, 0, 0, 1) 0%,
                rgba(0, 0, 0, 0.9) 35%,
                rgba(0, 0, 0, 0.4) 55%,
                transparent 70%
              );
            mask-composite: intersect;
            transition: opacity 250ms ease-out;
          }
          .dark .zakar-shared-bg-spot {
            background-image:
              radial-gradient(circle at 1.5px 1.5px, rgba(143, 184, 154, 0.9) 1.5px, transparent 0);
          }

          /* Paper card — uses app's raised surface tones for brand consistency. */
          .zakar-paper { background-color: #ffffff; }
          .dark .zakar-paper { background-color: #2d2e31; }

          .zakar-shared-content {
            overflow-wrap: break-word;
            word-wrap: break-word;
            font-family: var(--font-sans), 'Manrope', system-ui, sans-serif;
          }
          .zakar-shared-content p { margin-bottom: 1.4em; }
          .zakar-shared-content .zakar-checklist p { margin: 0; }
          /* Reset paragraph margins inside list items. react-markdown
             wraps <li> children in <p>, which would otherwise inherit
             the default p margin-bottom of 1.4em — creating huge gaps
             between bullets. This was the "shared notes bullet points
             too far apart" issue. Adjacent paragraphs inside a single
             li still get a small gap so multi-paragraph items remain
             readable. (Stricter li > p reset added below the list
             rules.) */
          .zakar-shared-content h1, .zakar-shared-content h2, .zakar-shared-content h3 {
            font-family: var(--font-display), 'Nunito', serif;
            font-weight: 700;
            color: #2e3431;
            margin: 1.6em 0 0.6em;
            overflow-wrap: break-word;
            position: relative;
            /* Removed yellow dot ::before and padding-left:1em that
               created the amber bullet markers next to headings. The
               headings are strong enough on their own without the
               decorative dot. */
          }
          .dark .zakar-shared-content h1, .dark .zakar-shared-content h2, .dark .zakar-shared-content h3 { color: #e8eaed; }
          /* Italic / em — explicit colors for both modes so emphasized
             passages and inline italic text remain readable. Before,
             nested em inside li / blockquote inherited a faded color
             on dark mode and became nearly invisible (see "Share
             option button looks greyed out" line on the screenshot). */
          .zakar-shared-content em, .zakar-shared-content i {
            color: #2e3431;
            font-style: italic;
          }
          .dark .zakar-shared-content em, .dark .zakar-shared-content i {
            color: #dce8de;
          }
          /* Paragraph + list item text — explicit dark-mode color so
             body content doesn't inherit a low-contrast tint from
             the parent zk-text class. */
          .zakar-shared-content p, .zakar-shared-content li {
            color: #1f2520;
          }
          .dark .zakar-shared-content p, .dark .zakar-shared-content li {
            color: #dce8de;
          }
          .zakar-shared-content ul, .zakar-shared-content ol { margin: 0.5em 0; padding-left: 1.6em; list-style: none; }
          .zakar-shared-content ul li, .zakar-shared-content ol li {
            margin: 0.15em 0; overflow-wrap: break-word; position: relative; padding-left: 1.2em;
          }
          /* Tighten p inside li — react-markdown wraps each bullet's
             text in a <p>, and that paragraph picks up the default
             p margin, blowing up the spacing between bullets. Reset
             to zero so the only spacing is the li margin. */
          .zakar-shared-content li > p {
            margin: 0;
            padding: 0;
          }
          .zakar-shared-content ul li::before {
            content: ""; position: absolute; left: 0; top: 0.6em;
            width: 6px; height: 6px; border-radius: 999px; background-color: #2d5a44;
          }
          .dark .zakar-shared-content ul li::before { background-color: #8fb89a; }
          .zakar-shared-content ol { counter-reset: zk-li; }
          .zakar-shared-content ol li::before {
            counter-increment: zk-li; content: counter(zk-li) ".";
            position: absolute; left: 0; top: 0;
            font-weight: 700; color: #2d5a44;
            font-family: var(--font-sans); font-size: 0.9em;
          }
          .dark .zakar-shared-content ol li::before { color: #8fb89a; }
          /* Checklist items inside shared notes — suppress the parent
             ul bullet dot AND the ::before pseudo bullet for li that
             render the checkbox-row component. The previous rule left
             a circular sage dot to the left of every checkbox row,
             making it look like the row had a "round line" around it.
             We target descendants of zakar-checklist so regular ul
             bullets elsewhere on the page are untouched. */
          .zakar-shared-content .zakar-checklist ul,
          .zakar-shared-content .zakar-checklist ol {
            padding-left: 0;
            margin: 0;
          }
          .zakar-shared-content .zakar-checklist li,
          .zakar-shared-content .zakar-checklist li::before {
            padding-left: 0;
            background: none !important;
            content: none !important;
          }
          .zakar-shared-content a { color: #506455; text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
          .dark .zakar-shared-content a { color: #a8c9ac; }
          /* MD3-style inline code chips — match main app */
          .zakar-shared-content code {
            background: #d2e8d5; color: #1f3a26;
            padding: 1px 8px; border-radius: 6px;
            font-size: 0.85em; font-weight: 600;
            font-family: var(--font-mono), 'JetBrains Mono', monospace;
            box-shadow: inset 0 0 0 1px rgba(31,58,38,0.06);
            overflow-wrap: anywhere; word-break: break-word;
          }
          .dark .zakar-shared-content code {
            background: #3d5142; color: #d4e8d8;
            box-shadow: inset 0 0 0 1px rgba(212,232,216,0.08);
          }
          .zakar-shared-content pre {
            background: #f4f7f2;
            border: 1px solid #dde5da;
            color: #1f3a26;
            padding: 1.1em 1.3em;
            border-radius: 14px;
            margin: 1.4em 0;
            overflow-x: auto;
            max-width: 100%;
            font-size: 13.5px;
            line-height: 1.7;
            box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.03);
          }
          .dark .zakar-shared-content pre {
            background: #0f1411;
            border-color: rgba(45, 90, 68, 0.4);
            color: #dce5df;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
          }
          .zakar-shared-content pre code {
            background: transparent; color: inherit;
            padding: 0; border-radius: 0; box-shadow: none;
            overflow-wrap: normal; word-break: normal; white-space: pre;
            font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
            font-size: inherit;
            font-weight: 400;
          }
          .zakar-shared-content blockquote {
            border-left: 3px solid #2d5a44;
            padding: 0.6em 1.2em;
            margin: 1.2em 0;
            font-style: italic;
            color: #1f4534;
            overflow-wrap: break-word;
            background: rgba(45, 90, 68, 0.04);
            border-radius: 0 8px 8px 0;
          }
          .dark .zakar-shared-content blockquote {
            color: #c5dbc9;
            border-color: #8fb89a;
            background: rgba(143, 184, 154, 0.08);
          }
          /* Em inside blockquote — ensure italic emphasis in quotes
             keeps proper contrast in both modes. */
          .zakar-shared-content blockquote em,
          .zakar-shared-content blockquote i {
            color: inherit;
          }
          .zakar-shared-content strong { font-weight: 700; color: #2e3431; }
          .dark .zakar-shared-content strong { color: #e8eaed; }
        `}</style>

        {/* Sticky nav — blends with paper background */}
        <nav className="sticky top-0 z-50 backdrop-blur-lg bg-[var(--shared-bg)]/90 border-b border-[#2d5a44]/10 dark:border-[#2d5a44]/20 shadow-sm dark:shadow-none">
          <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="font-extrabold zk-text-primary-brand dark:zk-text-primary-brand tracking-tight"
                style={{
                  fontFamily: "var(--font-display)",
                  letterSpacing: "-0.02em",
                  fontSize: "20px",
                }}
              >
                zakar
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 dark:bg-[#282929] border border-[#2d5a44]/15 dark:border-[#6b8f72]/25 backdrop-blur-sm">
                <div className="w-1.5 h-1.5 rounded-full zk-bg-primary dark:bg-[#8fb89a]" />
                <span
                  className="text-[10px] font-bold tracking-widest zk-text-primary-brand dark:text-[#a8c9ac] uppercase"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  Shared Note
                </span>
              </div>
              {user && (
                <button
                  onClick={() => {
                    setSharedNote(null);
                    window.history.replaceState(
                      {},
                      "",
                      window.location.pathname,
                    );
                  }}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold zk-text-primary-brand dark:text-[#a8c9ac] hover:bg-[#d2e8d5] dark:hover:bg-[#3d5142] hover:text-[#1f3424] dark:hover:text-[#d4e8d8] transition-all active:scale-95"
                  style={{ fontFamily: "var(--font-sans)" }}
                  title="Back to your notes"
                >
                  <ChevronLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
                  My Notes
                </button>
              )}
            </div>
          </div>
        </nav>

        {/* Grid background wrapper */}
        {/* Faint dot baseline + bright spotlight layer */}
        <div className="zakar-shared-bg absolute inset-0 pointer-events-none z-0" />
        <div className="zakar-shared-bg-spot absolute inset-0 pointer-events-none z-0" />

        {/* Main content */}
        <main className="flex-1 relative z-10 max-w-4xl mx-auto w-full px-5 py-10 md:py-14">
          <motion.article
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="zakar-paper rounded-2xl relative"
            style={{
              boxShadow:
                "0 30px 60px -20px rgba(46,52,49,0.08), 0 10px 20px -8px rgba(46,52,49,0.04)",
            }}
          >
            {/* Inner paper content */}
            <div className="px-8 md:px-16 py-12 md:py-16 relative">
              {/* New header — meta strip on top, large title below.
                  Inspired by the reference screenshot but kept compatible
                  with our existing Copy button (in place of "Edits to save"). */}
              <div className="mb-8">
                {/* Meta strip: clock + date + category bullet | Copy */}
                <div className="flex items-center justify-between gap-3 pb-5 border-b border-[#2d5a44]/10 dark:border-white/[0.08]">
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <Clock
                      className="w-3.5 h-3.5 text-[#5b605d] dark:text-[#a3a3a3] flex-shrink-0"
                      strokeWidth={2}
                    />
                    <span
                      className="text-[12px] font-medium text-[#5b605d] dark:text-[#a3a3a3] whitespace-nowrap"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {(() => {
                        const date =
                          sharedNote.createdAt instanceof Timestamp
                            ? sharedNote.createdAt.toDate()
                            : new Date();
                        return `${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}, ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
                      })()}
                    </span>
                    {sharedNote.category && (
                      <>
                        <span className="text-[#5b605d]/40 dark:text-[#a3a3a3]/40">
                          ·
                        </span>
                        <span
                          className={cn(
                            "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            sharedNote.category === "Task" &&
                              "bg-[#c5e0c8] text-[#1f3a26] dark:bg-[#6b8f72] dark:text-[#0f1f13]",
                            sharedNote.category === "Idea" &&
                              "bg-[#fce39a] text-[#5b3700] dark:bg-[#d4a13a] dark:text-[#1f1300]",
                            sharedNote.category === "Credential" &&
                              "bg-[#fbc5c0] text-[#7a1d2a] dark:bg-[#d97a82] dark:text-[#2a0a10]",
                            sharedNote.category === "Web Content" &&
                              "bg-[#b8dcf2] text-[#0c4a6e] dark:bg-[#6aa3c7] dark:text-[#061a2a]",
                            sharedNote.category === "Personal" &&
                              "bg-[#d4c8f0] text-[#3a1d6e] dark:bg-[#9a85c7] dark:text-[#170a30]",
                            (sharedNote.category === "Other" ||
                              !sharedNote.category) &&
                              "bg-[#d8dcd5] text-[#3a4540] dark:bg-[#5a6660] dark:text-[#0f1413]",
                          )}
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {sharedNote.category}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Copy button — kept in same position as before */}
                  <button
                    onClick={async () => {
                      try {
                        if (typeof ClipboardItem !== "undefined") {
                          await navigator.clipboard.write([
                            new ClipboardItem({
                              "text/html": new Blob(
                                [markdownToHtml(sharedNote.content)],
                                { type: "text/html" },
                              ),
                              "text/plain": new Blob([sharedNote.content], {
                                type: "text/plain",
                              }),
                            }),
                          ]);
                        } else {
                          await navigator.clipboard.writeText(
                            sharedNote.content,
                          );
                        }
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch (err) {
                        try {
                          await navigator.clipboard.writeText(
                            sharedNote.content,
                          );
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        } catch {
                          const ta = document.createElement("textarea");
                          ta.value = sharedNote.content;
                          ta.style.position = "fixed";
                          ta.style.opacity = "0";
                          document.body.appendChild(ta);
                          ta.select();
                          try {
                            document.execCommand("copy");
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          } catch {}
                          document.body.removeChild(ta);
                        }
                      }
                    }}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-[#5b605d] dark:text-[#a3a3a3] hover:zk-text-primary-brand dark:hover:text-[#a8c9ac] transition-colors flex-shrink-0"
                    style={{ fontFamily: "var(--font-sans)" }}
                    title="Copy content"
                    aria-label="Copy note"
                  >
                    {copied ? (
                      <>
                        <Check
                          className="w-3.5 h-3.5 text-emerald-500"
                          strokeWidth={2.5}
                        />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Large title — display font, extra bold, full visual weight */}
                <h1
                  className="text-[34px] sm:text-[42px] md:text-[48px] font-extrabold leading-[1.08] mt-8 zk-text dark:text-white"
                  style={
                    {
                      fontFamily: "var(--font-display)",
                      letterSpacing: "-0.025em",
                      textWrap: "balance",
                      hyphens: "auto",
                    } as React.CSSProperties
                  }
                >
                  {sharedNote.title}
                </h1>
              </div>

              {/* Sensitive data warning — alert recipients if note contains credentials */}
              {detectSensitiveData(sharedNote.content) && (
                <div className="mb-8 p-4 bg-amber-50/80 dark:bg-amber-900/15 border border-amber-200/60 dark:border-amber-800/30 rounded-2xl flex items-center gap-4">
                  <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  <div>
                    <p
                      className="text-sm font-semibold text-amber-900 dark:text-amber-200"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      Sensitive info detected
                    </p>
                    <p
                      className="text-xs text-amber-700/70 dark:text-amber-300/70"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      This note may contain credentials or private data.
                    </p>
                  </div>
                </div>
              )}

              {/* Content — serif body like reference */}
              <div
                className="zakar-shared-content zk-text dark:text-[#dce8de]"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "18px",
                  lineHeight: "1.75",
                }}
              >
                {(() => {
                  const content = sharedNote.content;
                  const hasTodos = /^(\s*)[-*]\s*\[[\sx]\]/im.test(content);
                  if (!hasTodos)
                    return (
                      <Markdown components={markdownComponents}>
                        {repairMarkdown(preprocessQuotes(content))}
                      </Markdown>
                    );
                  const lines = content.split("\n");
                  const elements: React.ReactNode[] = [];
                  let nonTodoBuffer: string[] = [];
                  const flushBuffer = (key: string) => {
                    if (nonTodoBuffer.length > 0) {
                      const text = nonTodoBuffer.join("\n");
                      if (text.trim())
                        elements.push(
                          <Markdown key={key} components={markdownComponents}>
                            {repairMarkdown(text)}
                          </Markdown>,
                        );
                      nonTodoBuffer = [];
                    }
                  };
                  let currentTodoGroup: { text: string; checked: boolean }[] =
                    [];
                  const flushTodoGroup = (key: string) => {
                    if (currentTodoGroup.length > 0) {
                      const group = [...currentTodoGroup];
                      elements.push(
                        <div
                          key={key}
                          className="zakar-checklist my-5 space-y-2.5"
                        >
                          {group.map((todo, i) => (
                            <div
                              key={`${key}-${i}`}
                              className="flex items-center gap-3"
                            >
                              <div
                                className={cn(
                                  "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center",
                                  todo.checked
                                    ? "bg-[#506455] border-[#506455]"
                                    : "border-[#aeb3af] dark:border-[#4a5450] bg-transparent",
                                )}
                              >
                                {todo.checked && (
                                  <Check
                                    className="w-3 h-3 text-white"
                                    strokeWidth={3}
                                  />
                                )}
                              </div>
                              <div
                                className={cn(
                                  "flex-1 leading-relaxed text-base [&>p]:m-0",
                                  todo.checked
                                    ? "line-through text-[#9aaa9f] dark:text-[#6d7d72]"
                                    : "zk-text dark:text-[#dce8de]",
                                )}
                                style={{ fontFamily: "var(--font-display)" }}
                              >
                                <Markdown components={markdownComponents}>
                                  {repairMarkdown(todo.text)}
                                </Markdown>
                              </div>
                            </div>
                          ))}
                        </div>,
                      );
                      currentTodoGroup = [];
                    }
                  };
                  for (let i = 0; i < lines.length; i++) {
                    const unchecked = lines[i].match(
                      /^(\s*)[-*]\s*\[\s*\]\s*(.*)/,
                    );
                    const checked = lines[i].match(
                      /^(\s*)[-*]\s*\[x\]\s*(.*)/i,
                    );
                    if (unchecked || checked) {
                      flushBuffer(`md-${i}`);
                      currentTodoGroup.push({
                        text: checked ? checked[2] : unchecked![2],
                        checked: !!checked,
                      });
                    } else {
                      flushTodoGroup(`todos-${i}`);
                      nonTodoBuffer.push(lines[i]);
                    }
                  }
                  flushBuffer("md-final");
                  flushTodoGroup("todos-final");
                  return <>{elements}</>;
                })()}
              </div>

              {/* Decorative divider */}
              <div className="mt-16 mb-10 flex items-center justify-center">
                <div className="w-12 h-px bg-[#2d5a44]/20 dark:bg-white/15" />
                <div className="mx-3 w-1 h-1 rounded-full bg-[#2d5a44]/30 dark:bg-white/25" />
                <div className="w-12 h-px bg-[#2d5a44]/20 dark:bg-white/15" />
              </div>

              {/* CTA card nested inside paper */}
              <div className="rounded-2xl bg-white/55 dark:bg-[#202124]/55 border border-[#2d5a44]/12 dark:border-white/10 px-8 py-7 text-center backdrop-blur-sm max-w-md mx-auto">
                <h3
                  className="text-lg font-semibold zk-text dark:text-[#e8ede9] mb-1.5"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Begin your own journey.
                </h3>
                <p
                  className="text-sm zk-text-secondary dark:text-[#a3a3a3] mb-5 leading-relaxed"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Join <span className="italic font-semibold">zakar</span> and
                  turn your scattered thoughts into clarity.
                </p>
                <button
                  onClick={() => {
                    setSharedNote(null);
                    window.history.replaceState(
                      {},
                      "",
                      window.location.pathname,
                    );
                  }}
                  className="group inline-flex items-center gap-2 bg-[#1f4534] hover:bg-[#2d5a44] dark:bg-[#2d5a44] dark:hover:bg-[#6b8f72] text-white font-semibold px-6 py-2.5 rounded-full transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#2d5a44]/30 dark:hover:shadow-[#2d5a44]/50 active:scale-95 shadow-sm"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "13px",
                  }}
                >
                  Get Started
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>

              {/* Faint smiling avatar watermark bottom-right inside paper */}
              <div className="absolute bottom-6 right-6 w-14 h-14 opacity-[0.08] dark:opacity-[0.15] pointer-events-none select-none">
                <svg
                  viewBox="0 0 100 100"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Face */}
                  <circle cx="50" cy="50" r="38" fill="#2d5a44" />
                  {/* Left eye */}
                  <ellipse cx="38" cy="44" rx="2.8" ry="4" fill="#ffffff" />
                  {/* Right eye */}
                  <ellipse cx="62" cy="44" rx="2.8" ry="4" fill="#ffffff" />
                  {/* Smile */}
                  <path
                    d="M 34 58 Q 50 72 66 58"
                    stroke="#ffffff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </div>
            </div>
          </motion.article>

          {/* Footer — outside paper, centered secure badge + actions */}
          <div className="mt-8 flex flex-col items-center gap-6 pb-8">
            <div className="flex items-center gap-2 text-[#5b605d]/70 dark:text-[#a3a3a3]/80">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span
                className="text-[10px] tracking-[0.3em] font-bold uppercase"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Zakar Secure Sharing
              </span>
            </div>

            <div
              className="flex items-center gap-8"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              <button
                onClick={async () => {
                  const btn = document.activeElement as HTMLButtonElement;
                  const originalText = btn?.innerHTML;
                  try {
                    // Show loading state
                    if (btn) {
                      btn.innerHTML =
                        '<svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" opacity="0.25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg> Generating...';
                      btn.setAttribute("disabled", "true");
                    }

                    // Lazy-load jsPDF + html2canvas (heavy libs, only loaded on click)
                    const [{ default: jsPDF }, { default: html2canvas }] =
                      await Promise.all([
                        import("jspdf"),
                        import("html2canvas"),
                      ]);

                    const date =
                      sharedNote.createdAt instanceof Timestamp
                        ? sharedNote.createdAt.toDate()
                        : new Date();
                    const dateStr = date.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    });
                    const htmlContent = markdownToHtml(sharedNote.content, true);
                    const escapedTitle = sharedNote.title.replace(
                      /[<>&"]/g,
                      (c) =>
                        ({
                          "<": "&lt;",
                          ">": "&gt;",
                          "&": "&amp;",
                          '"': "&quot;",
                        })[c] || c,
                    );
                    // Compact filename: zakar-YYMMDD-3to4word-slug.pdf
                    const yymmdd = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
                    const shortSlug =
                      sharedNote.title
                        .replace(/[^a-zA-Z0-9\s]+/g, "")
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 4) // max 4 words
                        .join("-")
                        .toLowerCase()
                        .slice(0, 40) || "note"; // hard cap at 40 chars
                    const filename = `zakar-${yymmdd}-${shortSlug}.pdf`;

                    // Build a hidden, absolutely-positioned element that html2canvas can render.
                    // A4 width at 96dpi ≈ 794px, height ≈ 1123px. Using flex column
                    // with min-height = full A4 height pushes the footer to the bottom
                    // even on short notes. html2canvas reads offsetHeight from the
                    // outer container, which respects min-height correctly.
                    //
                    // CRITICAL: We override `all: initial` then re-apply our styles
                    // explicitly. Tailwind v4 emits oklch() colors at the document
                    // level; html2canvas v1 cannot parse those and will throw a
                    // "Unable to parse color" error mid-render. Isolating from the
                    // parent's computed styles prevents that.
                    const container = document.createElement("div");
                    container.style.cssText = `
                      all: initial;
                      position: fixed;
                      top: 0;
                      left: -10000px;
                      width: 794px;
                      padding: 60px 64px;
                      background: #ffffff;
                      color: #1a1c19;
                      font-family: Georgia, 'Times New Roman', serif;
                      font-size: 15px;
                      line-height: 1.7;
                      box-sizing: border-box;
                    `;
                    container.innerHTML = `
                      <style>
                        .zpdf-render * { box-sizing: border-box; }
                        .zpdf-render .zpdf-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid #e5e9e5; }
                        .zpdf-render .zpdf-brand { font-family: Arial, Helvetica, sans-serif; font-size: 20px; font-weight: 800; color: #1f4534; letter-spacing: -0.02em; }
                        .zpdf-render .zpdf-date { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #9aaa9f; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 700; }
                        .zpdf-render h1.zpdf-title { font-family: 'Nunito', Arial, Helvetica, sans-serif; font-size: 30px; font-weight: 800; line-height: 1.2; margin: 0 0 28px 0; color: #1a1c19; letter-spacing: -0.02em; }
                        .zpdf-render .zpdf-content p { margin: 0 0 0.6em 0; }
                        .zpdf-render .zpdf-content h1, .zpdf-render .zpdf-content h2, .zpdf-render .zpdf-content h3 { font-weight: 700; color: #1a1c19; margin: 0.4em 0 0.35em; }
                        .zpdf-render .zpdf-content h1 { font-size: 22px; }
                        .zpdf-render .zpdf-content h2 { font-size: 18px; }
                        .zpdf-render .zpdf-content h3 { font-size: 16px; }
                        /* Lists — override the inline padding from
                           markdownToHtml so the CSS pseudo-bullet
                           layout works correctly. We use !important
                           because the inline style ("padding-left:20px")
                           on the <ul>/<ol> would otherwise win.

                           Layout strategy: flex with the bullet as
                           its own flex child. That makes the bullet
                           ALWAYS align to the first line's baseline
                           of the content, regardless of how long
                           the content is or how many lines it wraps
                           to. The previous absolute-positioned
                           ::before drifted when items contained
                           inline-code chips, <strong>, or wrapped
                           text — the bullet ended up floating high
                           above the text. */
                        .zpdf-render .zpdf-content ul,
                        .zpdf-render .zpdf-content ol {
                          margin: 0.9em 0 !important;
                          padding-left: 0 !important;
                          list-style: none !important;
                        }
                        .zpdf-render .zpdf-content ul > li,
                        .zpdf-render .zpdf-content ol > li {
                          display: flex !important;
                          align-items: flex-start;
                          gap: 0.55em;
                          margin: 0.1em 0 !important;
                          padding-left: 0.2em !important;
                          page-break-inside: avoid;
                          break-inside: avoid;
                          line-height: 1.55;
                        }
                        /* Unordered list bullet — small sage disc.
                           To get it on the SAME LINE as the first
                           text baseline, we calibrate margin-top
                           against the body line-height. Adjusting
                           the bullet DOWN from 0.6em to 0.7em
                           because the previous value put the bullet
                           slightly above the text baseline — now
                           sits visually level with the text x-height. */
                        .zpdf-render .zpdf-content ul > li::before {
                          content: "";
                          flex: 0 0 6px;
                          width: 6px;
                          height: 6px;
                          margin-top: 0.7em;
                          border-radius: 999px;
                          background: #1f4534;
                        }
                        /* The inline content of each <li> is wrapped
                           in <span class="zpdf-li-text"> by markdownToHtml.
                           That gives us a SINGLE flex item that owns the
                           entire line's text flow. Inside the span,
                           inline-block <code> chips, <strong>, etc.
                           wrap naturally as inline elements — no flex
                           weirdness. flex: 1 1 0% + min-width: 0 lets
                           the span shrink to share the row with the
                           bullet, while still allowing long inline-code
                           chips to wrap rather than push the row
                           wider than the page. */
                        .zpdf-render .zpdf-content .zpdf-li-text {
                          flex: 1 1 0%;
                          min-width: 0;
                          display: block;
                          line-height: 1.55;
                          word-wrap: break-word;
                          overflow-wrap: anywhere;
                        }
                        /* Bold lead-in inside li — stays inline, with
                           a regular word-break so multi-word bold
                           phrases like "Listing AVDs" don't wrap
                           mid-word. word-break:normal allows the
                           SPACE between words to break, but lets
                           individual words stay whole. */
                        .zpdf-render .zpdf-content li strong,
                        .zpdf-render .zpdf-content li b {
                          display: inline;
                          line-height: inherit;
                          white-space: normal;
                          word-break: normal;
                        }
                        /* Inline code chips inside li/p — give them
                           breathing room on both sides so adjacent
                           chips don't appear jam-packed (the bug
                           in the AVD script screenshot where
                           "$P / AT / H" looked smashed together).
                           Vertical-align: baseline keeps the chip
                           on the same baseline as the surrounding
                           prose. */
                        .zpdf-render .zpdf-content li code,
                        .zpdf-render .zpdf-content p code {
                          margin: 0 2px;
                          vertical-align: baseline;
                        }
                        /* Ordered list — same flex layout, but use a
                           CSS counter rendered as text instead of a
                           disc. */
                        .zpdf-render .zpdf-content ol {
                          counter-reset: zpdf-ol;
                        }
                        .zpdf-render .zpdf-content ol > li {
                          counter-increment: zpdf-ol;
                        }
                        .zpdf-render .zpdf-content ol > li::before {
                          content: counter(zpdf-ol) ".";
                          flex: 0 0 1.4em;
                          font-weight: 700;
                          color: #1f4534;
                          text-align: right;
                          margin-top: 0;
                        }
                        /* Major blocks use the JS-injected cut-hint
                           spacers (24px wide before h1/h2/h3/pre/
                           blockquote/table; 8px narrow before lists)
                           for vertical separation. Adding a CSS
                           top-margin here on top of that compounded
                           into ~50px gaps between every section. We
                           only keep page-break hints. */
                        .zpdf-render .zpdf-content h1,
                        .zpdf-render .zpdf-content h2,
                        .zpdf-render .zpdf-content h3,
                        .zpdf-render .zpdf-content blockquote,
                        .zpdf-render .zpdf-content pre,
                        .zpdf-render .zpdf-content table {
                          page-break-inside: avoid;
                          break-inside: avoid;
                          page-break-after: avoid;
                          break-after: avoid-page;
                        }
                        .zpdf-render .zpdf-content blockquote { font-style: italic; color: #1f4534; padding: 0.3em 1em; margin: 1em 0; border-left: 3px solid #d2e8d5; }
                        .zpdf-render .zpdf-content code {
                          background: #f2f4f1;
                          padding: 0.15em 0.4em;
                          border-radius: 3px;
                          font-size: 0.9em;
                          font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, 'Courier New', monospace;
                          /* Long inline code chips like file paths
                             and URLs: prefer to keep the WHOLE chip
                             on one line. break-word + anywhere lets
                             the chip wrap if it absolutely has to,
                             but unlike break-all it won't carve a
                             single-character "r" off the end of a
                             long token. The chip looks visually
                             cleaner this way. */
                          word-break: break-word;
                          overflow-wrap: anywhere;
                          white-space: normal;
                          line-height: inherit;
                          vertical-align: baseline;
                          /* Discourage breaks mid-chip by making the
                             chip an inline-block — it'll prefer to
                             move to the next line as a unit. */
                          display: inline;
                        }
                        /* Plain <pre> fallback (when PDF source has
                           a raw pre without our header wrapper). */
                        .zpdf-render .zpdf-content pre {
                          background: #f7f7f5;
                          color: #1f2227;
                          border: 1px solid #e5e7e0;
                          padding: 14px 18px;
                          border-radius: 12px;
                          overflow: hidden;
                          font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
                          font-size: 13px;
                          line-height: 1.7;
                          margin: 1.2em 0;
                          white-space: pre-wrap;
                          word-break: break-word;
                          overflow-wrap: anywhere;
                        }
                        /* Structured code block (emitted by our
                           fenced-code rule above). Matches the
                           in-app ZkCodeBlock visual: header strip
                           with language label, then code body. */
                        .zpdf-render .zpdf-code-block {
                          background: #f7f7f5;
                          border: 1px solid #e5e7e0;
                          border-radius: 14px;
                          margin: 1.4em 0;
                          overflow: hidden;
                          box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.02);
                        }
                        .zpdf-render .zpdf-code-block-header {
                          padding: 10px 18px;
                          background: #fbfbf9;
                          border-bottom: 1px solid #ececea;
                          font-family: 'Inter', system-ui, sans-serif;
                        }
                        .zpdf-render .zpdf-code-block-lang {
                          font-size: 12px;
                          font-weight: 600;
                          color: #4b5158;
                        }
                        .zpdf-render .zpdf-code-block-body {
                          margin: 0;
                          padding: 14px 18px;
                          background: transparent;
                          border: 0;
                          border-radius: 0;
                          color: #1f2227;
                          font-family: 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace;
                          font-size: 13px;
                          line-height: 1.7;
                          white-space: pre-wrap;
                          word-break: break-word;
                          overflow-wrap: anywhere;
                        }
                        /* Prism tokens INSIDE the PDF code block.
                           Light-mode palette mirrors the on-screen
                           CSS so PDFs match what the user just saw. */
                        .zpdf-render .zpdf-code-block .token.comment,
                        .zpdf-render .zpdf-code-block .token.prolog,
                        .zpdf-render .zpdf-code-block .token.doctype,
                        .zpdf-render .zpdf-code-block .token.cdata {
                          color: #8b8f96;
                          font-style: italic;
                        }
                        .zpdf-render .zpdf-code-block .token.punctuation { color: #555a62; }
                        .zpdf-render .zpdf-code-block .token.property,
                        .zpdf-render .zpdf-code-block .token.tag,
                        .zpdf-render .zpdf-code-block .token.boolean,
                        .zpdf-render .zpdf-code-block .token.number,
                        .zpdf-render .zpdf-code-block .token.constant,
                        .zpdf-render .zpdf-code-block .token.symbol,
                        .zpdf-render .zpdf-code-block .token.deleted {
                          color: #d44a6f;
                        }
                        .zpdf-render .zpdf-code-block .token.selector,
                        .zpdf-render .zpdf-code-block .token.attr-name,
                        .zpdf-render .zpdf-code-block .token.string,
                        .zpdf-render .zpdf-code-block .token.char,
                        .zpdf-render .zpdf-code-block .token.builtin,
                        .zpdf-render .zpdf-code-block .token.inserted {
                          color: #2d8a4a;
                        }
                        .zpdf-render .zpdf-code-block .token.operator,
                        .zpdf-render .zpdf-code-block .token.entity,
                        .zpdf-render .zpdf-code-block .token.url {
                          color: #6f7480;
                        }
                        .zpdf-render .zpdf-code-block .token.atrule,
                        .zpdf-render .zpdf-code-block .token.attr-value,
                        .zpdf-render .zpdf-code-block .token.keyword {
                          color: #9333ea;
                          font-weight: 500;
                        }
                        .zpdf-render .zpdf-code-block .token.function,
                        .zpdf-render .zpdf-code-block .token.class-name {
                          color: #2d6da3;
                        }
                        .zpdf-render .zpdf-code-block .token.regex,
                        .zpdf-render .zpdf-code-block .token.important,
                        .zpdf-render .zpdf-code-block .token.variable {
                          color: #c47d2a;
                        }
                        .zpdf-render .zpdf-code-block .token.important,
                        .zpdf-render .zpdf-code-block .token.bold { font-weight: 700; }
                        .zpdf-render .zpdf-code-block .token.italic { font-style: italic; }
                        /* Code inside <pre> shouldn't keep the
                           inline-code chip background — that creates
                           a pill inside the block. Inherit instead. */
                        .zpdf-render .zpdf-content pre code {
                          background: transparent;
                          padding: 0;
                          border-radius: 0;
                          font-size: inherit;
                          word-break: normal;
                        }
                        /* Code block inside list item — break to its
                           own line so the bullet still aligns with
                           the FIRST text line, not with the code. */
                        .zpdf-render .zpdf-content li > pre {
                          margin: 0.5em 0 0.3em 0;
                        }
                        .zpdf-render .zpdf-content a { color: #1f4534; text-decoration: underline; }
                        .zpdf-render .zpdf-content img { max-width: 100%; height: auto; }
                        .zpdf-render .zpdf-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }
                        .zpdf-render .zpdf-content th, .zpdf-render .zpdf-content td { border: 1px solid #e5e9e5; padding: 8px 12px; text-align: left; }
                        .zpdf-render .zpdf-content input[type="checkbox"] { margin-right: 6px; }
                      </style>
                      <div class="zpdf-render">
                        <div class="zpdf-header">
                          <span class="zpdf-brand">zakar <span style="font-weight: 500; color: #5b605d; letter-spacing: -0.01em;">— notes</span></span>
                          <span class="zpdf-date">${dateStr}</span>
                        </div>
                        <h1 class="zpdf-title">${escapedTitle}</h1>
                        <div class="zpdf-content">${htmlContent}</div>
                      </div>
                    `;
                    document.body.appendChild(container);

                    // The in-HTML footer was removed — we now draw the footer
                    // per-page directly on the PDF using pdf.text() + pdf.line()
                    // so it appears on EVERY page (not just the last one) and
                    // sits at a consistent location on each page regardless of
                    // where the canvas slice ends.

                    // INJECT CUT HINTS — explicit 10px-tall pure-white
                    // spacer divs inserted before every major block.
                    // html2canvas renders these as guaranteed-empty
                    // rows, which the slice's low-ink scanner reliably
                    // picks up as ideal cut points. Without these, a
                    // dense run of bullets or a tall code block at a
                    // page boundary could leave the scanner with no
                    // clean break, and content would get cut. The
                    // spacers are visually invisible (white on white)
                    // so they don't affect the perceived design — they
                    // just give the pagination algorithm something to
                    // grab onto.
                    try {
                      // Two spacer sizes:
                      //   - "wide" (24px) before h1/h2/h3/pre/blockquote/table.
                      //     These are blocks the user expects to live as
                      //     ONE unit on a page. The wide gap gives the
                      //     slicer a clear, unmistakable cut point so
                      //     the heading doesn't get orphaned at the
                      //     bottom of a page with its content on the
                      //     next.
                      //   - "narrow" (8px) before ul/ol/.zpdf-checklist/hr.
                      //     We still want a recognizable gap so the
                      //     slicer can land on it, but the wide gap
                      //     between consecutive lists made the per-item
                      //     spacing look inflated.
                      const wideHint = `<div style="height:24px;background:#ffffff;margin:0;padding:0;line-height:0;font-size:0;" data-pdf-cut="1"></div>`;
                      const narrowHint = `<div style="height:8px;background:#ffffff;margin:0;padding:0;line-height:0;font-size:0;" data-pdf-cut="1"></div>`;
                      const contentRoot = container.querySelector(
                        ".zpdf-content",
                      );
                      if (contentRoot) {
                        // Inject WIDE before headings, code, quotes, tables.
                        // Target the zpdf-code-block WRAPPER (not the
                        // inner pre.zpdf-code-block-body) so the cut
                        // hint goes ABOVE the whole code surface — not
                        // BETWEEN the dark header strip and the code
                        // body (which would leave the "Bash" header
                        // stranded alone at the bottom of a page,
                        // with the code body starting on the next).
                        contentRoot
                          .querySelectorAll(
                            "h1, h2, h3, blockquote, .zpdf-code-block, pre:not(.zpdf-code-block-body), table",
                          )
                          .forEach((el) => {
                            const prev = el.previousElementSibling as HTMLElement | null;
                            if (prev?.getAttribute("data-pdf-cut") === "1") return;
                            // If the previous element is a heading,
                            // skip injecting a wide gap — we want
                            // headings to STAY VISUALLY ATTACHED to
                            // the block immediately below them
                            // (their content). Otherwise we get a
                            // big empty void between "Section title"
                            // and the code block / paragraph that
                            // belongs to it.
                            if (
                              prev &&
                              /^H[1-6]$/.test(prev.tagName)
                            )
                              return;
                            el.insertAdjacentHTML("beforebegin", wideHint);
                          });
                        // Inject NARROW before lists and hr.
                        contentRoot
                          .querySelectorAll("ul, ol, .zpdf-checklist, hr")
                          .forEach((el) => {
                            const prev = el.previousElementSibling as HTMLElement | null;
                            if (prev?.getAttribute("data-pdf-cut") === "1") return;
                            // Same heading-attachment rule for lists.
                            if (
                              prev &&
                              /^H[1-6]$/.test(prev.tagName)
                            )
                              return;
                            el.insertAdjacentHTML("beforebegin", narrowHint);
                          });
                      }
                    } catch (hintErr) {
                      console.warn(
                        "[pdf] cut-hint injection failed:",
                        hintErr,
                      );
                    }

                    // Wait a tick for images/fonts to settle
                    await new Promise((r) => setTimeout(r, 100));

                    // Render to canvas at 2x resolution for sharp text
                    const canvas = await html2canvas(container, {
                      scale: 2,
                      useCORS: true,
                      backgroundColor: "#ffffff",
                      logging: false,
                      windowWidth: 794,
                      // Tailwind v4 emits oklch() colors at the document root
                      // (e.g. on <html>, <body>) which html2canvas can't parse.
                      // Strip them from the cloned doc before rasterization.
                      // This runs in the offscreen iframe, so it doesn't affect
                      // the live page.
                      onclone: (clonedDoc) => {
                        const html = clonedDoc.documentElement;
                        const body = clonedDoc.body;
                        if (html) {
                          html.style.color = "#1a1c19";
                          html.style.backgroundColor = "#ffffff";
                        }
                        if (body) {
                          body.style.color = "#1a1c19";
                          body.style.backgroundColor = "#ffffff";
                        }
                      },
                    });

                    // Capture <a> link positions BEFORE removing the
                    // container so we can lay clickable hyperlinks
                    // over the rasterized canvas in the final PDF.
                    // We measure relative to the container's top-left
                    // (which corresponds to canvas pixel 0,0).
                    type LinkRect = {
                      url: string;
                      // Coordinates in canvas-pixel space at the
                      // original DPR (we'll scale to mm later).
                      x: number;
                      y: number;
                      w: number;
                      h: number;
                    };
                    const linkRects: LinkRect[] = [];
                    // Rects of blocks that should NEVER be split across
                    // a page boundary. The slicer consults these when
                    // choosing a cut point: if the proposed cut would
                    // land INSIDE one of these rects, the cut is moved
                    // to the rect's TOP (pushing the whole block to the
                    // next page) instead of cutting it in half. This
                    // is the visual fix for "quote cut in half across
                    // pages" — the quote either stays on the current
                    // page in full, or moves to the next page in full.
                    type KeepRect = { yTop: number; yBottom: number };
                    const keepRects: KeepRect[] = [];
                    try {
                      const containerRect = container.getBoundingClientRect();
                      const anchors = container.querySelectorAll(
                        "a[href]",
                      ) as NodeListOf<HTMLAnchorElement>;
                      anchors.forEach((a) => {
                        const href = a.getAttribute("href") || "";
                        // Skip empty/JS hrefs.
                        if (!href || href.startsWith("javascript:")) return;
                        // Skip in-doc anchors that wouldn't make
                        // sense as PDF links.
                        if (href.startsWith("#")) return;
                        const rects = a.getClientRects();
                        for (let r = 0; r < rects.length; r++) {
                          const rect = rects[r];
                          linkRects.push({
                            url: href,
                            x: rect.left - containerRect.left,
                            y: rect.top - containerRect.top,
                            w: rect.width,
                            h: rect.height,
                          });
                        }
                      });
                      // Capture all keep-together block bounds. We
                      // INCLUDE the cut-hint spacer above the block
                      // in the "top" so the slicer's snap moves the
                      // cut to the whitespace ABOVE the block — not
                      // to the block's content edge (which would
                      // produce a tight cut with no breathing room).
                      const keepBlocks = container.querySelectorAll(
                        "blockquote, pre, table, .zpdf-checklist, .zpdf-code-block, h1, h2, h3",
                      );
                      keepBlocks.forEach((el) => {
                        const r = (el as HTMLElement).getBoundingClientRect();
                        const yTop = r.top - containerRect.top;
                        const yBottom = r.bottom - containerRect.top;
                        // Convert from CSS px to canvas px (scale 2).
                        keepRects.push({
                          yTop: yTop * 2,
                          yBottom: yBottom * 2,
                        });
                      });
                    } catch (linkErr) {
                      console.warn(
                        "[pdf] rect capture failed:",
                        linkErr,
                      );
                    }

                    document.body.removeChild(container);

                    // Build A4 PDF and add the canvas, paginating if content is taller than one page
                    const pdf = new jsPDF({
                      orientation: "portrait",
                      unit: "mm",
                      format: "a4",
                      compress: true,
                    });

                    const pdfWidth = pdf.internal.pageSize.getWidth(); // 210mm
                    const pdfHeight = pdf.internal.pageSize.getHeight(); // 297mm
                    const imgWidth = pdfWidth;
                    const imgHeight = (canvas.height * imgWidth) / canvas.width;

                    // Page geometry shared between rendering and footer drawing.
                    // - TOP_MARGIN_MM: breathing room above content on pages 2+
                    //   so the canvas slice doesn't butt up against the page top.
                    // - FOOTER_RESERVE_MM: reserved at the bottom of every page
                    //   for the drawn footer (line + "myzakar.app — shared note").
                    const TOP_MARGIN_MM = 10;
                    const FOOTER_RESERVE_MM = 14;

                    // Available content height on the FIRST page (no top margin
                    // since the rendered HTML already has its own padding).
                    const firstPageContentHeight =
                      pdfHeight - FOOTER_RESERVE_MM;
                    // Available content height on SUBSEQUENT pages (top margin + footer).
                    const subsequentPageContentHeight =
                      pdfHeight - TOP_MARGIN_MM - FOOTER_RESERVE_MM;

                    // If the entire image fits within the first page's content
                    // area, we can place it without slicing.
                    if (imgHeight <= firstPageContentHeight) {
                      pdf.addImage(
                        canvas.toDataURL("image/png", 0.95),
                        "PNG",
                        0,
                        0,
                        imgWidth,
                        imgHeight,
                      );

                      // Single-page link overlay. Each link rect is in
                      // CSS-pixel space; convert to mm and drop onto
                      // page 1 of the PDF. 1 CSS px = pdfWidth / 794 mm
                      // (container was rendered at 794px wide).
                      const PX_TO_MM = pdfWidth / 794;
                      for (const lr of linkRects) {
                        pdf.link(
                          lr.x * PX_TO_MM,
                          lr.y * PX_TO_MM,
                          lr.w * PX_TO_MM,
                          lr.h * PX_TO_MM,
                          { url: lr.url },
                        );
                      }
                    } else {
                      // Paginate: slice the canvas into page-sized chunks.
                      //
                      // CRITICAL: Don't blindly slice at fixed pixel intervals
                      // — that cuts through headings/paragraphs (you see half a
                      // line at the bottom of page N, the other half at the top
                      // of page N+1). Instead, scan UPWARD from each proposed
                      // boundary looking for a row that's mostly whitespace, and
                      // cut THERE. This naturally falls in the gaps between
                      // paragraphs, headings, and list items.
                      const pageHeightPx =
                        (pdfHeight * canvas.width) / pdfWidth;

                      // Pre-read the full canvas pixels once so we can probe rows
                      // without expensive re-reads.
                      const fullCtx = canvas.getContext("2d");
                      let fullData: Uint8ClampedArray | null = null;
                      if (fullCtx) {
                        try {
                          fullData = fullCtx.getImageData(
                            0,
                            0,
                            canvas.width,
                            canvas.height,
                          ).data;
                        } catch {
                          // Cross-origin tainting could throw — fall back to dumb slicing
                          fullData = null;
                        }
                      }

                      // For a given row, return a "darkness score" — how much
                      // ink is on this row. Lower score = more whitespace =
                      // better break point. We sample densely (every other
                      // pixel) and accumulate the ink amount per pixel rather
                      // than just counting, so a row with one solid line of
                      // text scores higher than a row with a few stray
                      // antialiasing pixels.
                      const inkScoreForRow = (
                        data: Uint8ClampedArray,
                        rowY: number,
                        width: number,
                      ): number => {
                        let score = 0;
                        const rowStart = rowY * width * 4;
                        for (let x = 0; x < width; x += 2) {
                          const i = rowStart + x * 4;
                          const r = data[i];
                          const g = data[i + 1];
                          const b = data[i + 2];
                          // Average channel — 255 = pure white, 0 = pure black.
                          // Subtract from 255 to get "darkness". Pixels above
                          // 248 (near-white antialiasing) contribute nothing.
                          const avg = (r + g + b) / 3;
                          if (avg < 248) score += 255 - avg;
                        }
                        return score;
                      };

                      // Find the cleanest break point within `searchHeight` px
                      // above the proposed cut. We don't just want a low-ink
                      // row — we want the MIDDLE of the longest run of low-ink
                      // rows (the gap between paragraphs/sections). That way
                      // we never cut just above or just below text — we cut
                      // squarely in the gap.
                      const findCleanBreak = (
                        proposedY: number,
                        searchHeight: number,
                      ): number => {
                        if (!fullData) return proposedY;
                        // Don't search above 50% of the page. Lower than the
                        // previous 35% — we'd rather have a slightly
                        // emptier page than visibly cut content. With the
                        // 24px CSS margins we add to every major block,
                        // a gap should always exist within this window.
                        const minY = Math.max(
                          proposedY - searchHeight,
                          proposedY - pageHeightPx * 0.5,
                          0,
                        );
                        // Score every candidate row
                        const scores: number[] = [];
                        for (let y = minY; y <= proposedY; y++) {
                          scores.push(
                            inkScoreForRow(fullData, y, canvas.width),
                          );
                        }
                        // What's "low ink"? Use a threshold relative to the
                        // max in this range — anything below 5% of the max
                        // counts as a gap row.
                        const maxScore = Math.max(...scores, 1);
                        const gapThreshold = maxScore * 0.05;

                        // Find the longest consecutive run of gap rows
                        let bestStart = -1;
                        let bestLen = 0;
                        let runStart = -1;
                        for (let i = 0; i < scores.length; i++) {
                          if (scores[i] <= gapThreshold) {
                            if (runStart === -1) runStart = i;
                            const runLen = i - runStart + 1;
                            if (runLen > bestLen) {
                              bestLen = runLen;
                              bestStart = runStart;
                            }
                          } else {
                            runStart = -1;
                          }
                        }

                        if (bestLen >= 4) {
                          // Cut at the middle of the longest gap
                          return minY + bestStart + Math.floor(bestLen / 2);
                        }
                        // No clear gap found — fall back to the lowest-ink row
                        let bestIdx = scores.length - 1;
                        let bestScore = scores[bestIdx];
                        for (let i = 0; i < scores.length; i++) {
                          if (scores[i] < bestScore) {
                            bestScore = scores[i];
                            bestIdx = i;
                          }
                        }
                        return minY + bestIdx;
                      };

                      let yOffset = 0;
                      let pageNum = 0;
                      while (yOffset < canvas.height) {
                        // Per-page content height in canvas pixels.
                        // Page 1: full pdfHeight minus footer reserve.
                        // Pages 2+: also subtract the top margin.
                        const pageContentHeightMm =
                          pageNum === 0
                            ? firstPageContentHeight
                            : subsequentPageContentHeight;
                        const pageContentHeightPx =
                          (pageContentHeightMm * canvas.width) / pdfWidth;

                        // Naive slice end based on this page's available height
                        let sliceEnd = Math.min(
                          yOffset + pageContentHeightPx,
                          canvas.height,
                        );

                        // If this isn't the last page, snap to a clean break.
                        // Search up to 1100px upward (≈ 22 lines of text).
                        // The slicer now has even more room to find a gap,
                        // which combined with the 24px margin-top we add to
                        // every major block in CSS should give it clear
                        // cut points to land on.
                        if (sliceEnd < canvas.height) {
                          sliceEnd = findCleanBreak(sliceEnd, 1100);
                          // Safety: don't go backwards
                          if (sliceEnd <= yOffset) {
                            sliceEnd = Math.min(
                              yOffset + pageContentHeightPx,
                              canvas.height,
                            );
                          }
                          // KEEP-TOGETHER snap: if the proposed cut
                          // would fall INSIDE a blockquote/pre/table/
                          // checklist/heading, push the cut up to the
                          // block's top so the whole block moves to
                          // the next page instead of being split in
                          // half. We only do this if there's enough
                          // content above the block to make a
                          // worthwhile current page (>= 30% of page).
                          // Otherwise we leave the bad cut in place —
                          // the block is just too tall to keep whole.
                          for (const kr of keepRects) {
                            const krHeight = kr.yBottom - kr.yTop;
                            // Only snap if the block fits in a page
                            // (krHeight <= pageContentHeightPx). If the
                            // block is genuinely taller than a page we
                            // can't keep it whole anywhere, so accept
                            // the cut. Lower the floor to 15% so even
                            // a tight first-page-of-block-on-next
                            // snap fires.
                            if (
                              krHeight <= pageContentHeightPx &&
                              sliceEnd > kr.yTop &&
                              sliceEnd < kr.yBottom &&
                              kr.yTop > yOffset + pageContentHeightPx * 0.15
                            ) {
                              sliceEnd = Math.floor(kr.yTop) - 4;
                              break;
                            }
                          }
                          if (sliceEnd <= yOffset) {
                            // Fallback if the snap pushed too far up.
                            sliceEnd = Math.min(
                              yOffset + pageContentHeightPx,
                              canvas.height,
                            );
                          }
                        }
                        const sliceHeight = sliceEnd - yOffset;

                        // Create a temporary canvas for this page slice
                        const pageCanvas = document.createElement("canvas");
                        pageCanvas.width = canvas.width;
                        pageCanvas.height = sliceHeight;
                        const ctx = pageCanvas.getContext("2d");
                        if (!ctx) break;
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
                        ctx.drawImage(
                          canvas,
                          0,
                          yOffset,
                          canvas.width,
                          sliceHeight,
                          0,
                          0,
                          canvas.width,
                          sliceHeight,
                        );

                        const sliceImgHeight =
                          (sliceHeight * imgWidth) / canvas.width;
                        if (pageNum > 0) pdf.addPage();
                        // Y placement: page 1 starts at top; pages 2+ start
                        // below the top margin so content has breathing room.
                        const yPlacementMm = pageNum === 0 ? 0 : TOP_MARGIN_MM;
                        pdf.addImage(
                          pageCanvas.toDataURL("image/png", 0.95),
                          "PNG",
                          0,
                          yPlacementMm,
                          imgWidth,
                          sliceImgHeight,
                        );

                        // Per-page link overlays. linkRects are in
                        // CSS-pixel space relative to the full
                        // container. Since the canvas was rendered
                        // at scale 2, canvas pixels = CSS pixels * 2.
                        // Convert link CSS coords to canvas coords,
                        // check if they fall within this page's
                        // slice [yOffset, sliceEnd], and if so emit
                        // a pdf.link() at the correct page position.
                        const PX_TO_MM_MP = pdfWidth / 794;
                        const canvasYPerCssPx = canvas.width / 794; // also ≈ scale (=2)
                        for (const lr of linkRects) {
                          const linkCanvasTop = lr.y * canvasYPerCssPx;
                          const linkCanvasBottom = (lr.y + lr.h) * canvasYPerCssPx;
                          if (
                            linkCanvasBottom < yOffset ||
                            linkCanvasTop > sliceEnd
                          ) {
                            continue;
                          }
                          // Position within the slice (canvas px),
                          // then convert canvas px → mm using the
                          // image's height scale.
                          const linkCanvasYInSlice =
                            linkCanvasTop - yOffset;
                          const linkYMm =
                            yPlacementMm +
                            (linkCanvasYInSlice * imgWidth) / canvas.width;
                          const linkHMm =
                            (lr.h * canvasYPerCssPx * imgWidth) /
                            canvas.width;
                          pdf.link(
                            lr.x * PX_TO_MM_MP,
                            linkYMm,
                            lr.w * PX_TO_MM_MP,
                            linkHMm,
                            { url: lr.url },
                          );
                        }

                        yOffset = sliceEnd;
                        pageNum += 1;
                      }
                    }

                    // Draw the footer on EVERY page using PDF text/line operations
                    // (not html2canvas) so it appears consistently on every page,
                    // not just the last. This gives us a real "sticky footer"
                    // across all pages of a multi-page PDF.
                    const totalPages = pdf.getNumberOfPages();
                    for (let p = 1; p <= totalPages; p++) {
                      pdf.setPage(p);

                      // Footer separator line — sage tint, very thin
                      const lineY = pdfHeight - FOOTER_RESERVE_MM + 2;
                      pdf.setDrawColor(229, 233, 229); // #e5e9e5
                      pdf.setLineWidth(0.2);
                      pdf.line(20, lineY, pdfWidth - 20, lineY);

                      // Footer text "myzakar.app  •  shared note" — centered
                      const textY = pdfHeight - 6;
                      const linkPart = "myzakar.app";
                      const sepPart = "  •  ";
                      const labelPart = "SHARED NOTE";

                      pdf.setFont("helvetica", "bold");
                      pdf.setFontSize(8);

                      // Compute widths so we can position pieces side-by-side
                      const linkWidthMm = pdf.getTextWidth(linkPart);
                      const sepWidthMm = pdf.getTextWidth(sepPart);
                      const labelWidthMm = pdf.getTextWidth(labelPart);
                      const totalWidthMm =
                        linkWidthMm + sepWidthMm + labelWidthMm;
                      const startX = (pdfWidth - totalWidthMm) / 2;

                      // Draw "myzakar.app" in sage brand color
                      pdf.setTextColor(79, 99, 84); // #2d5a44
                      pdf.text(linkPart, startX, textY);

                      // Draw separator + label in muted gray
                      pdf.setTextColor(171, 180, 175); // #abb4af
                      pdf.text(sepPart, startX + linkWidthMm, textY);
                      pdf.text(
                        labelPart,
                        startX + linkWidthMm + sepWidthMm,
                        textY,
                      );

                      // Add a clickable hyperlink over the "myzakar.app" text.
                      // jsPDF link() takes (x, y, w, h) in mm and an options
                      // object with a `url`. The y param is the TOP of the
                      // hit area, so we offset upward by ~3.5mm to cover the
                      // text glyph.
                      pdf.link(startX - 1, textY - 3.5, linkWidthMm + 2, 5, {
                        url: "https://myzakar.app",
                      });
                    }

                    // Reset text color for any subsequent operations (defensive;
                    // we save() right after but better not to leak state).
                    pdf.setTextColor(0, 0, 0);

                    pdf.save(filename);
                  } catch (err) {
                    console.error("PDF generation failed:", err);
                    alert(
                      "Failed to generate PDF. Please try again or use your browser's Print > Save as PDF as a fallback.",
                    );
                  } finally {
                    if (btn && originalText) {
                      btn.innerHTML = originalText;
                      btn.removeAttribute("disabled");
                    }
                  }
                }}
                className="group flex items-center gap-1.5 px-3 py-2 rounded-lg text-[#5b605d] dark:text-[#a3a3a3] hover:text-[#2e3431] dark:hover:text-[#d4e8d8] hover:bg-[#c6e3ca] dark:hover:bg-[#3d5142] transition-all text-[10px] font-bold tracking-[0.25em] uppercase disabled:opacity-50 active:scale-95"
              >
                <Download
                  className="w-3.5 h-3.5 transition-transform group-hover:-translate-y-0.5"
                  strokeWidth={2}
                />{" "}
                Download PDF
              </button>
              <button
                onClick={() => {
                  const subject = encodeURIComponent("Report: Shared Note");
                  const body = encodeURIComponent(
                    `I'd like to report this shared note: ${window.location.href}\n\nReason:`,
                  );
                  window.open(
                    `mailto:support@myzakar.app?subject=${subject}&body=${body}`,
                  );
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[#5b605d] dark:text-[#a3a3a3] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/15 transition-all text-[10px] font-bold tracking-[0.25em] uppercase active:scale-95"
              >
                <Flag className="w-3.5 h-3.5" strokeWidth={2} /> Report
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!isAuthReady || isCheckingShare) {
    return (
      <div className="min-h-screen zk-surface dark:zk-surface flex items-center justify-center transition-colors duration-300">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <FileText className="w-10 h-10 zk-text-primary-brand dark:zk-text-primary-brand" />
          <p
            className="text-sm zk-text-faint"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            Loading...
          </p>
        </div>
      </div>
    );
  }

  const handleVerifyForDeletion = async () => {
    setIsIdentityVerified(true);
  };

  const handleDeleteAccount = async () => {
    if (!isIdentityVerified) {
      setDeleteAccountError("Please verify your identity first.");
      return;
    }

    if (isDeletingAccountRef.current || goodbyeEmailSentRef.current) {
      console.log(
        "Account deletion already in progress or goodbye email already sent. Skipping.",
      );
      return;
    }

    setIsDeletingAccount(true);
    isDeletingAccountRef.current = true; // Update ref immediately to prevent race conditions
    deletionStartedAtRef.current = Date.now();
    if (user?.uid) {
      localStorage.setItem(`zakar_deleting_${user.uid}`, "true");
    }
    setDeleteAccountError(null);
    try {
      // Capture user info before deletion
      const userEmail = auth.currentUser?.email;
      const userName = auth.currentUser?.displayName;

      console.log(`Starting account deletion for ${userEmail}...`);
      goodbyeEmailSentRef.current = true;
      if (user?.uid) {
        localStorage.setItem("zakar_last_deleting_uid", user.uid);
      }
      await deleteUserAccount();

      // Send goodbye email asynchronously
      if (userEmail) {
        console.log(`Triggering goodbye email for ${userEmail}...`);
        fetch("/api/send-goodbye", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail, name: userName }),
        })
          .then((res) => res.json())
          .then((data) => console.log("Goodbye email response:", data))
          .catch((err) =>
            console.error("Failed to trigger goodbye email:", err),
          );
      }

      // Reset states on success
      // Note: We don't call setIsDeletingAccount(false) here because the auth state change
      // will handle the cleanup and we want to keep the guard active until the user is gone.
      setIsDeleteConfirmOpen(false);
      setIsSettingsOpen(false);
      setDeleteConfirmName("");
      setIsIdentityVerified(false);
    } catch (error: any) {
      console.error("Account deletion failed:", error);
      if (error.code === "auth/requires-recent-login") {
        setDeleteAccountError(
          "For your security, please sign out and sign back in before deleting your account.",
        );
      } else if (error.code === "auth/network-request-failed") {
        setDeleteAccountError(
          "Connection issue. Please check your internet and try again.",
        );
      } else {
        setDeleteAccountError(
          "Something went wrong while deleting your account. Please try again.",
        );
      }
      setIsDeletingAccount(false);
      isDeletingAccountRef.current = false;
      deletionStartedAtRef.current = 0;
    }
  };
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      if (isSignUp) {
        if (!displayName.trim()) {
          throw new Error("Please enter a display name");
        }
        await signUpWithEmail(email, password, displayName);
        // Send verification email separately — always show verification screen even if email fails
        try {
          await sendVerificationEmail(email, displayName);
        } catch (err) {
          console.error("Verification email failed to send:", err);
        }
        setPendingVerificationEmail(email);
        setPendingVerificationName(displayName);
        setVerificationEmailSent(true);
        return; // skip the catch block — sign-up succeeded
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error: any) {
      let message = "Something went wrong. Please try again.";
      if (
        error.code === "auth/user-not-found" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/invalid-credential"
      ) {
        message = "Incorrect email or password. Please try again.";
      } else if (error.code === "auth/email-already-in-use") {
        message =
          "An account with this email already exists. Try signing in instead.";
      } else if (error.code === "auth/weak-password") {
        message =
          "Your password is too short. Please use at least 6 characters.";
      } else if (error.code === "auth/invalid-email") {
        message = "That doesn't look like a valid email address.";
      } else if (error.code === "auth/email-not-verified") {
        message =
          "Please verify your email before signing in. Check your inbox for the verification link.";
      } else if (error.code === "auth/too-many-requests") {
        message = "Too many attempts. Please wait a moment and try again.";
      } else if (error.code === "auth/network-request-failed") {
        message = "Connection issue. Please check your internet and try again.";
      } else if (error.code === "auth/user-disabled") {
        message = "This account has been disabled. Please contact support.";
      }
      setAuthError(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      console.error("Google Login Error:", error);
      const code = error?.code;
      if (
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/user-cancelled"
      ) {
        // User aborted — don't show an error, this is normal
        setAuthError(null);
      } else if (code === "auth/popup-blocked") {
        setAuthError(
          "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.",
        );
      } else if (code === "auth/network-request-failed") {
        setAuthError(
          "Connection issue. Please check your internet and try again.",
        );
      } else if (code === "auth/too-many-requests") {
        setAuthError("Too many attempts. Please wait a moment and try again.");
      } else if (code === "auth/unauthorized-domain") {
        setAuthError(
          "This domain isn't authorized for Google sign-in. Contact support.",
        );
      } else if (code === "auth/account-exists-with-different-credential") {
        setAuthError(
          "An account already exists with this email using a different sign-in method. Try signing in with email and password.",
        );
      } else if (code === "auth/operation-not-allowed") {
        setAuthError(
          "Google sign-in is currently disabled. Please use email instead.",
        );
      } else if (code === "auth/internal-error") {
        setAuthError(
          "Google sign-in had a temporary issue. Please try again in a moment.",
        );
      } else {
        // Unknown error — show the code so we can diagnose
        const codeHint = code ? ` (${code})` : "";
        setAuthError(
          `Google sign-in didn't work${codeHint}. Please try again or use email instead.`,
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setAuthError("Please enter your email address");
      return;
    }
    setIsSigningIn(true);
    setAuthError(null);
    try {
      // Only use our custom Resend-based API. No fallback to Firebase default.
      await sendPasswordResetEmail(email);
      setResetEmailSent(true);
    } catch (error: any) {
      console.error("Password Reset Flow Error:", error);

      let message = "Couldn't send the reset email. Please try again.";
      if (error.status === 404) {
        message = "We couldn't find an account with that email address.";
      } else if (error.status === 403) {
        message = "This account has been disabled. Please contact support.";
      } else if (error.status === 429) {
        message =
          "You've requested too many resets. Please wait a few minutes and try again.";
      } else if (error.status === 400) {
        message = "That doesn't look like a valid email address.";
      }

      setAuthError(message);
    } finally {
      setIsSigningIn(false);
    }
  };

  if (!user || !user.emailVerified) {
    return (
      <div
        className="min-h-screen flex"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {/* Google Fonts for auth pages only */}
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800&display=swap');`}</style>

        {/* Left Side: Visual Hero */}
        <section
          className="hidden lg:flex lg:w-1/2 relative flex-col justify-end overflow-hidden sticky top-0 h-screen"
          style={{
            background:
              "linear-gradient(135deg, #2d3a30 0%, #2d5a44 40%, #6b8f72 70%, #8fb89a 100%)",
          }}
        >
          {/* Organic shapes */}
          <div
            className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full opacity-10"
            style={{
              background:
                "radial-gradient(circle, #d2e8d5 0%, transparent 70%)",
              transform: "translate(30%, -30%)",
            }}
          />
          <div
            className="absolute bottom-0 left-0 w-[600px] h-[600px] rounded-full opacity-8"
            style={{
              background:
                "radial-gradient(circle, #e0fae6 0%, transparent 70%)",
              transform: "translate(-40%, 40%)",
            }}
          />
          <div
            className="absolute top-1/3 left-1/4 w-[300px] h-[300px] rounded-full opacity-5"
            style={{
              background:
                "radial-gradient(circle, #ffffff 0%, transparent 70%)",
            }}
          />

          {/* Subtle grain overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            }}
          />

          {/* Content */}
          <div className="relative z-10 p-16 pb-20 max-w-lg mt-auto">
            <div className="mb-10">
              <span
                className="text-white/90 text-2xl font-700 tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                zakar
              </span>
            </div>
            <h1
              className="text-white text-[2.75rem] leading-[1.15] font-300 mb-6 tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {welcomeMessage.headline}
            </h1>
            <p className="text-white/60 text-lg font-300 max-w-sm leading-relaxed">
              {welcomeMessage.subtitle}
            </p>
          </div>
        </section>

        {/* Right Side: Auth Form */}
        <section
          className="w-full lg:w-1/2 flex items-center justify-center p-8 lg:p-24 overflow-y-auto"
          style={{ backgroundColor: "#f9faf7" }}
        >
          <div className="w-full max-w-md flex flex-col">
            {/* Mobile Logo */}
            <div className="lg:hidden mb-12 flex justify-center">
              <span
                className="text-2xl font-700 tracking-tight"
                style={{ color: "#2d5a44", fontFamily: "var(--font-display)" }}
              >
                zakar
              </span>
            </div>

            {verificationEmailSent ? (
              /* Verification Email Sent State */
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center lg:text-left"
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 mx-auto lg:mx-0"
                  style={{ backgroundColor: "#d2e8d5" }}
                >
                  <CheckCircle2
                    className="w-7 h-7"
                    style={{ color: "#2d5a44" }}
                  />
                </div>
                <h2
                  className="text-3xl font-700 mb-3 tracking-tight"
                  style={{
                    color: "#2c3430",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  Check your inbox
                </h2>
                <p
                  className="text-sm mb-8 leading-relaxed"
                  style={{ color: "#59615d" }}
                >
                  We sent a verification link to{" "}
                  <strong style={{ color: "#2c3430" }}>
                    {pendingVerificationEmail}
                  </strong>
                  . Please verify before signing in.
                </p>
                <div className="space-y-3">
                  <button
                    disabled={isResendingVerification || verificationResent}
                    onClick={async () => {
                      setIsResendingVerification(true);
                      try {
                        await sendVerificationEmail(
                          pendingVerificationEmail,
                          pendingVerificationName,
                        );
                        setVerificationResent(true);
                        setTimeout(() => setVerificationResent(false), 5000);
                      } catch (err) {
                        console.error(
                          "Failed to resend verification email:",
                          err,
                        );
                      } finally {
                        setIsResendingVerification(false);
                      }
                    }}
                    className="w-full py-4 font-700 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: "#2d5a44",
                      color: "#e7feea",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {isResendingVerification
                      ? "Sending..."
                      : verificationResent
                        ? "Email Sent!"
                        : "Resend Verification Email"}
                  </button>
                  <button
                    onClick={() => {
                      setVerificationEmailSent(false);
                      setPendingVerificationEmail("");
                      setPendingVerificationName("");
                      setVerificationResent(false);
                      setIsSignUp(false);
                      setAuthError(null);
                    }}
                    className="w-full py-4 font-700 rounded-xl transition-all active:scale-[0.97] hover:brightness-95 hover:shadow-sm cursor-pointer"
                    style={{
                      backgroundColor: "#eaefeb",
                      color: "#2c3430",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    Back to Sign In
                  </button>
                </div>
              </motion.div>
            ) : resetEmailSent ? (
              /* Reset Email Sent State */
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center lg:text-left"
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 mx-auto lg:mx-0"
                  style={{ backgroundColor: "#d2e8d5" }}
                >
                  <CheckCircle2
                    className="w-7 h-7"
                    style={{ color: "#2d5a44" }}
                  />
                </div>
                <h2
                  className="text-3xl font-700 mb-3 tracking-tight"
                  style={{
                    color: "#2c3430",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  Check your email
                </h2>
                <p
                  className="text-sm mb-8 leading-relaxed"
                  style={{ color: "#59615d" }}
                >
                  We've sent a password reset link to your email. Follow the
                  instructions to set a new password.
                </p>
                <button
                  onClick={() => {
                    setResetEmailSent(false);
                    setIsForgotPassword(false);
                    setAuthError(null);
                  }}
                  className="w-full py-4 font-700 rounded-xl transition-all active:scale-[0.97] hover:brightness-95 hover:shadow-sm cursor-pointer"
                  style={{
                    backgroundColor: "#eaefeb",
                    color: "#2c3430",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  Back to Sign In
                </button>
              </motion.div>
            ) : (
              /* Main Auth Form */
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <header className="mb-10 text-center lg:text-left">
                  <h2
                    className="text-3xl font-700 mb-2 tracking-tight"
                    style={{
                      color: "#2c3430",
                      fontFamily: "var(--font-display)",
                    }}
                  >
                    {isForgotPassword
                      ? "Reset your password"
                      : isSignUp
                        ? "Create your account"
                        : "Sign in to zakar"}
                  </h2>
                  <p className="text-sm" style={{ color: "#59615d" }}>
                    {isForgotPassword
                      ? "Enter your email and we'll send you a reset link."
                      : isSignUp
                        ? "Start organizing your thoughts with AI."
                        : "Enter your details to continue."}
                  </p>
                </header>

                <div className="space-y-4">
                  {/* Google Login - only show on sign in/sign up */}
                  {!isForgotPassword && (
                    <>
                      <button
                        onClick={handleGoogleLogin}
                        disabled={isSigningIn}
                        className="flex items-center justify-center gap-3 w-full px-6 py-4 rounded-xl transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed group"
                        style={{
                          backgroundColor: "#ffffff",
                          border: "1px solid rgba(171,180,175,0.3)",
                        }}
                      >
                        <svg
                          className="w-5 h-5 grayscale group-hover:grayscale-0 transition-all"
                          viewBox="0 0 24 24"
                        >
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        <span
                          className="text-sm font-600"
                          style={{ color: "#2c3430" }}
                        >
                          Continue with Google
                        </span>
                      </button>

                      <div className="relative flex items-center py-3">
                        <div
                          className="flex-grow"
                          style={{
                            borderTop: "1px solid rgba(171,180,175,0.15)",
                          }}
                        />
                        <span
                          className="flex-shrink mx-4 text-[10px] font-700 uppercase tracking-[0.15em]"
                          style={{ color: "#747d78" }}
                        >
                          or email
                        </span>
                        <div
                          className="flex-grow"
                          style={{
                            borderTop: "1px solid rgba(171,180,175,0.15)",
                          }}
                        />
                      </div>
                    </>
                  )}

                  {/* Auth Form */}
                  <form
                    onSubmit={
                      isForgotPassword ? handleForgotPassword : handleAuth
                    }
                    className="space-y-5"
                  >
                    {isSignUp && !isForgotPassword && (
                      <div className="space-y-1.5">
                        <label
                          className="block text-[11px] font-700 uppercase tracking-[0.12em] ml-1"
                          style={{ color: "#59615d" }}
                        >
                          Display Name
                        </label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Your Name"
                          required
                          className="w-full px-5 py-4 border-none rounded-xl focus:ring-2 transition-all text-sm"
                          style={{
                            backgroundColor: "#e3eae5",
                            color: "#2c3430",
                            fontFamily: "var(--font-display)",
                            outline: "none",
                          }}
                          onFocus={(e) =>
                            (e.target.style.boxShadow =
                              "0 0 0 2px rgba(79,99,84,0.2)")
                          }
                          onBlur={(e) => (e.target.style.boxShadow = "none")}
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label
                        className="block text-[11px] font-700 uppercase tracking-[0.12em] ml-1"
                        style={{ color: "#59615d" }}
                      >
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="hello@myzakar.app"
                        required
                        className="w-full px-5 py-4 border-none rounded-xl transition-all text-sm"
                        style={{
                          backgroundColor: "#e3eae5",
                          color: "#2c3430",
                          fontFamily: "var(--font-display)",
                          outline: "none",
                        }}
                        onFocus={(e) =>
                          (e.target.style.boxShadow =
                            "0 0 0 2px rgba(79,99,84,0.2)")
                        }
                        onBlur={(e) => (e.target.style.boxShadow = "none")}
                      />
                    </div>

                    {!isForgotPassword && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center ml-1 mr-1">
                          <label
                            className="block text-[11px] font-700 uppercase tracking-[0.12em]"
                            style={{ color: "#59615d" }}
                          >
                            Password
                          </label>
                          {!isSignUp && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsForgotPassword(true);
                                setAuthError(null);
                              }}
                              className="text-[11px] font-600 hover:underline transition-all"
                              style={{ color: "#2d5a44" }}
                            >
                              Reset password
                            </button>
                          )}
                        </div>
                        <div className="relative">
                          <input
                            type={showLoginPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="w-full px-5 py-4 pr-12 border-none rounded-xl transition-all text-sm"
                            style={{
                              backgroundColor: "#e3eae5",
                              color: "#2c3430",
                              fontFamily: "var(--font-display)",
                              outline: "none",
                            }}
                            onFocus={(e) =>
                              (e.target.style.boxShadow =
                                "0 0 0 2px rgba(79,99,84,0.2)")
                            }
                            onBlur={(e) => (e.target.style.boxShadow = "none")}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setShowLoginPassword(!showLoginPassword)
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all hover:bg-[#d2e8d5]/50 active:scale-[0.97]"
                            style={{ color: "#747d78" }}
                            title={
                              showLoginPassword
                                ? "Hide password"
                                : "Show password"
                            }
                          >
                            {showLoginPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {isSignUp && !isForgotPassword && (
                      <p
                        className="text-[11px] leading-relaxed text-center"
                        style={{ color: "#747d78" }}
                      >
                        By continuing, you agree to our{" "}
                        <a
                          href="https://www.myzakar.app/#privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2 hover:no-underline"
                          style={{ color: "#2d5a44" }}
                        >
                          Privacy Policy
                        </a>{" "}
                        and{" "}
                        <a
                          href="https://www.myzakar.app/#terms"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2 hover:no-underline"
                          style={{ color: "#2d5a44" }}
                        >
                          Terms of Use
                        </a>
                        .
                      </p>
                    )}

                    {authError && (
                      <div
                        className="px-4 py-3 rounded-xl text-sm font-500"
                        style={{
                          backgroundColor: "rgba(254,137,131,0.12)",
                          color: "#9f403d",
                          border: "1px solid rgba(254,137,131,0.2)",
                        }}
                      >
                        {authError}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSigningIn}
                      className="w-full py-4 font-700 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                      style={{
                        backgroundColor: "#2d5a44",
                        color: "#e7feea",
                        fontFamily: "var(--font-display)",
                      }}
                    >
                      {isSigningIn ? (
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      ) : isForgotPassword ? (
                        "Send Reset Link"
                      ) : isSignUp ? (
                        "Create Account"
                      ) : (
                        "Sign in"
                      )}
                    </button>

                    {isForgotPassword && (
                      <button
                        type="button"
                        disabled={isSigningIn}
                        onClick={() => {
                          setIsForgotPassword(false);
                          setAuthError(null);
                        }}
                        className="group w-full py-3 text-sm font-600 transition-colors text-center disabled:opacity-50 hover:opacity-90 cursor-pointer inline-flex items-center justify-center gap-1.5"
                        style={{ color: "#2d5a44" }}
                      >
                        <span
                          aria-hidden="true"
                          className="inline-block transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-translate-x-1 group-hover:scale-125 group-active:-translate-x-1.5 group-active:scale-[1.3]"
                        >
                          ←
                        </span>
                        <span>Back to Sign In</span>
                      </button>
                    )}
                  </form>
                </div>

                {/* Footer: Toggle sign in/up */}
                {!isForgotPassword && (
                  <footer className="mt-10 text-center">
                    <p className="text-sm" style={{ color: "#59615d" }}>
                      {isSignUp
                        ? "Already have an account?"
                        : "Don't have an account?"}
                      <button
                        onClick={() => {
                          setIsSignUp(!isSignUp);
                          setAuthError(null);
                        }}
                        className="font-700 hover:underline decoration-2 underline-offset-4 ml-1.5 transition-all"
                        style={{ color: "#2d5a44" }}
                      >
                        {isSignUp ? "Sign In" : "Create account"}
                      </button>
                    </p>
                    <div className="mt-12 flex flex-wrap justify-center gap-6">
                      <a
                        href="https://www.myzakar.app/#privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-500 transition-colors hover:underline"
                        style={{ color: "#747d78" }}
                      >
                        Privacy
                      </a>
                      <a
                        href="https://www.myzakar.app/#terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-500 transition-colors hover:underline"
                        style={{ color: "#747d78" }}
                      >
                        Terms
                      </a>
                    </div>
                  </footer>
                )}
              </motion.div>
            )}
          </div>
        </section>

        {/* Organic background blobs */}
        <div
          className="fixed -bottom-32 -left-32 w-96 h-96 rounded-full blur-3xl pointer-events-none -z-10"
          style={{ backgroundColor: "rgba(210,232,213,0.2)" }}
        />
        <div
          className="fixed -top-32 -right-32 w-96 h-96 rounded-full blur-3xl pointer-events-none -z-10"
          style={{ backgroundColor: "rgba(224,250,230,0.2)" }}
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={dndSensors}
      // closestCenter > pointerWithin for masonry layouts. pointerWithin
      // requires the cursor to be inside a target's bounding box —
      // missing the target during fast drags across columns leaves the
      // user with no drop target and the drag does nothing. closestCenter
      // always picks the nearest target by center distance, so dragging
      // a card "across the grid" reliably finds a destination.
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-screen zk-surface dark:zk-surface zk-text dark:text-[#e8ede9] selection:bg-[#d2e8d5] dark:selection:bg-[#2d5a44]/30 transition-colors duration-300">
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,300..800;1,6..72,300..800&family=Manrope:wght@200..800&display=swap');

        /* ============================================================
           ZAKAR DESIGN SYSTEM — Material 3 token mapping
           Semantic names keep future refactors safe; values remain
           the tuned Zakar palette (not stock M3 seed generation).
           ============================================================ */
        :root {
          /* M3 Color Roles — Light */
          --md-sys-color-primary: #2d5a44;
          --md-sys-color-on-primary: #ffffff;
          --md-sys-color-primary-container: #d2e8d5;
          --md-sys-color-on-primary-container: #314436;
          --md-sys-color-primary-hover: #435749;

          --md-sys-color-secondary-container: #e3eae5;
          --md-sys-color-on-secondary-container: #3b413d;

          --md-sys-color-surface: #f9faf7;
          --md-sys-color-surface-container-lowest: #ffffff;
          --md-sys-color-surface-container-low: #f2f4f1;
          --md-sys-color-surface-container: #ebefeb;
          --md-sys-color-surface-container-high: #e5e9e5;

          --md-sys-color-on-surface: #1A1C19;
          --md-sys-color-on-surface-variant: #59615d;
          --md-sys-color-outline: #767c78;
          --md-sys-color-outline-variant: #abb4af;

          --md-sys-color-error: #a83836;
          --md-sys-color-error-container: #fdeaea;

          /* M3 Shape — Corner radius scale */
          --md-sys-shape-corner-xs: 4px;
          --md-sys-shape-corner-sm: 8px;
          --md-sys-shape-corner-md: 12px;
          --md-sys-shape-corner-lg: 16px;
          --md-sys-shape-corner-xl: 28px;
          --md-sys-shape-corner-full: 9999px;

          /* M3 State layer opacities */
          --md-sys-state-hover-opacity: 0.08;
          --md-sys-state-focus-opacity: 0.10;
          --md-sys-state-pressed-opacity: 0.12;
        }

        .dark {
          --md-sys-color-primary: #8fb89a;
          --md-sys-color-on-primary: #1a2920;
          --md-sys-color-primary-container: #2d5a44;
          --md-sys-color-on-primary-container: #d2e8d5;
          --md-sys-color-primary-hover: #a5c5af;

          --md-sys-color-secondary-container: #242b27;
          --md-sys-color-on-secondary-container: #c5d0c8;

          --md-sys-color-surface: #202124;
          --md-sys-color-surface-container-lowest: #0a0f0c;
          --md-sys-color-surface-container-low: #1a1f1c;
          --md-sys-color-surface-container: #242b27;
          --md-sys-color-surface-container-high: #2e3632;

          --md-sys-color-on-surface: #e8ede9;
          --md-sys-color-on-surface-variant: #9aaa9f;
          --md-sys-color-outline: #6a7570;
          --md-sys-color-outline-variant: #3a4340;
        }

        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes zakarSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* Accessibility: focus-visible ring for keyboard navigation */
        button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
          outline: 2px solid #2d5a44;
          outline-offset: 2px;
          border-radius: 8px;
        }
        .dark button:focus-visible, .dark a:focus-visible, .dark input:focus-visible, .dark textarea:focus-visible, .dark select:focus-visible {
          outline-color: #8fb89a;
        }
      `}</style>

        <div className="flex h-screen overflow-hidden">
          {/* Mobile drawer overlay (backdrop) */}
          <AnimatePresence>
            {mobileDrawerOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileDrawerOpen(false)}
                className="fixed inset-0 bg-black/40 z-40 lg:hidden"
              />
            )}
          </AnimatePresence>

          {/* --- Sidebar --- */}
          <aside
            role="navigation"
            aria-label="Main navigation"
            className={cn(
              "flex flex-col bg-[#f4f7f2] dark:bg-[#202124] border-r border-[#dde5da]/20 dark:border-white/[0.03] flex-shrink-0 transition-all duration-300",
              // Hide sidebar entirely when a note is open — clean
              // reading view. Brand presence preserved via the
              // floating logo top-left.
              selectedNote && "hidden",
              // Desktop: sits in flow, collapsible. Top padding kept
              // tight (pt-3 / pt-2) so the logo and avatar sit close
              // to the top edge — earlier this had pt-6 which made
              // the chrome feel bottom-weighted with empty space at
              // the top. Side and bottom padding stays generous.
              !selectedNote && "lg:flex",
              sidebarCollapsed
                ? "lg:w-[72px] lg:px-2.5 lg:pb-2.5 lg:pt-5"
                : "lg:w-56 lg:px-6 lg:pb-6 lg:pt-6",
              // Mobile: fixed overlay drawer
              "fixed inset-y-0 left-0 z-50 w-64 px-6 pb-6 pt-6 lg:static lg:z-auto",
              // When profile popover is open, elevate the entire
              // sidebar above the main content so the popover (which
              // anchors absolute to the user-section) can extend
              // freely to the right without being clipped. Previously
              // this only applied in collapsed mode; expanded mode
              // had the same issue — popover would render but get
              // covered by neighboring stacking contexts.
              showProfilePopover && "lg:z-[60]",
              mobileDrawerOpen
                ? "translate-x-0"
                : "-translate-x-full lg:translate-x-0",
            )}
          >
            {/* Logo + collapse toggle.
                EXPANDED: logo + "zakar" wordmark on the left,
                chevron toggle on the right.
                COLLAPSED: a single hover-swap target — the Zakar
                logo by default, morphing into a PanelLeftOpen
                (|>) icon when the cursor is over it. Click to
                expand. On mobile, this same button closes the
                drawer if it's open. */}
            <div
              className={cn(
                "flex items-center mb-5",
                sidebarCollapsed ? "justify-center" : "justify-between",
              )}
            >
              {!sidebarCollapsed && (
                <div
                  className="flex items-center gap-1 px-3 py-2.5"
                  aria-label="Zakar"
                >
                  <img
                    src="/zakar-logo.svg"
                    alt=""
                    aria-hidden="true"
                    className="h-7 w-auto flex-shrink-0"
                  />
                  <h1
                    className="text-[22px] tracking-tight zk-text dark:zk-text leading-none -ml-0.5"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    zakar
                  </h1>
                </div>
              )}
              {sidebarCollapsed && !mobileDrawerOpen ? (
                // COLLAPSED — hover-swap: logo by default, |> on hover.
                // We use a group on the button so children can react
                // to the parent's :hover state. The PanelLeftOpen
                // icon overlays the logo and fades in on hover; the
                // logo fades out simultaneously so the swap is
                // smooth, not flickery. A tooltip pill appears to
                // the right of the rail (only when hovered + group
                // anchor on the button, so it sits beside the rail
                // rather than crammed inside it).
                <button
                  onClick={() => {
                    setRailTipLabel(null);
                    setSidebarCollapsed(false);
                  }}
                  onMouseEnter={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setRailTipY(r.top + r.height / 2);
                    setRailTipLabel("Open sidebar");
                  }}
                  onMouseLeave={() => setRailTipLabel(null)}
                  className="group relative w-10 h-10 flex items-center justify-center rounded-lg active:scale-95 transition-transform"
                  aria-label="Open sidebar"
                >
                  <img
                    src="/zakar-logo.svg"
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 m-auto h-7 w-auto transition-opacity duration-150 group-hover:opacity-0"
                  />
                  <PanelLeftOpen
                    className="absolute inset-0 m-auto w-5 h-5 zk-text-secondary dark:text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    strokeWidth={1.75}
                  />
                </button>
              ) : (
                // EXPANDED or mobile drawer — collapse button.
                // Shows PanelLeftClose at all times (no icon swap).
                // Hover shows "Close sidebar" via the portal tooltip.
                <button
                  onClick={() => {
                    // Clear the rail tooltip immediately. After the
                    // sidebar collapses/expands, the button's DOM
                    // position changes and onMouseLeave may not fire
                    // — leaving the tooltip stranded on screen.
                    setRailTipLabel(null);
                    if (mobileDrawerOpen) {
                      setMobileDrawerOpen(false);
                    } else {
                      setSidebarCollapsed(!sidebarCollapsed);
                    }
                  }}
                  onMouseEnter={() => {
                    // When the sidebar is expanded, the close button
                    // sits right next to the logo + wordmark — the
                    // affordance is obvious and a "Close sidebar"
                    // pill ends up overlapping the logo (visible in
                    // user-reported screenshot). Just don't show a
                    // tooltip here. The collapsed-state "Open
                    // sidebar" pill remains.
                  }}
                  onMouseLeave={() => setRailTipLabel(null)}
                  className="p-1.5 zk-text-faint hover:zk-text dark:hover:text-white hover:bg-white/60 dark:hover:bg-[#28292c]/40 rounded-lg transition-all active:scale-95"
                  aria-label={mobileDrawerOpen ? "Close menu" : "Close sidebar"}
                >
                  {mobileDrawerOpen ? (
                    <X className="w-5 h-5" />
                  ) : (
                    <PanelLeftClose className="w-5 h-5" strokeWidth={1.75} />
                  )}
                </button>
              )}
            </div>

            {/* Nav.
                Collapsed mode gets an extra top margin so the first
                nav item aligns visually with the search bar's
                baseline in the main content area. Without this the
                rail's first icon sat right under the logo, while
                the search bar's baseline was ~48px lower — making
                the two columns look misaligned. */}
            <nav
              className={cn(
                "space-y-1 flex-1 overflow-y-auto custom-scrollbar min-h-0",
                // Push the first nav item down so it aligns with the
                // search bar in the main panel. Collapsed rail needs a
                // bigger nudge (no logo+wordmark above) — lg:mt-14
                // lines the first icon up with the search bar's
                // vertical center. Expanded only needs a small tweak.
                sidebarCollapsed ? "lg:mt-8" : "lg:mt-2",
              )}
            >
              <DroppableSidebarItem
                id="sidebar-All"
                isOver={dragOverSidebarKey === "All"}
              >
                <button
                  onClick={() => setActiveCategory(null)}
                  className={cn(
                    "w-full flex items-center rounded-xl text-sm font-medium transition-all group",
                    sidebarCollapsed
                      ? "justify-center p-2.5"
                      : "gap-3 px-3 py-2.5",
                    activeCategory === null
                      ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8]"
                      : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                  )}
                  style={{ fontFamily: "var(--font-sans)" }}
                  aria-label="Notes"
                >
                  <span className="relative flex-shrink-0">
                    <FileText className="w-6 h-6" />
                    {sidebarCollapsed && counts.All > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-[4px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[#2d5a44] dark:bg-[#6b8f72] text-white ring-2 ring-[#f4f7f2] dark:ring-[#202124] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {counts.All > 99 ? "99+" : counts.All}
                      </span>
                    )}
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      Notes
                      <span className="ml-auto text-[10px] font-bold zk-text-muted dark:zk-text-muted">
                        {counts.All}
                      </span>
                    </>
                  )}
                </button>
              </DroppableSidebarItem>
              <DroppableSidebarItem
                id="sidebar-Starred"
                isOver={dragOverSidebarKey === "Starred"}
              >
                <button
                  onClick={() => setActiveCategory("Starred")}
                  className={cn(
                    "w-full flex items-center rounded-xl text-sm font-medium transition-all group",
                    sidebarCollapsed
                      ? "justify-center p-2.5"
                      : "gap-3 px-3 py-2.5",
                    activeCategory === "Starred"
                      ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8]"
                      : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                  )}
                  style={{ fontFamily: "var(--font-sans)" }}
                  aria-label="Starred"
                >
                  <span className="relative flex-shrink-0">
                    <Star
                      className={cn(
                        "w-6 h-6 transition-colors",
                        activeCategory === "Starred"
                          ? // When selected, the star sits on the sage-tinted
                            // background — so we use a muted golden-amber that
                            // blends rather than fighting it. Lower saturation
                            // and a thinner stroke read as "in harmony" with
                            // the background instead of stamped on top of it.
                            "fill-amber-300/80 text-amber-500/90 dark:fill-amber-200/70 dark:text-amber-200/90"
                          : "fill-amber-400/80 text-amber-500/80 dark:fill-amber-300 dark:text-amber-300",
                      )}
                      strokeWidth={1.5}
                    />
                    {sidebarCollapsed && counts.Starred > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-[4px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[#2d5a44] dark:bg-[#6b8f72] text-white ring-2 ring-[#f4f7f2] dark:ring-[#202124] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {counts.Starred > 99 ? "99+" : counts.Starred}
                      </span>
                    )}
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      Starred
                      {counts.Starred > 0 && (
                        <span className="ml-auto text-[10px] font-bold zk-text-muted dark:zk-text-muted">
                          {counts.Starred}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </DroppableSidebarItem>
              <button
                onClick={() => setActiveCategory("Locked")}
                className={cn(
                  "w-full flex items-center rounded-xl text-sm font-medium transition-all group",
                  sidebarCollapsed
                    ? "justify-center p-2.5"
                    : "gap-3 px-3 py-2.5",
                  activeCategory === "Locked"
                    ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8]"
                    : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                )}
                style={{ fontFamily: "var(--font-sans)" }}
                aria-label="Locked notes"
              >
                <span className="relative flex-shrink-0">
                  <Lock className="w-6 h-6" />
                  {sidebarCollapsed && counts.Locked > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-[4px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[#2d5a44] dark:bg-[#6b8f72] text-white ring-2 ring-[#f4f7f2] dark:ring-[#202124] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      {counts.Locked > 99 ? "99+" : counts.Locked}
                    </span>
                  )}
                </span>
                {!sidebarCollapsed && (
                  <>
                    Locked
                    {counts.Locked > 0 && (
                      <span className="ml-auto text-[10px] font-bold zk-text-muted dark:zk-text-muted">
                        {counts.Locked}
                      </span>
                    )}
                  </>
                )}
              </button>
              <button
                onClick={() => setActiveCategory("Shared")}
                className={cn(
                  "w-full flex items-center rounded-xl text-sm font-medium transition-all group",
                  sidebarCollapsed
                    ? "justify-center p-2.5"
                    : "gap-3 px-3 py-2.5",
                  activeCategory === "Shared"
                    ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8]"
                    : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                )}
                style={{ fontFamily: "var(--font-sans)" }}
                aria-label="Shared notes"
              >
                <span className="relative flex-shrink-0">
                  <Globe className="w-6 h-6" />
                  {sidebarCollapsed && counts.Shared > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-[4px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[#2d5a44] dark:bg-[#6b8f72] text-white ring-2 ring-[#f4f7f2] dark:ring-[#202124] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      {counts.Shared > 99 ? "99+" : counts.Shared}
                    </span>
                  )}
                </span>
                {!sidebarCollapsed && (
                  <>
                    Shared
                    {counts.Shared > 0 && (
                      <span className="ml-auto text-[10px] font-bold zk-text-muted dark:zk-text-muted">
                        {counts.Shared}
                      </span>
                    )}
                  </>
                )}
              </button>
              <DroppableSidebarItem
                id="sidebar-Archive"
                isOver={dragOverSidebarKey === "Archive"}
              >
                <button
                  onClick={() => setActiveCategory("Archive")}
                  className={cn(
                    "w-full flex items-center rounded-xl text-sm font-medium transition-all group",
                    sidebarCollapsed
                      ? "justify-center p-2.5"
                      : "gap-3 px-3 py-2.5",
                    activeCategory === "Archive"
                      ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8]"
                      : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                  )}
                  style={{ fontFamily: "var(--font-sans)" }}
                  aria-label="Archive"
                >
                  <span className="relative flex-shrink-0">
                    <Archive className="w-6 h-6" />
                    {sidebarCollapsed && counts.Archive > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-[4px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[#2d5a44] dark:bg-[#6b8f72] text-white ring-2 ring-[#f4f7f2] dark:ring-[#202124] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {counts.Archive > 99 ? "99+" : counts.Archive}
                      </span>
                    )}
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      Archive
                      {counts.Archive > 0 && (
                        <span className="ml-auto text-[10px] font-bold zk-text-muted dark:zk-text-muted">
                          {counts.Archive}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </DroppableSidebarItem>
              <DroppableSidebarItem
                id="sidebar-Trash"
                isOver={dragOverSidebarKey === "Trash"}
              >
                <button
                  onClick={() => setActiveCategory("Trash")}
                  className={cn(
                    "w-full flex items-center rounded-xl text-sm font-medium transition-all group",
                    sidebarCollapsed
                      ? "justify-center p-2.5"
                      : "gap-3 px-3 py-2.5",
                    activeCategory === "Trash"
                      ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8]"
                      : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                  )}
                  style={{ fontFamily: "var(--font-sans)" }}
                  aria-label="Trash"
                >
                  <span className="relative flex-shrink-0">
                    <Trash2 className="w-6 h-6" />
                    {sidebarCollapsed && counts.Trash > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-[4px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[#2d5a44] dark:bg-[#6b8f72] text-white ring-2 ring-[#f4f7f2] dark:ring-[#202124] opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {counts.Trash > 99 ? "99+" : counts.Trash}
                      </span>
                    )}
                  </span>
                  {!sidebarCollapsed && (
                    <>
                      Trash
                      {counts.Trash > 0 && (
                        <span className="ml-auto text-[10px] font-bold zk-text-muted dark:zk-text-muted">
                          {counts.Trash}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </DroppableSidebarItem>

              {/* Dynamic categories */}
              {!sidebarCollapsed && categories.length > 0 && (
                <div className="pt-4 mt-2">
                  <p
                    className="text-[10px] font-bold zk-text-faint uppercase tracking-[0.18em] px-3 mb-3"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    Categories
                  </p>
                  {categories.map((cat) => {
                    const catKey = cat as string;
                    const isActive = activeCategory === catKey;
                    const count = counts[catKey] || 0;
                    return (
                      <button
                        key={catKey}
                        onClick={() => setActiveCategory(catKey)}
                        className={cn(
                          // Mockup-style row: simple, clean, dot +
                          // label + count. Active = sage-tinted fill,
                          // hover = lighter sage fill. Updated per user
                          // color spec (#e8f3ee active, #dcfce8 hover,
                          // #2d5a44 text).
                          "w-full flex items-center justify-between px-3 py-1.5 text-sm rounded-md transition-colors",
                          isActive
                            ? "bg-[#e8f3ee] dark:bg-[#2d5a44]/30 text-[#2d5a44] dark:text-[#d4e8d8] font-semibold"
                            : "text-[#2d5a44] dark:text-[#a8c9ac] hover:bg-[#dcfce8] dark:hover:bg-[#2d5a44]/35",
                        )}
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full flex-shrink-0",
                              getCategoryDotClass(catKey),
                            )}
                            aria-hidden="true"
                          />
                          <span>{catKey}</span>
                        </div>
                        {count > 0 && (
                          <span className="text-[11px] text-[#9aa39d] dark:text-[#6b746f] font-medium tabular-nums">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </nav>

            {/* User — clickable avatar at bottom */}
            <div
              className={cn(
                "relative pt-3 mt-2",
                sidebarCollapsed ? "flex flex-col items-center" : "",
                showProfilePopover && "z-[60]",
              )}
            >
              {/* Settings cog — only when the sidebar is collapsed.
                  Sits directly above the avatar so the rail's
                  trailing column reads as: [cog] → [avatar]. When
                  the sidebar is expanded, settings is reachable
                  via the popover (Settings button) — duplicating
                  it in the rail would clutter the chrome. */}
              {sidebarCollapsed && (
                <button
                  onClick={() => {
                    setRailTipLabel(null);
                    setIsSettingsOpen(true);
                  }}
                  onMouseEnter={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setRailTipY(r.top + r.height / 2);
                    setRailTipLabel("Settings");
                  }}
                  onMouseLeave={() => setRailTipLabel(null)}
                  className="w-10 h-10 mb-2 flex items-center justify-center rounded-xl zk-text-secondary dark:zk-text-muted hover:bg-[#d2e8d5]/50 dark:hover:bg-[#2d5a44]/35 hover:text-[#1f4534] dark:hover:text-[#c5e0cc] transition-all active:scale-[0.85] active:shadow-[0_0_0_3px_rgba(45,90,68,0.25)] hover:scale-105"
                  aria-label="Open settings"
                >
                  <Settings className="w-[18px] h-[18px]" strokeWidth={1.85} />
                </button>
              )}
              <button
                onClick={() => {
                  setRailTipLabel(null);
                  setShowProfilePopover(!showProfilePopover);
                }}
                data-profile-popover
                onMouseEnter={(e) => {
                  if (sidebarCollapsed) {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setRailTipY(r.top + r.height / 2);
                    setRailTipLabel("Profile");
                  }
                }}
                onMouseLeave={() => setRailTipLabel(null)}
                className={cn(
                  "relative flex items-center gap-3 rounded-xl transition-all hover:bg-[#d2e8d5]/40 dark:hover:bg-[#2d5a44]/35 hover:scale-[1.05] active:scale-[0.92] active:shadow-[0_0_0_3px_rgba(45,90,68,0.22)]",
                  sidebarCollapsed
                    ? "p-1.5 flex-col gap-2.5"
                    : "w-full px-2 py-2",
                )}
                aria-label={sidebarCollapsed ? "Open profile menu" : undefined}
              >
                {renderAvatar(sidebarCollapsed ? "sm" : "md")}
                {sidebarCollapsed && (
                  <span
                    className="text-[8px] font-bold zk-text-muted dark:zk-text-muted uppercase tracking-wider mt-0.5"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    zakar
                  </span>
                )}
                {!sidebarCollapsed && (
                  <div className="min-w-0 text-left flex-1">
                    <p
                      className="text-sm font-semibold zk-text dark:zk-text truncate leading-tight"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {user?.displayName?.split(" ")[0] || "User"}
                    </p>
                    <p
                      className="text-[10px] zk-text-muted dark:zk-text-muted truncate leading-tight mt-0.5"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {user?.email}
                    </p>
                  </div>
                )}
              </button>

              {/* Profile popover — opens upward */}
              <AnimatePresence>
                {showProfilePopover && (
                  <motion.div
                    data-profile-popover
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    className={cn(
                      "absolute bottom-full mb-2 bg-white dark:bg-[#282929] rounded-2xl shadow-2xl border border-[#dde5da] dark:border-white/[0.10] z-[62] overflow-hidden",
                      sidebarCollapsed
                        ? "left-0 w-64"
                        : "left-0 right-0 w-auto min-w-[220px]",
                    )}
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {/* Avatar + name */}
                    <div className="flex flex-col items-center py-5 px-5">
                      <div className="mb-2">{renderAvatar("lg")}</div>
                      <h3
                        className="text-base font-bold zk-text dark:zk-text"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        Hi, {user?.displayName?.split(" ")[0] || "there"}!
                      </h3>
                      <p className="text-[11px] zk-text-muted dark:zk-text-muted truncate max-w-full mt-0.5">
                        {user?.email}
                      </p>
                    </div>

                    {/* Avatar picker for users without photo */}
                    {!user?.photoURL && (
                      <div className="px-5 pb-5">
                        <p className="text-[9px] font-bold zk-text-faint uppercase tracking-[0.15em] mb-3 text-center">
                          Choose your buddy
                        </p>
                        <div className="flex gap-3 justify-center">
                          {AVATAR_OPTIONS.map((av) => (
                            <button
                              key={av.id}
                              onClick={() => {
                                setSelectedAvatar(av.id);
                                localStorage.setItem("zakar_avatar", av.id);
                              }}
                              className={cn(
                                "rounded-full transition-all hover:scale-110",
                                selectedAvatar === av.id
                                  ? "ring-2 ring-[#2d5a44] ring-offset-2 dark:ring-offset-[#1a1f1c]"
                                  : "",
                              )}
                            >
                              <div className="w-12 h-12 rounded-full overflow-hidden">
                                <svg
                                  viewBox="0 0 100 100"
                                  className="w-full h-full"
                                >
                                  {av.svg}
                                </svg>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Email-to-note hint */}
                    <div
                      className="px-4 py-3"
                      style={{
                        borderTop: "1px solid rgba(171,180,175,0.12)",
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Mail className="w-3 h-3 text-[#2d5a44] dark:text-[#8fb89a]" />
                        <p
                          className="text-[9px] font-bold uppercase tracking-[0.18em] zk-text-secondary dark:zk-text-muted"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          Forward emails as notes
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              "capturezakarnotes@ildiprenuc.resend.app",
                            );
                            setInboxEmailCopied(true);
                            setTimeout(() => setInboxEmailCopied(false), 2000);
                          } catch {
                            /* clipboard may not be available */
                          }
                        }}
                        className="group w-full flex items-start gap-2 text-left text-[11px] font-mono zk-text dark:zk-text bg-[#eaf0e8] dark:bg-[#3c3d40] px-2.5 py-1.5 rounded-md hover:bg-[#dde5da] dark:hover:bg-[#5f6368] transition-colors active:scale-[0.99]"
                        title="Click to copy"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {/* Long emails can be 30+ chars; wrap with break-all
                            so they fit nicely in the popover instead of
                            clipping with an ellipsis (which hides the part
                            users actually need to verify). */}
                        <span className="flex-1 break-all leading-snug">
                          capturezakarnotes@ildiprenuc.resend.app
                        </span>
                        {inboxEmailCopied ? (
                          <span className="flex items-center gap-1 text-[#2d5a44] dark:text-[#8fb89a] flex-shrink-0 mt-0.5">
                            <Check className="w-3 h-3" strokeWidth={2.5} />
                            <span className="text-[9px] font-sans font-semibold uppercase tracking-wider">
                              Copied
                            </span>
                          </span>
                        ) : (
                          <Copy
                            className="w-3 h-3 zk-text-faint dark:zk-text-muted group-hover:zk-text-primary-brand dark:group-hover:text-[#8fb89a] transition-colors flex-shrink-0 mt-0.5"
                            strokeWidth={2}
                          />
                        )}
                      </button>
                      <p
                        className="text-[10px] zk-text-faint dark:zk-text-muted mt-1.5 leading-snug break-words"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        Forward from{" "}
                        <strong className="break-all">{user?.email}</strong>{" "}
                        only.
                      </p>
                    </div>

                    {/* Settings + Sign out */}
                    <div
                      className="flex"
                      style={{
                        borderTop: "1px solid rgba(171,180,175,0.12)",
                      }}
                    >
                      <button
                        onClick={() => {
                          setShowProfilePopover(false);
                          setIsSettingsOpen(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium zk-text-secondary dark:zk-text-muted hover:zk-surface-muted dark:hover:bg-[#242b27] transition-all"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Settings
                      </button>
                      <div className="w-px zk-surface-sunken dark:zk-surface-sunken" />
                      <button
                        onClick={() => {
                          setShowProfilePopover(false);
                          // Forget the device-bound WebAuthn credential
                          // before sign-out so the next user on this
                          // browser doesn't see a stale credential id.
                          // The credential itself stays on the device's
                          // authenticator — only our pointer to it is
                          // cleared.
                          forgetCredential(user);
                          logOut();
                        }}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium zk-text-secondary dark:zk-text-muted hover:zk-surface-muted dark:hover:bg-[#242b27] transition-all"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Tagline */}
            {!sidebarCollapsed && (
              <div
                className="flex items-center gap-1.5 pt-2.5 pb-0.5 px-2 text-[10px] zk-text-faint dark:text-[#6a7570]"
                style={{
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "0.01em",
                }}
              >
                <ShieldCheck
                  className="w-3 h-3 flex-shrink-0"
                  strokeWidth={2}
                />
                <span>Everything in its right place</span>
              </div>
            )}
          </aside>

          {/* --- Main Content Area --- */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top bar (mobile header + desktop toolbar) */}
            <header
              className="sticky top-0 z-30 bg-[#f4f7f2]/80 dark:bg-[#202124]/80 backdrop-blur-md px-6 py-4"
              style={{ borderBottom: "1px solid rgba(171,180,175,0.12)" }}
            >
              <div className="flex items-center justify-between">
                {/* Mobile: hamburger + logo */}
                <div className="flex items-center gap-2 lg:hidden flex-shrink-0 mr-3">
                  <button
                    onClick={() => setMobileDrawerOpen(true)}
                    className="p-2 -ml-2 zk-text dark:zk-text hover:zk-surface-muted dark:hover:bg-[#242b27] rounded-lg transition-colors"
                    aria-label="Open menu"
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <line x1="4" y1="7" x2="20" y2="7" />
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <line x1="4" y1="17" x2="14" y2="17" />
                    </svg>
                  </button>
                  <h1
                    className="text-xl tracking-tight zk-text dark:zk-text"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    zakar
                  </h1>
                </div>

                {/* Search (desktop). Reserve the same flexible space
                    while notes are loading so the toolbar doesn't shift
                    when the search bar appears. Hidden entirely when a
                    note is open — searching the corpus isn't useful
                    while you're reading a single note. We render an
                    INVISIBLE spacer in its place so the right-side
                    buttons (Ask / Magic Sort / dark toggle) stay
                    anchored to the right edge of the toolbar. */}
                {!selectedNote ? (notesLoaded ? (
                  notes.length > 5 ? (
                    <div className="hidden sm:block relative flex-1 max-w-md">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 zk-text-faint" />
                      <input
                        type="text"
                        placeholder="Search your notes..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() =>
                          setTimeout(() => setSearchFocused(false), 200)
                        }
                        className="w-full pl-11 pr-4 py-2.5 zk-surface-muted dark:bg-[#282929] rounded-xl border border-transparent dark:border-white/[0.06] outline-none text-sm zk-text dark:zk-text placeholder:zk-text-faint focus:bg-white dark:focus:bg-[#1f1f1f] focus:dark:border-white/[0.12] focus:shadow-md transition-all"
                        style={{ fontFamily: "var(--font-sans)" }}
                      />
                      {/* Category quick-filter panel */}
                      <AnimatePresence>
                        {searchFocused && !searchQuery && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="absolute top-full left-0 right-0 mt-2 zk-surface-raised rounded-xl shadow-xl border zk-border-color dark:zk-border-color p-3 z-50"
                          >
                            <p
                              className="text-[9px] font-bold zk-text-faint uppercase tracking-[0.15em] mb-2 px-1"
                              style={{ fontFamily: "var(--font-sans)" }}
                            >
                              Quick filter
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                {
                                  key: null,
                                  label: "All",
                                  icon: Brain,
                                  count: counts.All,
                                },
                                {
                                  key: "Starred",
                                  label: "Starred",
                                  icon: Star,
                                  count: counts.Starred,
                                },
                                {
                                  key: "Locked",
                                  label: "Locked",
                                  icon: Lock,
                                  count: counts.Locked,
                                },
                                {
                                  key: "Shared",
                                  label: "Shared",
                                  icon: Globe,
                                  count: counts.Shared,
                                },
                                ...categories.map((cat) => ({
                                  key: cat as string,
                                  label: cat as string,
                                  icon: () => (
                                    <CategoryIcon
                                      category={cat as string}
                                      className="w-3 h-3"
                                    />
                                  ),
                                  count: counts[cat as string] || 0,
                                })),
                              ].map((item) => {
                                const Icon = item.icon;
                                const isCustom =
                                  typeof Icon === "function" &&
                                  !Icon.displayName;
                                return (
                                  <button
                                    key={item.key || "all"}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setActiveCategory(
                                        item.key as string | null,
                                      );
                                      setSearchFocused(false);
                                    }}
                                    className={cn(
                                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                      activeCategory === item.key
                                        ? "zk-bg-primary text-white"
                                        : "zk-surface-muted dark:zk-surface-muted zk-text-secondary dark:zk-text-muted hover:zk-surface-sunken dark:hover:bg-[#2e3632]",
                                    )}
                                    style={{
                                      fontFamily: "var(--font-sans)",
                                    }}
                                  >
                                    {isCustom ? (
                                      <Icon />
                                    ) : (
                                      <Icon className="w-3 h-3" />
                                    )}
                                    {item.label}
                                    {item.count > 0 && (
                                      <span className="text-[10px] opacity-60">
                                        {item.count}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Filter chips — visible whenever the query has any
                          operator (tag:/has:/is:/after:/before:/etc). Chips
                          let users remove a single filter without losing the
                          rest of the query. */}
                      {(() => {
                        const chips = extractFilterChips(searchQuery);
                        if (chips.length === 0) return null;
                        return (
                          <div className="absolute top-full left-0 right-0 mt-2 flex flex-wrap gap-1.5 px-1">
                            {chips.map((chip, i) => (
                              <button
                                key={`${chip.rawToken}-${i}`}
                                onClick={() =>
                                  setSearchQuery(
                                    removeChipFromQuery(
                                      searchQuery,
                                      chip.rawToken,
                                    ),
                                  )
                                }
                                className="group inline-flex items-center gap-1 px-2.5 py-1 bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/15 hover:bg-[#d2e8d5]/60 dark:hover:bg-[#2d5a44]/25 zk-text-primary-brand rounded-md text-[11px] font-bold transition-all"
                                style={{ fontFamily: "var(--font-sans)" }}
                                aria-label={`Remove filter ${chip.label}`}
                              >
                                <span>{chip.label}</span>
                                <X className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    /* User has ≤5 notes — show a flexible spacer so toolbar layout matches. */
                    <div className="hidden sm:block flex-1 max-w-md" />
                  )
                ) : (
                  /* Notes still loading — reserve the same flex space so
                     toolbar doesn't shift when data arrives. */
                  <div className="hidden sm:block flex-1 max-w-md" />
                )) : (
                  /* Note is open — invisible spacer keeps Ask / Magic
                     Sort / dark toggle anchored to the right edge of
                     the toolbar. Without this, the flex layout
                     collapses left and the buttons cluster
                     mid-toolbar. */
                  <div className="hidden sm:block flex-1 max-w-md" />
                )}

                {/* Right actions */}
                <div className="flex items-center gap-2">
                  {/* New Note — quick capture shortcut shown ONLY
                      when a note is already open. Without this,
                      the user has to close the current note (or
                      use the FAB) to start a new capture. Mirrors
                      the "New chat" affordance from screenshot 7. */}
                  {selectedNote && (
                    <button
                      onClick={() => {
                        setShowCaptureModal(true);
                      }}
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#2d5a44] bg-[#e8f3ee] hover:bg-[#dcfce8] dark:bg-[#2d5a44]/40 dark:hover:bg-[#2d5a44]/30 dark:text-[#a8d0b0] transition-all hover:scale-[1.04] active:scale-95 active:shadow-[0_0_0_3px_rgba(45,90,68,0.18)]"
                      title="New note"
                      aria-label="Create a new note"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      <SquarePen className="w-3.5 h-3.5" />
                      <span>New note</span>
                    </button>
                  )}
                  {/* Ask my notes — Tier 1 RAG. Only shown when there's a
                      meaningful library to ask against (≥5 notes), since
                      below that the user is better served by just opening
                      the note. Discreet sparkle button next to search.
                      Keyboard shortcut: Cmd/Ctrl+K. */}
                  {notesLoaded && notes.length >= 5 && (
                    <button
                      onClick={() => {
                        setAskOpen(true);
                        setAskAnswer(null);

                        setAskMeta(null);
                        setAskQuestion("");
                      }}
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#2d5a44] bg-[#e8f3ee] hover:bg-[#dcfce8] dark:bg-[#2d5a44]/40 dark:hover:bg-[#2d5a44]/30 dark:text-[#a8d0b0] transition-all hover:scale-[1.04] active:scale-95 active:shadow-[0_0_0_3px_rgba(45,90,68,0.18)]"
                      title="Ask your notes a question (⌘K)"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Ask</span>
                    </button>
                  )}
                  {/* Mobile category filter */}
                  <div className="flex lg:hidden items-center gap-2 overflow-x-auto no-scrollbar mr-2">
                    <button
                      onClick={() => setActiveCategory(null)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                        activeCategory === null
                          ? "zk-bg-primary text-white"
                          : "zk-surface-muted dark:zk-surface-muted zk-text-secondary",
                      )}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setActiveCategory("Starred")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                        activeCategory === "Starred"
                          ? "bg-amber-500 text-white"
                          : "zk-surface-muted dark:zk-surface-muted zk-text-secondary",
                      )}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      Starred
                    </button>
                    <button
                      onClick={() => setActiveCategory("Trash")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all",
                        activeCategory === "Trash"
                          ? "bg-rose-500 text-white"
                          : "zk-surface-muted dark:zk-surface-muted zk-text-secondary",
                      )}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      Trash{counts.Trash > 0 ? ` (${counts.Trash})` : ""}
                    </button>
                  </div>

                  {/* View toggle and sort dropdown — hidden when a
                      note is open since both operate on the notes
                      list. Per user request, the right toolbar
                      becomes more focused while a note is in view. */}
                  {!selectedNote && (
                    <>
                      {/* View toggle — hidden on mobile (grid only on small screens) */}
                      <button
                        onClick={() =>
                          setViewMode(viewMode === "grid" ? "list" : "grid")
                        }
                        className="hidden md:block p-2.5 zk-text-secondary dark:zk-text-muted hover:zk-text dark:hover:text-white zk-surface-muted dark:zk-surface-muted hover:zk-surface-sunken dark:hover:bg-[#2e3632] rounded-xl transition-all"
                        title={
                          viewMode === "grid"
                            ? "Switch to list view"
                            : "Switch to grid view"
                        }
                      >
                        {viewMode === "grid" ? (
                          <List className="w-5 h-5" />
                        ) : (
                          <LayoutGrid className="w-5 h-5" />
                        )}
                      </button>

                      {/* Sort */}
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="zk-surface-muted dark:bg-[#282929] zk-text-secondary dark:zk-text-muted text-xs font-medium px-3 py-2 rounded-lg outline-none border border-transparent dark:border-white/[0.06] cursor-pointer hover:zk-surface-sunken dark:hover:bg-[#35363a] dark:hover:border-white/[0.1] transition-all hidden sm:block"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="alphabetical">A-Z</option>
                        <option value="custom">Custom (drag)</option>
                      </select>
                    </>
                  )}

                  {/* Magic Sort toggle — fixed min-width so the label
                      ("Manual" → "Magic Sort") doesn't reflow toolbar
                      when profile loads from Firestore. */}
                  <button
                    onClick={toggleAutoSort}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all sm:min-w-[110px]",
                      profile?.autoSortEnabled
                        ? "text-white"
                        : "zk-surface-muted dark:bg-[#282929] zk-text-secondary dark:zk-text-muted border border-transparent dark:border-white/[0.06]",
                    )}
                    style={
                      profile?.autoSortEnabled
                        ? {
                            backgroundColor: "#2d5a44",
                            fontFamily: "var(--font-sans)",
                          }
                        : { fontFamily: "var(--font-sans)" }
                    }
                    title={
                      profile?.autoSortEnabled
                        ? "Magic Sort is on"
                        : "Magic Sort is off"
                    }
                  >
                    <Sparkles
                      className={cn(
                        "w-3.5 h-3.5",
                        profile?.autoSortEnabled && "animate-pulse",
                      )}
                    />
                    <span className="hidden sm:inline">
                      {profile?.autoSortEnabled ? "Magic Sort" : "Manual"}
                    </span>
                  </button>

                  {/* Theme */}
                  <button
                    onClick={toggleTheme}
                    className="p-2 zk-text-secondary dark:zk-text-secondary hover:zk-text dark:hover:text-white hover:zk-surface-muted dark:hover:zk-surface-muted rounded-lg transition-all overflow-hidden relative"
                    title={theme === "light" ? "Dark mode" : "Light mode"}
                    aria-label={
                      theme === "light"
                        ? "Switch to dark mode"
                        : "Switch to light mode"
                    }
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      {theme === "light" ? (
                        <motion.span
                          key="moon"
                          initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                          animate={{ rotate: 0, opacity: 1, scale: 1 }}
                          exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
                          transition={{
                            duration: 0.32,
                            ease: [0.2, 0, 0, 1],
                          }}
                          className="block"
                        >
                          <Moon className="w-4 h-4" />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="sun"
                          initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
                          animate={{ rotate: 0, opacity: 1, scale: 1 }}
                          exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
                          transition={{
                            duration: 0.32,
                            ease: [0.2, 0, 0, 1],
                          }}
                          className="block"
                        >
                          <Sun className="w-4 h-4" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                </div>
              </div>
              {/* Mobile sticky search */}
              {notes.length > 5 && (
                <div className="sm:hidden relative mt-3">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 zk-text-faint" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 zk-surface-muted dark:bg-[#282929] rounded-xl border border-transparent dark:border-white/[0.06] outline-none text-sm zk-text dark:zk-text placeholder:zk-text-faint focus:bg-white dark:focus:bg-[#1f1f1f] focus:dark:border-white/[0.12] transition-all"
                    style={{ fontFamily: "var(--font-sans)" }}
                  />
                </div>
              )}
            </header>

            {/* Batch action bar — positioned between header and main */}
            <AnimatePresence>
              {selectedNoteIds.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="zk-bg-primary dark:bg-[#2d5a44] text-white shadow-md relative z-50 border-b border-[#1f4534] dark:border-[#2a3530]"
                >
                  <div className="px-6 lg:px-10 py-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={clearSelection}
                          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                          title="Clear selection"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <span
                          className="text-sm font-semibold"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {selectedNoteIds.size} selected
                        </span>
                      </div>
                      <div
                        className="flex items-center gap-1 flex-wrap"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {(() => {
                          // Smart toggle: if every selected note is already
                          // pinned/starred, show "Unpin"/"Unstar" instead.
                          const selectedNotes = notes.filter((n) =>
                            selectedNoteIds.has(n.id),
                          );
                          const allPinned =
                            selectedNotes.length > 0 &&
                            selectedNotes.every((n) => n.isPinned);
                          const allStarred =
                            selectedNotes.length > 0 &&
                            selectedNotes.every((n) => n.isStarred);
                          return (
                            <>
                              <button
                                onClick={() =>
                                  batchAction(allPinned ? "unpin" : "pin")
                                }
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-white/15 transition-colors"
                              >
                                <Pin
                                  className={cn(
                                    "w-3.5 h-3.5",
                                    allPinned && "fill-current",
                                  )}
                                />{" "}
                                {allPinned ? "Unpin" : "Pin"}
                              </button>
                              <button
                                onClick={() =>
                                  batchAction(allStarred ? "unstar" : "star")
                                }
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-white/15 transition-colors"
                              >
                                <Star
                                  className={cn(
                                    "w-3.5 h-3.5",
                                    allStarred &&
                                      "fill-amber-400 text-amber-400",
                                  )}
                                />{" "}
                                {allStarred ? "Unstar" : "Star"}
                              </button>
                            </>
                          );
                        })()}
                        <button
                          onClick={() => batchAction("archive")}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-white/15 transition-colors"
                        >
                          <Archive className="w-3.5 h-3.5" /> Archive
                        </button>
                        <button
                          onClick={() => batchAction("trash")}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-rose-500/30 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Trash
                        </button>
                        <div className="relative" data-bulk-dropdown>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBulkDropdownOpen(
                                bulkDropdownOpen === "category"
                                  ? null
                                  : "category",
                              );
                            }}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                              bulkDropdownOpen === "category"
                                ? "bg-white/20"
                                : "hover:bg-white/15",
                            )}
                            aria-expanded={bulkDropdownOpen === "category"}
                          >
                            <Sparkles className="w-3.5 h-3.5" /> Category
                          </button>
                          {bulkDropdownOpen === "category" && (
                            <div className="absolute right-0 top-full pt-2 z-[60]">
                              <div className="zk-surface-raised rounded-xl shadow-xl border zk-border-color dark:zk-border-color p-1 min-w-[140px]">
                                {[
                                  "Task",
                                  "Idea",
                                  "Credential",
                                  "Web Content",
                                  "Personal",
                                  "Other",
                                ].map((cat) => (
                                  <button
                                    key={cat}
                                    onClick={() => {
                                      batchSetCategory(cat);
                                      setBulkDropdownOpen(null);
                                    }}
                                    className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium zk-text dark:zk-text hover:bg-[#d2e8d5] dark:hover:bg-[#3d5142] hover:zk-text-primary-brand dark:hover:text-[#d4e8d8] transition-colors"
                                  >
                                    {cat}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="relative" data-bulk-dropdown>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setBulkDropdownOpen(
                                bulkDropdownOpen === "color" ? null : "color",
                              );
                            }}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors",
                              bulkDropdownOpen === "color"
                                ? "bg-white/20"
                                : "hover:bg-white/15",
                            )}
                            title="Set color for selected notes"
                            aria-expanded={bulkDropdownOpen === "color"}
                          >
                            <Palette className="w-3.5 h-3.5" /> Color
                          </button>
                          {bulkDropdownOpen === "color" && (
                            <div className="absolute right-0 top-full pt-2 z-[60]">
                              <div className="zk-surface-raised rounded-2xl shadow-xl border zk-border-color dark:zk-border-color p-3 w-[240px]">
                                <p className="text-[9px] font-bold uppercase tracking-[0.18em] zk-text-faint dark:zk-text-muted mb-2 px-1">
                                  Apply to {selectedNoteIds.size}
                                </p>
                                <div className="grid grid-cols-5 gap-2">
                                  {NOTE_COLOR_TOKENS.map((tok) => {
                                    const isDefault = tok.key === "default";
                                    return (
                                      <button
                                        key={tok.key}
                                        onClick={() => {
                                          batchSetColor(tok.key);
                                          setBulkDropdownOpen(null);
                                        }}
                                        className="relative aspect-square rounded-full transition-all active:scale-90 hover:scale-110 hover:ring-2 hover:ring-offset-2 hover:ring-[#2d5a44] hover:ring-offset-white dark:hover:ring-offset-[#2d2e31] dark:hover:ring-[#a8c9ac]"
                                        style={
                                          isDefault
                                            ? {
                                                border: "1.5px solid #cfd4cf",
                                                background:
                                                  "linear-gradient(135deg, #fff 50%, #f4f7f2 50%)",
                                              }
                                            : { backgroundColor: tok.swatch }
                                        }
                                        title={tok.label}
                                        aria-label={tok.label}
                                      >
                                        {isDefault && (
                                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold zk-text-faint">
                                            ∅
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scrollable content */}
            <main
              role="main"
              aria-label="Notes content"
              className="flex-1 overflow-y-auto px-6 lg:px-10 py-8"
            >
              {/* Greeting — disappears after 30 seconds, only on main views. Centered above capture bar. */}
              <AnimatePresence>
                {showGreetingWave && !activeCategory && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4, transition: { duration: 0.5 } }}
                    className="mb-5 hidden sm:flex items-center justify-center gap-3"
                  >
                    <motion.span
                      initial={{ opacity: 0, rotate: -20, scale: 0.5 }}
                      animate={{
                        opacity: 1,
                        rotate: [0, 14, -8, 14, -4, 10, 0],
                        scale: 1,
                        transition: {
                          rotate: { duration: 1.5, ease: "easeInOut" },
                          opacity: { duration: 0.3 },
                          scale: { duration: 0.4 },
                        },
                      }}
                      className="text-2xl inline-block origin-bottom-right"
                    >
                      👋
                    </motion.span>
                    <p
                      className="text-base font-semibold zk-text dark:zk-text"
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      {(() => {
                        const hour = new Date().getHours();
                        const name = user?.displayName?.split(" ")[0] || "";
                        if (hour < 12)
                          return `Good morning${name ? ", " + name : ""}`;
                        if (hour < 17)
                          return `Good afternoon${name ? ", " + name : ""}`;
                        return `Good evening${name ? ", " + name : ""}`;
                      })()}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* --- Flashback (spaced resurfacing of older notes) --- */}
              {activeCategory === null && notesLoaded && (
                <Flashback
                  notes={notes}
                  onOpenNote={(n) => setSelectedNote(n)}
                  onMarkRelevant={async (noteId) => {
                    try {
                      await updateDoc(doc(db, "notes", noteId), {
                        updatedAt: Timestamp.now(),
                      });
                    } catch (err) {
                      handleFirestoreError(
                        err,
                        OperationType.UPDATE,
                        `notes/${noteId}`,
                      );
                    }
                  }}
                  onArchive={async (noteId) => {
                    try {
                      await updateDoc(doc(db, "notes", noteId), {
                        isArchived: true,
                        updatedAt: Timestamp.now(),
                      });
                    } catch (err) {
                      handleFirestoreError(
                        err,
                        OperationType.UPDATE,
                        `notes/${noteId}`,
                      );
                    }
                  }}
                />
              )}

              {/* --- Where you left off (return-after-gap continuity) --- */}
              {activeCategory === null && notesLoaded && (
                <WhereLeftOff
                  notes={notes}
                  onOpenNote={(n) => setSelectedNote(n)}
                />
              )}

              {/* --- Today's Focus (ADHD "what should I do now?") --- */}
              {activeCategory === null && (
                <TodaysFocus
                  notes={notes}
                  onOpenNote={(n) => setSelectedNote(n)}
                  onCompleteTask={async (noteId, taskLine) => {
                    const note = notes.find((n) => n.id === noteId);
                    if (!note) return;

                    // Build a tolerant replacement: swap [anywhitespace] OR []
                    // with [x], preserving everything else on the line.
                    const checkedLine = taskLine.replace(/\[[\s]*\]/, "[x]");
                    if (checkedLine === taskLine) return;

                    // Update BOTH content and rawContent so the checkbox state
                    // persists whether the card shows cleaned or raw content.
                    const updates: Record<string, unknown> = {};
                    if (note.content && note.content.includes(taskLine)) {
                      updates.content = note.content.replace(
                        taskLine,
                        checkedLine,
                      );
                    }
                    if (note.rawContent && note.rawContent.includes(taskLine)) {
                      updates.rawContent = note.rawContent.replace(
                        taskLine,
                        checkedLine,
                      );
                    }
                    if (Object.keys(updates).length === 0) return;
                    updates.updatedAt = Timestamp.now();

                    try {
                      await updateDoc(doc(db, "notes", noteId), updates);
                    } catch (err) {
                      handleFirestoreError(
                        err,
                        OperationType.UPDATE,
                        `notes/${noteId}`,
                      );
                    }
                  }}
                />
              )}

              {/* --- Capture bar (desktop) — Keep-inspired, Zakar-unique --- */}
              {activeCategory !== "Trash" && activeCategory !== "Archive" && (
                <section
                  id="zakar-capture-bar"
                  className="mb-8 hidden sm:flex justify-center"
                >
                  {/* Relative wrapper at the same width as the bar so
                      the absolute-positioned draft hint anchors to
                      the bar's right edge, not the section's full
                      width. Keeps the hint visually attached to the
                      bar even when the viewport is wide. */}
                  <div className="relative w-full max-w-2xl">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setShowCaptureModal(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setShowCaptureModal(true);
                      }
                    }}
                    className="w-full flex items-center gap-2 px-5 py-3.5 bg-white dark:bg-transparent rounded-2xl transition-all group hover:shadow-lg dark:hover:bg-white/[0.02] border border-[#dde5da] dark:border-white/[0.10] hover:dark:border-white/[0.15] active:scale-[0.99] cursor-pointer"
                    style={{
                      boxShadow: "0 2px 20px rgba(46,52,45,0.06)",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    <div className="flex items-center gap-2.5 flex-1 text-sm text-left pointer-events-none">
                      <Plus className="w-5 h-5 zk-text-faint group-hover:zk-text-primary-brand transition-colors flex-shrink-0" />
                      <span className="flex-1 text-[#8a9690] dark:zk-text-muted text-[15px]">
                        {captureHeader.replace(/\s*[^\s\w]+$/, "")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 zk-text-muted dark:zk-text-muted">
                      {/* Voice */}
                      {speechSupported && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowCaptureModal(true);
                            setTimeout(() => toggleVoiceInput(), 300);
                          }}
                          className={cn(
                            "relative p-2 rounded-lg transition-all hover:zk-surface-muted dark:hover:bg-[#242b27] hover:zk-text-primary-brand",
                            // Sage brand when recording — was generic
                            // emerald-500, which clashes with the rest
                            // of the app's sage palette and read as a
                            // "different app's button." #2d5a44 is the
                            // app's primary brand sage.
                            isRecording &&
                              "bg-[#2d5a44] text-white hover:bg-[#1f4534] hover:text-white",
                          )}
                          title={isRecording ? "Stop recording" : "Voice"}
                        >
                          <Mic className="w-[18px] h-[18px]" strokeWidth={2} />
                          {/* Breathing red dot while recording —
                              mirrors the capture modal's pattern so
                              users see the same "live recording"
                              signal regardless of which mic they
                              pressed. The ring matches the surrounding
                              card background so the dot reads as a
                              floating indicator rather than sitting
                              on a halo. */}
                          {isRecording && (
                            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse ring-2 ring-white dark:ring-[#1a1f1c]" />
                          )}
                        </button>
                      )}
                      {/* Pencil (brain dump) */}
                      <button
                        onClick={() => setShowCaptureModal(true)}
                        className="p-2 rounded-lg transition-all hover:zk-surface-muted dark:hover:bg-[#242b27] hover:zk-text-primary-brand active:scale-[0.97]"
                        title="Write a note"
                      >
                        <Sparkles
                          className="w-[18px] h-[18px]"
                          strokeWidth={2}
                        />
                      </button>
                    </div>
                  </div>
                  {/* Draft hint — floats at bottom-right of the bar
                      when the user has uncommitted text in the
                      capture buffer and the modal is closed. Anchors
                      to the bar's right edge regardless of viewport
                      width. Click to reopen the modal. Hidden when
                      modal is open (its own counter takes over) or
                      when there's no draft. stopPropagation on the
                      click prevents the bar's own onClick from also
                      firing — both lead to the same place but firing
                      twice causes a brief flicker. */}
                  {!showCaptureModal && dump.trim() && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCaptureModal(true);
                      }}
                      className="absolute right-2 -bottom-5 text-[10px] uppercase tracking-[0.12em] text-[#6b746f] dark:text-[#9aa39d] hover:text-[#2d5a44] dark:hover:text-[#a8d0b0] transition-colors flex items-center gap-1.5"
                      style={{
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}
                      title="You have a draft. Click to continue."
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#8fb89a] dark:bg-[#a8d0b0] animate-pulse" />
                      Draft · {dump.length.toLocaleString()} chars ·{" "}
                      {(50000 - dump.length).toLocaleString()} remaining
                    </button>
                  )}
                  </div>
                </section>
              )}

              {/* --- Notes --- */}
              {loading || !notesLoaded ? (
                <section className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={`skeleton-${i}`}
                      className="zk-surface-raised rounded-2xl overflow-hidden animate-pulse"
                      style={{ boxShadow: "0 1px 12px rgba(46,52,45,0.03)" }}
                    >
                      <div className="flex">
                        <div className="w-1 zk-surface-sunken dark:zk-surface-sunken" />
                        <div className="flex-1 p-6 space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="h-5 w-14 zk-surface-muted dark:zk-surface-muted rounded-full" />
                            <div className="h-3 w-16 zk-surface-muted dark:zk-surface-muted rounded" />
                          </div>
                          <div className="h-5 zk-surface-muted dark:zk-surface-muted rounded-lg w-3/4" />
                          <div className="space-y-2 pt-1">
                            <div className="h-3 zk-surface-muted dark:zk-surface-muted rounded w-full" />
                            <div className="h-3 zk-surface-muted dark:zk-surface-muted rounded w-5/6" />
                          </div>
                          <div className="flex gap-2 pt-2">
                            <div className="h-4 w-16 zk-surface-muted dark:zk-surface-muted rounded-full" />
                            <div className="h-4 w-14 zk-surface-muted dark:zk-surface-muted rounded-full" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>
              ) : filteredNotes.length === 0 ? (
                <motion.div
                  key={`empty-${activeCategory ?? "all"}`}
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0 }}
                  className="py-20 text-center"
                >
                  <div className="w-14 h-14 zk-surface-muted dark:zk-surface-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
                    {searchQuery || activeCategory ? (
                      <Search className="w-7 h-7 zk-text-faint" />
                    ) : (
                      <FileText className="w-7 h-7 zk-text-faint" />
                    )}
                  </div>
                  <h3
                    className="zk-text dark:zk-text font-semibold text-lg mb-1"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {searchQuery
                      ? "No notes match your search"
                      : activeCategory === "Trash"
                        ? "Trash is empty"
                        : activeCategory && activeCategory !== "All"
                          ? `No ${activeCategory.toLowerCase()} notes`
                          : "Your zakar is empty"}
                  </h3>
                  <p
                    className="text-sm zk-text-muted dark:zk-text-muted"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {searchQuery
                      ? "Try a different keyword or clear your search."
                      : activeCategory === "Trash"
                        ? "Deleted notes will appear here for 7 days."
                        : activeCategory && activeCategory !== "All"
                          ? "Notes in this category will appear here."
                          : "Capture your first thought above."}
                  </p>
                </motion.div>
              ) : groupedNotes && viewMode === "grid" ? (
                /* Time-grouped grid view */
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0 }}
                  className="space-y-10"
                >
                  {activeCategory === "Archive" && filteredNotes.length > 0 && (
                    <div className="flex items-center p-4 zk-surface-muted dark:zk-surface-muted rounded-2xl border zk-border-color dark:zk-border-strong gap-3">
                      <Archive className="w-4 h-4 zk-text-muted" />
                      <span
                        className="text-sm zk-text-secondary dark:zk-text-muted"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        Archived notes are hidden from your main view
                      </span>
                    </div>
                  )}
                  {activeCategory === "Trash" && filteredNotes.length > 0 && (
                    <div className="flex items-center justify-between p-4 zk-surface-muted dark:zk-surface-muted rounded-2xl border zk-border-color dark:zk-border-strong">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 zk-text-muted" />
                        <span
                          className="text-sm zk-text-secondary dark:zk-text-muted"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          Auto-deletes after 7 days
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setConfirmPermanentDelete({ type: "empty" })
                        }
                        className="px-4 py-1.5 text-xs font-bold zk-text-secondary dark:zk-text-muted zk-surface-raised rounded-xl hover:zk-surface-sunken dark:hover:bg-[#2e3632] border zk-border-color dark:zk-border-strong transition-all"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        Empty Trash
                      </button>
                    </div>
                  )}
                  {groupedNotes.map((group) => (
                    <div key={group.label}>
                      {/* Group heading */}
                      <div className="mb-4">
                        <span
                          className="text-[11px] font-bold uppercase tracking-[0.18em] zk-text-muted dark:zk-text-muted"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {group.label}
                        </span>
                      </div>
                      {/* Cards grid — masonry layout (content-sized cards) */}
                      <SortableContext
                        items={group.notes.map((n) => n.id)}
                        strategy={rectSortingStrategy}
                      >
                        <MasonryGrid>
                          <AnimatePresence mode="popLayout">
                            {group.notes.map((note) => {
                              const hasTodos =
                                /[-*]\s*\[\s*\]|[-*]\s*\[x\]/i.test(
                                  note.content,
                                );
                              const taskCounts = hasTodos
                                ? getTaskCounts(note.content)
                                : null;
                              return (
                                <SortableNoteWrapper
                                  key={note.id}
                                  id={note.id}
                                  isSelected={selectedNoteIds.has(note.id)}
                                  staleness={computeNoteStaleness(note)}
                                  disabled={
                                    // While a drag is in flight, refuse to
                                    // act as a drop target if this note is
                                    // on the opposite side of the pin
                                    // boundary from the dragged one.
                                    draggedNoteIsPinned !== null &&
                                    draggedNoteIsPinned !== !!note.isPinned
                                  }
                                >
                                  <motion.div
                                    initial={false}
                                    onClick={(e) => {
                                      if (e.metaKey || e.ctrlKey) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleNoteSelection(
                                          note.id,
                                          "toggle",
                                          filteredNotes.map((n) => n.id),
                                        );
                                        return;
                                      }
                                      if (e.shiftKey) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggleNoteSelection(
                                          note.id,
                                          "range",
                                          filteredNotes.map((n) => n.id),
                                        );
                                        return;
                                      }
                                      if (selectedNoteIds.size > 0) {
                                        toggleNoteSelection(
                                          note.id,
                                          "toggle",
                                          filteredNotes.map((n) => n.id),
                                        );
                                        return;
                                      }
                                      openNote(note);
                                    }}
                                    className={cn(
                                      "zk-note-card group cursor-pointer transition-all duration-200 ease-out relative rounded-2xl hover:translate-y-[-2px] hover:shadow-md overflow-visible",
                                      noteColorClass(note.backgroundColor),
                                    )}
                                    style={{
                                      boxShadow:
                                        "0 1px 16px rgba(46,52,45,0.04)",
                                    }}
                                  >
                                    <div
                                      className={cn(
                                        "absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full",
                                        note.category === "Task" &&
                                          "zk-bg-primary",
                                        note.category === "Idea" &&
                                          "bg-amber-500",
                                        note.category === "Credential" &&
                                          "bg-rose-400",
                                        note.category === "Web Content" &&
                                          "bg-sky-400",
                                        note.category === "Personal" &&
                                          "bg-violet-400",
                                        note.category === "Other" &&
                                          "bg-[#abb4af]",
                                      )}
                                    />
                                    {/* Pinned indicator — flat pushpin inside card, top-right — click to unpin */}
                                    {note.isPinned && !note.isTrashed && (
                                      <div className="absolute -top-2 -right-2 z-20 group/pinnote">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            togglePin(note);
                                          }}
                                          className={cn(
                                            "w-7 h-7 rounded-full border-2 zk-note-pin-ring flex items-center justify-center shadow-md transition-colors",
                                            // Use .includes() instead of === so hallucinated
                                            // categories like "SurprisinglySurprisinglyTask"
                                            // still match the right color family.
                                            (() => {
                                              const cat = (note.category || "").toLowerCase();
                                              if (cat.includes("task") || cat.includes("todo")) return "zk-bg-primary hover:bg-[#1f4534]";
                                              if (cat.includes("idea")) return "bg-amber-500 hover:bg-amber-600";
                                              if (cat.includes("credential") || cat.includes("password") || cat.includes("auth")) return "bg-rose-400 hover:bg-rose-500";
                                              if (cat.includes("web") || cat.includes("link") || cat.includes("article")) return "bg-sky-400 hover:bg-sky-500";
                                              if (cat.includes("personal") || cat.includes("journal")) return "bg-violet-400 hover:bg-violet-500";
                                              return "zk-bg-primary hover:bg-[#1f4534] dark:bg-[#6b8f72] dark:hover:bg-[#7fa388]";
                                            })(),
                                          )}
                                          title="Unpin"
                                        >
                                          <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            xmlns="http://www.w3.org/2000/svg"
                                            className="text-white"
                                          >
                                            <path d="M12 17v5" />
                                            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                                          </svg>
                                        </button>
                                        <span
                                          className="absolute top-full right-0 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/pinnote:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                          style={{
                                            fontFamily: "var(--font-sans)",
                                          }}
                                        >
                                          Unpin
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex flex-col pl-4 pr-5 py-4">
                                      <div className="flex items-center justify-between mb-4 gap-3 lg:gap-5">
                                        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                          <span
                                            data-cat-badge
                                            className={cn(
                                              "px-2.5 py-1 rounded-full text-[10px] font-semibold flex-shrink-0 zk-cat-pill",
                                              note.category === "Task" &&
                                                "zk-cat-task",
                                              note.category === "Idea" &&
                                                "zk-cat-idea",
                                              note.category === "Credential" &&
                                                "zk-cat-credential",
                                              note.category === "Web Content" &&
                                                "zk-cat-web",
                                              note.category === "Personal" &&
                                                "zk-cat-personal",
                                              (!note.category ||
                                                note.category === "Other" ||
                                                note.category ===
                                                  "Uncategorized") &&
                                                "zk-cat-other",
                                            )}
                                            style={{
                                              fontFamily:
                                                "'Nunito', sans-serif",
                                            }}
                                          >
                                            {note.category || "Uncategorized"}
                                          </span>
                                          <span
                                            className="text-[10px] zk-text-faint font-medium truncate min-w-0"
                                            style={{
                                              fontFamily:
                                                "'Manrope', sans-serif",
                                            }}
                                            title={`Created ${formatDate(note.createdAt)}`}
                                          >
                                            {formatDate(note.createdAt)}
                                          </span>
                                          {(() => {
                                            const editedLabel = formatEditedAgo(
                                              note.createdAt,
                                              note.updatedAt,
                                            );
                                            if (!editedLabel) return null;
                                            return (
                                              <span
                                                className="text-[10px] zk-text-primary-brand dark:text-[#8fb89a] font-semibold whitespace-nowrap flex-shrink-0"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                                title={`Edited ${formatDate(note.updatedAt)}`}
                                              >
                                                · {editedLabel}
                                              </span>
                                            );
                                          })()}
                                          {processingNotes.has(note.id) && (
                                            <ProcessingDot />
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          {note.isPublic && (
                                            <div className="relative group/globe">
                                              <Globe className="w-3 h-3 zk-text-primary-brand" />
                                              <span
                                                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/globe:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                Shared publicly
                                              </span>
                                            </div>
                                          )}
                                          {note.password && (
                                            <div className="relative group/key">
                                              <Fingerprint className="w-3 h-3 text-emerald-500 zk-lock-pulse" />
                                              <span
                                                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/key:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                Locked — biometric or account password
                                              </span>
                                            </div>
                                          )}
                                          {note.status === "processing" && (
                                            <div className="w-2.5 h-2.5 rounded-full bg-[#6b8f72] animate-pulse" />
                                          )}
                                          {!note.isTrashed &&
                                            !note.isPinned && (
                                              <div className="relative group/pin">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    togglePin(note);
                                                  }}
                                                  className="p-1.5 rounded-full transition-all text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 hover:zk-text-primary-brand dark:hover:text-[#8fb89a] active:scale-[0.97]"
                                                >
                                                  <Pin className="w-3.5 h-3.5" />
                                                </button>
                                                <span
                                                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/pin:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                  style={{
                                                    fontFamily:
                                                      "'Manrope', sans-serif",
                                                  }}
                                                >
                                                  Pin
                                                </span>
                                              </div>
                                            )}
                                          <div className="relative group/star">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleStar(note);
                                              }}
                                              className={cn(
                                                "p-1 rounded-md transition-all",
                                                note.isStarred
                                                  ? "text-amber-500"
                                                  : "text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-amber-500",
                                              )}
                                            >
                                              <Star
                                                className={cn(
                                                  "w-3.5 h-3.5",
                                                  note.isStarred &&
                                                    "fill-current",
                                                )}
                                              />
                                            </button>
                                            <span
                                              className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/star:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                              style={{
                                                fontFamily:
                                                  "'Manrope', sans-serif",
                                              }}
                                            >
                                              {note.isStarred
                                                ? "Unstar"
                                                : "Star"}
                                            </span>
                                          </div>
                                          {note.isTrashed ? (
                                            <>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  restoreNote(note.id);
                                                }}
                                                className="p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 zk-text-faint hover:text-emerald-500 active:scale-[0.97]"
                                                title="Restore"
                                              >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmPermanentDelete({
                                                    type: "single",
                                                    id: note.id,
                                                  });
                                                }}
                                                className="p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 zk-text-faint hover:text-rose-400 active:scale-[0.97]"
                                                title="Delete forever"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              <div className="relative group/archive">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleArchive(note);
                                                  }}
                                                  className="p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[#5b605d] dark:text-[#bdc1c6] hover:zk-text-primary-brand dark:hover:text-[#8fb89a] hover:bg-black/5 dark:hover:bg-white/10 active:scale-[0.97]"
                                                >
                                                  {note.isArchived ? (
                                                    <ArchiveRestore className="w-3.5 h-3.5" />
                                                  ) : (
                                                    <Archive className="w-3.5 h-3.5" />
                                                  )}
                                                </button>
                                                <span
                                                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/archive:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                  style={{
                                                    fontFamily:
                                                      "'Manrope', sans-serif",
                                                  }}
                                                >
                                                  {note.isArchived
                                                    ? "Unarchive"
                                                    : "Archive"}
                                                </span>
                                              </div>
                                              <div className="relative group/trash">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (!note.password)
                                                      trashWithUndo(note);
                                                  }}
                                                  disabled={!!note.password}
                                                  className={cn(
                                                    "p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100",
                                                    note.password
                                                      ? "text-[#abb4af]/30 cursor-not-allowed"
                                                      : "text-[#5b605d] dark:text-[#bdc1c6] hover:text-rose-500 dark:hover:text-rose-400 hover:bg-black/5 dark:hover:bg-white/10",
                                                  )}
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                                <span
                                                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/trash:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                  style={{
                                                    fontFamily:
                                                      "'Manrope', sans-serif",
                                                  }}
                                                >
                                                  {note.password
                                                    ? "Unlock to delete"
                                                    : "Move to trash"}
                                                </span>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                      <h3
                                        className="text-[15px] font-bold zk-text dark:zk-text leading-snug mb-2 flex items-start gap-2"
                                        style={{
                                          fontFamily: "var(--font-display)",
                                        }}
                                      >
                                        {(() => {
                                          // Card title emoji rendering:
                                          //   1. If the title itself
                                          //      starts with an emoji
                                          //      (common for AI-sorted
                                          //      notes), extract and
                                          //      render it bigger.
                                          //   2. Otherwise, scan the
                                          //      content body for the
                                          //      first emoji glyph and
                                          //      surface that as the
                                          //      card's identity emoji.
                                          //      This catches the
                                          //      important case of
                                          //      email-forwarded notes
                                          //      whose titles are plain
                                          //      email subjects (no
                                          //      emoji) but whose AI-
                                          //      sorted body has
                                          //      emoji-prefixed
                                          //      headings (## 🎯 Hook,
                                          //      ### 📌 Pre-Meeting,
                                          //      etc.).
                                          //   3. If no emoji anywhere,
                                          //      just render the title.
                                          //
                                          // line-clamp-3 + flex don't
                                          // mix (line-clamp needs
                                          // display: -webkit-box which
                                          // overrides flex). Apply
                                          // line-clamp to the inner
                                          // text span only.
                                          const [titleEmoji, titleRest] =
                                            extractLeadingEmojiTopLevel(
                                              note.title || "",
                                            );
                                          if (titleEmoji) {
                                            return (
                                              <>
                                                <span
                                                  aria-hidden="true"
                                                  className="text-[22px] leading-none flex-shrink-0"
                                                >
                                                  {titleEmoji}
                                                </span>
                                                <span className="min-w-0 line-clamp-3">
                                                  {titleRest || "Untitled"}
                                                </span>
                                              </>
                                            );
                                          }
                                          // Fallback: scan body for an
                                          // emoji. Email-forwarded notes
                                          // hit this path.
                                          const bodyEmoji =
                                            findFirstEmojiInContent(
                                              note.content || "",
                                            );
                                          if (bodyEmoji) {
                                            return (
                                              <>
                                                <span
                                                  aria-hidden="true"
                                                  className="text-[22px] leading-none flex-shrink-0"
                                                >
                                                  {bodyEmoji}
                                                </span>
                                                <span className="min-w-0 line-clamp-3">
                                                  {note.title || "Untitled"}
                                                </span>
                                              </>
                                            );
                                          }
                                          return (
                                            <span className="line-clamp-3">
                                              {note.title}
                                            </span>
                                          );
                                        })()}
                                      </h3>
                                      {note.reminder && (
                                        <ReminderBadge reminder={note.reminder as Reminder} />
                                      )}
                                      <div className="mb-3">
                                        {hasTodos ? (
                                          <div className="space-y-1.5">
                                            {note.content
                                              .split("\n")
                                              .filter((l) =>
                                                /^(\s*)[-*]\s*\[[\sx]\]/i.test(
                                                  l,
                                                ),
                                              )
                                              .slice(0, 3)
                                              .map((line, i) => {
                                                const isChecked =
                                                  /[-*]\s*\[x\]/i.test(line);
                                                const text = line
                                                  .replace(
                                                    /^(\s*)[-*]\s*\[[\sx]\]\s*/i,
                                                    "",
                                                  )
                                                  .replace(
                                                    /\*\*(.+?)\*\*/g,
                                                    "$1",
                                                  )
                                                  .replace(/[🔴🟡🟢]\s*/g, "")
                                                  .trim();
                                                return (
                                                  <div
                                                    key={i}
                                                    className="flex items-center gap-2.5 min-w-0"
                                                  >
                                                    <div
                                                      className={cn(
                                                        "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                                                        isChecked
                                                          ? "zk-bg-primary border-[#2d5a44]"
                                                          : "border-[#abb4af] dark:border-[#5a6660]",
                                                      )}
                                                    >
                                                      {isChecked && (
                                                        <Check
                                                          className="w-3 h-3 text-white"
                                                          strokeWidth={3}
                                                        />
                                                      )}
                                                    </div>
                                                    <span
                                                      className={cn(
                                                        "text-[13px] leading-snug truncate block min-w-0",
                                                        isChecked
                                                          ? "line-through zk-text-faint dark:zk-text-muted"
                                                          : "zk-text dark:zk-text-secondary",
                                                      )}
                                                      style={{
                                                        fontFamily:
                                                          "'Manrope', sans-serif",
                                                      }}
                                                    >
                                                      {text}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            {note.content
                                              .split("\n")
                                              .filter((l) =>
                                                /^(\s*)[-*]\s*\[[\sx]\]/i.test(
                                                  l,
                                                ),
                                              ).length > 3 && (
                                              <p
                                                className="text-[11px] zk-text-faint pl-7"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                +
                                                {note.content
                                                  .split("\n")
                                                  .filter((l) =>
                                                    /^(\s*)[-*]\s*\[[\sx]\]/i.test(
                                                      l,
                                                    ),
                                                  ).length - 3}{" "}
                                                more tasks
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          <CardBodyText
                                            noteId={note.id}
                                            text={stripMarkdown(
                                              note.maskedContent ||
                                                note.content,
                                            )}
                                          />
                                        )}
                                      </div>
                                      <div
                                        className="flex items-center justify-between mt-auto pt-3"
                                        style={{
                                          borderTop:
                                            "1px solid rgba(171,180,175,0.08)",
                                        }}
                                      >
                                        <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                                          {note.tags.length > 0 ? (
                                            <>
                                              {note.tags
                                                .filter((t) => typeof t === "string" && t.trim().length > 0)
                                                .slice(0, 2)
                                                .map((tag, ti) => (
                                                  <span
                                                    key={`tag-${ti}-${tag}`}
                                                    className="px-2 py-0.5 bg-[#eaf0e8] dark:bg-[#28292c] text-[#747d78] dark:text-[#a3a3a3] text-[10px] font-medium rounded-full truncate max-w-[80px] border border-[#dde5da]/60 dark:border-white/5"
                                                    style={{
                                                      fontFamily:
                                                        "'Manrope', sans-serif",
                                                    }}
                                                  >
                                                    #{tag}
                                                  </span>
                                                ))}
                                              {note.tags.length > 2 && (
                                                <span className="text-[10px] text-[#abb4af] dark:text-[#737373] font-semibold flex-shrink-0">
                                                  +{note.tags.length - 2}
                                                </span>
                                              )}
                                            </>
                                          ) : (
                                            <span>&nbsp;</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap ml-2">
                                          {taskCounts &&
                                            taskCounts.total > 0 && (
                                              <span
                                                className="text-[9px] font-semibold text-[#2d5a44] dark:text-[#8fb89a]"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                {taskCounts.done}/
                                                {taskCounts.total}
                                              </span>
                                            )}
                                          {note.isAutoSorted && (
                                            <Sparkles className="w-3 h-3 text-[#2d5a44] dark:text-[#8fb89a]" />
                                          )}
                                          {note.formatType &&
                                            note.formatType !== "auto" && (
                                              <span
                                                className="text-[9px] font-semibold text-[#6b8f72] uppercase"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                {
                                                  FORMAT_LABELS[
                                                    note.formatType as FormatType
                                                  ]
                                                }
                                              </span>
                                            )}
                                        </div>
                                      </div>
                                    </div>
                                  </motion.div>
                                </SortableNoteWrapper>
                              );
                            })}
                          </AnimatePresence>
                        </MasonryGrid>
                      </SortableContext>
                    </div>
                  ))}
                </motion.div>
              ) : (
                /* Flat view (list mode, search, non-newest sort) */
                <motion.div
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0 }}
                  className="space-y-5"
                >
                  {activeCategory === "Trash" && filteredNotes.length > 0 && (
                    <div className="flex items-center justify-between p-4 zk-surface-muted dark:zk-surface-muted rounded-2xl border zk-border-color dark:zk-border-strong">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 zk-text-muted" />
                        <span
                          className="text-sm zk-text-secondary dark:zk-text-muted"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          Auto-deletes after 7 days
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setConfirmPermanentDelete({ type: "empty" })
                        }
                        className="px-4 py-1.5 text-xs font-bold zk-text-secondary dark:zk-text-muted zk-surface-raised rounded-xl hover:zk-surface-sunken dark:hover:bg-[#2e3632] border zk-border-color dark:zk-border-strong transition-all"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        Empty Trash
                      </button>
                    </div>
                  )}
                  <SortableContext
                    items={filteredNotes.map((n) => n.id)}
                    strategy={rectSortingStrategy}
                  >
                    {(() => {
                      // Grid view = masonry packed. List view = flex column.
                      // We render the inner children into whichever wrapper
                      // matches the user's viewMode, and the SortableContext
                      // above keeps drag-drop behavior consistent across both.
                      const inner = (
                        <AnimatePresence mode="popLayout">
                        {(() => {
                          // In LIST view, group by category. Pinned float to top, then categories alphabetically.
                          let lastCategory: string | null = null;
                          const elements: React.ReactNode[] = [];
                          // Sort a local copy so list view groups by category
                          const listNotes =
                            viewMode === "list"
                              ? [...filteredNotes].sort((a, b) => {
                                  // Pinned first
                                  if (a.isPinned && !b.isPinned) return -1;
                                  if (!a.isPinned && b.isPinned) return 1;
                                  // Then by category alphabetically (Uncategorized/Other last)
                                  const catA = a.category || "Uncategorized";
                                  const catB = b.category || "Uncategorized";
                                  const isLastA =
                                    catA === "Other" ||
                                    catA === "Uncategorized";
                                  const isLastB =
                                    catB === "Other" ||
                                    catB === "Uncategorized";
                                  if (isLastA && !isLastB) return 1;
                                  if (!isLastA && isLastB) return -1;
                                  return catA.localeCompare(catB);
                                })
                              : filteredNotes;

                          listNotes.forEach((note) => {
                            const hasTodos =
                              /[-*]\s*\[\s*\]|[-*]\s*\[x\]/i.test(note.content);
                            const taskCounts = hasTodos
                              ? getTaskCounts(note.content)
                              : null;

                            // Insert category header in list view when category changes
                            if (viewMode === "list") {
                              const isPinnedHeader = note.isPinned;
                              const currentCategory = isPinnedHeader
                                ? "Pinned"
                                : note.category || "Uncategorized";
                              if (currentCategory !== lastCategory) {
                                lastCategory = currentCategory;
                                elements.push(
                                  <div
                                    key={`cat-header-${currentCategory}`}
                                    className="flex items-center gap-3 pt-2 pb-1 first:pt-0"
                                  >
                                    <span
                                      className={cn(
                                        "text-[10px] font-bold uppercase tracking-[0.15em] flex items-center gap-1.5",
                                        currentCategory === "Pinned" &&
                                          "zk-text-primary-brand dark:zk-text-primary-brand",
                                        currentCategory === "Task" &&
                                          "zk-text-primary-brand dark:zk-text-primary-brand",
                                        currentCategory === "Idea" &&
                                          "text-amber-600 dark:text-amber-400",
                                        currentCategory === "Credential" &&
                                          "text-rose-600 dark:text-rose-400",
                                        currentCategory === "Web Content" &&
                                          "text-sky-600 dark:text-sky-400",
                                        currentCategory === "Personal" &&
                                          "text-violet-600 dark:text-violet-400",
                                        (currentCategory === "Other" ||
                                          currentCategory ===
                                            "Uncategorized") &&
                                          "zk-text-muted dark:zk-text-muted",
                                      )}
                                      style={{
                                        fontFamily: "var(--font-sans)",
                                      }}
                                    >
                                      {isPinnedHeader && (
                                        <Pin
                                          className="w-3 h-3 fill-current"
                                          strokeWidth={2}
                                        />
                                      )}
                                      {currentCategory}
                                    </span>
                                    <div className="flex-1 h-px zk-surface-sunken dark:zk-surface-sunken" />
                                  </div>,
                                );
                              }
                            }

                            elements.push(
                              <SortableNoteWrapper
                                key={note.id}
                                id={note.id}
                                isSelected={selectedNoteIds.has(note.id)}
                                staleness={computeNoteStaleness(note)}
                                disabled={
                                  // Block cross-pin drops at the dnd-kit
                                  // level — see grouped view for context.
                                  draggedNoteIsPinned !== null &&
                                  draggedNoteIsPinned !== !!note.isPinned
                                }
                              >
                                <motion.div
                                  initial={false}
                                  onClick={(e) => {
                                    if (e.metaKey || e.ctrlKey) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      toggleNoteSelection(
                                        note.id,
                                        "toggle",
                                        filteredNotes.map((n) => n.id),
                                      );
                                      return;
                                    }
                                    if (e.shiftKey) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      toggleNoteSelection(
                                        note.id,
                                        "range",
                                        filteredNotes.map((n) => n.id),
                                      );
                                      return;
                                    }
                                    if (selectedNoteIds.size > 0) {
                                      // If selection mode is active, clicking selects instead of opening
                                      toggleNoteSelection(
                                        note.id,
                                        "toggle",
                                        filteredNotes.map((n) => n.id),
                                      );
                                      return;
                                    }
                                    openNote(note);
                                  }}
                                  className={cn(
                                    "group cursor-pointer transition-all duration-200 ease-out relative",
                                    viewMode === "grid"
                                      ? cn(
                                          "zk-note-card hover:shadow-md rounded-2xl hover:translate-y-[-2px] overflow-visible",
                                          noteColorClass(note.backgroundColor),
                                        )
                                      : cn(
                                          "zk-note-card-list hover:opacity-95 overflow-visible rounded-xl",
                                          noteColorClass(note.backgroundColor),
                                        ),
                                  )}
                                  style={
                                    viewMode === "grid"
                                      ? {
                                          boxShadow:
                                            "0 1px 16px rgba(46,52,45,0.04)",
                                        }
                                      : undefined
                                  }
                                >
                                  {viewMode === "grid" && (
                                    <div
                                      className={cn(
                                        "absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full",
                                        note.category === "Task" &&
                                          "zk-bg-primary",
                                        note.category === "Idea" &&
                                          "bg-amber-500",
                                        note.category === "Credential" &&
                                          "bg-rose-400",
                                        note.category === "Web Content" &&
                                          "bg-sky-400",
                                        note.category === "Personal" &&
                                          "bg-violet-400",
                                        note.category === "Other" &&
                                          "bg-[#abb4af]",
                                      )}
                                    />
                                  )}

                                  {/* Pinned indicator — flat pushpin inside card, top-right — click to unpin */}
                                  {note.isPinned &&
                                    !note.isTrashed &&
                                    viewMode === "grid" && (
                                      <div className="absolute -top-2 -right-2 z-20 group/pinnote">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            togglePin(note);
                                          }}
                                          className={cn(
                                            "w-7 h-7 rounded-full border-2 zk-note-pin-ring flex items-center justify-center shadow-md transition-colors",
                                            note.category === "Task" &&
                                              "zk-bg-primary hover:bg-[#1f4534]",
                                            note.category === "Idea" &&
                                              "bg-amber-500 hover:bg-amber-600",
                                            note.category === "Credential" &&
                                              "bg-rose-400 hover:bg-rose-500",
                                            note.category === "Web Content" &&
                                              "bg-sky-400 hover:bg-sky-500",
                                            note.category === "Personal" &&
                                              "bg-violet-400 hover:bg-violet-500",
                                            (note.category === "Other" ||
                                              !note.category) &&
                                              "bg-[#abb4af] hover:bg-[#8a9690] dark:bg-[#5a6660] dark:hover:bg-[#6d7d72]",
                                          )}
                                          title="Unpin"
                                        >
                                          <svg
                                            width="13"
                                            height="13"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            xmlns="http://www.w3.org/2000/svg"
                                            className="text-white"
                                          >
                                            <path d="M12 17v5" />
                                            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                                          </svg>
                                        </button>
                                        <span
                                          className="absolute top-full right-0 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/pinnote:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                          style={{
                                            fontFamily: "var(--font-sans)",
                                          }}
                                        >
                                          Unpin
                                        </span>
                                      </div>
                                    )}

                                  {viewMode === "grid" && (
                                    <div className="flex flex-col pl-4 pr-5 py-4">
                                      <div className="flex items-center justify-between mb-4 gap-3 lg:gap-5">
                                        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                          <span
                                            data-cat-badge
                                            className={cn(
                                              "px-2.5 py-1 rounded-full text-[10px] font-semibold flex-shrink-0 zk-cat-pill",
                                              note.category === "Task" &&
                                                "zk-cat-task",
                                              note.category === "Idea" &&
                                                "zk-cat-idea",
                                              note.category === "Credential" &&
                                                "zk-cat-credential",
                                              note.category === "Web Content" &&
                                                "zk-cat-web",
                                              note.category === "Personal" &&
                                                "zk-cat-personal",
                                              (!note.category ||
                                                note.category === "Other" ||
                                                note.category ===
                                                  "Uncategorized") &&
                                                "zk-cat-other",
                                            )}
                                            style={{
                                              fontFamily:
                                                "'Nunito', sans-serif",
                                            }}
                                          >
                                            {note.category || "Uncategorized"}
                                          </span>
                                          <span
                                            className="text-[10px] zk-text-faint font-medium truncate min-w-0"
                                            style={{
                                              fontFamily:
                                                "'Manrope', sans-serif",
                                            }}
                                            title={`Created ${formatDate(note.createdAt)}`}
                                          >
                                            {formatDate(note.createdAt)}
                                          </span>
                                          {(() => {
                                            const editedLabel = formatEditedAgo(
                                              note.createdAt,
                                              note.updatedAt,
                                            );
                                            if (!editedLabel) return null;
                                            return (
                                              <span
                                                className="text-[10px] zk-text-primary-brand dark:text-[#8fb89a] font-semibold whitespace-nowrap flex-shrink-0"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                                title={`Edited ${formatDate(note.updatedAt)}`}
                                              >
                                                · {editedLabel}
                                              </span>
                                            );
                                          })()}
                                          {processingNotes.has(note.id) && (
                                            <ProcessingDot />
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          {note.isPublic && (
                                            <div className="relative group/globe">
                                              <Globe className="w-3 h-3 zk-text-primary-brand" />
                                              <span
                                                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/globe:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                Shared publicly
                                              </span>
                                            </div>
                                          )}
                                          {note.password && (
                                            <div className="relative group/key">
                                              <Fingerprint className="w-3 h-3 text-emerald-500 zk-lock-pulse" />
                                              <span
                                                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/key:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                Locked — biometric or account password
                                              </span>
                                            </div>
                                          )}
                                          {note.status === "processing" && (
                                            <div className="w-2.5 h-2.5 rounded-full bg-[#6b8f72] animate-pulse" />
                                          )}
                                          {!note.isTrashed &&
                                            !note.isPinned && (
                                              <div className="relative group/pin">
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    togglePin(note);
                                                  }}
                                                  className="p-1.5 rounded-full transition-all text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 hover:zk-text-primary-brand dark:hover:text-[#8fb89a] active:scale-[0.97]"
                                                >
                                                  <Pin className="w-3.5 h-3.5" />
                                                </button>
                                                <span
                                                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/pin:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                  style={{
                                                    fontFamily:
                                                      "'Manrope', sans-serif",
                                                  }}
                                                >
                                                  Pin
                                                </span>
                                              </div>
                                            )}
                                          <div className="relative group/star">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleStar(note);
                                              }}
                                              className={cn(
                                                "p-1 rounded-md transition-all",
                                                note.isStarred
                                                  ? "text-amber-500"
                                                  : "text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-amber-500",
                                              )}
                                            >
                                              <Star
                                                className={cn(
                                                  "w-3.5 h-3.5",
                                                  note.isStarred &&
                                                    "fill-current",
                                                )}
                                              />
                                            </button>
                                            <span
                                              className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/star:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                              style={{
                                                fontFamily:
                                                  "'Manrope', sans-serif",
                                              }}
                                            >
                                              {note.isStarred
                                                ? "Unstar"
                                                : "Star"}
                                            </span>
                                          </div>
                                          {note.isTrashed ? (
                                            <>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  restoreNote(note.id);
                                                }}
                                                className="p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 zk-text-faint hover:text-emerald-500 active:scale-[0.97]"
                                                title="Restore"
                                              >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmPermanentDelete({
                                                    type: "single",
                                                    id: note.id,
                                                  });
                                                }}
                                                className="p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 zk-text-faint hover:text-rose-400 active:scale-[0.97]"
                                                title="Delete forever"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </>
                                          ) : (
                                            <div className="relative group/trash">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (!note.password)
                                                    trashWithUndo(note);
                                                }}
                                                disabled={!!note.password}
                                                className={cn(
                                                  "p-1 rounded-md transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100",
                                                  note.password
                                                    ? "text-[#abb4af]/30 cursor-not-allowed"
                                                    : "text-[#5b605d] dark:text-[#bdc1c6] hover:text-rose-500 dark:hover:text-rose-400 hover:bg-black/5 dark:hover:bg-white/10",
                                                )}
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                              <span
                                                className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/trash:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                {note.password
                                                  ? "Unlock to delete"
                                                  : "Move to trash"}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <h3
                                        className="text-[15px] font-bold zk-text dark:zk-text leading-snug mb-2 flex items-start gap-2"
                                        style={{
                                          fontFamily: "var(--font-display)",
                                        }}
                                      >
                                        {(() => {
                                          // Card title emoji rendering:
                                          //   1. If the title itself
                                          //      starts with an emoji
                                          //      (common for AI-sorted
                                          //      notes), extract and
                                          //      render it bigger.
                                          //   2. Otherwise, scan the
                                          //      content body for the
                                          //      first emoji glyph and
                                          //      surface that as the
                                          //      card's identity emoji.
                                          //      This catches the
                                          //      important case of
                                          //      email-forwarded notes
                                          //      whose titles are plain
                                          //      email subjects (no
                                          //      emoji) but whose AI-
                                          //      sorted body has
                                          //      emoji-prefixed
                                          //      headings (## 🎯 Hook,
                                          //      ### 📌 Pre-Meeting,
                                          //      etc.).
                                          //   3. If no emoji anywhere,
                                          //      just render the title.
                                          //
                                          // line-clamp-3 + flex don't
                                          // mix (line-clamp needs
                                          // display: -webkit-box which
                                          // overrides flex). Apply
                                          // line-clamp to the inner
                                          // text span only.
                                          const [titleEmoji, titleRest] =
                                            extractLeadingEmojiTopLevel(
                                              note.title || "",
                                            );
                                          if (titleEmoji) {
                                            return (
                                              <>
                                                <span
                                                  aria-hidden="true"
                                                  className="text-[22px] leading-none flex-shrink-0"
                                                >
                                                  {titleEmoji}
                                                </span>
                                                <span className="min-w-0 line-clamp-3">
                                                  {titleRest || "Untitled"}
                                                </span>
                                              </>
                                            );
                                          }
                                          // Fallback: scan body for an
                                          // emoji. Email-forwarded notes
                                          // hit this path.
                                          const bodyEmoji =
                                            findFirstEmojiInContent(
                                              note.content || "",
                                            );
                                          if (bodyEmoji) {
                                            return (
                                              <>
                                                <span
                                                  aria-hidden="true"
                                                  className="text-[22px] leading-none flex-shrink-0"
                                                >
                                                  {bodyEmoji}
                                                </span>
                                                <span className="min-w-0 line-clamp-3">
                                                  {note.title || "Untitled"}
                                                </span>
                                              </>
                                            );
                                          }
                                          return (
                                            <span className="line-clamp-3">
                                              {note.title}
                                            </span>
                                          );
                                        })()}
                                      </h3>
                                      {note.reminder && (
                                        <ReminderBadge reminder={note.reminder as Reminder} />
                                      )}
                                      <div className="mb-3">
                                        {hasTodos ? (
                                          <div className="space-y-1.5">
                                            {note.content
                                              .split("\n")
                                              .filter((l) =>
                                                /^(\s*)[-*]\s*\[[\sx]\]/i.test(
                                                  l,
                                                ),
                                              )
                                              .slice(0, 3)
                                              .map((line, i) => {
                                                const isChecked =
                                                  /[-*]\s*\[x\]/i.test(line);
                                                const text = line
                                                  .replace(
                                                    /^(\s*)[-*]\s*\[[\sx]\]\s*/i,
                                                    "",
                                                  )
                                                  .replace(
                                                    /\*\*(.+?)\*\*/g,
                                                    "$1",
                                                  )
                                                  .replace(/[🔴🟡🟢]\s*/g, "")
                                                  .trim();
                                                return (
                                                  <div
                                                    key={i}
                                                    className="flex items-center gap-2.5 min-w-0"
                                                  >
                                                    <div
                                                      className={cn(
                                                        "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                                                        isChecked
                                                          ? "zk-bg-primary border-[#2d5a44]"
                                                          : "border-[#abb4af] dark:border-[#5a6660]",
                                                      )}
                                                    >
                                                      {isChecked && (
                                                        <Check
                                                          className="w-3 h-3 text-white"
                                                          strokeWidth={3}
                                                        />
                                                      )}
                                                    </div>
                                                    <span
                                                      className={cn(
                                                        "text-[13px] leading-snug truncate block min-w-0",
                                                        isChecked
                                                          ? "line-through zk-text-faint dark:zk-text-muted"
                                                          : "zk-text dark:zk-text-secondary",
                                                      )}
                                                      style={{
                                                        fontFamily:
                                                          "'Manrope', sans-serif",
                                                      }}
                                                    >
                                                      {text}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            {note.content
                                              .split("\n")
                                              .filter((l) =>
                                                /^(\s*)[-*]\s*\[[\sx]\]/i.test(
                                                  l,
                                                ),
                                              ).length > 3 && (
                                              <p
                                                className="text-[11px] zk-text-faint pl-7"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                +
                                                {note.content
                                                  .split("\n")
                                                  .filter((l) =>
                                                    /^(\s*)[-*]\s*\[[\sx]\]/i.test(
                                                      l,
                                                    ),
                                                  ).length - 3}{" "}
                                                more tasks
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          <CardBodyText
                                            noteId={note.id}
                                            text={stripMarkdown(
                                              note.maskedContent ||
                                                note.content,
                                            )}
                                          />
                                        )}
                                      </div>
                                      <div
                                        className="flex items-center justify-between mt-auto pt-3"
                                        style={{
                                          borderTop:
                                            "1px solid rgba(171,180,175,0.08)",
                                        }}
                                      >
                                        <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                                          {note.tags.length > 0 ? (
                                            <>
                                              {note.tags
                                                .filter((t) => typeof t === "string" && t.trim().length > 0)
                                                .slice(0, 2)
                                                .map((tag, ti) => (
                                                  <span
                                                    key={`tag-${ti}-${tag}`}
                                                    className="px-2 py-0.5 bg-[#eaf0e8] dark:bg-[#28292c] text-[#747d78] dark:text-[#a3a3a3] text-[10px] font-medium rounded-full truncate max-w-[80px] border border-[#dde5da]/60 dark:border-white/5"
                                                    style={{
                                                      fontFamily:
                                                        "'Manrope', sans-serif",
                                                    }}
                                                  >
                                                    #{tag}
                                                  </span>
                                                ))}
                                              {note.tags.length > 2 && (
                                                <span className="text-[10px] text-[#abb4af] dark:text-[#737373] font-semibold flex-shrink-0">
                                                  +{note.tags.length - 2}
                                                </span>
                                              )}
                                            </>
                                          ) : (
                                            <span>&nbsp;</span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap ml-2">
                                          {taskCounts &&
                                            taskCounts.total > 0 && (
                                              <span
                                                className="text-[9px] font-semibold text-[#2d5a44] dark:text-[#8fb89a]"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                {taskCounts.done}/
                                                {taskCounts.total}
                                              </span>
                                            )}
                                          {note.isAutoSorted && (
                                            <Sparkles className="w-3 h-3 text-[#2d5a44] dark:text-[#8fb89a]" />
                                          )}
                                          {note.formatType &&
                                            note.formatType !== "auto" && (
                                              <span
                                                className="text-[9px] font-semibold text-[#6b8f72] uppercase"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                              >
                                                {
                                                  FORMAT_LABELS[
                                                    note.formatType as FormatType
                                                  ]
                                                }
                                              </span>
                                            )}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {viewMode === "list" && (
                                    <div className="relative pl-7 pr-5 py-5 rounded-xl">
                                      {/* Category stripe — inset from corners so it doesn't poke past rounded edges */}
                                      <div
                                        className={cn(
                                          "absolute left-0 top-3 bottom-3 w-1 rounded-r-full",
                                          note.category === "Task" &&
                                            "zk-bg-primary",
                                          note.category === "Idea" &&
                                            "bg-amber-500",
                                          note.category === "Credential" &&
                                            "bg-rose-400",
                                          note.category === "Web Content" &&
                                            "bg-sky-400",
                                          note.category === "Personal" &&
                                            "bg-violet-400",
                                          note.category === "Other" &&
                                            "bg-[#abb4af]",
                                        )}
                                      />

                                      {/* Pin overlap circle — sits at top-left overlapping card corner (matches reference) */}
                                      {note.isPinned && !note.isTrashed && (
                                        <div className="absolute -top-3 -left-3 z-20 group/pinnote">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              togglePin(note);
                                            }}
                                            className={cn(
                                              "w-7 h-7 rounded-full border-2 zk-note-pin-ring flex items-center justify-center shadow-md transition-colors",
                                              note.category === "Task" &&
                                                "zk-bg-primary hover:bg-[#1f4534]",
                                              note.category === "Idea" &&
                                                "bg-amber-500 hover:bg-amber-600",
                                              note.category === "Credential" &&
                                                "bg-rose-400 hover:bg-rose-500",
                                              note.category === "Web Content" &&
                                                "bg-sky-400 hover:bg-sky-500",
                                              note.category === "Personal" &&
                                                "bg-violet-400 hover:bg-violet-500",
                                              (note.category === "Other" ||
                                                note.category ===
                                                  "Uncategorized" ||
                                                !note.category) &&
                                                "zk-bg-primary hover:bg-[#1f4534] dark:bg-[#6b8f72] dark:hover:bg-[#7fa388]",
                                            )}
                                            title="Unpin"
                                          >
                                            <svg
                                              width="12"
                                              height="12"
                                              viewBox="0 0 24 24"
                                              fill="currentColor"
                                              stroke="currentColor"
                                              strokeWidth="1.5"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              xmlns="http://www.w3.org/2000/svg"
                                              className="text-white"
                                            >
                                              <path d="M12 17v5" />
                                              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                                            </svg>
                                          </button>
                                          <span
                                            className="absolute top-full left-0 mt-1.5 px-2 py-1 text-[10px] font-medium text-white bg-[#2e3431] dark:zk-surface rounded-md opacity-0 group-hover/pinnote:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-30 shadow-lg"
                                            style={{
                                              fontFamily:
                                                "'Manrope', sans-serif",
                                            }}
                                          >
                                            Unpin
                                          </span>
                                        </div>
                                      )}

                                      {/* Top meta row */}
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                          <span
                                            data-cat-badge
                                            className={cn(
                                              "px-2.5 py-1 rounded-full text-[10px] font-semibold flex-shrink-0 zk-cat-pill",
                                              note.category === "Task" &&
                                                "zk-cat-task",
                                              note.category === "Idea" &&
                                                "zk-cat-idea",
                                              note.category === "Credential" &&
                                                "zk-cat-credential",
                                              note.category === "Web Content" &&
                                                "zk-cat-web",
                                              note.category === "Personal" &&
                                                "zk-cat-personal",
                                              (!note.category ||
                                                note.category === "Other" ||
                                                note.category ===
                                                  "Uncategorized") &&
                                                "zk-cat-other",
                                            )}
                                            style={{
                                              fontFamily:
                                                "'Nunito', sans-serif",
                                            }}
                                          >
                                            {note.category || "Uncategorized"}
                                          </span>
                                          <span
                                            className="text-[10px] zk-text-faint font-medium truncate min-w-0"
                                            style={{
                                              fontFamily:
                                                "'Manrope', sans-serif",
                                            }}
                                            title={`Created ${formatDate(note.createdAt)}`}
                                          >
                                            {formatDate(note.createdAt)}
                                          </span>
                                          {(() => {
                                            const editedLabel = formatEditedAgo(
                                              note.createdAt,
                                              note.updatedAt,
                                            );
                                            if (!editedLabel) return null;
                                            return (
                                              <span
                                                className="text-[10px] zk-text-primary-brand dark:text-[#8fb89a] font-semibold whitespace-nowrap flex-shrink-0"
                                                style={{
                                                  fontFamily:
                                                    "'Manrope', sans-serif",
                                                }}
                                                title={`Edited ${formatDate(note.updatedAt)}`}
                                              >
                                                · {editedLabel}
                                              </span>
                                            );
                                          })()}
                                          {note.isPublic && (
                                            <Globe className="w-3 h-3 zk-text-primary-brand flex-shrink-0" />
                                          )}
                                          {note.password && (
                                            <Fingerprint className="w-3 h-3 text-emerald-500 flex-shrink-0 zk-lock-pulse" />
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          {!note.isTrashed && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                togglePin(note);
                                              }}
                                              className={cn(
                                                "p-1 rounded transition-all",
                                                note.isPinned
                                                  ? "zk-text-primary-brand dark:text-[#8fb89a]"
                                                  : "text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:zk-text-primary-brand dark:hover:text-[#8fb89a]",
                                              )}
                                              title={
                                                note.isPinned ? "Unpin" : "Pin"
                                              }
                                            >
                                              <Pin
                                                className={cn(
                                                  "w-3.5 h-3.5",
                                                  note.isPinned &&
                                                    "fill-current",
                                                )}
                                              />
                                            </button>
                                          )}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleStar(note);
                                            }}
                                            className={cn(
                                              "p-1 rounded transition-all",
                                              note.isStarred
                                                ? "text-amber-500"
                                                : "text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-amber-500",
                                            )}
                                          >
                                            <Star
                                              className={cn(
                                                "w-3.5 h-3.5",
                                                note.isStarred &&
                                                  "fill-current",
                                              )}
                                            />
                                          </button>
                                          {!note.isTrashed && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleArchive(note);
                                              }}
                                              className="p-1 rounded text-[#5b605d] dark:text-[#bdc1c6] opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:zk-text-primary-brand dark:hover:text-[#8fb89a] transition-all"
                                              title={
                                                note.isArchived
                                                  ? "Unarchive"
                                                  : "Archive"
                                              }
                                            >
                                              {note.isArchived ? (
                                                <ArchiveRestore className="w-3.5 h-3.5" />
                                              ) : (
                                                <Archive className="w-3.5 h-3.5" />
                                              )}
                                            </button>
                                          )}
                                          {note.isTrashed ? (
                                            <>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  restoreNote(note.id);
                                                }}
                                                className="p-1 rounded zk-text-faint opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-emerald-500 transition-all"
                                                title="Restore"
                                              >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmPermanentDelete({
                                                    type: "single",
                                                    id: note.id,
                                                  });
                                                }}
                                                className="p-1 rounded zk-text-faint opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-rose-400 transition-all"
                                                title="Delete forever"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            </>
                                          ) : (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!note.password)
                                                  trashWithUndo(note);
                                              }}
                                              disabled={!!note.password}
                                              className="p-1 rounded zk-text-faint opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:text-rose-400 transition-all"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* Title */}
                                      <h3
                                        className="text-base font-semibold zk-text dark:zk-text leading-snug mb-2"
                                        style={{
                                          fontFamily: "var(--font-display)",
                                        }}
                                      >
                                        {note.title}
                                      </h3>

                                      {/* Body — full content preview, up to 10 lines */}
                                      <p
                                        className="text-[13px] zk-text-secondary dark:text-[#d4d8d3] leading-relaxed whitespace-pre-wrap line-clamp-[6]"
                                        style={{
                                          fontFamily: "var(--font-sans)",
                                        }}
                                      >
                                        {stripMarkdown(
                                          note.maskedContent || note.content,
                                        )}
                                      </p>

                                      {/* Task count footer if any */}
                                      {taskCounts && taskCounts.total > 0 && (
                                        <div className="mt-3 pt-3 border-t border-[#dde5da]/50 dark:border-white/10 flex items-center gap-2">
                                          <span
                                            className="text-[11px] font-semibold text-[#2d5a44] dark:text-[#8fb89a]"
                                            style={{
                                              fontFamily:
                                                "'Manrope', sans-serif",
                                            }}
                                          >
                                            {taskCounts.done}/{taskCounts.total}{" "}
                                            tasks complete
                                          </span>
                                          {note.isAutoSorted && (
                                            <Sparkles className="w-3 h-3 text-[#2d5a44] dark:text-[#8fb89a]" />
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </motion.div>
                              </SortableNoteWrapper>,
                            );
                          });
                          return elements;
                        })()}
                      </AnimatePresence>
                      );
                      return viewMode === "grid" ? (
                        <MasonryGrid>{inner}</MasonryGrid>
                      ) : (
                        <section className="flex flex-col gap-3 max-w-3xl mx-auto">
                          {inner}
                        </section>
                      );
                    })()}
                  </SortableContext>
                </motion.div>
              )}
            </main>
          </div>
        </div>

        {/* --- Modals --- */}

        {/* One-line toast for ephemeral status messages. Slides up from the
            bottom, fades after ~3.5 seconds. Click to dismiss. Sits at a
            high z-index so it floats above modals when one is open. */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] cursor-pointer"
              onClick={() => setToast(null)}
            >
              <div
                className={cn(
                  "px-4 py-2.5 rounded-xl shadow-xl text-xs font-bold border max-w-md",
                  toast.kind === "success" &&
                    "bg-[#1f4534] text-white border-[#1f4534]",
                  toast.kind === "error" &&
                    "bg-[#7a3838] text-white border-[#7a3838]",
                  toast.kind === "info" &&
                    "zk-surface-raised zk-text border zk-border-color",
                )}
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {toast.message}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Capture Modal --- */}
        <AnimatePresence>
          {showCaptureModal && (
            <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCaptureModal(false)}
                className="absolute inset-0 bg-[#2e3431]/40 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 40 }}
                className="relative w-full sm:max-w-lg zk-surface-raised sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden"
                style={{ border: "1px solid rgba(171,180,175,0.12)" }}
              >
                <form
                  onSubmit={(e) => {
                    handleDump(e);
                    setShowCaptureModal(false);
                  }}
                >
                  <div className="flex items-center justify-between px-6 pt-5 pb-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-base font-bold zk-text dark:zk-text"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {captureHeaderWithEmoji}
                      </span>
                      {/* Smart category badge */}
                      <AnimatePresence>
                        {(() => {
                          const detected = detectCategory(dump);
                          return (
                            detected && (
                              <motion.span
                                key={detected.label}
                                initial={{ opacity: 0, scale: 0.8, x: -4 }}
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                exit={{ opacity: 0, scale: 0.8, x: -4 }}
                                className={cn(
                                  "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider flex items-center gap-1",
                                  detected.bg,
                                )}
                                style={{ fontFamily: "var(--font-sans)" }}
                              >
                                <Sparkles className="w-2.5 h-2.5" />
                                {detected.label}
                              </motion.span>
                            )
                          );
                        })()}
                      </AnimatePresence>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCaptureModal(false)}
                      className="p-1.5 zk-text-faint hover:zk-text dark:hover:text-white rounded-lg transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Textarea wrapper — single clean bordered container */}
                  <div className="px-6">
                    <div className="relative rounded-xl border zk-border-color dark:zk-border-strong zk-surface-raised transition-all focus-within:border-[#2d5a44] dark:focus-within:border-[#6b8f72] focus-within:shadow-[0_0_0_3px_rgba(79,99,84,0.08)]">
                      <textarea
                        ref={dumpTextareaRef}
                        value={dump}
                        onChange={(e) => setDump(e.target.value)}
                        placeholder={placeholder}
                        maxLength={50000}
                        autoFocus
                        className="w-full min-h-[180px] px-5 py-4 bg-transparent outline-none text-base leading-relaxed resize-none zk-text dark:zk-text placeholder:zk-text-faint border-0 rounded-xl"
                        style={{
                          fontFamily: "var(--font-sans)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {/* Voice input button — always rendered so the
                          UI doesn't visually shift between browsers.
                          When SpeechRecognition isn't available
                          (e.g. Firefox doesn't ship the Web Speech
                          recognition API), the button is disabled
                          with a tooltip explaining why and a link
                          to the workaround (use Chrome/Edge/Safari
                          or type directly). */}
                      <button
                        type="button"
                        onClick={() => {
                          if (speechSupported) {
                            toggleVoiceInput();
                          }
                        }}
                        disabled={!speechSupported}
                        className={cn(
                          "relative p-2.5 rounded-xl transition-all duration-150",
                          !speechSupported
                            ? "bg-[#eef3ed] dark:bg-[#1f2520] text-[#9aa39d] dark:text-[#5f6368] cursor-not-allowed opacity-70"
                            : isRecording
                              ? "bg-[#2d5a44] text-white shadow-md shadow-[#2d5a44]/30 active:scale-90 hover:scale-110"
                              : "bg-[#eef3ed] dark:bg-[#1f2520] text-[#2d5a44] dark:text-[#a8d0b0] hover:bg-[#d2e8d5] dark:hover:bg-[#2d5a44]/40 hover:text-[#1f4534] dark:hover:text-[#c5e0cc] shadow-sm active:scale-90 hover:scale-110",
                        )}
                        title={
                          !speechSupported
                            ? "Voice input isn't available in this browser. Try Chrome, Edge, or Safari, or type directly."
                            : isRecording
                              ? "Stop recording"
                              : "Voice input"
                        }
                        aria-label={
                          !speechSupported
                            ? "Voice input unavailable in this browser"
                            : isRecording
                              ? "Stop recording"
                              : "Start voice input"
                        }
                      >
                        <Mic className="w-[18px] h-[18px]" strokeWidth={2.25} />
                        {isRecording && (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse ring-2 ring-white dark:ring-[#1a1f1c]" />
                        )}
                      </button>
                      {/* Hidden file input — surfaced via the paperclip
                          button below. Accept list covers the formats the
                          import handler knows how to parse. .doc is
                          intentionally NOT here because we can't read it
                          client-side. */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept=".md,.markdown,.txt,.html,.htm,.json,.docx,text/plain,text/markdown,text/html,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={handleFileImport}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importingFile}
                        className={cn(
                          "p-2.5 rounded-xl transition-all duration-150 active:scale-90 hover:scale-110 shadow-sm",
                          importingFile
                            ? "bg-[#eef3ed] dark:bg-[#1f2520] text-[#2d5a44] dark:text-[#a8d0b0] cursor-wait"
                            : "bg-[#eef3ed] dark:bg-[#1f2520] text-[#2d5a44] dark:text-[#a8d0b0] hover:bg-[#d2e8d5] dark:hover:bg-[#2d5a44]/40 hover:text-[#1f4534] dark:hover:text-[#c5e0cc]",
                        )}
                        title={
                          importingFile
                            ? "Reading file…"
                            : "Import file (.md, .txt, .html, .json, .docx)"
                        }
                        aria-label="Import file from your device"
                      >
                        {importingFile ? (
                          <Loader2 className="w-[18px] h-[18px] animate-spin" strokeWidth={2.25} />
                        ) : (
                          <Upload className="w-[18px] h-[18px]" strokeWidth={2.25} />
                        )}
                      </button>
                      {dump.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setDump("");
                            if (user?.uid)
                              localStorage.removeItem(`zakar_dump_${user.uid}`);
                          }}
                          className="p-2 zk-text-faint hover:text-rose-400 rounded-lg transition-all"
                          title="Clear"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      <span
                        className={cn(
                          "text-[11px] font-medium",
                          dump.length >= 50000
                            ? "text-rose-500"
                            : "text-[#6b746f] dark:text-[#9aa39d]",
                        )}
                        style={{ fontFamily: "var(--font-sans)" }}
                        title={
                          dump.length >= 50000
                            ? "Character limit reached"
                            : `${(50000 - dump.length).toLocaleString()} characters remaining`
                        }
                      >
                        {dump.length >= 50000
                          ? "Limit"
                          : `${(50000 - dump.length).toLocaleString()}`}
                      </span>
                    </div>
                    <button
                      type="submit"
                      disabled={
                        !dump.trim() || isProcessing || dump.length > 50000
                      }
                      className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl disabled:opacity-60 disabled:cursor-not-allowed transition-all active:scale-[0.97] hover:bg-[#435749]"
                      style={{
                        backgroundColor: "#2d5a44",
                        fontFamily: "var(--font-sans)",
                      }}
                    >
                      Capture
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* Import error banner — surfaces failures from
                      handleFileImport (unsupported types, oversize
                      files, empty content). Dismissed by clicking
                      the X or by starting a successful import. */}
                  <AnimatePresence>
                    {importError && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mx-6 mb-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
                          <p
                            className="flex-1 text-[12px] leading-relaxed text-rose-700 dark:text-rose-200"
                            style={{ fontFamily: "var(--font-sans)" }}
                          >
                            {importError}
                          </p>
                          <button
                            type="button"
                            onClick={() => setImportError(null)}
                            className="text-rose-500 hover:text-rose-700 dark:hover:text-rose-300 flex-shrink-0"
                            aria-label="Dismiss"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Format Type Selector */}
                  <AnimatePresence>
                    {dump.trim().length > 0 && profile?.autoSortEnabled && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-4 flex flex-wrap gap-2">
                          <span
                            className="text-[9px] font-bold zk-text-faint uppercase tracking-[0.15em] self-center mr-1"
                            style={{ fontFamily: "var(--font-sans)" }}
                          >
                            Format as
                          </span>
                          {(Object.keys(FORMAT_LABELS) as FormatType[]).map(
                            (fmt) => {
                              const icons: Record<FormatType, any> = {
                                auto: Sparkles,
                                todo: ListChecks,
                                email: Mail,
                                blog: FileText,
                                tweet: MessageSquare,
                                meeting: CalendarCheck,
                                flashcards: Layers,
                                lyrics: Music,
                              };
                              const Icon = icons[fmt];
                              return (
                                <button
                                  key={fmt}
                                  type="button"
                                  onClick={() => setFormatType(fmt)}
                                  className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95",
                                    formatType === fmt
                                      ? "text-white"
                                      : "zk-surface-muted dark:zk-surface-muted zk-text-secondary dark:zk-text-muted hover:zk-surface-sunken dark:hover:bg-[#2e3632]",
                                  )}
                                  style={
                                    formatType === fmt
                                      ? {
                                          backgroundColor: "#2d5a44",
                                          fontFamily: "var(--font-sans)",
                                        }
                                      : { fontFamily: "var(--font-sans)" }
                                  }
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                  {FORMAT_LABELS[fmt]}
                                </button>
                              );
                            },
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {/* --- Settings Modal --- */}
          <Modal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            size="md"
            className="p-8"
          >
            <ModalHeader
              title="Settings"
              onClose={() => setIsSettingsOpen(false)}
              className="px-0 pt-0 pb-6"
            />

            {/* Tab navigation */}
            <div
              className="flex gap-1 p-1 zk-surface-muted dark:zk-surface-muted rounded-xl mb-6"
              role="tablist"
            >
              {[
                { id: "account" as const, label: "Account" },
                { id: "preferences" as const, label: "Preferences" },
                { id: "data" as const, label: "Data" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={settingsTab === tab.id}
                  onClick={() => setSettingsTab(tab.id)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg text-sm font-bold transition-all",
                    settingsTab === tab.id
                      ? "zk-surface-raised dark:zk-surface-raised zk-text dark:zk-text shadow-sm"
                      : "zk-text-muted dark:zk-text-muted hover:zk-text dark:hover:zk-text",
                  )}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* === ACCOUNT TAB === */}
            {settingsTab === "account" && (
              <div className="space-y-6">
                <div className="p-4 zk-surface-muted dark:zk-surface-muted rounded-2xl border zk-border-color dark:zk-border-color">
                  <h4 className="text-xs font-bold zk-text dark:zk-text mb-4 uppercase tracking-widest flex items-center gap-2">
                    <UserIcon className="w-4 h-4 zk-text-primary-brand" />
                    Account Info
                  </h4>
                  <div className="flex items-center gap-4">
                    {user?.photoURL && (
                      <img
                        src={user.photoURL}
                        alt=""
                        className="w-12 h-12 rounded-full border-2 border-white dark:zk-border-strong shadow-sm"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div>
                      <p className="font-bold zk-text dark:zk-text">
                        {user?.displayName}
                      </p>
                      <p className="text-sm zk-text-muted dark:zk-text-muted">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Danger zone — kept inside Account tab so it's only one
                    click away from the user's identity context, not buried. */}
                <div className="pt-6 border-t zk-border-color dark:zk-border-color">
                  <h4 className="text-xs font-bold zk-text-muted dark:zk-text-muted uppercase tracking-widest px-2 mb-3">
                    Danger Zone
                  </h4>
                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      setIsDeleteConfirmOpen(true);
                    }}
                    className="w-full flex items-center gap-3 p-4 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-2xl transition-all font-bold"
                  >
                    <Trash2 className="w-5 h-5" />
                    Delete Account
                  </button>
                </div>
              </div>
            )}

            {/* === PREFERENCES TAB === */}
            {settingsTab === "preferences" && (
              <div className="space-y-3">
                <button
                  onClick={toggleTheme}
                  className="w-full flex items-center justify-between p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl overflow-hidden relative">
                      <AnimatePresence mode="wait" initial={false}>
                        {theme === "light" ? (
                          <motion.span
                            key="settings-sun"
                            initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                            animate={{ rotate: 0, opacity: 1, scale: 1 }}
                            exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
                            transition={{
                              duration: 0.32,
                              ease: [0.2, 0, 0, 1],
                            }}
                            className="block"
                          >
                            <Sun className="w-5 h-5 zk-text-primary-brand" />
                          </motion.span>
                        ) : (
                          <motion.span
                            key="settings-moon"
                            initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
                            animate={{ rotate: 0, opacity: 1, scale: 1 }}
                            exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
                            transition={{
                              duration: 0.32,
                              ease: [0.2, 0, 0, 1],
                            }}
                            className="block"
                          >
                            <Moon className="w-5 h-5 zk-text-primary-brand" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <span className="font-bold zk-text dark:zk-text-secondary">
                      Theme
                    </span>
                  </div>
                  <span className="text-sm font-medium zk-text-muted dark:zk-text-muted capitalize">
                    {theme}
                  </span>
                </button>

                <button
                  onClick={toggleAutoSort}
                  className="w-full flex items-center justify-between p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl">
                      <Sparkles className="w-5 h-5 zk-text-primary-brand" />
                    </div>
                    <span className="font-bold zk-text dark:zk-text-secondary">
                      Magic Sort
                    </span>
                  </div>
                  <div
                    className={cn(
                      "w-10 h-5 rounded-full relative transition-all",
                      profile?.autoSortEnabled
                        ? "zk-bg-primary"
                        : "zk-surface-sunken dark:zk-surface-sunken",
                    )}
                  >
                    <motion.div
                      animate={{ x: profile?.autoSortEnabled ? 20 : 2 }}
                      className="absolute top-1 left-0 w-3 h-3 zk-surface-raised rounded-full shadow-sm"
                    />
                  </div>
                </button>

                <button
                  onClick={toggleSensitiveDataDetection}
                  className="w-full flex items-center justify-between p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl">
                      <ShieldCheck className="w-5 h-5 zk-text-primary-brand" />
                    </div>
                    <span className="font-bold zk-text dark:zk-text-secondary">
                      Auto-lock sensitive notes
                    </span>
                  </div>
                  <div
                    className={cn(
                      "w-10 h-5 rounded-full relative transition-all",
                      profile?.autoLockSensitiveNotes !== false
                        ? "zk-bg-primary"
                        : "zk-surface-sunken dark:zk-surface-sunken",
                    )}
                  >
                    <motion.div
                      animate={{
                        x:
                          profile?.autoLockSensitiveNotes !== false
                            ? 20
                            : 2,
                      }}
                      className="absolute top-1 left-0 w-3 h-3 zk-surface-raised rounded-full shadow-sm"
                    />
                  </div>
                </button>

                <div className="p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl">
                      <Globe className="w-5 h-5 zk-text-primary-brand" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold zk-text dark:zk-text-secondary">
                        Default Language
                      </p>
                      <p className="text-[11px] zk-text-faint dark:zk-text-muted mt-0.5">
                        Used for voice input and AI organization
                      </p>
                    </div>
                  </div>
                  <select
                    value={profile?.defaultLanguage || "en-US"}
                    onChange={(e) => updateDefaultLanguage(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white dark:bg-[#202124] border border-[#dde5da] dark:border-white/[0.08] rounded-xl text-sm font-medium zk-text dark:zk-text-secondary focus:border-[#2d5a44] dark:focus:border-[#6b8f72] focus:outline-none focus:ring-2 focus:ring-[#d2e8d5]/40 dark:focus:ring-[#2d5a44]/20 transition-all cursor-pointer"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.nativeLabel} — {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* === DATA TAB === */}
            {settingsTab === "data" && (
              <div className="space-y-3">
                <div className="relative">
                  <button
                    onClick={() => setExportPickerOpen((v) => !v)}
                    disabled={isExporting}
                    className="w-full flex items-center justify-between p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl">
                        <Download className="w-5 h-5 zk-text-primary-brand" />
                      </div>
                      <div className="text-left">
                        <p className="font-bold zk-text dark:zk-text-secondary">
                          {isExporting ? "Preparing export…" : "Export all notes"}
                        </p>
                        <p className="text-[11px] zk-text-faint dark:zk-text-muted mt-0.5">
                          Choose Markdown, HTML, or JSON
                        </p>
                      </div>
                    </div>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 zk-text-faint transition-transform",
                        exportPickerOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {/* Floating format picker — popover overlay anchored to the
                      Export button. Floats over the Data tab instead of
                      pushing other rows down, so the modal doesn't grow
                      uncomfortably tall. Click outside (the backdrop) or
                      pick a format to dismiss. */}
                  {exportPickerOpen && !isExporting && (
                    <>
                      {/* Click-outside catcher — invisible full-screen layer
                          BENEATH the popover. Closes the picker when the
                          user clicks anywhere else, matching standard
                          dropdown behavior. */}
                      <div
                        className="fixed inset-0 z-[55]"
                        onClick={() => setExportPickerOpen(false)}
                      />
                      <div
                        className="absolute top-full right-0 mt-2 w-72 zk-surface-raised rounded-xl shadow-xl border zk-border-color overflow-hidden z-[56]"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        <button
                          onClick={() => handleExportAllNotes("markdown")}
                          className="w-full text-left px-4 py-3 hover:bg-[#d2e8d5]/40 dark:hover:bg-[#2d5a44]/35 transition-colors border-b zk-border-color"
                        >
                          <p className="text-sm font-bold zk-text-primary-brand">
                            Markdown · .zip
                          </p>
                          <p className="text-[11px] zk-text-faint mt-0.5">
                            Portable — Obsidian, Bear, Notion. Lossless.
                          </p>
                        </button>
                        <button
                          onClick={() => handleExportAllNotes("html")}
                          className="w-full text-left px-4 py-3 hover:bg-[#d2e8d5]/40 dark:hover:bg-[#2d5a44]/35 transition-colors border-b zk-border-color"
                        >
                          <p className="text-sm font-bold zk-text">
                            HTML · single file
                          </p>
                          <p className="text-[11px] zk-text-faint mt-0.5">
                            For printing or archiving in a browser.
                          </p>
                        </button>
                        <button
                          onClick={() => handleExportAllNotes("json")}
                          className="w-full text-left px-4 py-3 hover:bg-[#d2e8d5]/40 dark:hover:bg-[#2d5a44]/35 transition-colors"
                        >
                          <p className="text-sm font-bold zk-text">
                            JSON · single file
                          </p>
                          <p className="text-[11px] zk-text-faint mt-0.5">
                            For scripts, databases, LLM workflows.
                          </p>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={triggerImportPicker}
                  disabled={
                    importStatus.state === "parsing" ||
                    importStatus.state === "importing" ||
                    importStatus.state === "sorting"
                  }
                  className="w-full flex items-center justify-between p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl">
                      <Upload className="w-5 h-5 zk-text-primary-brand" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold zk-text dark:zk-text-secondary">
                        {importStatus.state === "parsing"
                          ? "Reading file…"
                          : importStatus.state === "importing"
                            ? `Importing ${importStatus.progress?.current ?? 0} of ${
                                importStatus.progress?.total ?? 0
                              }…`
                            : importStatus.state === "sorting"
                              ? `Sorting ${importStatus.progress?.current ?? 0} of ${
                                  importStatus.progress?.total ?? 0
                                } with AI…`
                              : "Import notes"}
                      </p>
                      <p className="text-[11px] zk-text-faint dark:zk-text-muted mt-0.5">
                        {importStatus.state === "sorting"
                          ? "AI organizing each note — this may take a minute."
                          : "Upload a .md, .txt, or .zip from another notes app"}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Sort-during-import toggle. Sub-option for the import button
                    above — visually grouped via reduced indent and a softer
                    surface so it reads as "a setting that affects Import". */}
                <div className="pl-4 pt-1">
                  <button
                    onClick={toggleImportSortWithAI}
                    className="w-full flex items-center justify-between p-3 bg-white/40 dark:bg-white/[0.02] border border-[#dde5da]/60 dark:border-white/[0.04] rounded-xl hover:bg-white/60 dark:hover:bg-white/[0.04] transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-4 h-4 zk-text-primary-brand" />
                      <div className="text-left">
                        <p className="text-sm font-semibold zk-text dark:zk-text-secondary">
                          Sort imported notes with AI
                        </p>
                        <p className="text-[10px] zk-text-faint dark:zk-text-muted mt-0.5">
                          {importSortWithAI
                            ? "Magic Sort runs after import."
                            : "Imports keep their original organization."}
                        </p>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "w-9 h-[18px] rounded-full relative transition-all flex-shrink-0",
                        importSortWithAI
                          ? "zk-bg-primary"
                          : "zk-surface-sunken dark:zk-surface-sunken",
                      )}
                    >
                      <motion.div
                        animate={{ x: importSortWithAI ? 19 : 2 }}
                        className="absolute top-[3px] left-0 w-3 h-3 zk-surface-raised rounded-full shadow-sm"
                      />
                    </div>
                  </button>
                </div>

                {(importStatus.state === "done" ||
                  importStatus.state === "error") && (
                  <div
                    className={cn(
                      "px-4 py-3 rounded-xl text-sm",
                      importStatus.state === "done"
                        ? "bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/15 text-[#1f4534] dark:text-[#a8c9ac]"
                        : "bg-rose-50 dark:bg-rose-900/15 text-rose-700 dark:text-rose-300",
                    )}
                  >
                    <p className="font-medium">{importStatus.message}</p>
                    {/* Smart recovery hint: if the last import had AI sort
                        failures, surface a one-click "Sort failed notes now"
                        action so the user doesn't have to hunt for the bulk
                        sort button below. */}
                    {importLastResult &&
                      importLastResult.aiSortFailures > 0 &&
                      bulkSortStatus.state !== "running" && (
                        <button
                          onClick={handleBulkSortUnsorted}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/60 dark:bg-white/[0.06] hover:bg-white/80 dark:hover:bg-white/[0.10] rounded-lg text-xs font-bold transition-all"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Sort failed notes now
                        </button>
                      )}
                  </div>
                )}

                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt,.zip,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFile(file);
                    if (importFileInputRef.current) {
                      importFileInputRef.current.value = "";
                    }
                  }}
                />

                {/* Bulk Sort recovery — separator + dedicated section.
                    Lives under Import because that's where most users will
                    encounter the need (recover from AI sort failures), but
                    it's also useful for users who imported without AI sort
                    and changed their mind, or just want to organize notes
                    they captured during a Magic-Sort-disabled period. */}
                <div className="pt-4 mt-2 border-t zk-border-color dark:zk-border-color">
                  <h4 className="text-xs font-bold zk-text-muted dark:zk-text-muted uppercase tracking-widest px-2 mb-2">
                    Organize Existing Notes
                  </h4>
                  <button
                    onClick={
                      bulkSortStatus.state === "running"
                        ? cancelBulkSort
                        : handleBulkSortUnsorted
                    }
                    disabled={
                      importStatus.state === "importing" ||
                      importStatus.state === "sorting" ||
                      importStatus.state === "parsing"
                    }
                    className="w-full flex items-center justify-between gap-3 p-4 bg-[#f4f7f2] dark:bg-[#282929] border border-[#dde5da] dark:border-white/[0.08] rounded-2xl hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="p-1.5 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/10 rounded-xl flex-shrink-0">
                        <Sparkles
                          className={cn(
                            "w-5 h-5 zk-text-primary-brand",
                            bulkSortStatus.state === "running" &&
                              "animate-pulse",
                          )}
                        />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <p className="font-bold zk-text dark:zk-text-secondary">
                          {bulkSortStatus.state === "running"
                            ? `Sorting ${bulkSortStatus.progress?.current ?? 0} of ${
                                bulkSortStatus.progress?.total ?? 0
                              }… (tap to cancel)`
                            : "Sort all unsorted notes"}
                        </p>
                        <p className="text-[11px] zk-text-faint dark:zk-text-muted mt-0.5 leading-snug">
                          {bulkSortStatus.state === "running"
                            ? "AI organizing each note — this may take a while."
                            : "Run Magic Sort on every unsorted note."}
                        </p>
                      </div>
                    </div>
                    {/* Inline % during run */}
                    {bulkSortStatus.state === "running" &&
                      bulkSortStatus.progress && (
                        <span className="text-xs font-bold zk-text-primary-brand flex-shrink-0 tabular-nums">
                          {Math.round(
                            (bulkSortStatus.progress.current /
                              Math.max(
                                bulkSortStatus.progress.total,
                                1,
                              )) *
                              100,
                          )}
                          %
                        </span>
                      )}
                  </button>

                  {/* Bulk-sort progress bar — only while running */}
                  {bulkSortStatus.state === "running" &&
                    bulkSortStatus.progress && (
                      <div className="mt-2 h-1 zk-surface-sunken dark:bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full zk-bg-primary"
                          animate={{
                            width: `${
                              (bulkSortStatus.progress.current /
                                Math.max(
                                  bulkSortStatus.progress.total,
                                  1,
                                )) *
                              100
                            }%`,
                          }}
                          transition={{ duration: 0.3, ease: "easeOut" }}
                        />
                      </div>
                    )}

                  {bulkSortStatus.state === "done" && (
                    <div className="mt-2 px-4 py-3 rounded-xl text-sm font-medium bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/15 text-[#1f4534] dark:text-[#a8c9ac]">
                      {bulkSortStatus.message}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Footer — always visible regardless of active tab */}
            <div className="mt-8 pt-5 border-t zk-border-color dark:zk-border-color flex items-center justify-center gap-4 text-[10px] font-bold zk-text-faint dark:zk-text-muted uppercase tracking-widest">
              <a
                href="https://www.myzakar.app/#terms"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:zk-text-primary-brand transition-colors"
              >
                Terms
              </a>
              <div className="w-1 h-1 zk-surface-sunken dark:zk-surface-muted rounded-full" />
              <a
                href="https://www.myzakar.app/#privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:zk-text-primary-brand transition-colors"
              >
                Privacy
              </a>
            </div>
          </Modal>

          {/* Ask my notes — Tier 1 RAG. The user types a natural question
              about their own notes; we embed any unindexed notes lazily,
              run cosine similarity against the question vector, then ask
              Gemini to synthesize a grounded answer with citations.

              Visibility: when the user clicks a source citation, we open
              the note detail view but keep this modal MOUNTED (just
              visually hidden via display:none). React preserves the
              answer state, and closing the note detail returns the user
              straight to the answer — no re-asking, no lost context. */}
          {askOpen && (
            <div
              className={cn(
                "fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[10vh]",
                askPreviewingSource && "hidden",
              )}
            >
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  askCancelRef.current = true;
                  setAskOpen(false);
                }}
                // Lighter backdrop + less blur than the previous slate
                // overlay. Themes with sage/cream surfaces don't pair well
                // with bg-slate-900 — it reads as a cold separate layer
                // rather than "your app, dimmed". The current treatment
                // matches the rest of the app's modal style and lets the
                // grid show through faintly so users keep their context.
                className="absolute inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -12 }}
                className="relative z-10 w-full max-w-2xl zk-surface-raised rounded-2xl shadow-2xl border zk-border-color overflow-hidden"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {/* Header */}
                <div className="px-5 pt-5 pb-3 border-b zk-border-color flex items-center gap-3">
                  <div className="p-2 bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/15 rounded-xl flex-shrink-0">
                    <Sparkles className="w-5 h-5 zk-text-primary-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      className="font-bold zk-text"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      Ask your notes
                    </h3>
                    <p className="text-[11px] zk-text-faint mt-0.5">
                      Beta — answers come only from notes you've captured.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      askCancelRef.current = true;
                      setAskOpen(false);
                    }}
                    className="p-1.5 -mr-1.5 zk-text-faint hover:zk-text rounded-md hover:bg-[#d2e8d5]/30 dark:hover:bg-[#2d5a44]/35 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Input row */}
                <div className="px-5 py-4">
                  <div className="relative">
                    <input
                      type="text"
                      autoFocus
                      value={askQuestion}
                      onChange={(e) => setAskQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !askLoading && askQuestion.trim()) {
                          handleAskNotes(askQuestion);
                        }
                      }}
                      placeholder="What's the address Hope sent me?"
                      disabled={askLoading}
                      className="w-full px-4 py-3 pr-24 rounded-xl border zk-border-color zk-surface focus:border-[#2d5a44] dark:focus:border-[#6b8f72] focus:shadow-[0_0_0_3px_rgba(79,99,84,0.08)] outline-none text-sm zk-text placeholder:zk-text-faint disabled:opacity-60 transition-all"
                    />
                    <button
                      onClick={() => handleAskNotes(askQuestion)}
                      disabled={askLoading || !askQuestion.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2d5a44] hover:bg-[#1f4534] dark:bg-[#6b8f72] dark:hover:bg-[#7da085] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {askLoading ? "Thinking…" : "Ask"}
                    </button>
                  </div>

                  {/* Indexing progress — shown only on first run with stale notes */}
                  {askIndexing && askIndexing.total > 0 && (
                    <div className="mt-3 flex items-center gap-2 text-[11px] zk-text-faint">
                      <div className="flex-1 h-1 bg-[#dde5da] dark:bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-[#8fb89a]"
                          animate={{
                            width: `${(askIndexing.done / Math.max(askIndexing.total, 1)) * 100}%`,
                          }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                      <span className="tabular-nums">
                        Indexing {askIndexing.done}/{askIndexing.total}
                      </span>
                    </div>
                  )}
                </div>

                {/* Answer */}
                <div className="px-5 pb-5 max-h-[55vh] overflow-y-auto">
                  {askAnswer ? (
                    <div>
                      {/* Header: confidence pill + "Answered in Xs · N sources".
                          Confidence is derived from the top retrieval hit's
                          score; high (≥0.7), medium (≥0.5), low otherwise.
                          When the model itself says "I don't see that in your
                          notes" we force low confidence regardless of score. */}
                      {askMeta && askAnswer.hits.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold",
                              askMeta.confidence === "high" &&
                                "bg-[#d2e8d5] dark:bg-[#1f4534]/30 text-[#2e3a32] dark:text-[#a8d0b0]",
                              askMeta.confidence === "medium" &&
                                "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
                              askMeta.confidence === "low" &&
                                "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300",
                            )}
                          >
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                askMeta.confidence === "high" &&
                                  "bg-[#1f4534] dark:bg-[#8fb89a]",
                                askMeta.confidence === "medium" &&
                                  "bg-amber-500 dark:bg-amber-400",
                                askMeta.confidence === "low" &&
                                  "bg-orange-500 dark:bg-orange-400",
                              )}
                            />
                            {askMeta.confidence === "high" && "High confidence"}
                            {askMeta.confidence === "medium" &&
                              "Medium confidence"}
                            {askMeta.confidence === "low" && "Low confidence"}
                          </span>
                          <span className="text-[11px] zk-text-faint font-mono">
                            Answered in{" "}
                            {askMeta.durationMs < 1000
                              ? `${Math.round(askMeta.durationMs)}ms`
                              : `${(askMeta.durationMs / 1000).toFixed(1)}s`}{" "}
                            · {askAnswer.hits.length} source
                            {askAnswer.hits.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      )}

                      {/* Render the answer as markdown. The ask-answer-prose
                          class lets us tighten paragraph spacing, brand
                          bolds, and style date-shaped strings without
                          fighting the global markdown styles used by
                          notes elsewhere. */}
                      <div
                        className="text-[14px] leading-relaxed zk-text ask-answer-prose [&_strong]:zk-text [&_strong]:font-bold [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:space-y-1 [&_li]:leading-relaxed [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        <Markdown components={markdownComponents}>
                          {askAnswer.text}
                        </Markdown>
                      </div>
                      {askAnswer.hits.length > 0 && (
                        <div className="mt-4 pt-4 border-t zk-border-color">
                          <p className="text-[10px] uppercase tracking-widest font-bold zk-text-muted mb-2">
                            Sources
                          </p>
                          <div className="space-y-1.5">
                            {askAnswer.hits.map((hit, i) => (
                              <button
                                key={hit.note.id}
                                onClick={() => {
                                  // Find the live note object and open it
                                  // OVER the Ask modal. Keep askOpen=true
                                  // and toggle askPreviewingSource so the
                                  // Ask modal hides without unmounting.
                                  // Closing the note detail will flip
                                  // askPreviewingSource back and the user
                                  // is right back at the answer.
                                  const live = notes.find(
                                    (n) => n.id === hit.note.id,
                                  );
                                  if (live) {
                                    setAskPreviewingSource(true);
                                    setSelectedNote(live);
                                  }
                                }}
                                className="w-full flex items-start gap-2 text-left px-2.5 py-1.5 rounded-md hover:bg-[#d2e8d5]/30 dark:hover:bg-[#2d5a44]/35 transition-colors group"
                              >
                                <span className="text-[10px] font-bold zk-text-primary-brand flex-shrink-0 mt-0.5">
                                  #{i + 1}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-xs font-bold zk-text truncate">
                                    {hit.note.title || "Untitled"}
                                  </span>
                                  {/* Percentage was zk-text-faint which is
                                      barely legible on the modal surface.
                                      Bumped to zk-text-muted (one shade
                                      darker) so the match score is easy
                                      to scan at a glance. */}
                                  <span className="block text-[10px] zk-text-muted mt-0.5">
                                    <span className="font-bold zk-text-primary-brand">
                                      {Math.round(hit.score * 100)}% match
                                    </span>
                                    {hit.note.category &&
                                      ` · ${hit.note.category}`}
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : !askLoading ? (
                    <div className="text-center py-6">
                      <p className="text-xs zk-text-muted">
                        Try things like "What did I decide about the trip
                        last weekend?" or "Notes about the Q4 launch."
                      </p>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            </div>
          )}

          {/* Duplicate-import prompt — shown when one or more incoming notes
              fingerprint-match an existing note in the library. Three actions:
                Skip duplicates  → import only the non-dupes
                Import anyway    → import everything (creates intentional copies)
                Cancel           → abandon the whole import. */}
          {importDupePrompt && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setImportDupePrompt(null)}
                className="absolute inset-0 bg-slate-900/70 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                className="relative z-10 w-full max-w-md zk-surface-raised rounded-2xl shadow-2xl border zk-border-color p-6"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                <h3
                  className="text-lg font-bold zk-text mb-2"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Some of these look familiar
                </h3>
                <p className="text-sm zk-text-muted leading-relaxed mb-5">
                  {importDupePrompt.duplicateIndices.size} of{" "}
                  {importDupePrompt.parsed.length} note
                  {importDupePrompt.parsed.length === 1 ? "" : "s"} in this file
                  already exist in your library. How would you like to handle
                  them?
                </p>

                <div className="space-y-2">
                  <button
                    onClick={() => {
                      const data = importDupePrompt;
                      setImportDupePrompt(null);
                      const filtered = data.parsed.filter(
                        (_, idx) => !data.duplicateIndices.has(idx),
                      );
                      if (filtered.length === 0) {
                        setImportLastResult({
                          success: 0,
                          failed: 0,
                          aiSortFailures: 0,
                          skipped:
                            data.issues.length +
                            data.duplicateIndices.size,
                          cancelled: false,
                        });
                        setImportStatus({
                          state: "done",
                          message: `Skipped ${data.duplicateIndices.size} duplicate${data.duplicateIndices.size === 1 ? "" : "s"}. Nothing new to import.`,
                        });
                        setTimeout(
                          () => setImportStatus({ state: "idle" }),
                          5000,
                        );
                        return;
                      }
                      runImportPipeline(
                        filtered,
                        data.issues,
                        data.wasZakarExport,
                      );
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/15 hover:bg-[#d2e8d5]/60 dark:hover:bg-[#2d5a44]/25 transition-all"
                  >
                    <p className="text-sm font-bold zk-text-primary-brand">
                      Skip duplicates (recommended)
                    </p>
                    <p className="text-[11px] zk-text-faint mt-0.5">
                      Import only the{" "}
                      {importDupePrompt.parsed.length -
                        importDupePrompt.duplicateIndices.size}{" "}
                      new note
                      {importDupePrompt.parsed.length -
                        importDupePrompt.duplicateIndices.size ===
                      1
                        ? ""
                        : "s"}
                    </p>
                  </button>

                  <button
                    onClick={() => {
                      const data = importDupePrompt;
                      setImportDupePrompt(null);
                      runImportPipeline(
                        data.parsed,
                        data.issues,
                        data.wasZakarExport,
                      );
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl bg-[#f4f7f2] dark:bg-[#282929] hover:bg-[#eaf0e8] dark:hover:bg-[#28292c] border zk-border-color transition-all"
                  >
                    <p className="text-sm font-bold zk-text">
                      Import everything anyway
                    </p>
                    <p className="text-[11px] zk-text-faint mt-0.5">
                      Creates duplicate copies of matching notes
                    </p>
                  </button>

                  <button
                    onClick={() => {
                      setImportDupePrompt(null);
                      setImportStatus({ state: "idle" });
                    }}
                    className="w-full px-4 py-3 rounded-xl text-sm font-medium zk-text-muted hover:zk-text transition-colors"
                  >
                    Cancel import
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {isDeleteConfirmOpen && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-md zk-surface-raised rounded-[28px] shadow-2xl p-8 text-center border zk-border-color dark:zk-border-color"
              >
                <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 rounded-3xl flex items-center justify-center mx-auto mb-6">
                  <AlertTriangle className="w-10 h-10 text-rose-500" />
                </div>
                <h3 className="text-2xl font-bold zk-text dark:zk-text mb-2">
                  Delete zakar Account?
                </h3>
                <p className="zk-text-muted dark:zk-text-muted mb-8">
                  This will permanently delete your profile and{" "}
                  <span className="font-bold text-rose-500">
                    all your notes
                  </span>
                  . This action cannot be undone.
                </p>

                <div className="mb-8 text-left space-y-6">
                  <div className="p-4 zk-surface-muted dark:bg-[#28292c]/50 rounded-2xl border zk-border-color dark:zk-border-color">
                    <p className="text-xs font-bold zk-text-faint dark:zk-text-muted uppercase tracking-widest mb-2">
                      1. Confirm your name:
                    </p>
                    <p className="text-lg font-bold zk-text dark:zk-text mb-3 italic">
                      "{user?.displayName}"
                    </p>
                    <input
                      type="text"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      placeholder="Type your name here"
                      disabled={isIdentityVerified || isDeletingAccount}
                      className="w-full px-4 py-3 zk-surface-raised border-2 zk-border-color dark:zk-border-strong rounded-xl focus:border-rose-500 outline-none transition-all dark:zk-text disabled:opacity-50"
                    />
                  </div>

                  <div className="p-4 zk-surface-muted dark:bg-[#28292c]/50 rounded-2xl border zk-border-color dark:zk-border-color">
                    <p className="text-xs font-bold zk-text-faint dark:zk-text-muted uppercase tracking-widest mb-3">
                      2. Verify SSO Identity:
                    </p>
                    {isIdentityVerified ? (
                      <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl border border-emerald-100 dark:border-emerald-800 font-bold text-sm">
                        <CheckCircle2 className="w-5 h-5" />
                        Identity Verified with Google
                      </div>
                    ) : (
                      <button
                        onClick={handleVerifyForDeletion}
                        disabled={
                          deleteConfirmName !== user?.displayName ||
                          isReauthenticating
                        }
                        className="w-full py-3 px-4 bg-white dark:zk-surface-muted zk-text dark:zk-text rounded-xl font-bold flex items-center justify-center gap-3 border zk-border-color dark:zk-border-strong hover:zk-surface-muted dark:hover:bg-[#2e3632] transition-all active:scale-95 shadow-sm disabled:opacity-50 disabled:grayscale"
                      >
                        {isReauthenticating ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <img
                            src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png"
                            className="w-5 h-5"
                            alt=""
                            referrerPolicy="no-referrer"
                          />
                        )}
                        {isReauthenticating
                          ? "Authenticating..."
                          : "Verify with Google"}
                      </button>
                    )}
                  </div>
                </div>

                {deleteAccountError && (
                  <div className="mb-6 p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-2xl border border-rose-100 dark:border-rose-800">
                    {deleteAccountError}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isDeletingAccount || !isIdentityVerified}
                    className="w-full py-4 bg-rose-500 text-white font-bold rounded-2xl hover:bg-rose-600 shadow-lg shadow-rose-200 dark:shadow-none transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:grayscale"
                  >
                    {isDeletingAccount ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Yes, Delete Everything"
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setIsDeleteConfirmOpen(false);
                      setDeleteAccountError(null);
                      setDeleteConfirmName("");
                      setIsIdentityVerified(false);
                    }}
                    disabled={isDeletingAccount}
                    className="w-full py-4 zk-surface-muted dark:zk-surface-muted zk-text-secondary dark:zk-text-muted font-bold rounded-2xl hover:zk-surface-sunken dark:hover:bg-[#2e3632] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}

          {noteToDelete && null}

          {/* Floating Action Button — shows on mobile always, on desktop when capture bar scrolls out */}
          {!showCaptureModal &&
            !selectedNote &&
            activeCategory !== "Trash" &&
            activeCategory !== "Archive" && (
              <>
                {/* Mobile — always visible */}
                <motion.button
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  onClick={() => setShowCaptureModal(true)}
                  className="sm:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center text-white dark:text-[#1a2520] transition-all active:scale-95 zk-fab"
                  title="Capture a thought"
                >
                  <Plus className="w-6 h-6" strokeWidth={2.5} />
                </motion.button>

                {/* Desktop — only when capture bar is out of view */}
                <AnimatePresence>
                  {!captureBarVisible && (
                    <motion.button
                      initial={{ scale: 0.9, opacity: 0, y: 20 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.9, opacity: 0, y: 20 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 25,
                      }}
                      onClick={() => setShowCaptureModal(true)}
                      className="hidden sm:flex fixed bottom-8 right-8 z-40 w-14 h-14 rounded-full items-center justify-center text-white dark:text-[#1a2520] transition-all hover:scale-105 active:scale-95 zk-fab"
                      title="Capture a thought"
                    >
                      <Plus className="w-6 h-6" strokeWidth={2.5} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </>
            )}

          {/* Trash undo snackbar */}
          <AnimatePresence>
            {trashedToast && (
              <motion.div
                initial={{ opacity: 0, y: 20, x: 0 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-6 left-6 z-[80] flex items-center gap-3 px-5 py-3.5 bg-[#2e3431] dark:zk-surface-muted text-white rounded-2xl shadow-2xl shadow-black/20"
                style={{
                  fontFamily: "var(--font-sans)",
                  maxWidth: "400px",
                }}
              >
                <Trash2 className="w-4 h-4 zk-text-faint flex-shrink-0" />
                <span className="text-sm font-medium truncate">
                  Note trashed
                </span>
                <button
                  onClick={undoTrash}
                  className="text-sm font-bold text-[#8fb89a] hover:text-[#d2e8d5] transition-colors flex-shrink-0 ml-2"
                >
                  Undo
                </button>
                <button
                  onClick={dismissTrashToast}
                  className="p-1 text-[#5a6660] hover:text-white transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generic action toast (archive / pin / star with undo) */}
          <AnimatePresence>
            {actionToast && (
              <motion.div
                key={actionToast.noteId + actionToast.action}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-6 left-6 z-[80] flex items-center gap-3 px-5 py-3.5 bg-[#2e3431] dark:zk-surface-muted text-white rounded-2xl shadow-2xl shadow-black/20"
                style={{
                  fontFamily: "var(--font-sans)",
                  maxWidth: "400px",
                }}
              >
                {actionToast.action === "archived" ||
                actionToast.action === "unarchived" ? (
                  <Archive className="w-4 h-4 zk-text-faint flex-shrink-0" />
                ) : actionToast.action === "pinned" ||
                  actionToast.action === "unpinned" ? (
                  <Pin className="w-4 h-4 zk-text-faint flex-shrink-0" />
                ) : actionToast.action === "starred" ? (
                  /* When the user JUST starred a note, show a filled
                     amber star — same color the star turns inside the
                     note card. The unstarred toast keeps the neutral
                     outline so the visual matches the new state. */
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400 flex-shrink-0" />
                ) : (
                  <Star className="w-4 h-4 zk-text-faint flex-shrink-0" />
                )}
                <span className="text-sm font-medium truncate">
                  {actionToast.action === "archived" && "Note archived"}
                  {actionToast.action === "unarchived" && "Note unarchived"}
                  {actionToast.action === "pinned" && "Note pinned"}
                  {actionToast.action === "unpinned" && "Note unpinned"}
                  {actionToast.action === "starred" && "Note starred"}
                  {actionToast.action === "unstarred" && "Note unstarred"}
                </span>
                <button
                  onClick={undoActionToast}
                  className="text-sm font-bold text-[#8fb89a] hover:text-[#d2e8d5] transition-colors flex-shrink-0 ml-2"
                >
                  Undo
                </button>
                <button
                  onClick={dismissActionToast}
                  className="p-1 text-[#5a6660] hover:text-white transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Import progress toast — slim single-line design. Survives
              Settings modal close. Bottom-left to match the trash/archive
              toast system. Two-phase aware:
                parsing  → "Reading file…" with indeterminate stripe
                importing → "Importing X of Y" with progress bar (fast)
                sorting  → "Sorting X of Y with AI" with progress bar (slow) */}
          <AnimatePresence>
            {(importStatus.state === "parsing" ||
              importStatus.state === "importing" ||
              importStatus.state === "sorting") && (
              <motion.div
                key="import-progress-toast"
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="fixed bottom-6 left-6 z-[80] bg-[#2e3431] dark:zk-surface-muted text-white rounded-xl shadow-xl shadow-black/20 overflow-hidden"
                style={{
                  fontFamily: "var(--font-sans)",
                  width: "300px",
                }}
              >
                <div className="px-4 py-3 flex items-center gap-3">
                  {importStatus.state === "sorting" ? (
                    <Sparkles className="w-4 h-4 text-[#a8c9ac] flex-shrink-0 animate-pulse" />
                  ) : (
                    <Upload className="w-4 h-4 text-[#a8c9ac] flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm font-bold truncate">
                      {importStatus.state === "parsing"
                        ? "Reading file…"
                        : importStatus.state === "sorting"
                          ? "Sorting with AI"
                          : "Importing notes"}
                    </span>
                    {/* Counter visibility rule: always show during the
                        "importing" (raw save) phase since it moves fast and
                        feels responsive. During the "sorting" phase, only
                        show when there are >3 notes — for 1-3 notes the
                        counter sits at the same value for 3 seconds per
                        note, which feels frozen rather than informative. */}
                    {importStatus.progress &&
                      (importStatus.state !== "sorting" ||
                        importStatus.progress.total > 3) && (
                        <span className="text-[11px] text-[#a8c9ac] flex-shrink-0">
                          {importStatus.progress.current}/
                          {importStatus.progress.total}
                        </span>
                      )}
                  </div>
                  {/* Same rule for the percentage indicator on the right */}
                  {importStatus.progress &&
                    (importStatus.state !== "sorting" ||
                      importStatus.progress.total > 3) && (
                      <span className="text-xs font-bold text-[#a8c9ac] flex-shrink-0 tabular-nums">
                        {Math.round(
                          (importStatus.progress.current /
                            Math.max(importStatus.progress.total, 1)) *
                            100,
                        )}
                        %
                      </span>
                    )}
                  {/* Cancel button — flips importCancelRef so the loop exits
                      between iterations. The current in-flight magicSort
                      call still completes, but no new ones start. */}
                  {(importStatus.state === "importing" ||
                    importStatus.state === "sorting") && (
                    <button
                      onClick={cancelImport}
                      className="flex-shrink-0 -mr-1 p-1 rounded-md text-[#a8c9ac] hover:text-white hover:bg-white/10 transition-colors"
                      title="Cancel import"
                      aria-label="Cancel import"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Progress bar */}
                <div className="h-[3px] bg-white/10 relative overflow-hidden">
                  {/* Show the indeterminate stripe whenever determinate
                      progress would be uninformative: while parsing (no
                      total yet), or while sorting a tiny batch (≤3 notes)
                      where the stepped bar barely moves. */}
                  {importStatus.state === "parsing" ||
                  (importStatus.state === "sorting" &&
                    importStatus.progress &&
                    importStatus.progress.total <= 3) ? (
                    <motion.div
                      className="absolute top-0 left-0 h-full w-1/3 bg-[#8fb89a]"
                      animate={{ x: ["-100%", "300%"] }}
                      transition={{
                        duration: 1.4,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                  ) : (
                    importStatus.progress && (
                      <motion.div
                        className="absolute top-0 left-0 h-full bg-[#8fb89a]"
                        animate={{
                          width: `${
                            (importStatus.progress.current /
                              Math.max(importStatus.progress.total, 1)) *
                            100
                          }%`,
                        }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                      />
                    )
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Permanent delete confirmation */}
          <AnimatePresence>
            {confirmPermanentDelete && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-[#2e3431] dark:zk-surface-muted rounded-2xl shadow-2xl shadow-black/20 px-6 py-4 flex items-center gap-6"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                <span className="text-sm text-white font-medium">
                  {confirmPermanentDelete.type === "empty"
                    ? "Empty trash?"
                    : "Delete forever?"}
                </span>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setConfirmPermanentDelete(null)}
                    className="text-sm text-[#7a8a82] hover:text-white font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (confirmPermanentDelete.type === "empty") {
                        emptyTrash();
                      } else if (confirmPermanentDelete.id) {
                        permanentlyDeleteNote(confirmPermanentDelete.id);
                        if (selectedNote?.id === confirmPermanentDelete.id)
                          setSelectedNote(null);
                      }
                      setConfirmPermanentDelete(null);
                    }}
                    className="text-sm text-[#8fb89a] hover:text-white font-bold transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {selectedNote && (
            <>
              {/* Floating brand logo top-left — since the sidebar is
                  hidden while a note is open, this preserves brand
                  presence in the corner. Click does nothing (just
                  visual identity), but the user can press Escape or
                  click outside the card to return to the notes list. */}
              <div
                key="note-floating-logo"
                className="fixed top-4 left-6 z-[60] flex items-center gap-1 pointer-events-none hidden lg:flex"
                aria-label="Zakar"
              >
                <img
                  src="/zakar-logo.svg"
                  alt=""
                  aria-hidden="true"
                  className="h-7 w-auto flex-shrink-0"
                />
                <h1
                  className="text-[22px] tracking-tight zk-text dark:zk-text leading-none -ml-0.5"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                  }}
                >
                  zakar
                </h1>
              </div>
              {/* In-main backdrop — covers the main column area from
                  just below the search bar down to the viewport bottom.
                  Uses the app surface color (#f4f7f2 / dark #202124).
                  CRITICAL: starts at top-16 (right below the search
                  bar) not at top-20 — this closes the gap that
                  previously showed the notes grid bleeding through
                  above the floating card. Click to close. */}
              <motion.div
                key="note-panel-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setSelectedNote(null);
                  setShowPasswordInput(false);
                  setIsResettingPassword(false);
                }}
                className={cn(
                  "fixed top-16 bottom-0 right-0 z-40 bg-[#f4f7f2] dark:bg-[#202124]",
                  "left-0",
                )}
              />
              {/* Panel wrapper — anchors the floating card to the
                  main column area with breathing room on all sides
                  per the mockup. Card itself sits centered with
                  max-w-4xl. */}
              <div
                key="note-panel-wrapper"
                onClick={() => {
                  // Click outside the card (in the margin area
                  // between the card and the column edges) closes
                  // the note. The inner card has its own
                  // stopPropagation so clicks INSIDE the card don't
                  // trigger this — only clicks in the empty padding
                  // area do.
                  setSelectedNote(null);
                  setShowPasswordInput(false);
                  setIsResettingPassword(false);
                }}
                className={cn(
                  "fixed bottom-6 right-0 z-50 flex items-stretch justify-center px-6 sm:px-10",
                  "top-20",
                  "left-0",
                )}
              >
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    // Floating centered card per the mockup: rounded
                    // corners, subtle shadow, max-width so it doesn't
                    // span the full main column width, generous
                    // breathing room around it via the wrapper padding.
                    // h-full fills the wrapper's height (which is
                    // calc-style from top-20 to bottom-6).
                    "zk-note-card relative w-full max-w-4xl rounded-2xl shadow-xl flex flex-col h-full",
                    noteColorClass(selectedNote.backgroundColor),
                  )}
                >
                {/* Mood band — colored stripe down the left edge.
                    Communicates note category at a glance: sage for
                    tasks, lavender for personal, peach for reminders,
                    blue for web content, etc. Runs nearly edge-to-edge
                    (4px inset top/bottom) to clear the modal's rounded
                    corners cleanly. Width 4px reads as a clear
                    architectural element rather than a thin hairline.
                    Rounded ends keep it sitting flush against the
                    modal's curve.

                    Hidden entirely when the user has picked a custom
                    background color: that color IS the identity signal,
                    and adding a competing band reads as visual noise.
                    Only the default (uncolored) note shows the band. */}
                {(!selectedNote.backgroundColor ||
                  selectedNote.backgroundColor === "default") && (
                  <div
                    aria-hidden="true"
                    className="absolute left-0 w-[4px] pointer-events-none z-[1] rounded-r-sm"
                    style={{
                      ...getMoodBandStyle(selectedNote.category),
                      top: "4px",
                      bottom: "4px",
                    }}
                  />
                )}
                {showPasswordInput ? (
                  // Compute the active lock method once. Older notes
                  // that pre-date the new flow may be missing
                  // `lockMethod`; default based on provider — Google
                  // users get biometric (with Google re-auth
                  // fallback), email users get account-password.
                  (() => {
                    const lockedOut =
                      !!selectedNote.lockedUntil &&
                      getTimestampMillis(selectedNote.lockedUntil) >
                        currentTime;
                    const method = extractLockMethod(selectedNote);
                    const showPasswordField = method === "account-password";
                    const Icon = lockedOut ? Lock : method === "biometric" ? Fingerprint : Key;
                    const iconColor = lockedOut
                      ? "text-rose-600 dark:text-rose-400 animate-bounce"
                      : "text-emerald-600 dark:text-emerald-400";
                    // Pulse the icon when this is the biometric
                    // unlock prompt — it cues the user to tap their
                    // sensor / Windows Hello popover. We don't
                    // pulse on lockout (already animated via
                    // animate-bounce) or on account-password (an
                    // input field is the actionable affordance).
                    const iconAnim =
                      !lockedOut && method === "biometric"
                        ? "zk-lock-pulse"
                        : "";
                    return (
                  <div className="flex-1 flex flex-col items-center justify-center p-10 space-y-8 text-center zk-surface-raised">
                    <div className="p-6 bg-emerald-50 dark:bg-emerald-900/20 rounded-full">
                      <Icon className={cn("w-12 h-12", iconColor, iconAnim)} />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-2xl font-bold zk-text dark:zk-text">
                        {lockedOut
                          ? "Note Temporarily Locked"
                          : method === "biometric"
                            ? "Unlock with biometrics"
                            : "Account password required"}
                      </h3>
                      <p className="zk-text-muted dark:zk-text-muted max-w-xs mx-auto">
                        {lockedOut ? (
                          <>
                            Too many failed attempts. Please try again in{" "}
                            <span className="font-bold text-rose-500">
                              {formatLockoutTime(
                                getTimestampMillis(selectedNote.lockedUntil!) -
                                  currentTime,
                              )}
                            </span>
                            .
                          </>
                        ) : method === "biometric" ? (
                          "Use Touch ID, Face ID, or your device password to view this note."
                        ) : (
                          "Enter your Zakar account password to view this note."
                        )}
                      </p>
                    </div>
                    <div className="w-full max-w-sm space-y-4">
                      {!lockedOut && showPasswordField && (
                        <div className="relative">
                          <input
                            type="password"
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            placeholder="Account password..."
                            className="w-full px-6 py-4 zk-surface-muted dark:zk-surface-muted border-2 zk-border-color dark:zk-border-strong rounded-2xl text-lg focus:outline-none focus:border-[#2d5a44] dark:focus:border-[#6b8f72] transition-all text-center"
                            autoFocus
                            onKeyDown={(e) =>
                              e.key === "Enter" && handleVerifyPassword()
                            }
                          />
                        </div>
                      )}
                      {passwordError && (
                        <p className="text-sm font-bold text-rose-500 animate-shake">
                          {passwordError}
                        </p>
                      )}
                      <div className="flex gap-4">
                        <button
                          onClick={() => setSelectedNote(null)}
                          className="flex-1 py-4 zk-surface-muted dark:zk-surface-muted zk-text-secondary dark:zk-text-muted font-bold rounded-2xl hover:zk-surface-sunken dark:hover:bg-[#2e3632] transition-all"
                        >
                          Cancel
                        </button>
                        {!lockedOut && (
                          <button
                            onClick={handleVerifyPassword}
                            disabled={isVerifyingPassword}
                            className="flex-1 py-4 zk-bg-primary text-white font-bold rounded-2xl hover:bg-[#435749] shadow-lg shadow-[#2d5a44]/15 dark:shadow-none transition-all flex items-center justify-center gap-2"
                          >
                            {isVerifyingPassword ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : method === "biometric" ? (
                              <>
                                <Fingerprint className="w-4 h-4" />
                                Use biometrics
                              </>
                            ) : (
                              "Unlock Note"
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedNote(null);
                        setShowPasswordInput(false);
                      }}
                      className="absolute top-6 right-6 p-2 zk-text-faint hover:zk-text dark:hover:text-white hover:zk-surface-muted dark:hover:zk-surface-muted rounded-xl transition-all"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                    );
                  })()
                ) : isResettingPassword ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-10 space-y-8 text-center zk-surface-raised">
                    <div className="p-6 bg-emerald-50 dark:bg-emerald-900/20 rounded-full">
                      <ShieldCheck className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="space-y-3">
                      <h3 className="text-2xl font-bold zk-text dark:zk-text">
                        Reset Password
                      </h3>
                      <p className="zk-text-muted dark:zk-text-muted max-w-xs mx-auto">
                        Authentication successful. Please set a new password for
                        this note.
                      </p>
                    </div>
                    <div className="w-full max-w-sm space-y-4">
                      <input
                        type="password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="New password..."
                        className="w-full px-6 py-4 zk-surface-muted dark:zk-surface-muted border-2 zk-border-color dark:zk-border-strong rounded-2xl text-lg focus:outline-none focus:border-[#2d5a44] dark:focus:border-[#6b8f72] transition-all text-center"
                        autoFocus
                      />
                      <button
                        onClick={handleConfirmReset}
                        disabled={!passwordInput || isResettingPasswordConfirm}
                        className="w-full py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 shadow-lg shadow-emerald-200 dark:shadow-none transition-all flex items-center justify-center gap-2"
                      >
                        {isResettingPasswordConfirm ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          "Set New Password"
                        )}
                      </button>
                      <button
                        onClick={() => setIsResettingPassword(false)}
                        className="text-xs font-bold zk-text-faint hover:zk-text-secondary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedNote(null);
                        setIsResettingPassword(false);
                      }}
                      className="absolute top-6 right-6 p-2 zk-text-faint hover:zk-text dark:hover:text-white hover:zk-surface-muted dark:hover:zk-surface-muted rounded-xl transition-all"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Modal Header - Editorial Style */}
                    <div
                      className="flex items-center justify-between px-6 sm:px-10 py-4 relative z-20"
                      style={{
                        borderBottom: "1px solid rgba(171,180,175,0.12)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {/* "Back to answer" — only shown when this note was
                            opened from clicking a source in Ask. Closing
                            the note via this button (or the X) flips the
                            preview flag and re-shows the Ask modal at the
                            answer the user was reading. */}
                        {askPreviewingSource && (
                          <button
                            onClick={() => {
                              setSelectedNote(null);
                              // askPreviewingSource resets via the effect
                              // that watches selectedNote going null.
                            }}
                            className="flex items-center gap-1.5 -ml-2 mr-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-[0.12em] zk-text-primary-brand bg-[#d2e8d5]/40 hover:bg-[#d2e8d5]/70 dark:bg-[#2d5a44]/15 dark:hover:bg-[#2d5a44]/25 transition-all active:scale-95"
                            style={{ fontFamily: "var(--font-sans)" }}
                            title="Back to your Ask answer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            Back to answer
                          </button>
                        )}
                        {noteNavStack.length > 0 && (
                          <button
                            onClick={() => {
                              const stack = [...noteNavStack];
                              const previous = stack.pop();
                              if (previous) {
                                setNoteNavStack(stack);
                                setSelectedNote(previous);
                                setIsEditing(false);
                              }
                            }}
                            className="flex items-center gap-1.5 -ml-2 mr-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-[0.12em] zk-text-secondary dark:zk-text-muted hover:zk-text dark:hover:zk-text bg-transparent hover:bg-[#eaf0e8] dark:hover:bg-white/[0.05] transition-all active:scale-95"
                            style={{ fontFamily: "var(--font-sans)" }}
                            title="Back to previous note"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            Back
                          </button>
                        )}
                        {/* Category removed from top strip per user
                            request — felt like noise in the chrome
                            line. Still rendered in the body meta-pill
                            below the title where it has visual context
                            (sits next to reading-time, todo counts).
                            The top strip now shows only meaningful
                            status changes (Enhancing / Sorted) plus
                            an EDITING badge when in edit mode. */}
                        {isEditing && (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#eaf0e8] dark:bg-[#2d5a44]/30 text-[#1f4534] dark:text-[#a8d0b0] text-[9px] font-bold uppercase tracking-[0.15em]"
                            style={{ fontFamily: "var(--font-sans)" }}
                          >
                            <Edit2 className="w-3 h-3" strokeWidth={2.25} />
                            Editing
                          </span>
                        )}
                        {(selectedNote.status === "processing" ||
                          processingNotes.has(selectedNote.id)) && (
                          <span
                            className="text-[9px] font-bold text-[#6b8f72] uppercase tracking-[0.15em] flex items-center gap-1.5"
                            style={{ fontFamily: "var(--font-sans)" }}
                          >
                            <div className="w-2 h-2 rounded-full bg-[#6b8f72] animate-pulse" />
                            Enhancing
                          </span>
                        )}
                        {selectedNote.isAutoSorted &&
                          selectedNote.status !== "processing" &&
                          !processingNotes.has(selectedNote.id) && (
                            <span
                              className="text-[9px] font-bold text-[#6b8f72] uppercase tracking-[0.15em] flex items-center gap-1"
                              style={{ fontFamily: "var(--font-sans)" }}
                            >
                              <Sparkles className="w-3 h-3" />
                              Sorted
                            </span>
                          )}
                      </div>
                      {/* Action row. Uses flex-wrap on narrow screens so
                          all actions stay reachable without cutting off
                          and without using overflow-clipping (which would
                          hide absolute-positioned popovers like the
                          color picker, share menu, and more menu). On
                          desktop the buttons fit on one line naturally. */}
                      <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap justify-end">
                        {/* Save state indicator — single source of
                            truth in the modal. Three states:
                              1. Saving: sage spinner + "Saving" label
                                 while the ~2s debounce-then-write
                                 window is in flight
                              2. Saved (transient): emerald check +
                                 "Changes saved" for 1.8s after the
                                 save completes, so the user sees
                                 confirmation before it vanishes
                              3. Idle: nothing rendered
                            The previous duplicates (inline at the
                            character counter, and in the footer bar)
                            were removed — three places showing the
                            same state was visual noise. */}
                        {!selectedNote.isTrashed && isAutoSaving && (
                          <span
                            className="hidden sm:inline-flex items-center gap-1.5 mr-1 text-[10px] font-bold uppercase tracking-[0.12em] zk-text-primary-brand transition-opacity duration-300"
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, monospace",
                            }}
                            title="Saving your changes…"
                          >
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Saving
                          </span>
                        )}
                        {!selectedNote.isTrashed &&
                          !isAutoSaving &&
                          showSavedFlash && (
                            <span
                              className="hidden sm:inline-flex items-center gap-1.5 mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400 transition-opacity duration-300"
                              style={{
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                              }}
                              title="All changes saved"
                            >
                              <Check className="w-3 h-3" strokeWidth={2.5} />
                              Changes saved
                            </span>
                          )}
                        {!isEditing && !selectedNote.isTrashed && (
                          <button
                            onClick={() => togglePin(selectedNote)}
                            className={cn(
                              "p-1.5 rounded-lg transition-all active:scale-[0.85] active:shadow-[0_0_0_3px_rgba(45,90,68,0.25)]",
                              selectedNote.isPinned
                                ? "zk-text-primary-brand bg-[#d2e8d5]/40 dark:bg-[#2d5a44]/40 dark:zk-text-primary-brand hover:bg-[#d2e8d5]/60 dark:hover:bg-[#2d5a44]/55 hover:scale-110"
                                : "zk-toolbar-icon",
                            )}
                            title={selectedNote.isPinned ? "Unpin" : "Pin"}
                          >
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill={
                                selectedNote.isPinned ? "currentColor" : "none"
                              }
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M12 17v5" />
                              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                            </svg>
                          </button>
                        )}
                        {!isEditing && !selectedNote.isTrashed && (
                          <div className="relative" ref={colorPickerRef}>
                            <button
                              onClick={() => setIsColorPickerOpen((v) => !v)}
                              className={cn(
                                "p-1.5 rounded-lg transition-all active:scale-[0.85] active:shadow-[0_0_0_3px_rgba(45,90,68,0.25)] zk-toolbar-icon",
                              )}
                              title="Change color"
                              aria-label="Change note color"
                            >
                              <Palette className="w-[18px] h-[18px]" />
                            </button>
                            <AnimatePresence>
                              {isColorPickerOpen && (
                                <motion.div
                                  initial={{
                                    opacity: 0,
                                    y: -4,
                                    scale: 0.96,
                                  }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                                  transition={{ duration: 0.15 }}
                                  className="absolute right-0 top-full mt-2 z-[70] bg-white dark:bg-[#282929] rounded-2xl border border-[#dde5da] dark:border-white/[0.10] shadow-2xl p-3 w-[260px]"
                                >
                                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] zk-text-faint dark:zk-text-muted mb-2 px-1">
                                    Note color
                                  </p>
                                  <div className="grid grid-cols-5 gap-2">
                                    {NOTE_COLOR_TOKENS.map((tok) => {
                                      const isActive =
                                        (selectedNote.backgroundColor ||
                                          "default") === tok.key;
                                      const isDefault = tok.key === "default";
                                      return (
                                        <button
                                          key={tok.key}
                                          onClick={async () => {
                                            try {
                                              await updateDoc(
                                                doc(
                                                  db,
                                                  "notes",
                                                  selectedNote.id,
                                                ),
                                                {
                                                  backgroundColor: tok.key,
                                                  updatedAt: Timestamp.now(),
                                                },
                                              );
                                              setSelectedNote((prev) =>
                                                prev
                                                  ? {
                                                      ...prev,
                                                      backgroundColor: tok.key,
                                                    }
                                                  : prev,
                                              );
                                            } catch (err) {
                                              handleFirestoreError(
                                                err,
                                                OperationType.UPDATE,
                                                `notes/${selectedNote.id}`,
                                              );
                                            }
                                            setIsColorPickerOpen(false);
                                          }}
                                          className={cn(
                                            "relative aspect-square rounded-full transition-all active:scale-90",
                                            isActive
                                              ? "ring-2 ring-[#2d5a44] ring-offset-2 ring-offset-white dark:ring-offset-[#2d2e31]"
                                              : "hover:scale-110 hover:ring-2 hover:ring-offset-2 hover:ring-[#2d5a44] hover:ring-offset-white dark:hover:ring-offset-[#2d2e31] dark:hover:ring-[#a8c9ac]",
                                          )}
                                          style={
                                            isDefault
                                              ? {
                                                  border: "1.5px solid #cfd4cf",
                                                  background:
                                                    "linear-gradient(135deg, #fff 50%, #f4f7f2 50%)",
                                                }
                                              : { backgroundColor: tok.swatch }
                                          }
                                          title={tok.label}
                                          aria-label={tok.label}
                                        >
                                          {isDefault && (
                                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold zk-text-faint">
                                              ∅
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                        {/* Lock and Copy moved to the ⋯ overflow menu
                            below — see "Action overflow menu" block. */}
                        {selectedNote.isAutoSorted && !isEditing && (
                          <button
                            onClick={() => setShowRaw(!showRaw)}
                            className={cn(
                              "px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                              showRaw
                                ? "zk-bg-primary text-white"
                                : "zk-surface-muted dark:zk-surface-muted zk-text-faint dark:zk-text-muted hover:zk-surface-sunken dark:hover:bg-[#2e3632]",
                            )}
                          >
                            {showRaw ? "View Sorted" : "View Original"}
                          </button>
                        )}

                        {!isEditing && !selectedNote.isTrashed && (
                          <div className="relative" ref={shareDropdownRef}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsSharing(!isSharing);
                              }}
                              className={cn(
                                "p-1.5 rounded-lg transition-all active:scale-[0.85] active:shadow-[0_0_0_3px_rgba(45,90,68,0.25)]",
                                selectedNote.isPublic
                                  ? "zk-text-primary-brand bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/15 hover:scale-110"
                                  : "zk-toolbar-icon",
                              )}
                              title="Share note"
                            >
                              <Share2 className="w-5 h-5" />
                            </button>

                            {isSharing && (
                              <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                className="absolute right-0 top-full mt-2 w-64 zk-surface-raised rounded-2xl shadow-xl border zk-border-color dark:zk-border-color p-4 z-[60]"
                              >
                                <div className="flex items-center justify-between mb-3">
                                  <span className="text-xs font-bold zk-text dark:zk-text uppercase tracking-wider">
                                    Public Link
                                  </span>
                                  <button
                                    onClick={() => toggleShare(selectedNote)}
                                    className={cn(
                                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
                                      selectedNote.isPublic
                                        ? "zk-bg-primary"
                                        : "zk-surface-sunken dark:zk-surface-sunken",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "inline-block h-3 w-3 transform rounded-full zk-surface-raised transition-transform",
                                        selectedNote.isPublic
                                          ? "translate-x-5"
                                          : "translate-x-1",
                                      )}
                                    />
                                  </button>
                                </div>

                                {selectedNote.isPublic ? (
                                  <div className="space-y-3">
                                    <div className="p-2 zk-surface-muted dark:zk-surface-muted rounded-xl border zk-border-color dark:zk-border-strong flex items-center gap-2 overflow-hidden">
                                      <ExternalLink className="w-3 h-3 zk-text-faint shrink-0" />
                                      <span className="text-[10px] zk-text-muted dark:zk-text-muted truncate select-all">
                                        {window.location.origin}
                                        {window.location.pathname}?share=
                                        {selectedNote.id}
                                      </span>
                                    </div>
                                    <button
                                      onClick={() =>
                                        handleCopyShareLink(selectedNote.id)
                                      }
                                      className="w-full py-2.5 zk-bg-primary text-white rounded-xl text-xs font-bold hover:bg-[#435749] transition-all flex items-center justify-center gap-2"
                                    >
                                      {shareCopied ? (
                                        <Check className="w-4 h-4" />
                                      ) : (
                                        <Copy className="w-4 h-4" />
                                      )}
                                      {shareCopied ? "Copied!" : "Copy Link"}
                                    </button>
                                    {/* Social share */}
                                    <div className="flex items-center justify-center gap-3 pt-1">
                                      {[
                                        {
                                          label: "X",
                                          url: `https://x.com/intent/tweet?url=${encodeURIComponent(`${window.location.origin}${window.location.pathname}?share=${selectedNote.id}`)}&text=${encodeURIComponent(selectedNote.title)}`,
                                          svg: (
                                            <svg
                                              viewBox="0 0 24 24"
                                              className="w-3.5 h-3.5"
                                              fill="currentColor"
                                              aria-hidden="true"
                                            >
                                              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                            </svg>
                                          ),
                                          // X uses near-black on light, near-white on dark
                                          colorClass:
                                            "bg-black text-white dark:bg-white dark:text-black",
                                        },
                                        {
                                          label: "WhatsApp",
                                          url: `https://wa.me/?text=${encodeURIComponent(`${selectedNote.title} ${window.location.origin}${window.location.pathname}?share=${selectedNote.id}`)}`,
                                          svg: (
                                            <svg
                                              viewBox="0 0 24 24"
                                              className="w-4 h-4"
                                              fill="currentColor"
                                              aria-hidden="true"
                                            >
                                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.885 3.488" />
                                            </svg>
                                          ),
                                          // WhatsApp brand green
                                          colorClass: "bg-[#25D366] text-white",
                                        },
                                        {
                                          label: "Gmail",
                                          url: `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(selectedNote.title)}&body=${encodeURIComponent(`Check out this note on zakar:\n\n${window.location.origin}${window.location.pathname}?share=${selectedNote.id}`)}`,
                                          svg: (
                                            // Authentic Gmail mark — full four-color M envelope.
                                            // Rendered as five overlapping paths so the colors
                                            // stack correctly: red+yellow form the side panels,
                                            // green forms the right edge, blue forms the top
                                            // strip, and the white M sits underneath.
                                            <svg
                                              viewBox="0 0 24 24"
                                              className="w-4 h-4"
                                              aria-hidden="true"
                                            >
                                              <path
                                                fill="#4285F4"
                                                d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
                                              />
                                              <path
                                                fill="#34A853"
                                                d="M5.455 21.003V11.73L1.636 8.83A1.636 1.636 0 0 0 0 10.466v8.9c0 .904.732 1.636 1.636 1.636h3.819z"
                                              />
                                              <path
                                                fill="#FBBC04"
                                                d="M18.545 21.003V11.73L24 7.616V5.457c0-2.023-2.309-3.178-3.927-1.964l-1.528 1.145z"
                                              />
                                              <path
                                                fill="#EA4335"
                                                d="M5.455 4.64L0 8.527v1.94c0-.605.273-1.157.732-1.527.46-.37 1.061-.523 1.636-.317.328.117.604.32.819.595L5.455 11.73z"
                                              />
                                              <path
                                                fill="#C5221F"
                                                d="M5.455 4.64v7.09L12 9.548 5.455 4.64z"
                                              />
                                            </svg>
                                          ),
                                          // White surface so the multi-color logo reads correctly
                                          colorClass:
                                            "bg-white border border-[#dadce0] dark:bg-white dark:border-transparent",
                                        },
                                      ].map((s) => (
                                        <a
                                          key={s.label}
                                          href={s.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className={cn(
                                            "w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95",
                                            s.colorClass,
                                          )}
                                          title={`Share on ${s.label}`}
                                          aria-label={`Share on ${s.label}`}
                                        >
                                          {s.svg}
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[10px] zk-text-faint dark:zk-text-muted leading-relaxed">
                                    Enable public sharing to generate a link
                                    that anyone can view.
                                  </p>
                                )}
                              </motion.div>
                            )}
                          </div>
                        )}
                        {/* Star and Archive moved to the ⋯ overflow
                            menu below. */}
                        {!isEditing && !selectedNote.isTrashed && (
                          <button
                            onClick={() => {
                              // Re-sync editContent from the latest content
                              // before entering edit mode. Critical for the
                              // edge case where AI sorting finished between
                              // openNote (which seeded editContent) and
                              // this click — without the resync, the user
                              // would edit pre-sort content and the save
                              // would overwrite the just-arrived sorted
                              // version.
                              setEditContent(selectedNote.content);
                              setEditTitle(selectedNote.title);
                              // Fresh edit session — no phantom changes
                              // from the editor's seed should auto-save.
                              hasEditorTypedRef.current = false;
                              setIsEditing(true);
                            }}
                            className="p-1.5 zk-toolbar-icon rounded-lg"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                        )}
                        {/* Secondary action buttons — moved back from
                            the ⋯ overflow menu per user request. Star,
                            Lock, Copy, Archive were collapsed earlier
                            because the row was wrapping; now that the
                            top strip no longer carries date/edited
                            (those moved to the bottom-right of the
                            note), the row has room. p-1.5 sizing keeps
                            each button compact. */}
                        {!isEditing && !selectedNote.isTrashed && (
                          <button
                            onClick={() => toggleStar(selectedNote)}
                            className={cn(
                              "p-1.5 rounded-lg transition-all active:scale-90",
                              selectedNote.isStarred
                                ? "text-amber-500 bg-amber-50 dark:bg-amber-900/30"
                                : "zk-toolbar-icon hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20",
                            )}
                            title={
                              selectedNote.isStarred ? "Unstar note" : "Star note"
                            }
                          >
                            <Star
                              className={cn(
                                "w-5 h-5",
                                selectedNote.isStarred && "fill-current",
                              )}
                            />
                          </button>
                        )}
                        {!isEditing && !selectedNote.isTrashed && (
                          <button
                            onClick={() => setIsPasswordModalOpen(true)}
                            className={cn(
                              "p-1.5 rounded-lg transition-all active:scale-90",
                              selectedNote.password
                                ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30"
                                : "zk-toolbar-icon hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30",
                            )}
                            title={
                              selectedNote.password
                                ? "Manage lock"
                                : "Lock note"
                            }
                          >
                            <Fingerprint
                              className={cn(
                                "w-5 h-5",
                                selectedNote.password && "zk-lock-pulse",
                              )}
                            />
                          </button>
                        )}
                        {!isEditing && (
                          <button
                            onClick={() => copyRichText(selectedNote.content)}
                            className="p-1.5 zk-toolbar-icon rounded-lg active:scale-90"
                            title={copied ? "Copied!" : "Copy content"}
                          >
                            {copied ? (
                              <Check className="w-5 h-5 text-emerald-500" />
                            ) : (
                              <Copy className="w-5 h-5" />
                            )}
                          </button>
                        )}
                        {!isEditing && !selectedNote.isTrashed && (
                          <button
                            onClick={() => toggleArchive(selectedNote)}
                            className={cn(
                              "p-1.5 rounded-lg transition-all active:scale-90",
                              selectedNote.isArchived
                                ? "zk-text-primary-brand bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/15"
                                : "zk-toolbar-icon",
                            )}
                            title={
                              selectedNote.isArchived ? "Unarchive" : "Archive"
                            }
                          >
                            {selectedNote.isArchived ? (
                              <ArchiveRestore className="w-5 h-5" />
                            ) : (
                              <Archive className="w-5 h-5" />
                            )}
                          </button>
                        )}
                        {selectedNote.isTrashed && (
                          <>
                            <button
                              onClick={() => {
                                restoreNote(selectedNote.id);
                                setSelectedNote(null);
                              }}
                              className="p-1.5 zk-text-faint hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                              title="Restore note"
                            >
                              <RotateCcw className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => {
                                setConfirmPermanentDelete({
                                  type: "single",
                                  id: selectedNote.id,
                                });
                              }}
                              className="p-1.5 zk-text-faint hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all"
                              title="Delete forever"
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setSelectedNote(null);
                            setShowPasswordInput(false);
                            setIsResettingPassword(false);
                          }}
                          className="p-1.5 zk-text-faint hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all active:scale-90"
                          title="Close (Esc)"
                          aria-label="Close note"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Trashed Note Banner */}
                    {selectedNote.isTrashed && (
                      <div className="mx-8 mt-4 p-4 zk-surface-muted dark:zk-surface-muted border zk-border-color dark:zk-border-strong rounded-2xl flex items-center gap-4">
                        <div className="p-2 bg-slate-400 dark:bg-slate-600 rounded-xl">
                          <Trash2 className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-bold zk-text-secondary dark:zk-text-secondary">
                            This note is in the trash
                          </p>
                          <p className="text-xs zk-text-muted dark:zk-text-muted">
                            It will be automatically deleted after 7 days.
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            restoreNote(selectedNote.id);
                            setSelectedNote(null);
                          }}
                          className="px-4 py-2 zk-bg-primary text-white text-xs font-bold rounded-xl hover:bg-[#435749] transition-all"
                        >
                          Restore
                        </button>
                      </div>
                    )}

                    {/* Modal Content — generous editorial canvas. Matches
                        the editor mockup's `padding: 72px 96px 100px`
                        on desktop, with proportionally tighter values
                        on smaller screens. The horizontal breathing
                        room is the single biggest contributor to the
                        "smoother" feel — it lets the serif title and
                        body text claim their natural width, the way
                        a printed page does. */}
                    <div className="flex-1 overflow-y-auto px-6 sm:px-14 lg:px-24 pt-10 sm:pt-14 lg:pt-16 pb-16 sm:pb-20 custom-scrollbar">
                      {!isEditing && (
                        <div className="mb-8">
                          {/* Title — editorial display, large and
                              dominant per the mockup. Fraunces serif at
                              weight 600, tight tracking. Scales up
                              significantly on larger viewports because
                              this is the visual anchor of the page. */}
                          <h1
                            className="zk-text dark:zk-text"
                            style={{
                              fontFamily: "var(--font-modal-title)",
                              fontSize: "clamp(26px, 4.5vw, 48px)",
                              fontWeight: 800,
                              letterSpacing: "-0.03em",
                              lineHeight: 1.1,
                              /* Prevent long unbreakable strings (URLs,
                                 hashes, slugs) from overflowing the
                                 modal width. `anywhere` allows mid-word
                                 breaks for the rare 80-character token;
                                 normal whitespace handling still wins
                                 when natural breaks exist. */
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              hyphens: "auto",
                            }}
                          >
                            {selectedNote.title}
                          </h1>

                          {/* Meta line — TASK pill + content metrics in
                              uppercase mono. Mirrors the mockup's
                              structure: a sage-tinted category pill
                              followed by reading time, todo total, and
                              completed count, separated by mono dots. */}
                          <div
                            className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-4 mb-9"
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, monospace",
                            }}
                          >
                            {selectedNote.category && (
                              <span
                                data-cat-badge
                                className={cn(
                                  "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-[0.12em]",
                                  getCategoryBadgeClass(selectedNote.category),
                                )}
                                style={{ fontFamily: "var(--font-sans)" }}
                              >
                                {selectedNote.category}
                              </span>
                            )}
                            <span className="text-[10px] uppercase tracking-[0.14em] zk-text-faint">
                              {estimateReadingTime(
                                selectedNote.content || "",
                              )}
                            </span>
                            {(() => {
                              // Inline IIFE — render todo counters from
                              // existing getTaskCounts helper. Only
                              // shown when the note actually has todos.
                              // We split "X todos · Y complete" so each
                              // metric reads as a discrete fact (matches
                              // the mockup's structure exactly), rather
                              // than the X/Y fraction we had before.
                              const hasTodos =
                                /[-*]\s*\[\s*\]|[-*]\s*\[x\]/i.test(
                                  selectedNote.content || "",
                                );
                              if (!hasTodos) return null;
                              const counts = getTaskCounts(
                                selectedNote.content || "",
                              );
                              if (!counts || counts.total === 0) return null;
                              return (
                                <>
                                  <span className="zk-text-faint opacity-50">
                                    ·
                                  </span>
                                  <span className="text-[10px] uppercase tracking-[0.14em] zk-text-faint">
                                    {counts.total} todos
                                  </span>
                                  {counts.completed > 0 && (
                                    <>
                                      <span className="zk-text-faint opacity-50">
                                        ·
                                      </span>
                                      <span className="text-[10px] uppercase tracking-[0.14em] zk-text-faint">
                                        {counts.completed} complete
                                      </span>
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          {/* Reminder badge in read mode — uses the
                              saved reminder on the note record if
                              present, otherwise parses the content
                              for "every Wednesday at 8am" / "tomorrow
                              at 5pm" etc. The fallback handles old
                              notes where the reminder was never
                              persisted to the dedicated field. */}
                          {(() => {
                            const r =
                              (selectedNote.reminder as Reminder | undefined) ||
                              parseReminder(selectedNote.content || "");
                            if (!r) return null;
                            return (
                              <div className="mt-4">
                                <ReminderBadge reminder={r} />
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {isEditing ? (
                        <div className="flex flex-col h-full space-y-4 pb-12">
                          <div className="flex-none">
                            {/* Title — borderless input styled like the
                                read-mode H1. Fraunces serif, large,
                                editable directly. No surrounding panel
                                or "Note Title" label per the editor
                                mockup; the title IS the title. */}
                            <textarea
                              ref={titleTextareaRef}
                              value={editTitle}
                              onChange={(e) => {
                                setEditTitle(e.target.value);
                                // Auto-resize: reset height first, then
                                // grow to scrollHeight. The reset
                                // guards against the textarea getting
                                // stuck at the previous (larger) height
                                // when the user deletes text.
                                const el = e.currentTarget;
                                el.style.height = "auto";
                                el.style.height = `${el.scrollHeight}px`;
                              }}
                              rows={1}
                              className="w-full bg-transparent border-0 outline-none zk-text dark:zk-text px-0 py-1 resize-none overflow-hidden block"
                              style={{
                                fontFamily: "var(--font-modal-title)",
                                fontSize: "clamp(26px, 4.5vw, 48px)",
                                fontWeight: 800,
                                letterSpacing: "-0.03em",
                                lineHeight: 1.1,
                              }}
                              placeholder="Untitled"
                            />
                            {/* Live reminder badge in edit mode. Parses
                                the current editContent on every
                                keystroke (parseReminder is cheap — a
                                regex pass over the markdown). When the
                                user changes "every Wednesday" to
                                "every Friday" or shifts a time, the
                                badge updates live. The saved reminder
                                on the note record only catches up at
                                the next auto-save (~2s debounce); the
                                live render here is faster and gives
                                immediate feedback that the change was
                                understood. Hidden when no reminder
                                language is detected. */}
                            {(() => {
                              const liveReminder = parseReminder(editContent);
                              if (!liveReminder) return null;
                              return (
                                <div className="mt-3">
                                  <ReminderBadge reminder={liveReminder} />
                                </div>
                              );
                            })()}
                          </div>
                          <div className="flex-1 flex flex-col">
                            <div className="flex items-center justify-end mb-2">
                              <div className="flex items-center gap-4">
                                {/* Inline "Saving..." indicator removed per
                                    user request — the single source of save
                                    state is now the header indicator above.
                                    Three places showing the same status felt
                                    redundant. */}
                                <p
                                  className={cn(
                                    "text-[10px] font-bold uppercase tracking-widest transition-colors duration-300",
                                    editContent.length >= 50000
                                      ? "text-rose-500"
                                      : "zk-text-faint dark:zk-text-muted",
                                  )}
                                >
                                  {editContent.length >= 50000
                                    ? "Limit exhausted"
                                    : `${(50000 - editContent.length).toLocaleString()} remaining`}
                                </p>
                              </div>
                            </div>
                            <div
                              className={cn(
                                // No background, no border, no rounded
                                // panel — the mockup shows the editor
                                // sitting directly on the note canvas
                                // like the read-mode markdown does.
                                // We keep the overflow scroll and a
                                // generous min-height so the editor
                                // has room to breathe even on short
                                // notes. The character-overflow state
                                // shows a soft red ring at the rounded
                                // outer container only when the user
                                // actually exceeds the limit — a
                                // restrained warning, not a constant
                                // bordered card.
                                "flex-1 w-full min-h-[400px] overflow-y-auto rounded-2xl transition-all",
                                editContent.length > 50000
                                  ? "ring-2 ring-rose-300 dark:ring-rose-900/30"
                                  : "",
                              )}
                            >
                              {/* Block editor — TipTap. The textarea
                                  contract stays: editContent in,
                                  edited markdown out. Auto-save reads
                                  editContent unchanged. The MAX_CHARS
                                  hint above still works because we
                                  measure the markdown string length,
                                  not the rich content. If the user
                                  pastes 60k chars of HTML, we'll
                                  measure the post-conversion markdown
                                  which is typically smaller — slight
                                  imprecision but acceptable for the
                                  warning. */}
                              <BlockEditor
                                markdown={editContent}
                                onMarkdownChange={(md) => {
                                  // Mark "user has typed" if this update
                                  // actually changes the content. The
                                  // editor may emit an initial onUpdate
                                  // when it seeds (round-trip can produce
                                  // a slightly normalized version of the
                                  // input markdown); we don't count that
                                  // as a user edit, only real divergence.
                                  if (md !== editContent) {
                                    hasEditorTypedRef.current = true;
                                  }
                                  setEditContent(md);
                                }}
                                placeholder="Start writing…"
                              />
                            </div>
                          </div>
                          <RelatedNotes
                            currentNote={selectedNote}
                            draftTitle={editTitle}
                            draftContent={editContent}
                            allNotes={notes}
                            onSelect={(n) => {
                              // Push the current note onto the back stack so
                              // the user can return after exploring.
                              if (selectedNote) {
                                setNoteNavStack((prev) => [
                                  ...prev,
                                  selectedNote,
                                ]);
                              }
                              setSelectedNote(n);
                              setIsEditing(false);
                            }}
                          />
                        </div>
                      ) : (
                        <div className="space-y-8 min-h-full flex flex-col">
                          {/* Compute which version of the body text
                              to display:
                              - revealSensitive=true → real content.
                              - hasSensitiveData=true → masked
                                version generated by the AI (with
                                [REDACTED] / ******** patches).
                              - otherwise → real content.
                              Falls back to real content if the
                              masked field is empty for any reason. */}
                          {(() => {
                            // Re-detect sensitive data client-side
                            // every render, instead of trusting the
                            // stored `hasSensitiveData` flag. Old
                            // notes captured before sensitive-data
                            // detection existed still have the flag
                            // missing/false, so without this re-check
                            // their Reveal/Hide button never appears.
                            // Re-detection is cheap (regex over the
                            // note body) and keeps fixes / detection
                            // improvements applying retroactively to
                            // every note, not just newly created ones.
                            const looksSensitive =
                              selectedNote.hasSensitiveData ||
                              detectSensitiveData(selectedNote.content || "");

                            // Pick the masked source: AI-generated
                            // maskedContent if available, otherwise
                            // fall back to client-side masking. This
                            // makes the Reveal/Hide button actually
                            // work for sensitive notes the AI never
                            // got to (e.g. captured offline, or
                            // sort-failed, or pre-feature).
                            const fallbackMasked = looksSensitive
                              ? maskSensitiveData(selectedNote.content)
                              : null;
                            const effectiveMasked =
                              selectedNote.maskedContent || fallbackMasked;
                            const showMasked =
                              looksSensitive &&
                              !revealSensitive &&
                              !!effectiveMasked;
                            const displayContent = showMasked
                              ? effectiveMasked
                              : selectedNote.content;
                            return (
                          <div className="prose prose-slate dark:prose-invert max-w-none">
                            {showMasked && (
                              <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-900/30">
                                <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                                <p
                                  className="flex-1 text-xs zk-text-secondary dark:text-amber-200"
                                  style={{ fontFamily: "var(--font-sans)" }}
                                >
                                  Sensitive values are hidden. Tap reveal to
                                  view the original.
                                </p>
                                <button
                                  onClick={() => setRevealSensitive(true)}
                                  className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors px-2 py-1 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30"
                                >
                                  Reveal
                                </button>
                              </div>
                            )}
                            {!showMasked && looksSensitive && (
                              <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#eef3ed] dark:bg-[#1f2520] border zk-border-color">
                                <Eye className="w-4 h-4 zk-text-secondary flex-shrink-0" />
                                <p
                                  className="flex-1 text-xs zk-text-secondary"
                                  style={{ fontFamily: "var(--font-sans)" }}
                                >
                                  Showing original content with sensitive
                                  values.
                                </p>
                                <button
                                  onClick={() => setRevealSensitive(false)}
                                  className="text-xs font-bold zk-text dark:text-white hover:zk-text-primary-brand transition-colors px-2 py-1 rounded-md hover:bg-white/60 dark:hover:bg-[#2d5a44]/30"
                                >
                                  Hide
                                </button>
                              </div>
                            )}
                            <div
                              className="text-[#1A1C19] dark:text-[#e8eaed] markdown-body"
                              style={{
                                // Mockup: 15px @ line-height 1.7. Editorial
                                // reading rhythm — generous but never
                                // chunky. text-lg/xl made the body feel
                                // dense and claustrophobic; the mockup's
                                // sweet spot is 15px desktop, 14px mobile.
                                fontSize: "15px",
                                lineHeight: 1.7,
                              }}
                            >
                              {showRaw ? (
                                <div className="zk-note-panel p-8 rounded-[28px] border zk-border-color dark:zk-border-strong text-[#1A1C19] dark:text-[#e8eaed] font-mono text-sm whitespace-pre-wrap shadow-sm overflow-x-auto">
                                  {selectedNote.rawContent}
                                </div>
                              ) : selectedNote.formatType === "todo" ||
                                /[-*]\s*\[\s*\]|[-*]\s*\[x\]/i.test(
                                  displayContent,
                                ) ? (
                                <div className="markdown-body">
                                  {(() => {
                                    const lines =
                                      displayContent.split("\n");
                                    const toggleTodo = async (
                                      lineIndex: number,
                                    ) => {
                                      const updatedLines = [...lines];
                                      const line = updatedLines[lineIndex];
                                      if (line.match(/^(\s*)[-*]\s*\[\s*\]/)) {
                                        updatedLines[lineIndex] = line.replace(
                                          /^(\s*)([-*])\s*\[\s*\]/,
                                          "$1$2 [x]",
                                        );
                                      } else if (
                                        line.match(/^(\s*)[-*]\s*\[x\]/i)
                                      ) {
                                        updatedLines[lineIndex] = line.replace(
                                          /^(\s*)([-*])\s*\[x\]/i,
                                          "$1$2 [ ]",
                                        );
                                      }
                                      const newContent =
                                        updatedLines.join("\n");
                                      setSelectedNote({
                                        ...selectedNote,
                                        content: newContent,
                                      });
                                      try {
                                        await updateDoc(
                                          doc(db, "notes", selectedNote.id),
                                          {
                                            content: newContent,
                                            updatedAt: serverTimestamp(),
                                          },
                                        );
                                      } catch (err) {
                                        console.error(
                                          "Failed to update todo:",
                                          err,
                                        );
                                      }
                                    };

                                    let lineIndex = 0;
                                    const elements: React.ReactNode[] = [];
                                    let nonTodoBuffer: string[] = [];

                                    const flushBuffer = () => {
                                      if (nonTodoBuffer.length > 0) {
                                        const content =
                                          nonTodoBuffer.join("\n");
                                        elements.push(
                                          <Markdown
                                            key={`md-${lineIndex++}`}
                                            components={markdownComponents}
                                          >
                                            {repairMarkdown(content)}
                                          </Markdown>,
                                        );
                                        nonTodoBuffer = [];
                                      }
                                    };

                                    for (let i = 0; i < lines.length; i++) {
                                      const line = lines[i];
                                      const uncheckedMatch = line.match(
                                        /^(\s*)[-*]\s*\[\s*\]\s*(.*)/,
                                      );
                                      const checkedMatch = line.match(
                                        /^(\s*)[-*]\s*\[x\]\s*(.*)/i,
                                      );

                                      if (uncheckedMatch || checkedMatch) {
                                        flushBuffer();
                                        const isChecked = !!checkedMatch;
                                        const taskText = isChecked
                                          ? checkedMatch![2]
                                          : uncheckedMatch![2];
                                        const currentIndex = i;
                                        elements.push(
                                          <div
                                            key={`todo-${i}`}
                                            onClick={() =>
                                              toggleTodo(currentIndex)
                                            }
                                            className={cn(
                                              "flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-xl cursor-pointer transition-all duration-200 group",
                                              isChecked
                                                ? // Hover for COMPLETED items: subtle in both
                                                  // modes. The earlier `dark:hover:bg-[#eaf0e8]/30`
                                                  // was a near-white tone in dark mode, which
                                                  // washed out the checked text. Use the same
                                                  // sage-tinted dark surface as unchecked but
                                                  // at half opacity so completed items still
                                                  // feel "lighter" than active ones.
                                                  "hover:bg-[#eaf0e8]/60 dark:hover:bg-[#2d5a44]/8"
                                                : "hover:bg-[#d2e8d5]/40 dark:hover:bg-[#2d5a44]/10",
                                            )}
                                          >
                                            <div
                                              className={cn(
                                                "flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200",
                                                isChecked
                                                  ? "zk-bg-primary border-[#2d5a44] dark:zk-bg-primary dark:border-[#6b8f72]"
                                                  : "zk-border-strong dark:zk-border-strong group-hover:border-[#6b8f72] dark:group-hover:border-[#6b8f72]",
                                              )}
                                            >
                                              {isChecked && (
                                                <Check
                                                  className="w-3.5 h-3.5 text-white"
                                                  strokeWidth={3}
                                                />
                                              )}
                                            </div>
                                            <span
                                              className={cn(
                                                "flex-1 text-base leading-relaxed transition-all duration-200 select-none [&>p]:m-0",
                                                isChecked
                                                  ? "line-through zk-text-faint dark:zk-text-muted"
                                                  : "zk-text-secondary dark:zk-text-muted",
                                              )}
                                            >
                                              <Markdown
                                                components={markdownComponents}
                                              >
                                                {repairMarkdown(taskText)}
                                              </Markdown>
                                            </span>
                                          </div>,
                                        );
                                      } else {
                                        nonTodoBuffer.push(line);
                                      }
                                      lineIndex = i;
                                    }
                                    flushBuffer();
                                    return elements;
                                  })()}
                                </div>
                              ) : (
                                <div className="markdown-body">
                                  <Markdown components={markdownComponents}>
                                    {repairMarkdown(preprocessQuotes(displayContent))}
                                  </Markdown>
                                </div>
                              )}
                            </div>
                          </div>
                            );
                          })()}

                          {/* Tag row — separated from content by a soft
                              hairline so it reads as metadata, not body.
                              Sage tint matches the brand without
                              overpowering. Tags are muted at rest and
                              brighten on hover for a subtle invitation
                              to interact. */}
                          {/* Tag row — always rendered when the note
                              isn't trashed so the "+ Add tag" pill is
                              reachable even on a brand-new tagless
                              note. The pill opens an inline input on
                              click; Enter commits, Escape cancels.
                              Sage tint matches the brand.

                              The bottom-right of this row also hosts
                              the note timestamp ("7 May · Edited 5m
                              ago") à la Google Keep. The timestamp
                              anchors right via `ml-auto` so tags
                              fill from the left and the date sits
                              flush with the right edge regardless of
                              tag count. Mono caps, faint color so it
                              reads as metadata not content. */}
                          {!selectedNote.isTrashed && (
                            <div className="flex flex-wrap gap-1.5 items-center mt-10 pt-5 border-t border-[#dde5da]/60 dark:border-white/[0.06]">
                              {(selectedNote.tags || [])
                                .filter(
                                  (t) =>
                                    typeof t === "string" && t.trim().length > 0,
                                )
                                .map((tag, ti) => (
                                <span
                                  key={`detail-tag-${ti}-${tag}`}
                                  className="group inline-flex items-center gap-1 pl-3 pr-1.5 py-1 bg-[#eaf0e8] dark:bg-[#2d5a44]/15 text-[#1f4534] dark:text-[#a8c9ac] text-[11px] font-semibold rounded-full transition-colors hover:bg-[#d2e8d5] dark:hover:bg-[#2d5a44]/30"
                                  style={{
                                    fontFamily: "var(--font-sans)",
                                  }}
                                >
                                  #{tag}
                                  {/* Inline delete button. Visible at
                                      low opacity on mobile (no
                                      hover available) so it's always
                                      tappable, and brightens on hover
                                      for desktop. Stop propagation so
                                      clicking the X doesn't trigger
                                      any future pill-click handler
                                      (filter-by-tag, etc.). */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeTag(tag);
                                    }}
                                    className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full opacity-40 hover:opacity-100 hover:bg-rose-100 dark:hover:bg-rose-900/40 hover:text-rose-600 dark:hover:text-rose-400 transition-all"
                                    title={`Remove #${tag}`}
                                    aria-label={`Remove tag ${tag}`}
                                  >
                                    <X className="w-3 h-3" strokeWidth={2.5} />
                                  </button>
                                </span>
                              ))}
                              {addingTag ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={tagDraft}
                                  onChange={(e) =>
                                    setTagDraft(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      commitTag();
                                    } else if (e.key === "Escape") {
                                      setAddingTag(false);
                                      setTagDraft("");
                                    }
                                  }}
                                  onBlur={() => {
                                    // Commit on blur so users can click
                                    // outside to save. Empty input
                                    // gracefully closes (commitTag
                                    // ignores empty drafts).
                                    commitTag();
                                  }}
                                  placeholder="tag-name"
                                  className="px-3 py-1 bg-white dark:bg-[#28292c] border border-[#8fb89a] dark:border-[#2d5a44] text-[#1f4534] dark:text-[#a8c9ac] text-[11px] font-semibold rounded-full outline-none focus:ring-2 focus:ring-[#d2e8d5]/50 dark:focus:ring-[#2d5a44]/30 min-w-[100px] max-w-[200px]"
                                  style={{
                                    fontFamily: "var(--font-sans)",
                                  }}
                                />
                              ) : (
                                <button
                                  onClick={() => setAddingTag(true)}
                                  className="px-3 py-1 border border-dashed border-[#dde5da] dark:border-white/[0.1] text-[#9aa39d] dark:text-[#6b746f] text-[11px] font-semibold rounded-full hover:border-[#8fb89a] dark:hover:border-[#2d5a44] hover:text-[#2d5a44] dark:hover:text-[#a8c9ac] transition-colors"
                                  style={{
                                    fontFamily: "var(--font-sans)",
                                  }}
                                  title="Add a tag"
                                >
                                  + Add tag
                                </button>
                              )}
                            </div>
                          )}

                          {/* Note timestamp — separated from the tag
                              row onto its own line so it doesn't
                              compete with tags for attention. The
                              spirit is Google Keep's quiet "Edited
                              yesterday" line at the bottom of every
                              card: clearly readable but understated,
                              right-aligned, breathing room above and
                              below. We go further than Keep by
                              showing both the creation date and the
                              relative edited-ago label — useful when
                              users come back days or weeks later and
                              want to know both "when did I write
                              this" and "when did I touch it last".
                              Color is one notch up from `zk-text-faint`
                              so it's actually readable in both light
                              and dark modes (the previous faint color
                              was vanishing on light theme). */}
                          {!selectedNote.isTrashed && (
                            <div
                              className="mt-4 flex justify-end items-center gap-2 text-[11px] text-[#6b746f] dark:text-[#9aa39d] whitespace-nowrap"
                              style={{
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                              }}
                              title={`Created ${formatDate(selectedNote.createdAt)}${
                                selectedNote.updatedAt
                                  ? ` · Edited ${formatDate(selectedNote.updatedAt)}`
                                  : ""
                              }`}
                            >
                              <span>
                                {(() => {
                                  try {
                                    const ts: any = selectedNote.createdAt;
                                    const date =
                                      typeof ts?.toDate === "function"
                                        ? ts.toDate()
                                        : ts instanceof Date
                                          ? ts
                                          : new Date(ts);
                                    if (isNaN(date.getTime())) return "—";
                                    return date.toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                    });
                                  } catch {
                                    return "—";
                                  }
                                })()}
                              </span>
                              {(() => {
                                const editedLabel = formatEditedAgo(
                                  selectedNote.createdAt,
                                  selectedNote.updatedAt,
                                );
                                if (!editedLabel) return null;
                                return (
                                  <>
                                    <span
                                      className="opacity-50"
                                      aria-hidden="true"
                                    >
                                      ·
                                    </span>
                                    <span>{editedLabel}</span>
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* AI Action Toast — shows after Break/Extract completes */}
                    <AnimatePresence>
                      {aiActionToast && isEditing && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          transition={{ duration: 0.2 }}
                          className="absolute bottom-[92px] left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2.5 bg-[#2e3431] dark:bg-[#0f0f0f] text-white rounded-full shadow-xl border border-white/10 pointer-events-none"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {aiActionToast.kind === "breakdown" ? (
                            <Split className="w-3.5 h-3.5 text-violet-300" />
                          ) : (
                            <ListTodo className="w-3.5 h-3.5 text-amber-300" />
                          )}
                          <span className="text-[12px] font-semibold">
                            {aiActionToast.kind === "breakdown"
                              ? `Broken down into ${aiActionToast.count} step${aiActionToast.count === 1 ? "" : "s"}`
                              : aiActionToast.count === 0
                                ? "No action items found — try writing more about what you need to do"
                                : `Extracted ${aiActionToast.count} action item${aiActionToast.count === 1 ? "" : "s"}`}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Modal Footer */}
                    {isEditing && (
                      <div className="px-6 py-4 mt-3 border-t zk-border-color dark:zk-border-color bg-[#eaf0e8]/60 dark:bg-[#28292c]/60 flex items-center justify-between rounded-b-xl">
                        <div className="flex items-center gap-4">
                          {/* Save-state indicator removed from footer
                              per user request. The header indicator
                              above is now the single source of save
                              state. Footer remains for AI actions
                              (Enhance Now, Break it down, Extract tasks)
                              and the Close Editor button. */}
                          {/* Enhance Now — always available in edit mode.
                              Especially useful when Auto-Sort is OFF (manual
                              mode) since this is the user's only way to
                              run AI on the note. */}
                          <button
                            onClick={handleUpdateNote}
                            disabled={isProcessing}
                            className="px-4 py-1.5 bg-[#d2e8d5]/30 dark:bg-[#2d5a44]/15 zk-text-primary-brand dark:zk-text-primary-brand text-[10px] font-bold rounded-lg border border-[#d2e8d5]/60 dark:border-[#2d5a44]/30 flex items-center gap-1.5 hover:bg-[#d2e8d5] dark:hover:bg-[#2d5a44]/25 transition-all active:scale-95 disabled:opacity-50"
                            title="Run AI to organize and structure this note"
                          >
                            {isProcessing ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                            Enhance Now
                          </button>
                          {/* Break it down — ADHD task atomization */}
                          <button
                            onClick={handleBreakdown}
                            disabled={
                              isBreakingDown ||
                              isExtractingTasks ||
                              isProcessing
                            }
                            title="Break into atomic steps (great for ADHD)"
                            className="px-4 py-1.5 bg-violet-100/60 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px] font-bold rounded-lg border border-violet-200/60 dark:border-violet-500/25 flex items-center gap-1.5 hover:bg-violet-100 dark:hover:bg-violet-500/25 transition-all active:scale-95 disabled:opacity-50"
                          >
                            {isBreakingDown ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Split className="w-3 h-3" />
                            )}
                            Break it down
                          </button>
                          {/* Extract tasks from prose */}
                          <button
                            onClick={handleExtractTasks}
                            disabled={
                              isExtractingTasks ||
                              isBreakingDown ||
                              isProcessing
                            }
                            title="Pull out action items as checkboxes"
                            className="px-4 py-1.5 bg-amber-100/60 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold rounded-lg border border-amber-200/60 dark:border-amber-500/25 flex items-center gap-1.5 hover:bg-amber-100 dark:hover:bg-amber-500/25 transition-all active:scale-95 disabled:opacity-50"
                          >
                            {isExtractingTasks ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <ListTodo className="w-3 h-3" />
                            )}
                            Extract tasks
                          </button>
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setIsEditing(false)}
                            className="px-5 py-2 bg-[#2d5a44] hover:bg-[#1f4534] dark:bg-[#3a6b4f] dark:hover:bg-[#2d5a44] text-white text-[12px] font-bold rounded-xl shadow-sm transition-all active:scale-95 flex items-center gap-1.5"
                          >
                            Close Editor
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            </div>
            </>
          )}
          {/* --- Password Modal --- */}
          {isPasswordModalOpen && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setIsPasswordModalOpen(false);
                  setPasswordInput("");
                  setPasswordError("");
                }}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-md zk-surface-raised rounded-[28px] shadow-2xl p-8 text-center border zk-border-color dark:zk-border-color"
              >
                {/* Lock setup modal — biometric edition.
                    No password input. The UI explains what's about
                    to happen (Touch ID / Face ID / device password)
                    and a single primary action triggers the
                    enrollment flow. Removal also requires a fresh
                    verification handled by handleRemovePassword. */}
                <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Fingerprint
                    className={cn(
                      "w-8 h-8 text-emerald-600 dark:text-emerald-400",
                      selectedNote?.password && "zk-lock-pulse",
                    )}
                  />
                </div>
                <h3 className="text-2xl font-bold zk-text dark:zk-text mb-2">
                  {selectedNote?.password ? "Note is locked" : "Lock this note"}
                </h3>
                <p className="zk-text-muted dark:zk-text-muted mb-6">
                  {selectedNote?.password
                    ? "This note already requires verification to open. Use the button below to remove the lock."
                    : isEmailUser(user)
                      ? "Lock this note with Touch ID, Face ID, or your device password. Your Zakar account password will be the fallback if your device can't use biometrics."
                      : "Lock this note with Touch ID, Face ID, Windows Hello, or your device password. We'll ask your device to confirm it's you every time you open this note."}
                </p>
                {/* For email users we render a password field that
                    is ONLY used when "Remove lock" is pressed (and
                    only when biometric isn't an option). Setting a
                    new lock doesn't need it. */}
                {selectedNote?.password &&
                  isEmailUser(user) &&
                  (selectedNote.lockMethod || "biometric") ===
                    "account-password" && (
                    <input
                      type="password"
                      placeholder="Account password (to remove lock)"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      className="w-full px-5 py-3 mb-3 zk-surface-muted dark:zk-surface-muted rounded-2xl border-2 border-transparent focus:border-[#2d5a44] outline-none transition-all text-center text-sm dark:zk-text"
                    />
                  )}

                {passwordError && (
                  <p className="text-sm font-bold text-rose-500 mb-3 animate-shake overflow-hidden" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {passwordError}
                  </p>
                )}

                <div className="space-y-3">
                  {!selectedNote?.password && (
                    <button
                      onClick={handleSetPassword}
                      disabled={isProtecting}
                      className="w-full px-6 py-3 zk-bg-primary text-white font-bold rounded-2xl hover:bg-[#435749] shadow-lg shadow-[#2d5a44]/15 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isProtecting ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <>
                          <Fingerprint className="w-4 h-4" />
                          Lock with biometrics
                        </>
                      )}
                    </button>
                  )}

                  {selectedNote?.password && (
                    <button
                      onClick={handleRemovePassword}
                      disabled={isRemovingPassword}
                      className="w-full px-6 py-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-bold rounded-2xl hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-all flex items-center justify-center gap-2"
                    >
                      {isRemovingPassword ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        "Remove Lock"
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setIsPasswordModalOpen(false);
                      setPasswordInput("");
                      setPasswordError("");
                    }}
                    className="w-full px-6 py-3 zk-surface-muted dark:zk-surface-muted zk-text-secondary dark:zk-text-muted font-bold rounded-2xl hover:zk-surface-sunken dark:hover:bg-[#2e3632] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragId ? (
          <div className="pointer-events-none">
            <div className="zk-surface-raised rounded-2xl shadow-2xl border border-[#2d5a44]/30 px-4 py-3 max-w-xs rotate-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full zk-bg-primary" />
                <span
                  className="text-[10px] font-bold zk-text-primary-brand dark:zk-text-primary-brand uppercase tracking-wider"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {selectedNoteIds.size > 1
                    ? `${selectedNoteIds.size} notes`
                    : notes.find((n) => n.id === activeDragId)?.category ||
                      "Note"}
                </span>
              </div>
              <p
                className="text-sm font-semibold zk-text dark:zk-text line-clamp-2"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {notes.find((n) => n.id === activeDragId)?.title || "Untitled"}
              </p>
            </div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Rail tooltip portal — position:fixed so it escapes the
          overflow-hidden parent and renders above EVERYTHING
          (search bar, note panel, etc.). Shared by Open sidebar,
          Close sidebar, Settings, and Profile buttons in the
          collapsed rail. Each button sets railTipLabel + railTipY
          onMouseEnter and clears them onMouseLeave. */}
      {/* Render only when the sidebar is in its collapsed RAIL
          state AND the mobile drawer isn't open. The rail tooltips
          are exclusively for the collapsed icons; when the drawer
          opens or the sidebar is fully expanded, the labels are
          right next to the icons in the regular nav and a floating
          pill would be redundant + visually noisy. */}
      {railTipLabel && sidebarCollapsed && !mobileDrawerOpen && (
        <span
          className="pointer-events-none fixed z-[99999] px-3 py-1.5 bg-white dark:bg-[#2e3631] text-[#1a1c19] dark:text-white text-xs font-semibold rounded-full shadow-xl border border-[#dde5da] dark:border-white/[0.1] whitespace-nowrap -translate-y-1/2"
          style={{
            left: "84px",
            top: `${railTipY}px`,
            fontFamily: "var(--font-sans)",
          }}
        >
          {railTipLabel}
        </span>
      )}
    </DndContext>
  );
}
