/**
 * Notes Recall — Tier 1 RAG ("Ask my notes")
 * ===========================================
 *
 * What this module does:
 *   1. Embed each note once using Gemini text-embedding-004 (768 dims).
 *      The vector is stored as a regular field on the Firestore note doc,
 *      keyed by a content hash so we know when to re-embed.
 *   2. On a query: embed the user's question, compute cosine similarity
 *      against every embedded note's vector in JS, take the top K, hand
 *      them to Gemini with a focused prompt to synthesize a grounded answer.
 *
 * What this module does NOT do (yet):
 *   - No chunking. Each note becomes one embedding. For a typical Zakar
 *     note (a paragraph to a page), that's plenty. We can revisit when we
 *     find users with multi-thousand-word notes where a single vector is
 *     too coarse to retrieve meaningfully.
 *   - No vector database. Cosine similarity in JS over the user's own
 *     notes. Fine up to ~5K notes per user; revisit at that scale.
 *   - No reranking, no hybrid keyword+vector search, no query rewriting.
 *     These are real wins but premature until we know users actually use
 *     this feature.
 *
 * Why these tradeoffs:
 *   This is the cheapest possible RAG that produces real answers. The goal
 *   is to ship in days not weeks, validate that users want this, and only
 *   then invest in a proper retrieval stack. The bill is small: ~$0.50 /
 *   user / month at moderate usage. The engineering risk lives in chunking
 *   and prompting, not infrastructure — solving those AT SCALE is wasted
 *   work if "ask my notes" turns out to not be the killer feature for
 *   Zakar's users.
 *
 * Privacy:
 *   - Password-locked notes are never embedded. Their content stays on the
 *     device behind the user's password and is excluded from recall.
 *   - Trashed notes are excluded from retrieval but their embedding is
 *     kept so restores don't trigger a re-embed.
 *   - Embeddings stay in the user's own Firestore subtree alongside the
 *     note. They never go to a third-party vector store.
 */

import { GoogleGenAI } from "@google/genai";

/* ============================================================
   Types
   ============================================================ */

export interface RecallableNote {
  id: string;
  title: string;
  content: string;
  rawContent?: string;
  embedding?: number[];
  /** Hash of the content used to produce `embedding`. If the current
   *  content hash differs, we know the embedding is stale and must be
   *  recomputed. Cheap dirty check. */
  embeddingHash?: string;
  isTrashed?: boolean;
  isArchived?: boolean;
  password?: string | null;
  category?: string;
  tags?: string[];
  updatedAt?: unknown;
}

export interface RecallHit {
  note: RecallableNote;
  /** Cosine similarity 0..1; higher = more relevant. */
  score: number;
}

export interface RecallAnswer {
  /** Synthesized natural-language answer. */
  text: string;
  /** Notes used as context, in score order. UI renders as citations. */
  hits: RecallHit[];
  /** True iff Gemini explicitly said it couldn't find an answer in the
   *  retrieved context. Lets the UI distinguish "found nothing" from a
   *  generation error. */
  groundedNotFound?: boolean;
}

/* ============================================================
   Hashing — lightweight FNV-1a over content for dirty-check
   ============================================================ */

/** Same hash style as the import duplicate detection — small, fast,
 *  collisions are vanishingly rare in this dataset. We hash title+content
 *  so an edit to either invalidates the embedding. */
