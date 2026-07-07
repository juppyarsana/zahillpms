const Anthropic = require('@anthropic-ai/sdk');

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One short, punchy sentence — the single most important takeaway this week',
    },
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short category label, e.g. "Demand", "Competitors", "Pricing", "Reputation"' },
          text: { type: 'string', description: 'One concise, specific sentence referencing real numbers from the data' },
        },
        required: ['label', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'highlights'],
  additionalProperties: false,
};

// Synthesizes already-collected market data into a structured briefing — straightforward
// summarization, not deep reasoning, so effort stays low. Structured output (rather than free
// prose) keeps the dashboard card scannable instead of one dense paragraph.
async function generateMarketSummary({ competitors, trends, holidays }) {
  const client = new Anthropic();

  const prompt = `You are a market analyst for Zahill Glamping Kintamani, a 5-unit glamping property in Kintamani, Bali. Based on the data below, produce a weekly briefing for the owner: a headline capturing the single most important takeaway, plus 2-4 highlights grouped by category (demand, competitors, pricing, reputation). Each highlight should be one concise, specific sentence referencing actual numbers from the data. Skip any category with nothing notable to report rather than padding it out.

Competitor ratings (self is marked is_self: true):
${JSON.stringify(competitors, null, 2)}

Search interest trends (0-100 relative scale):
${JSON.stringify(trends, null, 2)}

Upcoming holidays:
${JSON.stringify(holidays, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SUMMARY_SCHEMA },
    },
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock ? JSON.parse(textBlock.text) : null;
}

module.exports = { isConfigured, generateMarketSummary };
