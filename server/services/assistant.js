// Ask — a staff member asks the PMS a question (typed, or spoken and turned
// into text by their browser) and gets a short answer plus the data behind it.
// The model never reads the database: it picks one of the read-only lookups in
// assistantTools.js, which run as the asking user with their own permissions.
// Every number in a reply comes from a lookup.
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { describeProperty } = require('./claude');
const { todayWITA } = require('./roomChargeService');
const { toolsFor, definition, LookupError } = require('./assistantTools');

const MODEL = 'claude-opus-5-5';
const MAX_ROUNDS = 5;        // lookups per question, at most
const MAX_TURNS = 12;        // earlier messages sent along
const MAX_CHARS = 500;       // per message

function isConfigured() { return !!process.env.ANTHROPIC_API_KEY; }

async function systemPrompt(propertyId, toolNames) {
  const [{ rows: [ps] }, { rows: types }] = await Promise.all([
    db.query(`SELECT property_name, market_description, market_area FROM property_settings WHERE property_id = $1`, [propertyId]),
    db.query(`
      SELECT COALESCE(rt.name, u.type, 'Other') AS name, COUNT(*)::int AS rooms, MAX(COALESCE(rt.max_guests, u.max_guests)) AS max_guests
      FROM units u LEFT JOIN room_types rt ON rt.id = u.room_type_id
      WHERE u.property_id = $1 GROUP BY 1 ORDER BY 1`, [propertyId]),
  ]);
  const today = todayWITA();
  const dayName = new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const property = describeProperty({
    name: ps?.property_name, description: ps?.market_description, area: ps?.market_area,
    rooms: types.reduce((s, t) => s + t.rooms, 0),
  });
  return `You are the assistant inside the property management system of ${property}. Hotel staff (sales, front desk, managers) ask you questions, often by voice from a phone, in Indonesian, English or a mix. Their words may come from speech recognition, so expect misheard names and spellings.

Today is ${dayName} ${today} (property time, WITA). Resolve relative dates from it: "besok", "lusa", "weekend ini" (the coming Friday and Saturday nights), "minggu depan", "akhir bulan". A date with no year means the next time that date comes.

Room types here:
${types.map(t => `- ${t.name} (${t.rooms} room${t.rooms === 1 ? '' : 's'}, up to ${t.max_guests} guests)`).join('\n')}
When a spoken room type sounds like one of these, treat it as that one.

You can look things up with: ${toolNames.join(', ')}. You cannot create, change or cancel anything, and you cannot see individual guests or bookings.

How to answer:
- Reply in the language the person used. Keep it to two or three short sentences that also work read aloud: lead with the answer, then the one or two figures that matter. The screen shows the full table under your reply, so do not list every room type or every day.
- Every number you give must come from a lookup in this conversation. Never estimate availability, prices or occupancy.
- Say prices in Rupiah the way people say them (for example "Rp 1,2 juta per malam" or "Rp 1.2 million a night"). Prices include service and tax and are room only.
- If the dates or what is wanted are unclear, ask one short question instead of guessing. If guests or rooms are not mentioned, assume 2 guests and 1 room without asking.
- A follow-up such as "kalau Deluxe?" or "one night later?" keeps the dates and party from earlier in the conversation.
- One lookup usually answers a question; never repeat a lookup day by day to build a table. If the person asks how busy or how full a period is and you have no occupancy_forecast lookup, do not work it out from check_availability: say they have no access to the forecast here and offer to check specific dates instead.
- If the question needs something you have no lookup for, say plainly that you cannot look that up here, and name the page that has it when you know it (Guest Lists, Reservations, Reports).
- No markdown, no bullet points, no emoji.`;
}

// [{ role, text }] from the browser → API messages. Text only: lookups from
// earlier questions are not resent, the model runs them again when it needs to.
function toMessages(history) {
  const turns = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map(m => ({ role: m.role, content: m.text.trim().slice(0, MAX_CHARS) }))
    .slice(-MAX_TURNS);
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

async function ask(propertyId, user, history) {
  const started = Date.now();
  const messages = toMessages(history);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    const err = new Error('A question is required'); err.status = 400; throw err;
  }
  const question = messages[messages.length - 1].content;
  const tools = toolsFor(user);
  const byName = new Map(tools.map(t => [t.name, t]));
  const usage = { input: 0, output: 0 };
  const used = [], cards = [];
  let understood = null, reply = '', error = null;

  try {
    const client = new Anthropic();
    const system = await systemPrompt(propertyId, tools.map(t => t.name));
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      // Server-side fallbacks, as in services/claude.js: a declined request is
      // retried on a fallback model inside the same call.
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system,
        tools: tools.map(definition),
        messages,
      });
      usage.input += response.usage?.input_tokens || 0;
      usage.output += response.usage?.output_tokens || 0;

      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
        error = response.stop_reason;
        break;
      }
      const calls = response.content.filter(b => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !calls.length) {
        reply = response.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
        break;
      }
      if (round === MAX_ROUNDS) { error = 'too_many_lookups'; break; }

      messages.push({ role: 'assistant', content: response.content });
      const results = await Promise.all(calls.map(async call => {
        const tool = byName.get(call.name);
        try {
          if (!tool) throw new LookupError('That lookup is not available to this user');
          const out = await tool.run(propertyId, user, call.input || {});
          used.push({ name: call.name, input: call.input });
          return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out.forModel), out };
        } catch (e) {
          if (!(e instanceof LookupError)) console.error('[Ask] lookup failed:', call.name, e.message);
          used.push({ name: call.name, input: call.input, error: e.message });
          return {
            type: 'tool_result', tool_use_id: call.id, is_error: true,
            content: e instanceof LookupError ? e.message : 'The lookup failed. Tell the user it could not be looked up right now.',
          };
        }
      }));
      // Cards and the "looked up" line in the order the lookups were asked for.
      const done = results.filter(r => r.out).map(r => r.out);
      cards.push(...done.map(o => o.card));
      if (done.length) understood = done.map(o => o.understood).join('  +  ');
      messages.push({ role: 'user', content: results.map(({ out, ...result }) => result) });
    }
  } catch (e) {
    error = e.message || 'failed';
    console.error('[Ask] failed:', error);
  }

  if (!reply) {
    reply = error === 'refusal'
      ? 'Maaf, saya tidak bisa menjawab pertanyaan itu. / Sorry, I can\'t answer that one.'
      : /connection|timed? ?out/i.test(error || '')
      ? 'Tidak bisa terhubung ke layanan AI — cek internet server, lalu coba lagi. / Could not reach the AI service — check the server\'s internet connection and try again.'
      : 'Maaf, belum bisa dijawab sekarang — coba lagi. / Sorry, that could not be answered just now — please try again.';
  }
  const duration = Date.now() - started;
  db.query(
    `INSERT INTO assistant_log (property_id, user_id, question, reply, tools, input_tokens, output_tokens, duration_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [propertyId, user.id || null, question, reply, JSON.stringify(used), usage.input, usage.output, duration, error]
  ).catch(e => console.error('[Ask] log failed:', e.message));

  return { reply, understood, cards, ok: !error, duration_ms: duration };
}

module.exports = { ask, isConfigured, MAX_CHARS };
