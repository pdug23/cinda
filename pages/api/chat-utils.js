/**
 * Utility functions for the chat API.  This module contains pure
 * helpers for normalisation, fuzzy matching and context extraction.
 * It deliberately does not import OpenAI so it can be consumed by
 * node-based unit tests without requiring external dependencies.
 */

import { shoes } from '../../data/shoes.js';

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
  const brands = ['new balance', 'on running', 'hoka', 'nike', 'asics', 'saucony', 'puma', 'adidas'];
  for (const brand of brands) {
    str = str.replace(new RegExp(`\\b${brand}\\b`, 'g'), '');
  }
  const articles = ['the', 'a', 'an', 'shoe', 'shoes', 'model'];
  for (const art of articles) {
    str = str.replace(new RegExp(`\\b${art}\\b`, 'g'), '');
  }
  str = str.replace(/[^a-z0-9\s+-]/g, '');
  str = str.trim().replace(/\s+/g, ' ');
  const words = str.split(' ').flatMap((w) => {
    // Discard isolated single letters that aren't digits (e.g. stray
    // 't' from voice dictation) but keep tokens like 'v4' which
    // contain numbers.  This helps map "t novablast" → "novablast".
    if (w.length === 1 && !/[0-9]/.test(w)) {
      return [];
    }
    // Singularise very simple plurals ending in 's' but not 'ss' or
    // latin words ending in 'us' (e.g. "Pegasus" should remain untouched).
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) && !/us$/.test(w)) {
      return [w.slice(0, -1)];
    }
    return [w];
  });
  return words.join(' ').trim();
}

/**
 * Compute the Levenshtein distance between two strings.
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
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1,
        );
      }
    }
  }
  return dp[m][n];
}

/**
 * Calculate a similarity score between two strings based on
 * Levenshtein distance.
 *
 * @param {string} a
 * @param {string} b
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
 * raw dislike string.
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
  for (const shoe of shoes) {
    const modelName = normaliseString(shoe.model);
    let score = similarity(cleaned, modelName);
    // If one string is essentially a prefix of the other (ignoring
    // numeric suffixes), bump the score to reflect a strong match.
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
 *
 * @param {string} phrase Raw extracted phrase
 * @returns {boolean}
 */
export function isFeatureComplaint(phrase) {
  const keywords = ['lace', 'laces', 'fit', 'fits', 'colour', 'color', 'price', 'cost', 'style', 'look', 'looks', 'pattern'];
  const lc = phrase.toLowerCase();
  return keywords.some((k) => lc.includes(k));
}

/**
 * Parse a user message and chat history to extract context about the
 * runner.
 *
 * @param {Array<{role: string, content: string}>} chatHistory
 * @param {string} message
 * @returns {object}
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
  if (text.includes('10k')) context.goal = '10k race';
  else if (text.includes('half marathon')) context.goal = 'half marathon';
  else if (text.includes('marathon')) context.goal = 'marathon';
  else if (text.includes('long run')) context.goal = 'long runs';
  else if (text.includes('training') || text.includes('all round')) context.goal = 'daily training';
  if (text.includes('bouncy') || text.includes('springy') || text.includes('responsive')) {
    context.preferredFeel = 'bouncy';
  } else if (text.includes('soft') || text.includes('plush') || text.includes('cushioned')) {
    context.preferredFeel = 'soft';
  } else if (text.includes('firm') || text.includes('ground feel')) {
    context.preferredFeel = 'firm';
  }
  const dislikePatterns = [
    // Matches phrases like "didn't like", "didn’t like", "did not like", "don't like", "hate"/"hated", etc.
    /(?:didn[’']t like|did not like|don't like|dislike|hate(?:d)?|not a fan of)\s+([\w\s\-\/]+?)(?=\s*(?:,|\.|;|!|\bfelt\b|\bwas\b|\bseemed\b|$))/gi,
    // Matches constructions like "X was not for me" or "X wasn’t for me".
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
        if (model && confidence >= 0.8) {
          if (!context.dislikes.includes(model)) {
            context.dislikes.push(model);
          }
        } else if (candidate.length > 2) {
          context.dislikeClarifications.push({ input: candidate, suggestion: model, confidence });
        }
      });
    }
  }
  if (text.includes('neutral')) context.supportType = 'neutral';
  else if (text.includes('stability') || text.includes('support') || text.includes('overpronation')) {
    context.supportType = 'stability';
  }
  if (text.includes('rotation') || text.includes('multiple shoes') || text.includes('two shoes')) {
    context.shoeCount = 'rotation';
  }
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
 * Check for missing high level context and ambiguous dislikes.
 *
 * @param {object} context
 * @returns {string|null}
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
  if (context.dislikeClarifications && context.dislikeClarifications.length > 0) {
    const clarifications = context.dislikeClarifications
      .map((c) => `"${c.input}"${c.suggestion ? ` (did you mean ${c.suggestion}?)` : ''}`)
      .join(', ');
    return `Just to clarify, could you confirm which shoe you disliked? I detected ${clarifications}.`;
  }
  return null;
}

/**
 * Filter the supplied list of shoes based on parsed user context and message.
 *
 * @param {Array<object>} shoesList
 * @param {string} message
 * @param {Array<object>} chatHistory
 * @param {object} context
 * @returns {Array<object>}
 */
export function filterShoes(shoesList, message, chatHistory, context) {
  const text = [message, ...chatHistory.map((m) => m.content)].join(' ').toLowerCase();
  return shoesList.filter((shoe) => {
    const types = shoe.types.map((t) => t.toLowerCase());
    let match = true;
    if (context.raceIntent && shoe.raceReadiness === 'no') {
      match = false;
    }
    const fullName = `${shoe.brand} ${shoe.model}`.toLowerCase();
    const modelOnly = shoe.model.toLowerCase();
    for (const dislike of context.dislikes) {
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