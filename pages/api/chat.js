// pages/api/chat.js

import OpenAI from 'openai';
import { parseContext, missingContextCheck } from './chat-utils';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// You can override this in .env.local with OPENAI_MODEL if you ever want to.
const MODEL_NAME = process.env.OPENAI_MODEL || 'gpt-5.1';

/**
 * Try to infer the primary running "intent" (race, tempo, long run, etc)
 * from the user message + chat history.
 */
function inferRunIntent(message, history) {
  const parts = [];

  if (Array.isArray(history)) {
    for (const m of history) {
      if (m && typeof m.content === 'string') {
        parts.push(m.content);
      }
    }
  }
  if (message) parts.push(message);

  const text = parts.join(' ').toLowerCase();

  const intent = {
    useCase: null, // 'race' | 'tempo' | 'long' | 'daily' | 'easy'
    raceDistance: null, // '5k' | '10k' | 'half' | 'marathon'
    wantsCarbon: null, // true | false | null
  };

  // Race distance
  if (/\b5k\b|5 km|5km/.test(text)) intent.raceDistance = '5k';
  if (/\b10k\b|10 km|10km/.test(text)) intent.raceDistance = '10k';
  if (/half marathon|13\.1/.test(text)) intent.raceDistance = 'half';
  if (/(full marathon|marathon|26\.2)/.test(text)) intent.raceDistance = 'marathon';

  // Obvious race intent / race shoe phrases
  const raceSignals = [
    'race shoe',
    'racing shoe',
    'race-day',
    'race day',
    'for a race',
    'race trainer',
    'race flat',
    'race flats',
    'super shoe',
    'supershoe',
    'carbon shoe',
    'plated shoe',
  ];

  if (raceSignals.some((s) => text.includes(s))) {
    intent.useCase = 'race';
  }

  // If not already race, detect other use-cases
  if (!intent.useCase) {
    if (/(tempo|threshold|intervals?|speed work|track session|reps)/.test(text)) {
      intent.useCase = 'tempo';
    } else if (/(long run|lsr|long slow run|sunday long)/.test(text)) {
      intent.useCase = 'long';
    } else if (
      /(daily trainer|everyday trainer|most of my miles|do-everything|do everything|one shoe|only shoe)/.test(
        text,
      )
    ) {
      intent.useCase = 'daily';
    } else if (/(easy day|easy days|recovery run|shakeout)/.test(text)) {
      intent.useCase = 'easy';
    }
  }

  // Wants carbon / plated
  if (/(carbon|plate|plated|super shoe|supershoe)/.test(text)) {
    intent.wantsCarbon = true;
  }

  return intent;
}

/**
 * Build the system prompt that defines how Cinda should behave.
 */
function buildSystemPrompt() {
  return `
You are Cinda, an expert running shoe advisor.

Tone:
- Friendly, honest, slightly nerdy about shoes.
- Talk like a helpful human, not a sales robot.
- Keep answers clear and not too long.

You will receive:
- "runnerContext": parsed info about the runner.
- "runnerContext.runIntent": an extra object with:
  - "useCase": "race" | "tempo" | "long" | "daily" | "easy" | null
  - "raceDistance": "5k" | "10k" | "half" | "marathon" | null
  - "wantsCarbon": true | false | null

Your job:
- Recommend 1–3 real, modern running shoes.
- Explain *why* each shoe fits the runner (goal, feel, support, experience level if obvious).
- Never make up shoes that do not exist.
- Avoid any model the runner explicitly disliked.

Context rules:
- Respect explicit dislikes: if the user hated a model, do not recommend it again.
- If they are training for a race (10k / half / marathon) and mention PBs or all-out speed, explain how each shoe fits that race goal.
- If they mention stability, overpronation, flat feet, etc, favour stability shoes.
- If they sound budget-conscious, acknowledge value and avoid pushing expensive options as the only answer.

RunRepeat:
- You can say that RunRepeat has good lab reviews and is a useful independent source.
- You may suggest: "For more detail, check the RunRepeat lab review for this shoe."
- Do not quote specific lab scores or copy their wording - just refer to them as a resource.

Output format (mandatory):
- Start with a short summary sentence of your overall view.
- Then list 1–3 recommended shoes.
  For each shoe:
  - Give 2–4 short bullet points on why it fits.
- Always end the message with a JSON block exactly like this:
  SHOES_JSON: {"recommendedShoes":[{"name":"Brand Model"}]}
  - Use real model names.
  - Keep between 1 and 3 items.
`.trim();
}

function extractShoesFromReply(replyText) {
  const shoes = [];
  if (!replyText) return { shoes, cleanedReply: '' };

  const jsonMatch = replyText.match(/SHOES_JSON\s*:\s*(\{[\s\S]*\})/i);
  if (jsonMatch) {
    const jsonBlock = jsonMatch[1];
    try {
      const parsed = JSON.parse(jsonBlock);
      const recommended = Array.isArray(parsed?.recommendedShoes) ? parsed.recommendedShoes : [];
      recommended.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          shoes.push(item.trim());
        } else if (item && typeof item.name === 'string' && item.name.trim()) {
          shoes.push(item.name.trim());
        }
      });
    } catch (err) {
      console.warn('Failed to parse SHOES_JSON block', err);
    }
  }

  const cleanedReply = jsonMatch
    ? replyText.replace(jsonMatch[0], '').trim()
    : replyText.trim();

  return { shoes, cleanedReply };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, chatHistory } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing message' });
  }

  try {
    const safeHistory = Array.isArray(chatHistory) ? chatHistory : [];

    // 1) Parse context from history + latest message (existing helper)
    const context = parseContext(safeHistory, message);

    // 2) Infer higher-level run intent (race / tempo / long / etc)
    const runIntent = inferRunIntent(message, safeHistory);

    // 3) Ask follow-up only if context is missing AND we don't already have
    //    a strong run intent that gives us enough to go on.
    let missingPrompt = missingContextCheck(context);

    if (runIntent.useCase && missingPrompt) {
      missingPrompt = null;
    }

    if (missingPrompt) {
      return res.status(200).json({
        reply: missingPrompt,
        shoes: [],
      });
    }

    // 4) Build system and user messages for GPT-5.1
    const systemPrompt = buildSystemPrompt();

    const userPayload = {
      userMessage: message,
      runnerContext: {
        ...context,
        runIntent,
      },
    };

    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `
Here is the latest user message, previous chat context, an inferred runIntent, and reminders about dislikes.

Use any modern, real running shoes that fit the context. Never invent models.

${JSON.stringify(userPayload, null, 2)}
          `.trim(),
        },
      ],
      temperature: 0.6,
    });

    const rawReply =
      completion.choices[0]?.message?.content ||
      'Sorry, I could not generate a response.';

    const { shoes, cleanedReply } = extractShoesFromReply(rawReply);

    return res.status(200).json({
      reply: cleanedReply || rawReply,
      shoes,
    });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    return res.status(500).json({
      error: 'Something went wrong talking to Cinda.',
    });
  }
}
