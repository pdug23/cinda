/**
 * Chat API handler and helper utilities for Cinda.
 *
 * This module exposes an HTTP handler used by the Next.js API route as
 * well as a collection of pure helper functions to parse user context,
 * detect disliked shoe models and filter the available catalogue.  The
 * dislike extraction includes a normalisation and fuzzy matching
 * pipeline so that common typos, plurals and missing brand names can
 * still be mapped onto the correct model from the shoe list.  When a
 * user expresses a dislike with low confidence, a follow‑up question
 * will be triggered instead of silently adding the shoe to the
 * exclusions list.
 */

// Explicit file extension is required for ES module resolution when
// using dynamic import in Node.  Without the `.js` suffix the module
// cannot be located during tests.
import { shoes } from '../../data/shoes.js';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Normalise a string by lower‑casing, removing punctuation, collapse
 * whitespace and stripping common leading articles and known brand
 * prefixes.  Also singularises simple plurals (e.g. "Pegasus" →
 * "Pegasus", "Pegasuses" → "Pegasus").  This helper is pure and
 * deterministic.
 *
 * @param {string} input Raw input value
 * @returns {string} A trimmed, normalised string suitable for
 * comparison
 */
export function normaliseString(input) {
  if (!input) return '';
  let str = input.toLowerCase();
  // Remove brand prefixes; users often omit them, so comparisons are
  // performed on model names only.  Keep the order longest to
  // shortest to avoid partial overlaps (e.g. "new balance").
  const brands = ['new balance', 'on running', 'hoka', 'nike', 'asics', 'saucony', 'puma', 'adidas'];
  for (const brand of brands) {
    str = str.replace(new RegExp(`\\b${brand}\\b`, 'g'), '');
  }
  // Remove determiners and filler words
  const articles = ['the', 'a', 'an', 'shoe', 'shoes', 'model'];
  for (const art of articles) {
    str = str.replace(new RegExp(`\\b${art}\\b`, 'g'), '');
  }
  // Remove punctuation and any remaining non‑alphanumeric characters
  str = str.replace(/[^a-z0-9\s+-]/g, '');
  // Collapse multiple whitespace down to single spaces
  str = str.trim().replace(/\s+/g, ' ');
  // Singularise very simple plurals ending in s or es; don't strip
  // double consonants or numbers (e.g. Pegasus 41s → Pegasus 41)
  const words = str.split(' ').flatMap((w) => {
    // Discard isolated single letters without digits (e.g. stray "t" before model)
    if (w.length === 1 && !/[0-9]/.test(w)) {
      return [];
    }
    // Singularise simple plurals: remove trailing 's' but preserve latin 'us'
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) && !/us$/.test(w)) {
      return [w.slice(0, -1)];
    }
    return [w];
  });
  return words.join(' ').trim();
}

/**
 * Compute the Levenshtein distance between two strings.  This
 * implementation is iterative and runs in O(n*m) time where n and m
 * are the lengths of the input strings.  Used internally to derive a
 * similarity score.
 *
 * @param {string} a First string
 * @param {string} b Second string
 * @returns {number} The edit distance between a and b
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * Calculate a simple similarity score between two strings based on
 * Levenshtein distance.  The score is defined as
 * 1 - (distance / maxLength).  Values range from 0 (completely
 * different) to 1 (identical).  If both inputs are empty the
 * similarity is 1.
 *
 * @param {string} a First string
 * @param {string} b Second string
 * @returns {number} Similarity score between 0 and 1
 */
function similarity(a, b) {
  const aNorm = a.trim();
  const bNorm = b.trim();
  if (!aNorm && !bNorm) return 1;
  if (!aNorm || !bNorm) return 0;
  const distance = levenshtein(aNorm, bNorm);
  const maxLen = Math.max(aNorm.length, bNorm.length);
  return 1 - distance / maxLen;
}

/**
 * Identify which shoe model a user may be referring to based on a
 * raw dislike string.  Normalises the input and compares it against
 * every model in the catalogue (brand name removed).  Returns the
 * best match along with a confidence score and a human friendly
 * reason.
 *
 * @param {string} raw Candidate phrase extracted from the user
 * @returns {{model: string|null, confidence: number, reason: string}}
 */
