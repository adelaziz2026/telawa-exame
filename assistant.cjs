// AI assistant: a thin proxy between the page and Claude. The model, system prompt and tool list are fixed here, so
// the page can only send the conversation. The tools act on the page itself (navigate, play, read progress, quote the
// local Mushaf), so the page runs them and sends their results back; this file never sees the user's data otherwise.
// Needs credentials for the Claude API in the server's environment (ANTHROPIC_API_KEY); the key never reaches the page.
const MODEL = 'claude-opus-5-5';
const MAX_BODY = 512 * 1024, MAX_MESSAGES = 80, PER_MINUTE = 20;

const SYSTEM = `You are the built-in assistant of «اختبار التلاوة», an Arabic web app for reviewing Quran recitation and memorisation. Users pick a surah and ayah (or a range), listen to a reciter, recite into the microphone, and get a word-by-word comparison with written notes on their mistakes.

Reply in the language the user writes in. When it is Arabic, speak as a friendly Egyptian man in Egyptian colloquial Arabic (العامية المصرية), since replies are read aloud with an Egyptian male voice; but always quote Quran text exactly as in the Mushaf, never in dialect or paraphrased. Keep replies short and conversational: they may be read aloud. Avoid tables and heavy formatting.

Quran text: never write Quranic text from memory. When you need to show, quote or check an ayah, call get_ayah_text and copy the returned text exactly; otherwise refer to ayat by surah name and number.

Use the tools to act on the app when the user asks: go_to_ayah to open a surah/ayah or a range, play_recitation to listen (optionally choosing a reciter or repetitions), set_ayah_hidden for memorisation practice, get_progress and get_app_state to see where the user is and how their reviews went. Recording can't be started for the user: when they want to be tested, open the right ayat and tell them to press «ابدأ التسميع».

Limits to be honest about: the app compares words and letters only; it does not judge tajweed, harakat or makharij, and speech recognition can mishear. For tajweed you may explain general rules, but recommend a qualified teacher to assess the user's recitation. For tafsir give brief, mainstream explanations and say they are summaries. Do not issue fatwas; for rulings, refer the user to qualified scholars.`;

// Every tool is strict: the page receives inputs that exactly match these schemas.
const TOOLS = [
  {name: 'get_app_state', description: 'Where the user is now: selected surah, ayah and range, reciter, the list of available reciters (ids and names), whether the ayah is hidden, the speech engine, and the result of the last review including its written mistake notes.', strict: true, input_schema: {type: 'object', properties: {}, additionalProperties: false, required: []}},
  {name: 'go_to_ayah', description: 'Open a surah at an ayah, optionally selecting a range up to to_ayah (at most 50 ayat) so the user can listen to or recite several ayat together.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer', description: 'Surah number, 1-114'}, ayah: {type: 'integer', description: 'First ayah number'}, to_ayah: {type: ['integer', 'null'], description: 'Last ayah of the range, or null for a single ayah'}}, additionalProperties: false, required: ['surah', 'ayah', 'to_ayah']}},
  {name: 'get_ayah_text', description: 'The exact Uthmani text of one ayah or a range (at most 20 ayat) from the app\'s local Mushaf. Use this whenever Quran text has to be shown or checked.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer'}, ayah: {type: 'integer'}, to_ayah: {type: ['integer', 'null']}}, additionalProperties: false, required: ['surah', 'ayah', 'to_ayah']}},
  {name: 'play_recitation', description: 'Play the selected ayah or range. Optionally switch the reciter (an id from get_app_state) and the number of repetitions (1, 3 or 5).', strict: true, input_schema: {type: 'object', properties: {reciter: {type: ['string', 'null'], description: 'Reciter id, or null to keep the current one'}, repeat: {type: ['integer', 'null'], enum: [1, 3, 5, null]}}, additionalProperties: false, required: ['reciter', 'repeat']}},
  {name: 'set_ayah_hidden', description: 'Hide the ayah text so the user recites from memory, or show it again.', strict: true, input_schema: {type: 'object', properties: {hidden: {type: 'boolean'}}, additionalProperties: false, required: ['hidden']}},
  {name: 'get_progress', description: 'The user\'s review history on this device: ayat reviewed, average word accuracy, daily streak, today\'s count, and the weakest ayat (lowest predicted recall) with their last scores.', strict: true, input_schema: {type: 'object', properties: {}, additionalProperties: false, required: []}},
];

