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
 * Build the system prompt that defines how Cinda should behave.
 */
function buildSystemPrompt() {
  return `
You are Cinda, an expert running shoe advisor.

Tone:
- Friendly, honest, slightly nerdy about shoes.
- Talk like a helpful human, not a sales robot.
- Keep answers clear and not too long.

Your job:
- Use the supplied "context" about the runner and the filtered shoe list to recommend 1–3 shoes.
- Explain *why* each shoe fits the runner (goal, feel, support, experience level if obvious).
- Never make up shoes that do not exist.
- Never recommend a shoe that is not in the supplied shoe list.

Context rules:
- Respect explicit dislikes: if the user hated a model, do not recommend it again.
- If they are training for a race (10k / half / marathon) and say things like "PB" or "as fast as possible", favour shoes tagged for tempo/racing/race-readiness.
- If they mention stability, overpronation, flat feet, etc, favour stability shoes.
- If they sound budget-conscious (words like cheap, affordable, don't want to spend much), mention value and avoid sounding pushy.

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
- If there genuinely isn't a clear match, say that honestly and suggest the closest thing.

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

    // 1) Parse context from history + latest message
    const context = parseContext(safeHistory, message);

    // 2) If key context is missing, ask a follow-up question instead of calling OpenAI
    const missingPrompt = missingContextCheck(context);
    if (missingPrompt) {
      return res.status(200).json({
        reply: missingPrompt,
        shoes: [],
      });
    }

    // 3) Filter shoes based on context and message
    const candidateShoes = filterShoes(shoes, message, safeHistory, context);

    // If filtering is too aggressive and nothing is left, fall back to all shoes.
    const shortlist = candidateShoes.length > 0 ? candidateShoes : shoes;

    // 4) Build system and user messages for GPT-5.1
    const systemPrompt = buildSystemPrompt();

    const userPayload = {
      userMessage: message,
      runnerContext: context,
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
Here is the latest user message, previous chat context, and the list of shoes you are allowed to pick from.

You MUST ONLY recommend shoes from the "shortlistedShoes" array.
If nothing is suitable, explain why and suggest the closest options.

${JSON.stringify(userPayload, null, 2)}
          `.trim(),
        },
      ],
      temperature: 0.6,
    });

    const reply = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
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