export function identifyDislikeModel(raw) {
  const cleaned = normaliseString(raw);
  if (!cleaned) {
    return { model: null, confidence: 0, reason: 'Input was empty after normalisation' };
  }
  let bestMatch = null;
  let bestScore = 0;
  // Precompute cleaned model names without brand for each shoe
  for (const shoe of shoes) {
    const modelName = normaliseString(shoe.model);
    let score = similarity(cleaned, modelName);
    // If the cleaned candidate and model share a prefix (ignoring digits),
    // bump the confidence.  This helps map "Pegasus" to "Pegasus 41".
    const candNoNums = cleaned.replace(/\b\d+\b/g, '').trim();
    const modelNoNums = modelName.replace(/\b\d+\b/g, '').trim();
    if (
      candNoNums && modelNoNums &&
      (modelNoNums.startsWith(candNoNums) || candNoNums.startsWith(modelNoNums))
    ) {
      score = Math.max(score, 0.9);
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = modelName;
    }
  }
  if (bestMatch === null) {
    return { model: null, confidence: 0, reason: 'No models available to compare' };
  }
  return {
    model: bestMatch,
    confidence: bestScore,
    reason: `Matched "${cleaned}" to "${bestMatch}" with similarity ${bestScore.toFixed(2)}`,
  };
}

/**
 * Detect whether a phrase extracted from a dislike statement clearly
 * refers to a shoe component or feature rather than a shoe itself.
 * Common false positives such as "laces", "price" or "fit" are
 * excluded here to avoid polluting the dislikes list.
 *
 * @param {string} phrase Raw extracted phrase
 * @returns {boolean} True if the phrase refers to a feature to be
 * ignored
 */
function isFeatureComplaint(phrase) {
  const keywords = ['lace', 'laces', 'fit', 'fits', 'colour', 'color', 'price', 'cost', 'style', 'look', 'looks', 'pattern'];
  const lc = phrase.toLowerCase();
  return keywords.some((k) => lc.includes(k));
}

/**
 * Check for missing high level context such as running goal, feel
 * preference and support type.  If none are missing, fall back to
 * follow‑ups about ambiguous dislike mentions.  Returns a message or
 * null when nothing further is required.
 *
 * @param {object} context Context object returned from parseContext
 * @returns {string|null} A follow‑up question for the user
 */
export function missingContextCheck(context) {
  if (!context.goal) {
    return 'What kind of running are you mainly using the shoes for? (e.g. daily training, long runs, racing)';
  }
  if (!context.preferredFeel) {
    return 'Do you prefer something soft and cushioned, or more firm and responsive underfoot?';
  }
  if (!context.supportType) {
    return 'Do you usually run in neutral shoes, or do you benefit from added stability or support?';
  }
  // If there are unresolved dislike clarifications then ask about them
  if (context.dislikeClarifications && context.dislikeClarifications.length > 0) {
    const clarifications = context.dislikeClarifications
      .map((c) => `"${c.input}"${c.suggestion ? ` (did you mean ${c.suggestion}?)` : ''}`)
      .join(', ');
    return `Just to clarify, could you confirm which shoe you disliked? I detected ${clarifications}.`;
  }
  return null;
}

/**
 * Parse a user message and chat history to extract context about the
 * runner: goals, preferred feel, support type, number of shoes and
 * dislikes.  This function is pure and side effect free.  The
 * dislikes array contains normalised model names.  A separate
 * dislikeClarifications array holds candidates that could not be
 * confidently matched to a known model.
 *
 * @param {Array<{role: string, content: string}>} chatHistory Previous
 *   conversation messages
 * @param {string} message Latest user message
 * @returns {object} Parsed context with properties goal, preferredFeel,
 *   supportType, shoeCount, budget, dislikes, raceIntent and
 *   dislikeClarifications
 */
