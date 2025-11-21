/**
 * Utility functions for the chat API. These helpers are pure and do not
 * touch external APIs so they can be unit tested easily.
 */

/**
 * Normalise a string by lower‑casing, removing punctuation, and collapsing
 * whitespace.
 *
 * @param {string} input Raw input value
 * @returns {string} A trimmed, normalised string suitable for comparison
 */
export function normaliseString(input) {
  if (!input) return '';
  let str = input.toLowerCase();
  str = str.replace(/[^a-z0-9\s+-]/g, '');
  str = str.trim().replace(/\s+/g, ' ');
  const articles = ['the', 'a', 'an', 'shoe', 'shoes', 'model'];
  for (const art of articles) {
    str = str.replace(new RegExp(`\\b${art}\\b`, 'g'), '');
  }
  str = str.replace(/\s+/g, ' ');
  const words = str.split(' ').flatMap((w) => {
    if (w.length === 1 && !/[0-9]/.test(w)) {
      return [];
    }
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) && !/us$/.test(w) && !/ics$/.test(w)) {
      return [w.slice(0, -1)];
    }
    return [w];
  });
  return words.join(' ').trim();
}

/**
 * Detect whether a phrase extracted from a dislike statement clearly refers
 * to a shoe component or feature rather than a shoe itself.
 *
 * @param {string} phrase Raw extracted phrase
 * @returns {boolean}
 */
export function isFeatureComplaint(phrase) {
  const keywords = [
    'lace',
    'laces',
    'fit',
    'fits',
    'colour',
    'color',
    'price',
    'cost',
    'style',
    'look',
    'looks',
    'pattern',
    'upper',
  ];
  const lc = phrase.toLowerCase();
  return keywords.some((k) => lc.includes(k));
}

function collectDislikes(text) {
  const dislikes = new Set();
  const dislikePatterns = [
    /(?:didn[’']t like|did not like|don't like|dislike|hate(?:d)?|not a fan of)\s+([\w\s\-\/]+?)(?=\s*(?:,|\.|;|!|\bfelt\b|\bwas\b|\bseemed\b|$))/gi,
    /(?:the\s+)?([\w\s\-\/]+?)\s+(?:was(?:n[’']t)? for me|did(?:n[’']t)? work for me|was(?:n[’']t)? my thing)/gi,
  ];

  for (const regex of dislikePatterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const raw = match[1];
      const parts = raw.split(/\s*(?:or|and|,|\/)+\s*/i);
      parts.forEach((p) => {
        const candidate = normaliseString(p);
        if (!candidate || candidate.length < 3) return;
        if (isFeatureComplaint(candidate)) return;
        dislikes.add(candidate);
      });
    }
  }

  return Array.from(dislikes);
}

/**
 * Parse a user message and chat history to extract context about the runner.
 *
 * @param {Array<{role: string, content: string}>} chatHistory
 * @param {string} message
 * @returns {object}
 */
export function parseContext(chatHistory, message) {
  const text = [...chatHistory.map((m) => m.content || ''), message || '']
    .join(' ')
    .toLowerCase();

  const context = {
    goal: null,
    preferredFeel: null,
    supportType: null,
    shoeCount: null,
    budget: null,
    dislikes: [],
    dislikeClarifications: [],
    raceIntent: false,
  };

  if (/\b5k\b/.test(text)) context.goal = '5k race';
  else if (text.includes('10k')) context.goal = '10k race';
  else if (text.includes('half marathon') || text.includes('13.1')) context.goal = 'half marathon';
  else if (text.includes('marathon') || text.includes('26.2')) context.goal = 'marathon';
  else if (text.includes('long run')) context.goal = 'long runs';
  else if (text.includes('training') || text.includes('all round') || text.includes('daily')) context.goal = 'daily training';

  if (text.includes('bouncy') || text.includes('springy') || text.includes('responsive')) {
    context.preferredFeel = 'bouncy';
  } else if (text.includes('soft') || text.includes('plush') || text.includes('cushioned')) {
    context.preferredFeel = 'soft';
  } else if (text.includes('firm') || text.includes('ground feel')) {
    context.preferredFeel = 'firm';
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
  }

  context.dislikes = collectDislikes(text);

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
  return null;
}