const computeContentHash = (note: RecallableNote): string => {
  const text = (note.title || "") + "\n" + (note.rawContent || note.content || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(36);
};

/* ============================================================
   Embedding helpers
   ============================================================ */

/** Build a single string from a note suitable for embedding. We include
 *  title, tags, and content because semantic queries often look for
 *  topic/category words that may not appear in the body verbatim. */
const buildEmbeddingInput = (note: RecallableNote): string => {
  const parts: string[] = [];
  if (note.title) parts.push(`# ${note.title}`);
  if (note.tags && note.tags.length > 0) parts.push(`Tags: ${note.tags.join(", ")}`);
  if (note.category) parts.push(`Category: ${note.category}`);
  parts.push(note.rawContent || note.content || "");
  return parts.join("\n");
};

/** Cap embedding input length. Gemini embedding endpoints accept long
 *  inputs but quality degrades and cost grows linearly. 8KB of text is
 *  ~2K tokens — enough for nearly any reasonable note. Beyond that, take
 *  the head + tail so the model sees both ends of long content. */
const MAX_EMBED_CHARS = 8000;
const truncateForEmbedding = (text: string): string => {
  if (text.length <= MAX_EMBED_CHARS) return text;
  const half = Math.floor(MAX_EMBED_CHARS / 2);
  return text.slice(0, half) + "\n\n[...]\n\n" + text.slice(-half);
};

/** Embed a list of strings. Returns a parallel array of vectors.
 *
 *  Note: `gemini-embedding-001` accepts only ONE input text per request
 *  (see https://ai.google.dev/gemini-api/docs/embeddings). We can't send
 *  the array in a single call like the older `text-embedding-004` allowed,
 *  so we issue concurrent requests with a small concurrency cap to avoid
 *  hammering rate limits. We also pin output dimensionality to 768 — the
 *  default 3072 is overkill for whole-note recall and would 4x our
 *  Firestore document size. 768 is what `text-embedding-004` produced and
 *  what we sized the rules limit for. */
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 768;
const EMBED_CONCURRENCY = 5;

const embedSingle = async (
  ai: GoogleGenAI,
  text: string,
): Promise<number[]> => {
  const response = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { outputDimensionality: EMBED_DIMS },
  });
  // Response shape: { embeddings: [{ values: number[] }] }. Even for a
  // single input, the API returns a list of one.
  const vec = response.embeddings?.[0]?.values;
  return vec || [];
};

/** Embed many strings with bounded concurrency. Maintains parallel ordering
 *  with the input array. Failures of individual texts return [] for that
 *  slot rather than throwing — the caller checks for empty vectors. */
