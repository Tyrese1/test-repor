import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import path from "path";

let aiInstance: GoogleGenAI | null = null;

const getAI = async () => {
  if (!aiInstance) {
    let apiKey =
      process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || null;

    const isPlaceholder = (key: string | null | undefined) => {
      if (!key) return true;
      const placeholders = [
        "MY_GEMINI_API_KEY",
        "YOUR_API_KEY",
        "INSERT_KEY_HERE",
        "TODO",
      ];
      return (
        placeholders.some((p) => key.toUpperCase().includes(p.toUpperCase())) ||
        key.length < 10
      );
    };

    if (isPlaceholder(apiKey)) {
      console.warn(
        "AI Worker: GEMINI_API_KEY is missing or a placeholder. Trying fallback...",
      );
      try {
        const configPath = path.join(
          process.cwd(),
          "firebase-applet-config.json",
        );
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          if (config.apiKey && !isPlaceholder(config.apiKey)) {
            console.log(
              "AI Worker: Using Firebase API key as fallback for Gemini.",
            );
            apiKey = config.apiKey;
          }
        }
      } catch (e) {
        console.error("AI Worker: Fallback key detection failed:", e);
      }
    }

    if (!apiKey || isPlaceholder(apiKey)) {
      console.error(
        "AI Worker: No valid Gemini API key found. Please set GEMINI_API_KEY.",
      );
      return null;
    }

    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

export interface SortedNote {
  title: string;
  content: string;
  maskedContent: string;
  category: string;
  tags: string[];
  isAlreadyWellFormatted: boolean;
  isError?: boolean;
  detectedFormatType?: string;
}

export type FormatType =
  | "auto"
  | "todo"
  | "email"
  | "blog"
  | "tweet"
  | "meeting"
  | "flashcards"
  | "lyrics";

const getLanguageName = (code: string | undefined): string => {
  const map: Record<string, string> = {
    "en-US": "English",
    "en-GB": "English",
    "en-NG": "English",
    "en-IN": "English",
    "en-AU": "English",
    "en-CA": "English",
    "es-ES": "Spanish",
    "es-MX": "Spanish",
    "fr-FR": "French",
    "fr-CA": "French",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-BR": "Portuguese",
    "pt-PT": "Portuguese",
    "nl-NL": "Dutch",
    "sv-SE": "Swedish",
    "ar-SA": "Arabic",
    "ar-EG": "Arabic",
    "hi-IN": "Hindi",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "ru-RU": "Russian",
    "tr-TR": "Turkish",
    "pl-PL": "Polish",
    "id-ID": "Indonesian",
    "th-TH": "Thai",
    "vi-VN": "Vietnamese",
  };
  return map[code || "en-US"] || "English";
};

const getFormatInstruction = (formatType: FormatType): string => {
  switch (formatType) {
    case "todo":
      return `\n\nFORMAT OVERRIDE — TO-DO LIST:
      Transform this content into an actionable to-do list. Structure it as:
      - Group related tasks under clear headings with emojis (e.g., ### ✅ High Priority)
      - Each task should be a checkbox item: \`- [ ] Task description\`
      - ALL items MUST start as unchecked "- [ ]". NEVER pre-check items with "- [x]" unless the source text explicitly marks that exact item as done (e.g., "(done)", "✅", crossed out, or already "- [x]" in the input).
      - Add priority indicators where relevant: 🔴 Urgent, 🟡 Medium, 🟢 Low
      - If deadlines or timeframes are mentioned, include them inline
      - Add a "### 📋 Summary" section at the top with total task count
      - Categorize as "Task"`;
    case "email":
      return `\n\nFORMAT OVERRIDE — EMAIL DRAFT:
      Transform this content into a professional email draft. Structure it as:
      - Start with "**To:** [infer recipient or use placeholder]"
      - Add "**Subject:** [generate a clear subject line]"
      - Write the email body with proper greeting, paragraphs, and closing
      - Keep the tone professional but warm
      - If there are action items, list them clearly before the sign-off
      - Categorize as "Personal"`;
    case "blog":
      return `\n\nFORMAT OVERRIDE — BLOG POST OUTLINE:
      Transform this content into a structured blog post outline. Structure it as:
      - Start with a compelling "### 📝 Title" suggestion
      - Add "### 🎯 Hook" — a 1-2 sentence attention grabber
      - Create "### 📐 Outline" with numbered sections
      - Under each section, add 2-3 bullet points of key points to cover
      - Add "### 💡 Key Takeaways" section with 3-5 takeaways
      - End with "### 🔚 CTA" — suggested call-to-action
      - Categorize as "Idea"`;
    case "tweet":
      return `\n\nFORMAT OVERRIDE — TWEET THREAD:
      Transform this content into a Twitter/X thread. Structure it as:
      - "### 🧵 Thread" as the heading
      - Number each tweet: "**1/** First tweet content"
      - Keep each tweet under 280 characters
      - First tweet should be a hook that grabs attention
      - Last tweet should be a summary or call-to-action
      - Add "### 🏷️ Suggested Hashtags" at the end
      - Categorize as "Web Content"`;
    case "meeting":
      return `\n\nFORMAT OVERRIDE — MEETING AGENDA:
      Transform this content into a structured meeting agenda. Structure it as:
      - "### 📅 Meeting Agenda" as the main heading
      - Add "**Date:** [infer or placeholder]" and "**Attendees:** [infer or placeholder]"
      - Number agenda items: "**1.** Topic — *(X min)*"
      - Under each item, add brief discussion points as sub-bullets
      - Add "### ✅ Action Items" section at the end
      - Categorize as "Task"`;
    case "flashcards":
      return `\n\nFORMAT OVERRIDE — FLASHCARDS:
      Transform this content into study flashcards. Structure it as:
      - "### 🃏 Flashcards" as the main heading
      - Format each card as:
        ---
        **Q:** [Question]
        **A:** [Concise answer]
        ---
      - Extract the most important facts, definitions, and concepts
      - Aim for 5-15 cards depending on content depth
      - Categorize as "Other"`;
    case "lyrics":
      return `\n\nFORMAT OVERRIDE — SONG LYRICS:
      Treat this content as song lyrics. Critical rules:
      - PRESERVE every original line break — line breaks are meter and matter to the artist
      - Do NOT collapse short lines into prose; do NOT add narrative explanation
      - Detect lyrical structure (verse, pre-chorus, chorus, bridge, outro, hook) by repetition, line length, and rhyme
      - Add structural section headers like "### 🎵 Verse 1", "### 🎤 Chorus", "### 🌉 Bridge", "### 🔁 Outro" before each section
      - If a section repeats, mark it as "*(Repeat Chorus)*" rather than copying the lines again UNLESS the artist may want both copies for editing — only deduplicate identical repeats
      - If the input is rough/fragmented (one verse, scattered lines), keep it raw — the artist is brain-dumping, don't fabricate missing parts
      - Use a markdown blockquote ("> line") ONLY for hook lines or memorable refrains the writer should keep
      - Title should be the song title if present in the input, otherwise a short evocative phrase from the lyrics (NOT a generic "Untitled Song")
      - Tags MUST include "lyrics" and the inferred mood (e.g. "melancholy", "upbeat", "acoustic"). 1-3 mood tags max.
      - Categorize as "Lyrics"`;
    default:
      return `\n\nAUTO-FORMAT DETECTION:
      Analyze the content and apply the most appropriate format automatically:
      - If content contains action items, tasks, or to-do items → format as a TO-DO LIST with \`- [ ]\` checkboxes, grouped by priority
      - If content resembles a meeting agenda, meeting notes, or minutes → format as a MEETING AGENDA with numbered items and time allocations
      - If content is a draft email or message → format as an EMAIL DRAFT
      - If content contains Q&A pairs or study material → format as FLASHCARDS
      - If content shows lyrical/poetic structure — short repeating lines, repeated phrases (chorus/refrain), broken meter, sparse imagery, no narrative paragraphs, line breaks that look intentional and rhythmic — format as SONG LYRICS, preserve all line breaks, add section headers (Verse / Chorus / Bridge), include "lyrics" plus a mood tag, and categorize as "Lyrics"
      - Otherwise → use standard organized note format
      
      IMPORTANT: Set the "formatType" field in your JSON response to match the detected format: "todo", "meeting", "email", "flashcards", "lyrics", or "auto" if none match.`;
  }
};

export const magicSort = async (
  rawContent: string,
  formatType: FormatType = "auto",
  language?: string,
): Promise<SortedNote> => {
  const ai = await getAI();

  if (!ai) {
    console.warn(
      "AI Instance not available (missing API key). Returning raw content.",
    );
    return {
      title:
        rawContent
          .substring(0, 60)
          .replace(/[^a-zA-Z0-9\s.,!?-]/g, "")
          .trim() || "Unsorted Note",
      content: rawContent,
      maskedContent: rawContent,
      category: "Uncategorized",
      tags: [],
      isAlreadyWellFormatted: false,
      isError: true,
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a professional note organizer. Analyze the following raw note content and transform it into a highly organized, professional, and meaningful note.
      
      Raw Content:
      ${rawContent}
      
      CORE PRINCIPLES:
      1. PRESERVE ALL MEANINGFUL DATA: Do not omit any real details. However, REMOVE any gibberish, random keystrokes, nonsensical strings, or garbled text that is clearly not intentional content (e.g., "jkhljiknd", "asdfgh", "xxxyyy"). These are accidental inputs, not data to preserve.
      2. CORRECT & REFINE: Be aggressive in spotting and fixing all spelling mistakes, typos (e.g., "autoamticatically" -> "automatically"), and grammatical errors. Ensure the tone is professional.
      3. MEANINGFUL STRUCTURE: Arrange data logically by its class/type. Make the content easy to digest at a glance.
      4. DATA-TYPE FORMATTING: Use appropriate formatting for different data types (lists for tasks, code blocks for keys, tables for structured data if applicable). Ensure there is ample spacing (double newlines) between sections for readability.
      5. NO LITERAL ESCAPES: Use actual line breaks in your response. Do not output literal "\\n" text sequences; use real newlines that will be properly escaped in the JSON string.
      6. MULTI-TOPIC SEPARATION: If the raw content covers TWO OR MORE distinct topics (e.g. half the note is about a project named "Zakar", the other half about a trip to Lagos, the rest about grocery shopping), DO NOT mash them together and DO NOT split into multiple notes. Instead, keep everything as ONE note and create a separate "### <emoji> <Topic Name>" heading for EACH distinct topic, then group the content belonging to that topic under its own heading. Each topic section must contain only the content that belongs to it. Choose topic names that reflect the actual subject (e.g. "### 🧠 Zakar Updates", "### ✈️ Lagos Trip", "### 🛒 Groceries") — not generic labels like "Topic 1". If the raw content is about a SINGLE topic, do not invent extra topic headings; use the normal section structure described below.
      
      Tasks:
      1. TITLE GENERATION: Create a concise, highly descriptive, and professional title. 
         - NEVER use generic titles like "New Note", "Untitled", "Note", or "Processing Failed".
         - Read the ENTIRE content deeply and extract the core subject matter.
         - Focus on what the note is actually ABOUT, not the first few words.
         - Example: "Google Nano Banana Image Generation Model Overview" instead of "New Note".
         - If the content contains meaningful information, ALWAYS derive the title from it.
      2. CONTENT REFINEMENT: Clean up the content (fix typos, remove gibberish, improve structure, and ensure it is meaningful and easy to digest).
      3. VISUAL FORMATTING (STRICT ADHERENCE): Use Markdown to make the note visually appealing, following this EXACT pattern:
         - Use clear, bold headings (###) for main sections, ALWAYS adding a relevant emoji (e.g., ### 🔐 Credentials).
         - Use sub-headings (####) for sub-sections without emojis.
         - Use bullet points (*) for all individual items.
         - **PATTERN FOR ITEMS**: Use \`* **Label**: Value\`. 
           - If the value is technical (key, path, command, setting), wrap it in inline code: \`* **Label**: \\\`value\\\` \`.
           - If the value is a description or link, use plain text or a Markdown link.
         - Use code blocks (\`\`\`) ONLY for multi-line scripts, logs, or blocks of code. Specify the language (e.g., \`\`\`bash).
         - ADD SPACING: Ensure there is a blank line before and after every heading, list, and code block.
      4. SENSITIVE DATA IDENTIFICATION: Create a "masked" version where sensitive info (passwords, keys, tokens, personal names) is replaced with [REDACTED] or "••••••••". 
         - CRITICAL: Distinguish between real credentials and error logs. If the text says "API key not valid", that is NOT a sensitive key. Only mask actual strings that look like functional keys or passwords.
      5. CATEGORIZATION: Categorize it strictly into one of these: Credential, Idea, Task, Web Content, Personal, Other.
      6. TAGGING: Generate 3-5 highly relevant, specific tags.
      7. WELL-FORMATTED CHECK: Determine if the original content was already professionally structured.
      
      CRITICAL RULES:
      - NEVER include ratings, scores, or evaluations like "10/10", "8/10", "Score: 9" etc. in the output. You are organizing, not grading.
      - NEVER add your own commentary about the quality of the content.
      - CHECKBOX STATE: When creating task lists, ALL new checkbox items MUST be unchecked: "- [ ] task". NEVER output "- [x]" or "- [X]" unless the source text already marks that specific item as completed (using phrases like "(done)", "(completed)", "✅", or "- [x]"). When in doubt, leave it unchecked. The user will check items themselves.
      - EMOJI USAGE — two distinct rules:
        (a) HEADING EMOJIS: ALWAYS add ONE relevant emoji to each ### main-section heading. This is part of the visual structure of organized notes (e.g. ### 🎯 Hook, ### ✅ Action Items, ### 🔐 Credentials, ### 📌 Pre-Meeting Prep, ### 💡 Key Takeaways, ### 📊 Summary). #### sub-headings stay clean (no emoji).
        (b) BODY/INLINE EMOJIS: Use SPARINGLY in the body text. Only keep emojis the source content actually contains; do NOT add decorative emojis to bullet points, list items, or paragraphs. NEVER repeat the same emoji multiple times in a row anywhere. If the source contains a run of repeated emojis (e.g. "📅📅📅"), keep only ONE instance.
      - LANGUAGE: Write the title and content in ${getLanguageName(language)}. If the source is in a different language, translate it. CRITICAL: The "category" value MUST always be one of these EXACT English strings (do not translate, do not localize): "Task", "Idea", "Credential", "Web Content", "Personal", "Other". Tags can be in the user's language.
      - Output ONLY the organized content itself.${getFormatInstruction(formatType)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
            maskedContent: { type: Type.STRING },
            category: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            isAlreadyWellFormatted: { type: Type.BOOLEAN },
            formatType: { type: Type.STRING },
          },
          required: [
            "title",
            "content",
            "maskedContent",
            "category",
            "tags",
            "isAlreadyWellFormatted",
          ],
        },
      },
    });

    const result = JSON.parse(response.text || "{}");

    const fixMarkdown = (str: string) => {
      if (!str) return str;
      let s = str;
      s = s.replace(/\\n/g, "\n");
      s = s.replace(/([^\n])(\s*#{1,6}\s)/g, "$1\n\n$2");
      s = s.replace(/([^\n])\s*(-\s*\[[\sx]\])/gi, "$1\n$2");
      s = s.replace(/([^\n])\s*(\*\s+\*\*)/g, "$1\n$2");
      s = s.replace(/([^\n])(\s*[-]\s+(?!\[))/g, "$1\n$2");
      s = s.replace(/\n{3,}/g, "\n\n");
      return s;
    };

    const stripRatings = (str: string) => {
      if (!str) return str;
      return str
        .replace(/\s*\d{1,2}\/\d{1,2}\s*/g, " ")
        .replace(/\s*Score:\s*\d+\s*/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    };

    // Safety net: if the source content had NO pre-checked items but the AI
    // output does, scrub them back to unchecked. Prevents Gemini from
    // accidentally marking tasks as done when the user hasn't checked them.
    const sourceHadCheckedItems = /[-*]\s*\[[xX]\]/.test(rawContent);
    const scrubUnwantedChecks = (str: string) => {
      if (!str) return str;
      if (sourceHadCheckedItems) return str;
      return str.replace(/([-*]\s*\[)[xX](\])/g, "$1 $2");
    };

    // Emoji-spam scrubber. When forwarded emails contain decorative emoji
    // strings (e.g. "📅📅📅📅..."), Gemini sometimes hallucinates the
    // pattern and generates dozens of repeated emojis. This collapses any
    // run of 3+ adjacent emoji-likes (with optional spaces between) down
    // to a single instance.
    const scrubEmojiSpam = (str: string) => {
      if (!str) return str;
      // \p{Extended_Pictographic} matches all emoji codepoints. We require
      // at least 3 emoji-likes in close succession (allowing one space
      // between) to trigger the collapse, so single decorative emojis
      // ("Hello 👋") are preserved.
      return str.replace(
        /(\p{Extended_Pictographic}\uFE0F?)(?:\s?\1){2,}/gu,
        "$1",
      );
    };

    const cleanContent = (s: string) =>
      scrubEmojiSpam(scrubUnwantedChecks(fixMarkdown(s)));

    return {
      title: scrubEmojiSpam(stripRatings(result.title) || "Untitled Note"),
      content: cleanContent(result.content || rawContent),
      maskedContent: cleanContent(result.maskedContent || rawContent),
      category: result.category || "Uncategorized",
      tags: result.tags || [],
      isAlreadyWellFormatted: !!result.isAlreadyWellFormatted,
      isError: false,
      detectedFormatType: result.formatType || undefined,
    };
  } catch (error) {
    console.error("AI Sort failed:", error);
    return {
      title:
        rawContent
          .substring(0, 60)
          .replace(/[^a-zA-Z0-9\s.,!?-]/g, "")
          .trim() || "Processing Failed",
      content: rawContent,
      maskedContent: rawContent,
      category: "Uncategorized",
      tags: [],
      isAlreadyWellFormatted: false,
      isError: true,
    };
  }
};

/* ============================================================
   breakdownTask — Goblin Tools–style task atomization.
   Takes a vague/large task and returns 3–6 concrete, atomic
   next steps formatted as markdown checkboxes.
   Designed to reduce ADHD task-initiation paralysis.
   ============================================================ */
export interface BreakdownResult {
  steps: string[];
  isError?: boolean;
  errorMessage?: string;
}

export const breakdownTask = async (
  taskDescription: string,
): Promise<BreakdownResult> => {
  const ai = await getAI();
  if (!ai) {
    return {
      steps: [],
      isError: true,
      errorMessage: "AI service not available",
    };
  }
  if (!taskDescription || taskDescription.trim().length < 3) {
    return { steps: [], isError: true, errorMessage: "Task too short" };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are helping someone with ADHD break down a task into small, concrete, atomic steps. The person is stuck and needs the SMALLEST possible next actions to reduce task-initiation paralysis.

Rules:
- Return 3 to 6 steps, no more.
- Each step should be a single concrete action, completable in 5-15 minutes.
- Start each step with a verb (Open, Write, Call, Find, Send, Draft, etc).
- Avoid vague verbs like "Think about", "Consider", "Plan".
- If the input already has a list, atomize further — break down any still-vague steps.
- Do NOT add "Step 1:" prefixes, numbering, or any markdown. Just the plain text of each step.
- Do NOT output anything other than the requested JSON.

Task to break down:
"""
${taskDescription.slice(0, 4000)}
"""`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            steps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["steps"],
        },
      },
    });

    const raw = response.text ?? "";
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { steps?: string[] };
    const steps = (parsed.steps || [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 6);

    if (steps.length === 0) {
      return {
        steps: [],
        isError: true,
        errorMessage: "AI returned no steps",
      };
    }

    return { steps, isError: false };
  } catch (error) {
    console.error("Breakdown failed:", error);
    return {
      steps: [],
      isError: true,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

/* ============================================================
   extractTasks — Scans prose for implicit action items and
   converts them into explicit markdown checkboxes. For when
   a user dumps "I should call the dentist and pick up X"
   and wants actionable tasks extracted.
   ============================================================ */
export interface TaskExtractionResult {
  tasks: string[];
  isError?: boolean;
  errorMessage?: string;
}

export const extractTasks = async (
  content: string,
): Promise<TaskExtractionResult> => {
  const ai = await getAI();
  if (!ai) {
    return {
      tasks: [],
      isError: true,
      errorMessage: "AI service not available",
    };
  }
  if (!content || content.trim().length < 10) {
    return { tasks: [], isError: true, errorMessage: "Content too short" };
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Scan the following note for IMPLICIT action items — things the writer expressed intent to do — and extract them as concrete tasks.

Rules:
- Only extract CLEAR action items. Do NOT extract reminders, thoughts, observations, or feelings.
- Each task must be a clear, concrete action starting with a verb (Call, Email, Review, Finish, Send, etc).
- Preserve specifics (names, dates, deadlines) in each task.
- If the note has NO clear action items, return an empty array.
- Do NOT duplicate tasks that are already written as checkbox items "[ ] ..." in the note.
- Return at most 8 tasks. Prefer quality over quantity.
- Do NOT output anything other than the requested JSON.

Note content:
"""
${content.slice(0, 6000)}
"""`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tasks: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ["tasks"],
        },
      },
    });

    const raw = response.text ?? "";
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { tasks?: string[] };
    const tasks = (parsed.tasks || [])
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 8);

    return { tasks, isError: false };
  } catch (error) {
    console.error("Task extraction failed:", error);
    return {
      tasks: [],
      isError: true,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