export function parseContext(chatHistory, message) {
  const text = [...chatHistory.map((m) => m.content), message].join(' ').toLowerCase();

  const context = {
    goal: null,
    preferredFeel: null,
    supportType: null,
    shoeCount: null,
    budget: null,
    dislikes: [],
    raceIntent: false,
    dislikeClarifications: [],
  };

  // Running goal detection
  if (text.includes('10k')) context.goal = '10k race';
  else if (text.includes('half marathon')) context.goal = 'half marathon';
  else if (text.includes('marathon')) context.goal = 'marathon';
  else if (text.includes('long run')) context.goal = 'long runs';
  else if (text.includes('training') || text.includes('all round')) context.goal = 'daily training';

  // Preferred feel detection
  if (text.includes('bouncy') || text.includes('springy') || text.includes('responsive')) {
    context.preferredFeel = 'bouncy';
  } else if (text.includes('soft') || text.includes('plush') || text.includes('cushioned')) {
    context.preferredFeel = 'soft';
  } else if (text.includes('firm') || text.includes('ground feel')) {
    context.preferredFeel = 'firm';
  }

  // Dislike extraction
  const dislikePatterns = [
    // Capture phrases like "didn't like", "didn’t like", "did not like", "don't like", and past tense "hated".
    /(?:didn[’']t like|did not like|don't like|dislike|hate(?:d)?|not a fan of)\s+([\w\s\-\/]+?)(?=\s*(?:,|\.|;|!|\bfelt\b|\bwas\b|\bseemed\b|$))/gi,
    // Capture constructions like "X wasn't for me", "X wasn't my thing" or "X didn't work for me".
    /(?:the\s+)?([\w\s\-\/]+?)\s+(?:was(?:n[’']t)? for me|did(?:n[’']t)? work for me|was(?:n[’']t)? my thing)/gi,
  ];
  for (const regex of dislikePatterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const raw = match[1];
      const parts = raw.split(/\s*(?:or|and|,|\/)+\s*/i);
      parts.forEach((p) => {
        const candidate = p.trim();
        if (!candidate || isFeatureComplaint(candidate)) return;
        const { model, confidence } = identifyDislikeModel(candidate);
        // Only add to dislikes if confidence is high enough
        if (model && confidence >= 0.8) {
          if (!context.dislikes.includes(model)) {
            context.dislikes.push(model);
          }
        } else if (candidate.length > 2) {
          // Save ambiguous candidates for follow‑up
          context.dislikeClarifications.push({ input: candidate, suggestion: model, confidence });
        }
      });
    }
  }

  // Support type detection
  if (text.includes('neutral')) context.supportType = 'neutral';
  else if (text.includes('stability') || text.includes('support') || text.includes('overpronation')) {
    context.supportType = 'stability';
  }

  // Shoe count hints
  if (text.includes('rotation') || text.includes('multiple shoes') || text.includes('two shoes')) {
    context.shoeCount = 'rotation';
  }

  // Budget hints
  if (
    text.includes('budget') ||
    text.includes('cheap') ||
    text.includes('don’t want to spend') ||
    text.includes("don't want to spend") ||
    text.includes('not looking to spend') ||
    text.includes('affordable') ||
    text.includes('price sensitive') ||
    text.includes('expensive')
  ) {
    context.budget = 'budget-conscious';
  }

  // Race intent detection
  if (
    text.includes('pb') ||
    text.includes('personal best') ||
    text.includes('go all out') ||
    text.includes('as fast as possible') ||
    text.includes('max performance') ||
    text.includes('race day') ||
    text.includes('aggressive') ||
    text.includes('carbon plate') ||
    text.includes('plated shoe')
  ) {
    context.raceIntent = true;
  } else {
    context.raceIntent = false;
  }

  return context;
}

/**
 * Filter the supplied list of shoes based on parsed user context and
 * message content.  Shoes are excluded if they match any of the
 * disliked models, if their category does not align with support or
 * preferred feel preferences, or if race intent excludes slower
 * options.  This helper does not modify its inputs.
 *
 * @param {Array<object>} shoesList The list of shoes to filter
 * @param {string} message The latest user message
 * @param {Array<object>} chatHistory Previous conversation messages
 * @param {object} context Parsed user context
 * @returns {Array<object>} The filtered list of shoes
 */
export function filterShoes(shoesList, message, chatHistory, context) {
  const text = [message, ...chatHistory.map((m) => m.content)].join(' ').toLowerCase();
  return shoesList.filter((shoe) => {
    const types = shoe.types.map((t) => t.toLowerCase());
    let match = true;
    // Race intent exclusion
    if (context.raceIntent && shoe.raceReadiness === 'no') {
      match = false;
    }
    const fullName = `${shoe.brand} ${shoe.model}`.toLowerCase();
    const modelOnly = shoe.model.toLowerCase();
    for (const dislike of context.dislikes) {
      // Remove trailing s again here in case of plural
      const cleanDislike = dislike.replace(/s$/, '').trim();
      if (
        fullName.includes(cleanDislike) ||
        modelOnly.includes(cleanDislike) ||
        cleanDislike.includes(modelOnly)
      ) {
        match = false;
      }
    }
    if (text.includes('support') || text.includes('overpronation')) {
      if (!types.includes('stability')) match = false;
    }
    if (text.includes('neutral')) {
      if (types.includes('stability')) match = false;
    }
    if (context.preferredFeel === 'soft' && shoe.heelHeight < 25) match = false;
    if (context.preferredFeel === 'firm' && shoe.heelHeight > 35) match = false;
    if (context.preferredFeel === 'bouncy' && shoe.weight > 290) match = false;
    if (['10k race', 'half marathon', 'marathon'].includes(context.goal)) {
      if (types.includes('racing') || types.includes('tempo')) match = true;
    }
    return match;
  });
}

/**
 * Next.js API route handler.  Accepts a POST request with a user
 * message and chat history, parses the context, filters the shoe
 * catalogue and then asks the OpenAI model to generate a response.
 * The response includes a follow‑up question when context is missing
 * or when shoe dislikes are ambiguous.  Errors from OpenAI are
 * handled gracefully.
 *
 * @param {import('next').NextApiRequest} req Incoming HTTP request
 * @param {import('next').NextApiResponse} res Outgoing HTTP response
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message, chatHistory = [] } = req.body;
  const context = parseContext(chatHistory, message);
  console.log('Extracted context:', context);
  console.log('Race intent detected:', context.raceIntent);

  const followUp = missingContextCheck(context);
  if (followUp) {
    console.log('Follow-up question for user:', followUp);
  }

  const filteredShoes = filterShoes(shoes, message, chatHistory, context);
  console.log('Filtered shoes being sent to GPT:', filteredShoes.map((s) => s.model));
  const shoeDescriptions = filteredShoes
    .map((shoe) => {
      return `Brand: ${shoe.brand}\nModel: ${shoe.model}\nTypes: ${shoe.types.join(', ')}\nWeight: ${shoe.weight}g\nHeel Height: ${shoe.heelHeight}mm\nForefoot Height: ${shoe.forefootHeight}mm\nDrop: ${shoe.drop}mm\nNotes: ${shoe.notes || 'None'}`;
    })
    .join('\n\n');
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: `You're Cinda 👟 — a friendly, thoughtful, and slightly cheeky running shoe expert.

You help runners choose the best shoe *from the provided database only*. Never say you're using a database or list — just speak naturally, like a real expert. NEVER invent shoe names.

Here’s what you must always do:
- Keep track of what the user has said: their goals (e.g. race vs training), dislikes, foot shape, experience level, and more. Use that context when responding.
- Recommend only 1–3 shoes per message, *never more*, unless the user explicitly asks for multiple options across categories (e.g. race + daily + tempo).
- Give your reasoning. Don’t just list options — explain why each one fits and what trade-offs are involved.
- Be honest about limitations. If a shoe isn’t ideal for a specific use (e.g. racing), say so. Suggest better alternatives where helpful and explain why. Never oversell a shoe just to fill a gap.
- If the user dislikes a shoe (e.g. “didn’t like the Glycerin”), learn from that and don’t suggest similar shoes — unless you ask why they disliked it first.
- Avoid listing specs (e.g. stack height, weight) unless the user asks or it’s crucial to your reasoning. Offer to share details if they want more.
- Speak like a human. Use charm, contractions, and stay conversational — not robotic.
- Adapt to the user’s experience level. Use simpler language if they seem new to running.
- Always ask at least one smart follow-up question if the prompt is vague or missing key info (like running goals, terrain, feel preference, fit issues, etc).
- Never repeat shoes that have already been suggested unless you're revisiting them deliberately.
- Never make up new shoes or brands. Stick strictly to what’s in the list below.

Shoes you can recommend:
---
${shoeDescriptions}
---`,
        },
        ...chatHistory,
        { role: 'user', content: `${message}${followUp ? '\n\n' + followUp : ''}` },
      ],
    });
    const reply = completion.choices[0].message.content;
    res.status(200).json({ reply });
  } catch (error) {
    console.error('OpenAI Error:', error);
    res.status(500).json({ reply: 'Something went wrong talking to Cinda 😢' });
  }
}