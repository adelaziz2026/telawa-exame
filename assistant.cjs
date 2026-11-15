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

Limits to be honest about: the app compares words and letters only; it does not judge tajweed, harakat or makharij, and speech recognition can mishear. For tajweed you may explain general rules, but recommend a qualified teacher to assess the user's recitation. Do not issue fatwas; for rulings, refer the user to qualified scholars.

Knowledge must come from the tools, not from memory:
- Tafsir and meanings of words or ayat: call get_tafsir. Choose the book: "muyassar" (التفسير الميسّر) for a plain short meaning and by default; "saadi" (السعدي) for a clear explanation with lessons; "ibn_kathir" for tafsir by hadith and narrations, including asbab al-nuzul; "qurtubi" for rulings (ahkam) and language; "tabari" for the earliest opinions of the Companions and Successors; "baghawi" for a concise classical tafsir; "wasit" (طنطاوي) for a modern detailed one. Always use the book the user names. Explain in your own words from the returned text, keep it short, name the book, and offer more or another book. When books differ, say so instead of choosing for the user.
- "No ayah number" requests: the ayah on screen (get_app_state) is the default. When the user quotes words of an ayah instead («الآية اللي بتقول…», «قوله تعالى…»), call find_ayah first and use its surah and ayah; if exact_match is false, say it is the closest ayah. Never guess an ayah's place from memory.
- Meaning of a single word («معنى كلمة الصمد»): if the ayah on screen has the word, explain it there; otherwise find it with search_quran (phrase=true), then call get_tafsir with "muyassar" for that ayah and explain the word in its context.
- Where a word or phrase occurs in the Quran, how often, or which ayat mention a topic word: call search_quran. Whole words match with attached prefixes (و ف ب ل ك ال); partial=true matches any part of a word (derivatives such as صبر in اصبروا); phrase=true needs the words together and in order. Report ayat_count, and occurrences when asked how many times; give a few references by surah name and ayah number, and offer to open one with go_to_ayah. A topic (not a word) may need several searches with its key words. Counts are of this Mushaf's spelling; say so if a count seems surprising.
- Facts about a surah (Meccan or Medinan, number of ayat and words, juz, pages, sajda) and general Quran-sciences questions about a surah: call get_surah_info.
- Tajweed (أحكام التلاوة): for the rules in an ayah call get_tajweed (it also returns the ayah's waqf signs and the lam of «الله») (riwayat Hafs, found from the Mushaf's letters and marks) and explain them simply with the words where they occur; for what a rule or topic means (including makharij, sifat, tafkhim and tarqiq, waqf signs, sakt) call explain_tajweed_rule. You may add general tajweed knowledge (makharij, sifat, waqf signs), but say the app cannot hear tajweed in the user's voice and recommend a qualified teacher for assessment.
- Quran sciences (علوم القرآن): for counts (surahs, ayat, words, Meccan/Medinan, juz, hizb, pages, sajdas, longest/shortest surah) call get_quran_facts and use its numbers; it also lists well-established classical facts (first and last revelation, compilation, the ten qira'at). For other topics (naskh, asbab al-nuzul, i'jaz, qira'at differences, makki/madani criteria) answer from established scholarship, cautiously, say when scholars differ, and prefer get_tafsir (ibn_kathir, qurtubi) for what a specific ayah says.
- Rulings in ayat (آيات الأحكام): show the ayat (search_quran) and what Al-Qurtubi's tafsir (the classical book of ahkam) says via get_tafsir, but never give a personal fatwa.
- Hadith sciences (مصطلح الحديث): for what a term means (صحيح، حسن، ضعيف، موضوع، متواتر، آحاد، مرسل، منقطع، معضل، معلق، مدلس، شاذ، منكر، معلل، الإسناد، الجرح والتعديل…) call explain_hadith_term and explain from its definitions (Nukhbat al-Fikar, al-Bayquniyya), naming the source. For a hadith's grade, find it with search_hadith (book "six" covers the six books) and report only the grades it returns, with the scholar who gave each; for the Sahihs say it is in al-Bukhari or Muslim. If no grade is returned, say the source gives none: never grade a hadith yourself, and never call a hadith fabricated or weak from memory.
- Sunnah: only quote hadith returned by search_hadith (the six books and al-Arba'in al-Nawawiyya), always with the book and hadith number, copying the text exactly. Never quote or attribute a hadith from memory; if the search finds nothing, say so and suggest different words. Searching a large book downloads it once and can take a moment.`;

// Every tool is strict: the page receives inputs that exactly match these schemas.
const TOOLS = [
  {name: 'get_app_state', description: 'Where the user is now: selected surah, ayah and range, reciter, the list of available reciters (ids and names), whether the ayah is hidden, the speech engine, and the result of the last review including its written mistake notes.', strict: true, input_schema: {type: 'object', properties: {}, additionalProperties: false, required: []}},
  {name: 'go_to_ayah', description: 'Open a surah at an ayah, optionally selecting a range up to to_ayah (at most 50 ayat) so the user can listen to or recite several ayat together.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer', description: 'Surah number, 1-114'}, ayah: {type: 'integer', description: 'First ayah number'}, to_ayah: {type: ['integer', 'null'], description: 'Last ayah of the range, or null for a single ayah'}}, additionalProperties: false, required: ['surah', 'ayah', 'to_ayah']}},
  {name: 'get_ayah_text', description: 'The exact Uthmani text of one ayah or a range (at most 20 ayat) from the app\'s local Mushaf. Use this whenever Quran text has to be shown or checked.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer'}, ayah: {type: 'integer'}, to_ayah: {type: ['integer', 'null']}}, additionalProperties: false, required: ['surah', 'ayah', 'to_ayah']}},
  {name: 'play_recitation', description: 'Play the selected ayah or range. Optionally switch the reciter (an id from get_app_state) and the number of repetitions (1, 3 or 5).', strict: true, input_schema: {type: 'object', properties: {reciter: {type: ['string', 'null'], description: 'Reciter id, or null to keep the current one'}, repeat: {type: ['integer', 'null'], enum: [1, 3, 5, null]}}, additionalProperties: false, required: ['reciter', 'repeat']}},
  {name: 'set_ayah_hidden', description: 'Hide the ayah text so the user recites from memory, or show it again.', strict: true, input_schema: {type: 'object', properties: {hidden: {type: 'boolean'}}, additionalProperties: false, required: ['hidden']}},
  {name: 'get_tafsir', description: 'Tafsir of one ayah from a classical or modern book, as plain text (long tafsirs are truncated). Use it for meanings of words and ayat, context and explanations.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer'}, ayah: {type: 'integer'}, source: {type: 'string', enum: ['muyassar', 'saadi', 'ibn_kathir', 'qurtubi', 'tabari', 'baghawi', 'wasit'], description: 'muyassar = التفسير الميسّر (plain meanings), saadi = تفسير السعدي, ibn_kathir = تفسير ابن كثير, qurtubi = تفسير القرطبي, tabari = تفسير الطبري, baghawi = تفسير البغوي, wasit = التفسير الوسيط لطنطاوي'}}, additionalProperties: false, required: ['surah', 'ayah', 'source']}},
  {name: 'search_quran', description: 'Find ayat containing an Arabic word or phrase in the local Mushaf (diacritics ignored; whole words match with attached prefixes such as و ب ال). Returns ayat_count, occurrences (how many times it appears in all) and up to 15 ayat with their exact text.', strict: true, input_schema: {type: 'object', properties: {query: {type: 'string'}, surah: {type: ['integer', 'null'], description: 'Limit to one surah, or null for the whole Quran'}, partial: {type: 'boolean', description: 'true to match any part of a word'}, phrase: {type: 'boolean', description: 'true to need the words together and in order'}}, additionalProperties: false, required: ['query', 'surah', 'partial', 'phrase']}},
  {name: 'find_ayah', description: 'Which ayah says this? Locate an ayah from words the user quotes or half-remembers (or speech recognition misheard). Returns exact_match, and up to 5 ayat with surah, ayah and exact text; inexact matches include words_matched_percent.', strict: true, input_schema: {type: 'object', properties: {text: {type: 'string', description: 'The quoted words, in Arabic'}}, additionalProperties: false, required: ['text']}},
  {name: 'get_surah_info', description: 'Facts about a surah from the local Mushaf: name, English name and meaning, Meccan or Medinan, number of ayat and words, juz, page range, sajda ayat.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer'}}, additionalProperties: false, required: ['surah']}},
  {name: 'search_hadith', description: 'Search hadith collections in Arabic by words (diacritics ignored, all words must appear). Returns the book, hadith number, text and grades (for the Sunan: each grade with the scholar who gave it) of up to 8 matches. book "all" = al-Bukhari, Muslim and al-Nawawi\'s Forty; "six" = the six books (larger download).', strict: true, input_schema: {type: 'object', properties: {query: {type: 'string'}, book: {type: 'string', enum: ['all', 'six', 'nawawi', 'bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah']}}, additionalProperties: false, required: ['query', 'book']}},
  {name: 'explain_hadith_term', description: 'Definitions of hadith-science terms (مصطلح الحديث) from the classical texts, matched from the words given (e.g. «حديث حسن», «الفرق بين الشاذ والمنكر», «المرسل»); returns every term when none matches.', strict: true, input_schema: {type: 'object', properties: {term: {type: 'string'}}, additionalProperties: false, required: ['term']}},
  {name: 'get_tajweed', description: 'The tajweed rules (riwayat Hafs) in one ayah, found from the Uthmani text: noon sakinah and tanween (izhar, idgham, iqlab, ikhfa), meem sakinah, ghunnah, qalqalah, lam shamsiyya/qamariyya, madd types; each with the words where it occurs and how to read it.', strict: true, input_schema: {type: 'object', properties: {surah: {type: 'integer'}, ayah: {type: 'integer'}}, additionalProperties: false, required: ['surah', 'ayah']}},
  {name: 'explain_tajweed_rule', description: 'What a tajweed rule means and how to read it, by its Arabic name (e.g. إخفاء, إدغام بغنة, قلقلة, مد لازم) or group (النون الساكنة, الميم الساكنة, المدود).', strict: true, input_schema: {type: 'object', properties: {rule: {type: 'string'}}, additionalProperties: false, required: ['rule']}},
  {name: 'get_quran_facts', description: 'Quran-sciences facts counted from the app\'s Mushaf (surahs, ayat, words, Meccan/Medinan, juz, hizb, pages, manzil, sajdas, longest/shortest surahs) plus well-established classical facts.', strict: true, input_schema: {type: 'object', properties: {}, additionalProperties: false, required: []}},
  {name: 'get_progress', description: 'The user\'s review history on this device: the letters they confuse most (weak_letters, each with an articulation tip to explain in simple words), ayat reviewed, average word accuracy, daily streak, today\'s count, and the weakest ayat (lowest predicted recall) with their last scores.', strict: true, input_schema: {type: 'object', properties: {}, additionalProperties: false, required: []}},
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