let sdk;
function loadSdk() {
  if (sdk !== undefined) return sdk;
  try { const mod = require('@anthropic-ai/sdk'); sdk = mod.default || mod; } catch { sdk = null; }
  return sdk;
}
let client = null;
// Tests replace the client; otherwise one SDK client, which reads ANTHROPIC_API_KEY from the environment.
function setClient(c) { client = c; }
function getClient() {
  if (client) return client;
  const Anthropic = loadSdk();
  if (!Anthropic) return null;
  client = new Anthropic();
  return client;
}
function configured() { return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || client); }

// The page may only send ordinary user/assistant turns; anything else (system turns, other fields) is rejected.
function validMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return false;
  if (messages[0].role !== 'user') return false;
  return messages.every(m => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)) && Object.keys(m).length === 2);
}

const recent = [];
function rateLimited() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= PER_MINUTE) return true;
  recent.push(now);
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(Error('too large'), {status: 413})); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Arabic messages for the page, by failure kind.
const MESSAGES = {
  not_configured: 'المساعد غير مفعّل: يحتاج مفتاح Claude API على الخادم (ANTHROPIC_API_KEY).',
  no_sdk: 'المساعد غير مفعّل: ثبّت الحزمة بالأمر npm install في مجلد المشروع.',
  rate_limited: 'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم حاول.',
  bad_request: 'تعذّر إرسال المحادثة. ابدأ محادثة جديدة.',
  network: 'تعذّر الاتصال بخدمة Claude. تحقق من الإنترنت.',
  failed: 'حدث خطأ في المساعد. حاول مرة أخرى.',
};

async function handleAssistant(req, res, send) {
  const json = (status, body) => send(req, res, status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}, JSON.stringify(body));
  const fail = (status, code) => json(status, {error: code, message: MESSAGES[code]});
  if (req.method === 'GET') return json(200, {available: Boolean(loadSdk() || client), configured: configured(), model: MODEL});
  if (req.method !== 'POST') return send(req, res, 405, {'Allow': 'GET, POST', 'Content-Type': 'text/plain; charset=utf-8'}, 'Method not allowed');
  // Only the page itself may use the assistant (blocks other sites from spending the key through the browser).
  const origin = req.headers.origin;
  // http locally; https behind a hosting provider (Render and others terminate TLS in front of the server).
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return fail(403, 'bad_request');
  let messages;
  try { ({messages} = JSON.parse(await readBody(req))); } catch (e) { return fail(e.status || 400, 'bad_request'); }
  if (!validMessages(messages)) return fail(400, 'bad_request');
  if (!loadSdk() && !client) return fail(503, 'no_sdk');
  if (!configured()) return fail(503, 'not_configured');
  if (rateLimited()) return fail(429, 'rate_limited');
  const Anthropic = loadSdk();
  try {
    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Chat replies are short; low effort keeps them quick.
      output_config: {effort: 'low'},
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Tools and system prompt never change, so they are cached across turns.
      cache_control: {type: 'ephemeral'},
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    // The page appends `content` unchanged to its history (thinking and fallback blocks included) and runs any tool_use blocks.
    return json(200, {content: response.content, stop_reason: response.stop_reason, model: response.model});
  } catch (error) {
    console.error('assistant:', error?.status || '', error?.message || error);
    if (Anthropic && error instanceof Anthropic.AuthenticationError) return fail(503, 'not_configured');
    if (Anthropic && error instanceof Anthropic.RateLimitError) return fail(429, 'rate_limited');
    if (Anthropic && error instanceof Anthropic.BadRequestError) return fail(400, 'bad_request');
    if (Anthropic && error instanceof Anthropic.APIConnectionError) return fail(502, 'network');
    if (Anthropic && error instanceof Anthropic.APIError) return fail(502, 'failed');
    // The SDK raises a plain AnthropicError before sending when no credentials can be found.
    if (Anthropic && error instanceof Anthropic.AnthropicError) return fail(503, 'not_configured');
    return fail(500, 'failed');
  }
}

module.exports = {handleAssistant, setClient, validMessages, TOOLS, SYSTEM, MODEL};
