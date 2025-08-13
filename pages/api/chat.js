import { shoes } from '../../data/shoes';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function normaliseDislikeName(name) {
  return name
    .toLowerCase()
    .replace(/\b(hoka|nike|asics|new balance|saucony|puma|adidas)\b/g, '')
    .replace(/\b(shoes?|the|a|an)\b/g, '')
    .replace(/[^a-z0-9\s+-]/g, '')
    .replace(/\bt\b/g, '')
    .trim();
}

function missingContextCheck(context) {
  if (!context.goal) {
    return "What kind of running are you mainly using the shoes for? (e.g. daily training, long runs, racing)";
  }
  if (!context.preferredFeel) {
    return "Do you prefer something soft and cushioned, or more firm and responsive underfoot?";
  }
  if (!context.supportType) {
    return "Do you usually run in neutral shoes, or do you benefit from added stability or support?";
  }
  return null; // skip shoeCount and budget unless prompted
}


function parseContext(chatHistory, message) {
  const text = [...chatHistory.map(m => m.content), message].join(' ').toLowerCase();

  const context = { 
    goal: null,
    preferredFeel: null,
    supportType: null,
    shoeCount: null,
    budget: null,
    dislikes: [],
    raceIntent: false
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

  const stopWords = [
    'either', 'too', 'also', 'though', 'however', 'still', 'really',
    'much', 'very', 'kind of', 'sort of', 'at all', 'actually', 'but',
    'one', 'ones', 'both', 'all', 'just', 'so', 'didnt', 'don\'t',
    'didn’t', 'dont', 'like', 'love', 'hate', 'not', 'fan', 'a fan of',
    'tbh', 'imo', 'idk', 'to be honest', 'honestly'
  ];

  const removeStopWords = (input) => {
    return input
      .split(/\s+/)
      .filter(word => !stopWords.includes(word.trim()))
      .join(' ')
      .trim();
  };

  const dislikePatterns = [
    /(?:didn’t like|did not like|don't like|dislike|hate|not a fan of)\s+([\w\s\-\/]+?)(?=\s*(?:,|\.|;|!|\bor\b|\band\b|\bfelt\b|\bwas\b|\bseemed\b|$))/gi,
    /(?:the\s+)?([\w\s\-\/]+?)\s+(?:was(?:n’t|n't) for me|was not for me|did(?:n’t|n't) work for me|did not work for me|was(?:n’t|n't) my thing|was not my thing)/gi
  ];

  for (const regex of dislikePatterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const raw = match[1];
      const parts = raw.split(/\s*(?:or|and|,|\/)\s*/i);
      parts.forEach(p => {
        let cleaned = normaliseDislikeName(p);
        cleaned = removeStopWords(cleaned);
        if (cleaned.length > 2 && !context.dislikes.includes(cleaned)) {
          context.dislikes.push(cleaned);
        }
      });
    }
  }

    // Basic support type detection
  if (text.includes('neutral')) context.supportType = 'neutral';
  else if (text.includes('stability') || text.includes('support') || text.includes('overpronation')) {
    context.supportType = 'stability';
  }

  // Optional clues about shoe count
  if (text.includes('rotation') || text.includes('multiple shoes') || text.includes('two shoes')) {
    context.shoeCount = 'rotation';
  }

  // Optional clues about budget
  if (
    text.includes('budget') || 
    text.includes('cheap') || 
    text.includes('don’t want to spend') || 
    text.includes('don\'t want to spend') || 
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

function filterShoes(shoes, message, chatHistory, context) {
  const text = [message, ...chatHistory.map(m => m.content)].join(' ').toLowerCase();

  return shoes.filter(shoe => {
    const types = shoe.types.map(t => t.toLowerCase());
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
  console.log('Filtered shoes being sent to GPT:', filteredShoes.map(s => s.model));

  const shoeDescriptions = filteredShoes.map(shoe => {
    return `Brand: ${shoe.brand}
Model: ${shoe.model}
Types: ${shoe.types.join(', ')}
Weight: ${shoe.weight}g
Heel Height: ${shoe.heelHeight}mm
Forefoot Height: ${shoe.forefootHeight}mm
Drop: ${shoe.drop}mm
Notes: ${shoe.notes || 'None'}`;
  }).join('\n\n');

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
---`
}
,
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
