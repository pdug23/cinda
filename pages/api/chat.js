// pages/api/chat.js

import OpenAI from 'openai';
import { shoes } from '../../data/shoes';
import {
  parseContext,
  missingContextCheck,
  filterShoes,
} from './chat-utils';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// You can override this in .env.local with OPENAI_MODEL if you ever want to.
const MODEL_NAME = process.env.OPENAI_MODEL || 'gpt-5.1';

/**
 * From the assistant's reply text, work out which shoes were mentioned
 * so the frontend can show cards / affiliate links.
 */
function extractMentionedShoesFromReply(replyText) {
  const lcReply = (replyText || '').toLowerCase();
  const mentioned = [];

  for (const shoe of shoes) {
    const fullName = `${shoe.brand} ${shoe.model}`.toLowerCase();
    const modelOnly = shoe.model.toLowerCase();

    if (lcReply.includes(fullName) || lcReply.includes(modelOnly)) {
      mentioned.push({
        brand: shoe.brand,
        model: shoe.model,
      });
    }
  }

  return mentioned;
}

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
    useCase: null,        // 'race' | 'tempo' | 'long' | 'daily' | 'easy'
    raceDistance: null,   // '5k' | '10k' | 'half' | 'marathon'
    wantsCarbon: null,    // true | false | null
  };

  // Race distance
  if (/5k|5 km|5km/.test(text)) intent.raceDistance = '5k';
  if (/10k|10 km|10km/.test(text)) intent.raceDistance = '10k';
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

  const raceModelNames = [
    'vaporfly',
    'alphafly',
    'adios pro',
    'metaspeed',
    'rocket x',
    'deviate elite',
    'fast-r',
    'fast r',
    'rc elite',
  ];

  if (
    raceSignals.some((s) => text.includes(s)) ||
    raceModelNames.some((s) => text.includes(s))
  ) {
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
        text
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
 * Helper to decide if a shoe is clearly "racey".
 */
function isRaceyShoe(shoe) {
  const types = shoe.types || [];
  const raceReadiness = shoe.raceReadiness || '';
  const name = `${shoe.brand} ${shoe.model}`.toLowerCase();

  const nameSignals = [
    'vaporfly',
    'alphafly',
    'adios pro',
    'metaspeed',
    'rocket x',
    'elite',
    'fast-r',
    'fast r',
    'rc elite',
  ];

  return (
    types.includes('race') ||
    raceReadiness === 'race' ||
    shoe.plated === true ||
    nameSignals.some((sig) => name.includes(sig))
  );
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
- "shortlistedShoes": the ONLY shoes you are allowed to recommend.

Rules about runIntent:
- If runIntent.useCase === "race":
  - Treat this as a request for a race shoe, not a daily trainer.
  - Focus on race-appropriate options (plated "super shoes" or lighter race-ready models).
  - Only mention long-run comfort if the user also clearly cares about that.
- If runIntent.useCase === "tempo":
  - Favour shoes suited to tempo/speed sessions or lighter trainers that could double for racing.
- If runIntent.useCase === "long":
  - Favour cushioned, protective shoes for longer easy runs.
- If runIntent.useCase === "easy" or "daily":
  - Favour comfortable, reliable daily trainers that match the described feel/support.

Your job:
- Use the supplied "runnerContext" and the "shortlistedShoes" to recommend 1–3 shoes.
- Explain *why* each shoe fits the runner (goal, feel, support, experience level if obvious).
- Never make up shoes that do not exist.
- Never recommend a shoe that is not in the supplied "shortlistedShoes" list.

Context rules:
- Respect explicit dislikes: if the user hated a model, do not recommend it again.
- If they are training for a race (10k / half / marathon) and mention PBs or all-out speed, explain how each shoe fits that race goal.
- If they mention stability, overpronation, flat feet, etc, favour stability shoes.
- If they sound budget-conscious, acknowledge value and avoid pushing expensive options as the only answer.

RunRepeat:
- You can say that RunRepeat has good lab reviews and is a useful independent source.
- You may suggest: "For more detail, check the RunRepeat lab review for this shoe."
- Do not quote specific lab scores or copy their wording - just refer to them as a resource.

Output style:
- Start with a short summary sentence of your overall view.
- Then list 1–3 recommended shoes.
  For each shoe:
  - Give 2–4 short bullet points on why it fits.
- If the context is still a bit fuzzy, it's OK to say what you *assume* and why.
- If there genuinely isn't a clear match, say that honestly and suggest the closest options.

Do NOT:
- Repeat the full shoe spec table (stack height, weight, etc) unless it genuinely helps the decision.
- Overwhelm with numbers. Focus on feel, use-case, and trade-offs.
  `.trim();
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

    // If we clearly know it's a race/tempo/long/etc request, don't get stuck
    // asking generic "what kind of running" questions forever.
    if (runIntent.useCase && missingPrompt) {
      // We'll skip the generic prompt and let the model handle nuance instead.
      missingPrompt = null;
    }

    if (missingPrompt) {
      return res.status(200).json({
        reply: missingPrompt,
        shoes: [],
      });
    }

    // 4) Filter shoes based on context and message (existing helper)
    const candidateShoes = filterShoes(shoes, message, safeHistory, context);

    // Base shortlist
    let shortlist = candidateShoes.length > 0 ? candidateShoes : shoes;

    // 5) Apply runIntent overrides to fix issues like "race shoe" returning a long run trainer.
    if (runIntent.useCase === 'race') {
      let raceShortlist = shortlist.filter(isRaceyShoe);

      if (!raceShortlist.length) {
        raceShortlist = shoes.filter(isRaceyShoe);
      }

      if (raceShortlist.length) {
        shortlist = raceShortlist;
      }
    } else if (runIntent.useCase === 'tempo') {
      const tempoShort = shortlist.filter((s) => {
        const types = s.types || [];
        return types.includes('tempo') || isRaceyShoe(s);
      });
      if (tempoShort.length) shortlist = tempoShort;
    } else if (runIntent.useCase === 'long') {
      const longShort = shortlist.filter((s) => {
        const types = s.types || [];
        return types.includes('long') || types.includes('easy') || types.includes('daily');
      });
      if (longShort.length) shortlist = longShort;
    } else if (runIntent.useCase === 'easy') {
      const easyShort = shortlist.filter((s) => {
        const types = s.types || [];
        return types.includes('easy') || types.includes('recovery') || types.includes('daily');
      });
      if (easyShort.length) shortlist = easyShort;
    } else if (runIntent.useCase === 'daily') {
      const dailyShort = shortlist.filter((s) => {
        const types = s.types || [];
        return types.includes('daily') || types.length > 1; // multi-purpose shoes
      });
      if (dailyShort.length) shortlist = dailyShort;
    }

    // 6) Build system and user messages for GPT-5.1
    const systemPrompt = buildSystemPrompt();

    const userPayload = {
      userMessage: message,
      runnerContext: {
        ...context,
        runIntent,
      },
      shortlistedShoes: shortlist.map((s) => ({
        brand: s.brand,
        model: s.model,
        types: s.types,
        raceReadiness: s.raceReadiness,
        plated: s.plated,
        heelHeight: s.heelHeight,
        forefootHeight: s.forefootHeight,
      })),
    };

    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `
Here is the latest user message, previous chat context, an inferred runIntent, and the list of shoes you are allowed to pick from.

You MUST ONLY recommend shoes from the "shortlistedShoes" array.
If nothing is suitable, explain why and suggest the closest options.

${JSON.stringify(userPayload, null, 2)}
          `.trim(),
        },
      ],
      temperature: 0.6,
    });

    const reply =
      completion.choices[0]?.message?.content ||
      'Sorry, I could not generate a response.';
    const mentionedShoes = extractMentionedShoesFromReply(reply);

    return res.status(200).json({
      reply,
      shoes: mentionedShoes,
    });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    return res.status(500).json({
      error: 'Something went wrong talking to Cinda.',
    });
  }
}