const embedMany = async (
  ai: GoogleGenAI,
  texts: string[],
): Promise<number[][]> => {
  if (texts.length === 0) return [];
  const results: number[][] = new Array(texts.length).fill(null) as any;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(EMBED_CONCURRENCY, texts.length) },
    async () => {
      while (cursor < texts.length) {
        const i = cursor++;
        try {
          results[i] = await embedSingle(ai, texts[i]);
        } catch (err) {
          console.warn(`[recall] embed failed for slot ${i}:`, err);
          results[i] = [];
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
};

/* ============================================================
   Cosine similarity
   ============================================================ */

/** Standard cosine similarity. Returns NaN-safe 0 if either vector is
 *  zero-length, which can happen for empty-content notes that slipped
 *  past our filters. */
const cosineSimilarity = (a: number[], b: number[]): number => {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/* ============================================================
   Public API
   ============================================================ */

/** Predicate: should this note ever be embedded/retrieved?
 *  Excludes locked, trashed (during retrieval), and empty notes. */
export const isRecallable = (note: RecallableNote): boolean => {
  if (note.password) return false; // privacy: never embed locked
  const text = note.rawContent || note.content || "";
  if (text.trim().length < 10) return false; // empty/trivial
  return true;
};

/** Find notes that need (re-)embedding. Returns those whose stored hash
 *  doesn't match their current content hash, or who have no embedding. */
export const findStaleNotes = (
  notes: RecallableNote[],
): RecallableNote[] => {
  return notes.filter((n) => {
    if (!isRecallable(n)) return false;
    if (!n.embedding || n.embedding.length === 0) return true;
    const currentHash = computeContentHash(n);
    return n.embeddingHash !== currentHash;
  });
};

/**
 * Embed a list of notes in parallel-batched fashion. Calls a per-note
 * commit callback so the caller (App.tsx) can persist each fresh
 * embedding to Firestore as it arrives.
 *
 * Behavior:
 *   - Batches of 20 notes per API call (Gemini batch limit is generous;
 *     20 is conservative and keeps any single failure scope small).
 *   - On a batch failure, falls through — the caller can retry later.
 *   - A progress callback fires after every batch.
 */
export const embedNotes = async (
  ai: GoogleGenAI,
  notes: RecallableNote[],
  commit: (
    id: string,
    embedding: number[],
    embeddingHash: string,
  ) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  shouldCancel?: () => boolean,
): Promise<{ embedded: number; failed: number }> => {
  const stale = findStaleNotes(notes);
  let embedded = 0;
  let failed = 0;
  // Process in chunks so we can update progress between chunks. Each
  // chunk uses bounded internal concurrency in embedMany. We use a
  // smaller chunk size (10) than before (20) since each note is now its
  // own API call, and we want progress updates to feel responsive.
  const CHUNK = 10;

  for (let i = 0; i < stale.length; i += CHUNK) {
    if (shouldCancel?.()) break;
    const batch = stale.slice(i, i + CHUNK);
    const inputs = batch.map((n) =>
      truncateForEmbedding(buildEmbeddingInput(n)),
    );
    const vectors = await embedMany(ai, inputs);
    // Persist each result. A vector of length 0 means that specific
    // text failed; count it as failed and move on rather than aborting
    // the whole batch.
    await Promise.all(
      batch.map(async (note, idx) => {
        const vec = vectors[idx];
        if (!vec || vec.length === 0) {
          failed++;
          return;
        }
        try {
          await commit(note.id, vec, computeContentHash(note));
          embedded++;
        } catch (err) {
          failed++;
          console.warn(`[recall] commit failed for ${note.id}:`, err);
        }
      }),
    );
    onProgress?.(Math.min(i + CHUNK, stale.length), stale.length);
  }

  return { embedded, failed };
};

/**
 * Run a recall query against the user's library.
 *
 *   1. Embed the question
 *   2. Score every note's embedding by cosine similarity
 *   3. Keep top K above a minimum score threshold
 *   4. Compose a prompt with retrieved notes as context
 *   5. Call Gemini to generate a grounded answer
 *
 * The minimum score threshold filters out noise — if the best hit has
 * cosine sim < 0.3 it's almost certainly an unrelated topic and we'd
 * rather tell the user "I didn't find anything" than have Gemini
 * confabulate.
 */
export const askNotes = async (
  ai: GoogleGenAI,
  question: string,
  notes: RecallableNote[],
  options?: { topK?: number; minScore?: number; modelName?: string },
): Promise<RecallAnswer> => {
  // Default to 3 sources. The Ask UI shows them as cited references,
  // not browse results — more than 3 makes the answer noisy and forces
  // the LLM to weave together half-relevant notes. Better to cite 1-2
  // strong sources than 6 mediocre ones.
  const topK = options?.topK ?? 3;
  // Floor for absolute relevance. Real-world testing (e.g. wedding
  // query also matching "event planning" / "WordCamp scheduling" notes)
  // showed that genuinely-off-topic notes still score 0.50-0.58 in
  // this embedding space. 0.55 is the line where confidently-relevant
  // matches start. If a query returns nothing, that's the right
  // signal — don't push the floor down to manufacture results.
  const minScore = options?.minScore ?? 0.55;
  // Relative gap: trailing hits more than this far below the top hit
  // are treated as noise even if they cleared the absolute floor. 0.10
  // is tighter than the previous 0.15 — empirically, in this embedding
  // space, a 10-point drop already separates "relevant" from "vaguely
  // similar." A truly relevant second source rarely drops more than
  // ~0.08 below the top.
  const relativeGap = 0.1;
  const modelName = options?.modelName ?? "gemini-3-flash-preview";

  // Filter to the recallable & embedded subset. We exclude trashed but
  // include archived — archived notes are still the user's own knowledge
  // and they'd be surprised if old memories disappeared from recall.
  const candidates = notes.filter(
    (n) =>
      isRecallable(n) &&
      !n.isTrashed &&
      n.embedding &&
      n.embedding.length > 0,
  );

  if (candidates.length === 0) {
    return {
      text: "You don't have any notes to search through yet — or none of them have been indexed yet. Try capturing a few notes first.",
      hits: [],
      groundedNotFound: true,
    };
  }

  // Embed the query
  let queryVec: number[];
  try {
    const vec = await embedSingle(ai, question);
    if (!vec || vec.length === 0) {
      throw new Error("Empty query embedding");
    }
    queryVec = vec;
  } catch (err) {
    console.error("[recall] query embedding failed:", err);
    return {
      text: "Sorry, something went wrong looking through your notes. Please try again.",
      hits: [],
    };
  }

  // Score and rank ALL candidates first — don't pre-slice by topK, or
  // we'd pick K weak hits when there are only 2 strong ones.
  const scored: RecallHit[] = candidates
    .map((note) => ({
      note,
      score: cosineSimilarity(queryVec, note.embedding!),
    }))
    .sort((a, b) => b.score - a.score);

  // Apply the absolute minimum-score floor.
  let qualified = scored.filter((h) => h.score >= minScore);

  // Apply a RELATIVE cutoff in addition to the floor. If the top hit is
  // strong but #5 has dropped meaningfully below it, that drop usually
  // signals the trailing hits are noise. We'd rather show 1-2 confidently
  // relevant sources than 6 with the back half being random matches —
  // those distractors confuse the LLM and produce hallucinated cross-
  // references (e.g. "your wedding planning meeting" pulling in a
  // hackathon note that happens to mention "schedule").
  if (qualified.length > 0) {
    const topScore = qualified[0].score;
    qualified = qualified.filter((h) => h.score >= topScore - relativeGap);
  }

  // Finally take the top K from what survived both filters.
  const topHits = qualified.slice(0, topK);

  if (topHits.length === 0) {
    // Use the highest-scoring (but-rejected) hit so the user knows what
    // we ALMOST returned. Helps them rephrase if needed.
    return {
      text: `I couldn't find anything in your notes that closely matches that question. The closest was "${scored[0]?.note.title || "an untitled note"}" but it didn't seem on topic.`,
      hits: [],
      groundedNotFound: true,
    };
  }

  // Build a focused prompt. Important rules in the prompt:
  //   - Only answer from the provided notes (no world knowledge)
  //   - Some notes may be tangential; ignore the irrelevant ones
  //   - Cite which note each claim comes from by [#1], [#2] markers
  //   - If notes don't actually contain the answer, say so explicitly
  //     (this triggers groundedNotFound on the parsed response)
  const contextBlocks = topHits
    .map((hit, i) => {
      const note = hit.note;
      const body = (note.rawContent || note.content || "").slice(0, 2000);
      return `[Note #${i + 1}] ${note.title || "Untitled"}\n${body}`;
    })
    .join("\n\n---\n\n");

  const prompt = `You are answering a question using ONLY the user's personal notes provided below as context. You are not a general assistant — your knowledge is limited to what these notes say.

USER'S QUESTION:
${question}

USER'S NOTES (most relevant first):
${contextBlocks}

RULES:
1. Answer ONLY from the provided notes. Do not use outside knowledge.
2. The notes were retrieved by semantic similarity; some may be only LOOSELY related to the question. IGNORE notes that don't actually contain information answering the question, even if they share keywords (e.g. don't pull "event planning" details into a "wedding" answer just because both involve "events"). Better to use 1 clearly-relevant note than 5 tangential ones.
3. When you state a fact, cite the note it came from like [#1] or [#3]. Only cite notes you actually used. Never cite a note just to acknowledge it exists.
4. If multiple relevant notes contain related info, synthesize them into one clear answer.
5. If NONE of the provided notes actually contain enough info to answer the question, say so directly — start your answer with "I don't see that in your notes." and briefly describe what's missing. Do NOT guess, fill gaps, or stretch to make a tangential note fit.
6. Be conversational but concise. No preamble like "Based on your notes...". Just answer.
7. If the relevant notes contain a date, time, list, or specific value, surface it explicitly.

Answer:`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
    });
    const text = (response.text || "").trim();
    // Strict grounded-not-found detection. The previous regex caught any
    // response starting with "I don't see that in your notes" but that
    // produced false positives when the model wrote things like "I don't
    // see a 'wedding' explicitly mentioned, but the note lists Aug 22:
    // My Wedding..." — the model HAD found the answer but the regex
    // forced low confidence anyway.
    //
    // We now require the not-found message to be the WHOLE answer (or at
    // most a single sentence). If the model continues past that
    // sentence with substantive content, we treat it as a real answer.
    const trimmed = text.trim();
    const notFoundMatch = trimmed.match(
      /^i don't see that in your notes\.?\s*([^]*)$/i,
    );
    let groundedNotFound = false;
    if (notFoundMatch) {
      const continuation = notFoundMatch[1].trim();
      // Allow a brief explanation ("...the closest mention is X") but
      // not a paragraph of actual answer content. Threshold: 200 chars
      // of continuation = the model is genuinely answering despite the
      // disclaimer preamble; treat as found.
      groundedNotFound = continuation.length < 200;
    }
    return {
      text,
      hits: topHits,
      groundedNotFound,
    };
  } catch (err) {
    console.error("[recall] generation failed:", err);
    return {
      text: "Sorry, I couldn't generate an answer just now. Please try again in a moment.",
      hits: topHits,
    };
  }
};
