// AI assistant panel: chat and voice with Claude (through the local server's /api/assistant), which can act on the
// app through the tools below. The conversation is kept append-only, exactly as the API returns it.
(function(){
const $=id=>document.getElementById(id);
if(!$('aiFab'))return;
const MAX_STEPS=8;
let history=[],busy=false,status=null,recognizer=null;
let speakOn=false;try{speakOn=localStorage.getItem('tarteel:aiSpeak')==='1';}catch{}

// ---------- Tools: run on the page, return plain data for the model ----------
const surahName=n=>surahs[n-1]?.name||'';
// How a place is said aloud: «سورة الملك، الآية 1» (no diacritics, words instead of a bare number).
const place=(s,nums)=>`${QuranCompare.normalize(surahName(s))}، ${nums.length>1?`الآيات ${nums[0]} إلى ${nums.at(-1)}`:`الآية ${nums[0]}`}`;
function checkAyah(surah,ayah){
 if(loading)throw Error('The Mushaf is still loading; try again in a moment.');
 if(!surahs[surah-1])throw Error(`Surah ${surah} does not exist (1-114).`);
 if(!surahs[surah-1].ayahs[ayah-1])throw Error(`Surah ${surah} has ${surahs[surah-1].ayahs.length} ayat.`);
}
// Results show the Uthmani text the page displays, not the simple edition used for matching.
const uthmani=x=>({surah:x.surah,surah_name:surahName(x.surah),ayah:x.ayah,text:surahs[x.surah-1].ayahs[x.ayah-1].text});
const tools={
 get_app_state(){
  if(loading)return {loading:true};
  const s=Number($('surah').value),nums=rangeNumbers();
  return {
   surah:{number:s,name:surahName(s),ayat_count:surahs[s-1].ayahs.length},ayah:nums[0],to_ayah:nums.length>1?nums.at(-1):null,
   reciter:{id:$('reciter').value,name:reciter().name},reciters:Object.entries(RECITERS).map(([id,r])=>({id,name:r.name})),
   repeat:Number($('repeat').value)||1,ayah_hidden:$('hide').checked,speech_engine:engine(),
   last_review:{summary:$('resultLabel').textContent,notes:[...document.querySelectorAll('#notesList .note-text')].map(n=>n.textContent)},
  };
 },
 go_to_ayah({surah,ayah,to_ayah}){
  checkAyah(surah,ayah);goTo(surah,ayah);
  if(to_ayah&&to_ayah>ayah){const last=Math.min(to_ayah,surahs[surah-1].ayahs.length,ayah+49);$('ayahEnd').value=last;$('ayahEnd').onchange?.();}
  const nums=rangeNumbers();
  return {opened:place(surah,nums)};
 },
 get_ayah_text({surah,ayah,to_ayah}){
  checkAyah(surah,ayah);
  const last=Math.min(Math.max(ayah,to_ayah||ayah),surahs[surah-1].ayahs.length,ayah+19);
  const out={surah:surahName(surah),ayat:[]};
  if(ayah===1&&surahs[surah-1].basmala)out.basmala_before_ayah_1=surahs[surah-1].basmala;
  for(let a=ayah;a<=last;a++)out.ayat.push({ayah:a,text:surahs[surah-1].ayahs[a-1].text});
  return out;
 },
 play_recitation({reciter:id,repeat}){
  if(loading)throw Error('The Mushaf is still loading.');
  if(id){if(!RECITERS[id])throw Error(`Unknown reciter id "${id}". Valid ids: ${Object.keys(RECITERS).join(', ')}`);$('reciter').value=id;$('reciter').onchange();}
  if(repeat){$('repeat').value=String(repeat);$('repeat').onchange?.();}
  $('listen').click();
  const nums=rangeNumbers();
  return {playing:place(Number($('surah').value),nums),reciter:reciter().name,repeat:Number($('repeat').value)||1};
 },
 set_ayah_hidden({hidden}){if($('hide').checked!==hidden){$('hide').checked=hidden;$('hide').onchange();}return {hidden};},
 // ---- Knowledge: tafsir, Quran word search, surah facts, hadith (all from sources, never from memory) ----
 async get_tafsir({surah,ayah,source}){
  checkAyah(surah,ayah);
  const t=await QuranKnowledge.tafsir(source||'muyassar',surah,ayah);let text='';
  for(const p of t.paragraphs){if(text.length+p.length>6000){text+=' …';break;}text+=(text?'\n':'')+p;}
  return {source:t.name,author:t.by,covers_ayat:t.verses,text:text||'(no tafsir text for this ayah in this source)'};
 },
 search_quran({query,surah,partial,phrase}){
  if(loading)throw Error('The Mushaf is still loading.');
  const r=QuranKnowledge.searchQuran(simple,query,{surah:surah||null,partial:!!partial,phrase:!!phrase,limit:15});
  return {query:r.query,ayat_count:r.total,occurrences:r.occurrences,results:r.results.map(uthmani)};
 },
 find_ayah({text}){
  if(loading)throw Error('The Mushaf is still loading.');
  const r=QuranKnowledge.findAyah(simple,text,{limit:5});
  return {query:r.query,exact_match:r.exact,total:r.total,results:r.results.map(x=>({...uthmani(x),...(x.match?{words_matched_percent:x.match}:{})}))};
 },
 get_surah_info({surah}){if(loading)throw Error('The Mushaf is still loading.');return QuranKnowledge.surahInfo(surahs,surah);},
 // «all»: the two Sahihs and al-Nawawi's Forty; «six»: the six books, with grades for the Sunan by named scholars.
 search_hadith({query,book}){const books=!book||book==='all'?undefined:book==='six'?['bukhari','muslim','abudawud','tirmidhi','nasai','ibnmajah']:[book];return QuranKnowledge.searchHadith(query,{books,onLoading:name=>chip(`تحميل ${name} لأول مرة… قد يستغرق لحظات`)});},
 explain_hadith_term({term}){
  const hits=QuranKnowledge.findMustalah(term);
  return {source:QuranKnowledge.MUSTALAH_SOURCE,matched:hits.length>0,terms:(hits.length?hits:Object.entries(QuranKnowledge.MUSTALAH).map(([k,v])=>({term:k,...v}))).map(x=>({term:x.term,group:x.group,definition:x.def}))};
 },
 // Tajweed rules in an ayah (Hafs), found from the Uthmani text on the device.
 get_tajweed({surah,ayah}){
  checkAyah(surah,ayah);
  const text=surahs[surah-1].ayahs[ayah-1].text;
  return {surah,surah_name:surahName(surah),ayah,riwaya:'حفص عن عاصم',rules:QuranKnowledge.tajweed(text).map(r=>({rule:r.name,group:r.group,words:r.words,how_to_read:r.how})),waqf_signs:QuranKnowledge.waqfSigns(text).map(w=>({sign:w.sign,meaning:w.meaning,after_word:w.after}))};
 },
 explain_tajweed_rule({rule}){
  // Word by word, without «ال» and words like «أنواع/أحكام»: «انواع المد» → every madd, «النون الساكنة» → its four rules.
  const words=w=>norm(w).split(' ').map(x=>x.replace(/^و?ال(?=..)/,'')).filter(x=>x.length>1&&!/^(انواع|نوع|احكام|حكم|اشرح|اشرحلي|يعني|ايه|ما|هو|هي|معني)$/.test(x));
  // The rules found in ayat, and the recitation topics (makharij, sifat, waqf signs, sakt, the lam of «الله»).
  const k=words(rule),all=[...Object.values(QuranKnowledge.TAJWEED_RULES),...Object.entries(QuranKnowledge.RECITATION_TOPICS).map(([name,v])=>({name,...v}))];
  const hits=k.length?all.filter(r=>{const own=words(r.name+' '+r.group);return k.every(x=>own.some(o=>o===x||o.startsWith(x)));}):[];
  return {rules:(hits.length?hits:all).map(r=>({rule:r.name,group:r.group,how_to_read:r.how})),matched:hits.length>0};
 },
 get_quran_facts(){if(loading)throw Error('The Mushaf is still loading.');return QuranKnowledge.quranFacts(surahs);},
 get_progress(){
  const keys=Object.keys(scores),values=Object.values(scores),now=Date.now();
  const weakest=keys.map(key=>{const [s,a]=key.split(':').map(Number),words=simple[s-1]?.ayahs[a-1]?.text.split(/\s+/).length||1,p=QuranLearning.recall(brain,key,now,words);return {surah:s,ayah:a,name:surahName(s),last_score:scores[key],predicted_recall:Math.round((p??scores[key]/100)*100)};})
   .filter(w=>w.name).sort((x,y)=>x.predicted_recall-y.predicted_recall).slice(0,5);
  return {weak_letters:typeof weakLetters==='function'?weakLetters().map(l=>({read_as:l.spoken,instead_of:l.expected,times:l.count,articulation_tip:l.tip})):[],ayat_reviewed:keys.length,average_accuracy:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null,streak_days:streak(activity),reviews_today:activity[day()]||0,weakest};
 },
};
// A short Arabic label shown in the chat for each action.
const actionLabel={explain_hadith_term:'مصطلح الحديث',get_tajweed:'أحكام التجويد',explain_tajweed_rule:'شرح حكم التجويد',get_quran_facts:'علوم القرآن',get_tafsir:'قراءة التفسير',search_quran:'البحث في المصحف',find_ayah:'البحث عن الآية',get_surah_info:'معلومات السورة',search_hadith:'البحث في كتب السنة',get_app_state:'قراءة حالة التطبيق',go_to_ayah:'فتح الآية',get_ayah_text:'قراءة نص الآية من المصحف',play_recitation:'تشغيل التلاوة',set_ayah_hidden:'إخفاء/إظهار الآية',get_progress:'قراءة تقدمك'};

// ---------- Chat log ----------
function bubble(role,text){
 const div=document.createElement('div');div.className=`ai-msg ai-${role}`;
 // **bold** is the only formatting kept; everything else is plain text (never HTML).
 for(const part of String(text).split(/(\*\*[^*]+\*\*)/))if(part)div.append(part.startsWith('**')?Object.assign(document.createElement('strong'),{textContent:part.slice(2,-2)}):part.replace(/^#+\s*/gm,''));
 $('aiLog').append(div);div.scrollIntoView?.({block:'end',behavior:'smooth'});
 return div;
}
function chip(text,error){const d=bubble('action',(error?'⚠️ ':'⚙️ ')+text);if(error)d.classList.add('ai-action-error');}
function setBusy(on){
 busy=on;$('aiSend').disabled=on;$('aiTyping').hidden=!on;
 if(on)$('aiTyping').scrollIntoView?.({block:'end'});
}

// ---------- Voice ----------
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
// The assistant speaks as an Egyptian man: the best Arabic voice scores Egyptian (ar-EG), male, then natural-sounding.
// Voice names are often in Arabic (e.g. «Microsoft شاكر Online (Natural) - Arabic (Egypt)»), so both spellings count.
const MALE=/شاكر|shakir|حامد|hamed|نايف|naayf|حمدان|hamdan|علي|\bali\b|إسماعيل|ismael|باسل|bassel|تيم|taim|فهد|fahed|رامي|rami|أحمد|ahmed|جمال|jamal|عبدالله|abdullah|معاذ|moaz|ليث|laith|هادي|hedi|صالح|saleh|\bmale\b/i;
const FEMALE=/هدى|hoda|سلمى|salma|فاطمة|fatima|ليلى|layla|أمينة|amina|رنا|rana|سناء|sana|نورا|noura|إيمان|iman|منى|mouna|عائشة|aysha|أمل|amal|زارية|zariyah|أماني|amany|ريم|reem|مريم|maryam|female/i;
function arabicVoice(){
 const score=v=>(/^ar-EG/i.test(v.lang)?4:0)+(MALE.test(v.name)?3:FEMALE.test(v.name)?-3:0)+(/natural|online/i.test(v.name)?1:0);
 return speechSynthesis.getVoices().filter(v=>/^ar/i.test(v.lang)).sort((a,b)=>score(b)-score(a))[0]||null;
}
function speak(text){
 if(!speakOn||!globalThis.speechSynthesis)return;
 const clean=text.replace(/[*#`_>]/g,'').trim();if(!clean)return;
 const arabic=/[؀-ۿ]/.test(clean),utter=new SpeechSynthesisUtterance(clean);
 if(arabic){
  const voice=arabicVoice();utter.lang=voice?.lang||'ar-EG';if(voice)utter.voice=voice;
  // Only a female voice available (e.g. offline with just «Hoda»): a lower pitch sounds closer to a man's voice.
  if(!voice||!MALE.test(voice.name))utter.pitch=0.7;
  utter.rate=0.95;
 }else{utter.lang='en-US';const voice=speechSynthesis.getVoices().find(v=>/^en/i.test(v.lang));if(voice)utter.voice=voice;}
 speechSynthesis.speak(utter);
}
function updateSpeak(){$('aiSpeak').setAttribute('aria-pressed',String(speakOn));$('aiSpeak').textContent=speakOn?'🔊':'🔈';$('aiSpeak').title=speakOn?'إيقاف قراءة الردود':'قراءة الردود بصوت';}
$('aiSpeak').onclick=()=>{speakOn=!speakOn;try{localStorage.setItem('tarteel:aiSpeak',speakOn?'1':'0');}catch{}if(!speakOn)globalThis.speechSynthesis?.cancel();updateSpeak();};
updateSpeak();
if(!Recognition){$('aiMic').disabled=true;$('aiMic').title='التحدث غير مدعوم في هذا المتصفح — جرّب Chrome أو Edge';}
$('aiMic').onclick=()=>{
 if(recognizer){recognizer.stop();return;}
 globalThis.speechSynthesis?.cancel();
 recognizer=new Recognition();recognizer.lang='ar-EG';recognizer.interimResults=true;
 const before=$('aiInput').value;
 recognizer.onresult=e=>{$('aiInput').value=(before+' '+Array.from(e.results,r=>r[0].transcript).join(' ')).trim();};
 recognizer.onerror=e=>{if(e.error==='not-allowed')chip('لم يُسمح بالميكروفون.',true);};
 // Speaking ends the turn: send what was heard.
 recognizer.onend=()=>{recognizer=null;$('aiMic').classList.remove('on');if($('aiInput').value.trim()&&!busy)ask($('aiInput').value);};
 $('aiMic').classList.add('on');recognizer.start();
};

// ---------- Local mode: common commands without Claude (no key, no internet needed) ----------
// Letters are normalised like the Mushaf comparison, but digits are kept and ة/ه are treated alike.
const norm=t=>String(t).normalize('NFKC').replace(/[ؐ-ًؚ-ٟۖ-ۭـ]/g,'').replace(/ٰ/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^ء-ي0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const NUMBER_WORDS={واحد:1,واحده:1,اثنين:2,اثنتين:2,مرتين:2,ثلاث:3,ثلاثه:3,اربع:4,اربعه:4,خمس:5,خمسه:5};
// Surah names with and without the dagger alif (ٱلرَّحۡمَٰن is said «الرحمن» or «الرحمان»), and without «ال».
let surahNames=null;
function namesOf(s){
 const raw=s.name.normalize('NFKC').replace(/^سُورَةُ\s*/,'');
 const forms=new Set([norm(raw),norm(raw.replace(/ٰ/g,'ا'))].map(n=>n.replace(/^سوره /,'')));
 for(const f of [...forms])if(f.startsWith('ال')&&f.length>4)forms.add(f.slice(2));
 return [...forms];
}
// Other names surahs are known by, recognised after «سورة» («سورة الانشراح»، «سورة بني إسرائيل»).
const SURAH_ALIASES={'الانشراح':94,'الم نشرح':94,'بني اسرائيل':17,'الاسراء':17,'براءه':9,'المؤمن':40,'حم السجده':41,'الدهر':76,'هل اتي':76,'القتال':47,'تبت':111,'اللهب':111,'عم':78,'عم يتساءلون':78,'التوحيد':112,'ام الكتاب':1,'السبع المثاني':1,'الملائكه':35,'الشريعه':45,'المجادله':58,'التطفيف':83,'قريش':106,'لايلاف قريش':106};
function findSurahIn(t){
 for(const [alias,n] of Object.entries(SURAH_ALIASES).sort((a,b)=>b[0].length-a[0].length))if(new RegExp(`سوره ${alias}(?: |$)`).test(t))return n;
 const byNumber=t.match(/سوره (?:رقم )?(\d+)/);if(byNumber&&+byNumber[1]>=1&&+byNumber[1]<=114)return +byNumber[1];
 surahNames??=surahs.map(s=>({n:s.number,forms:namesOf(s)}));
 let best=null;
 for(const {n,forms}of surahNames)for(const f of forms){
  // Very short names (ق، ص، ن، طه…) only count after the word «سورة».
  const re=f.length<=3?new RegExp(`سوره ${f}(?: |$)`):new RegExp(`(?:^| )(?:سوره )?${f}(?: |$)`);
  if(re.test(t)&&(!best||f.length>best.len))best={n,len:f.length};
 }
 if(best)return best.n;
 // A misheard or misspelled name («افتح الفتحه»، «سورة الفاتح»): only the word right after «سورة» or after a command,
 // so ordinary words in a sentence («ابحث عن الصبر») never turn into a surah.
 const said=t.match(/(?:^| )(?:(?:افتح|افتحلي|روح ل|روحلي|وديني|شغل|شغلي|اقرا|اقرالي|تفسير)(?: سوره)?|سوره) (\S+)/)?.[1];
 return said&&!/^(?:سوره|الايه|ايه|رقم|القران|المصحف)$/.test(said)?QuranKnowledge.closestSurah(surahs,said):null;
}
// Whole words only, with or without «ال»: «علي» in a reciter's name must not match «عليكم».
function findReciter(t){
 let best=null;const tokens=t.split(' ');
 for(const [id,r]of Object.entries(RECITERS)){
  const words=norm(r.name).split(' ').filter(w=>w.length>=3);
  const hits=words.filter(w=>tokens.some(k=>k===w||k===w.replace(/^ال/,'')||'ال'+k===w)).length;
  if(hits&&(!best||hits>best.hits))best={id,hits};
 }
 return best?.id??null;
}
function repeatIn(t){
 const m=t.match(/(\d+|[^\s]+) مر(?:ات|ه)/)||t.match(/(مرتين)/);if(!m)return null;
 const n=+m[1]||NUMBER_WORDS[m[1]]||null;if(!n)return null;
 return [1,3,5].reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a);
}
// Local replies are in Egyptian colloquial Arabic, matching the Egyptian voice.
const CAN='أقدر من غير إنترنت أفتحلك سورة أو آية («افتح سورة الكهف»، «آية الكرسي»، «البقرة من آية 1 لحد 5»)، وأشغّلك التلاوة بصوت أي شيخ («شغّلها بصوت الحصري 3 مرات»)، وأخبّيلك الآية عشان تسمّع من حفظك، وأروح للآية اللي بعدها أو اللي قبلها، وأورّيك الآيات اللي محتاجة مراجعة، وأشرحلك أخطاء آخر تسميع، وأدوّرلك على أي كلمة في القرآن أو في سورة معيّنة («كلمة الصبر في سورة البقرة»، «في أي سورة وردت كلمة الكوثر»).';
// Runs one tool through the same path as Claude's tool calls, so the chat shows the same action chips.
function act(name,input){const out=tools[name](input);chip(actionLabel[name]||name);return out;}
// Knowledge requests in local mode, in Egyptian or standard phrasing (t is normalised, raw is what the user typed):
//  tafsir:        «فسّر الآية»، «تفسير ابن كثير لآية الكرسي»، «يعني ايه الآية دي»، then «وعند السعدي؟» or «كمّل»
//  word meaning:  «معنى كلمة الصمد»، «يعني ايه الفلق»
//  find an ayah:  «فين الآية اللي بتقول وجعلنا من الماء كل شيء حي»، «فسّر قوله تعالى إن مع العسر يسرا»، then «افتحها»
//  word search:   «ابحث عن كلمة الصبر»، «كام مرة اتذكرت الجنة»، «ابحث عن الرحمة في سورة الكهف»، then «افتح النتيجة 2»
//  surah facts and hadith: «معلومات عن سورة الكهف»، «حديث عن النية»
// Returns the reply, or null if the message is not such a request.
let lastTafsir=null,lastResults=null;
const SOURCES=[['saadi',/سعدي/],['ibn_kathir',/كثير/],['qurtubi',/قرطبي/],['tabari',/طبري/],['baghawi',/بغوي/],['wasit',/وسيط|طنطاوي/],['muyassar',/ميسر/]];
const sourceIn=t=>SOURCES.find(([,re])=>re.test(t))?.[0]||null;
const ORDINALS={الاولي:1,الاول:1,اول:1,التانيه:2,التاني:2,تاني:2,الثانيه:2,التالته:3,التالت:3,الثالثه:3,الرابعه:4,الخامسه:5};
// Words that point at the ayah on screen rather than naming a word: «يعني ايه الآية دي».
const POINTER=/^(?:(?:ال)?ايه|الايات|دي|ده|دا|سوره|السوره|هذه)(?: |$)/;
const nameOf=n=>QuranCompare.normalize(surahName(n));
// Counted nouns agree with the number as in speech: آية واحدة، آيتين، 5 آيات، 42 آية.
const count=(n,one,two,few,unit)=>n===1?one:n===2?two:n<=10?`${n} ${few}`:`${n} ${unit}`;
const ayat=n=>count(n,'آية واحدة','آيتين','آيات','آية'),times=n=>count(n,'مرة واحدة','مرتين','مرات','مرة');
const refs=list=>list.map((x,i)=>`${i+1}) ${nameOf(x.surah)} ${x.ayah}`).join('، ');
// «هل سفيه موجودة بالقرآن»، «هل ذكرت مصر في القرآن»: one or two words asked about, not a question that merely ends in «القرآن».
const WORD_IN_QURAN=/^(?!كم |كام |ما |ايه |مين |عدد |اول |اخر |اطول |اقصر )(?:هل )?(?:(?:يوجد|توجد|فيه|ورد|وردت|ذكر|ذكرت|جاء|جاءت|جت) )?(?:(?:كلمه|لفظ|لفظه) )?(\S+(?: \S+)?) (?:(?:موجوده?|مذكوره?) )?(?:بالقران|بالمصحف|(?:في|فى) (?:القران|المصحف))(?: الكريم)?$/;
// A word asked about inside one surah, or across the surahs. One or two words only, so a quoted ayah or a command is left alone.
const ASK_WORD='(?!(?:افتح|افتحلي|شغل|شغلي|اقرا|اقرالي|سمع|سمعني|روح|وديني|تفسير|فسر|معني|ايه|الايه|ايات|الايات|اخر|اول|كم|كام|عدد|ما|ماذا|مين|ابحث|ابحثلي|دور|دورلي|فين|اطول|اقصر|هل|ترتيب|اسم|احكام|تجويد)(?: |$))([^\\s\\d]+(?: [^\\s\\d]+)?)';
const WORD_NOUN='(?:(?:كلمه|لفظ|لفظه) )?',WORD_LEAD='(?:هل )?(?:(?:يوجد|توجد|فيه|ورد|وردت|ذكر|ذكرت|جاء|جاءت|جت|اتذكرت) )?'+WORD_NOUN,WORD_STATE='(?:(?:موجوده?|مذكوره?|وردت|ذكرت|جت) )?';
const WORD_IN_SURAH=new RegExp(`^${WORD_LEAD}${ASK_WORD} ${WORD_STATE}(?:في|فى|ب) ?سوره (?!\\d)(.+)$`);
const SURAH_HAS_WORD=[new RegExp(`^(?:هل )?(?:(?:في|فى) )?سوره (?!\\d)(.+?) (?:(?:فيها|فيه|بها) )?(?:كلمه|لفظ|لفظه) ${ASK_WORD}$`),new RegExp(`^(?:هل )?سوره (?!\\d)(\\S+(?: \\S+)?) (?:فيها|فيه|بها) ${ASK_WORD}$`)];
const WORD_ACROSS_SURAHS=[new RegExp(`^(?:(?:في|فى) )?(?:اي|انهي|ايه) (?:سوره|سور|السور)(?: (?:اللي )?(?:وردت|ورد|ذكرت|ذكر|جت|جاءت|موجوده?))?(?: (?:فيها|فيه|بها))? ${WORD_NOUN}${ASK_WORD}$`),new RegExp(`^(?:هل )?(?:(?:ابحث|ابحثلي|دور|دورلي) (?:(?:عن|علي) )?)?${WORD_NOUN}${ASK_WORD} ${WORD_STATE}(?:في|فى) (?:(?:اي|انهي) سوره|(?:كل |جميع )?السور|سور القران)$`),new RegExp(`^السور اللي فيها ${WORD_NOUN}${ASK_WORD}$`)];
function surahWordAsk(t){
 const one=t.match(WORD_IN_SURAH);if(one){const surah=findSurahIn('سوره '+one[2]);return surah?{query:one[1],surah}:null;}
 for(const re of SURAH_HAS_WORD){const m=t.match(re);if(m){const surah=findSurahIn('سوره '+m[1]);if(surah)return {query:m[2],surah};}}
 for(const re of WORD_ACROSS_SURAHS){const m=t.match(re);if(m)return {query:m[1],across:true};}
 return null;
}
function quoteIn(t,raw){
 const q=String(raw).match(/[«"“]([^»"”]{4,})[»"”]/)?.[1];if(q)return norm(q);
 return (t.match(/قوله تعالي (.+)$/)||t.match(/(?:الايه|ايه|اللي)(?: اللي)? (?:بتقول|بيقول|تقول|يقول|بتبدا ب|فيها|فيه) (.+)$/)||t.match(/(?:انهي|اي|ايه) سوره (?:فيها|فيه|بتقول|اللي فيها) (.+)$/))?.[1]?.replace(/ (?:في|فى) (?:القران|المصحف).*$/,'').trim()||null;
}
async function tafsirReply(surah,ayah,source,intro=''){
 const out=await tools.get_tafsir({surah,ayah,source});chip(`${actionLabel.get_tafsir}: ${out.source}`);
 const paragraphs=out.text.split('\n').filter(Boolean),first=source==='muyassar'?paragraphs.length:2;
 lastTafsir={surah,ayah,source,paragraphs,at:first};
 // Keep the tafsir panel in step when the answer is about the ayah on screen.
 if(Number($('surah').value)===surah&&rangeNumbers()[0]===ayah)$('tafsirBox')?.querySelector?.(`[data-src="${source}"]`)?.click();
 const more=paragraphs.length>first?' … قول «كمّل» وأكمّلك.':'';
 return `${intro}${out.source} — ${nameOf(surah)}، الآية ${ayah}: ${paragraphs.slice(0,first).join(' ')||'مفيش تفسير للآية دي في المصدر ده.'}${more}`;
}
async function knowledgeTurn(t,raw=t){
 // A surah or ayah number that does not exist («سورة 200»، «الفاتحة آية 99»): say so instead of answering about another place.
 const asked=t.match(/سوره (?:رقم )?(\d+)/);if(asked&&(+asked[1]<1||+asked[1]>114))return `القرآن 114 سورة بس، ومفيش سورة رقم ${asked[1]}.`;
 const askedAyah=+(t.match(/(?:الايه|ايه)(?: رقم)? (\d+)/)?.[1]||0),askedSurah=findSurahIn(t)||(askedAyah&&!/ايه الكرسي/.test(t)?Number($('surah').value):0);
 if(askedSurah&&askedAyah&&surahs[askedSurah-1]&&askedAyah>surahs[askedSurah-1].ayahs.length)return `${QuranCompare.normalize(surahName(askedSurah))} فيها ${ayat(surahs[askedSurah-1].ayahs.length)} بس، فمفيش آية ${askedAyah}.`;
 // Words are shown as the user wrote them («الجنة»), not in the normalised form used for matching («الجنه»).
 const shown=q=>q.split(' ').map(w=>String(raw).split(/[\s«»"“”؟?،,.!]+/).find(r=>r&&norm(r)===w)||w).join(' ');
 const current=()=>({surah:Number($('surah').value),ayah:rangeNumbers()[0]});
 const where=()=>{const kursi=/ايه الكرسي/.test(t),surah=kursi?2:findSurahIn(t),ayah=kursi?255:+(t.match(/(?:الايه|ايه)(?: رقم)? (\d+)/)?.[1]||0);return surah?{surah,ayah:ayah||1}:{surah:current().surah,ayah:ayah||current().ayah};};
 const after=re=>(t.match(re)?.[1]||'').replace(/ (في|فى) (القران|المصحف).*$/,'').trim();
 // 1. Follow-ups on the last answer: more of the same tafsir, the same ayah from another book, or open a result.
 if(lastTafsir&&/^(?:طب |طيب |و)?(?:كمل|اكمل|كمان|زود|الباقي|باقي التفسير|اكتر|المزيد|عايز اكتر|كمل التفسير|وبعدين)(?: |$)/.test(t)){
  const {paragraphs,at}=lastTafsir;if(at>=paragraphs.length)return 'كده خلص تفسير الآية دي. تحب تسمع تفسير تاني؟ قول مثلًا «وعند القرطبي».';
  lastTafsir.at=at+2;return paragraphs.slice(at,at+2).join(' ')+(lastTafsir.at<paragraphs.length?' … قول «كمّل» وأكمّلك.':' وكده خلص التفسير.');
 }
 const source=sourceIn(t);
 if(lastTafsir&&source&&!t.replace(/(?:ال)?(?:سعدي|كثير|قرطبي|طبري|بغوي|وسيط|طنطاوي|ميسر)/g,'').replace(/(?:^| )(?:و?عند|طب|طيب|في|بتفسير|تفسير|و?ايه رايك|ابن|الامام|الشيخ|الحافظ|عايز|عاوز|و)(?= |$)/g,' ').trim())
  return tafsirReply(lastTafsir.surah,lastTafsir.ayah,source);
 if(!lastTafsir&&/^(?:طب |طيب |و)?(?:كمل|اكمل|كمل التفسير|باقي التفسير)$/.test(t))return 'لسه ما فسّرتلكش آية عشان أكمّل. قول مثلًا «فسّر الآية دي» أو «تفسير ابن كثير لآية الكرسي».';
 if(!lastResults?.length&&(/نتيجه(?: رقم)? \d+/.test(t)||/^(?:افتحها|افتحهالي|افتحهولي|وديني عليها|روحلها)$/.test(t)))return 'مفيش نتايج بحث لسه أفتح منها. دوّر الأول، مثلًا «ابحث عن كلمة الصبر» أو «فين الآية اللي بتقول…».';
 if(lastResults?.length){
  // A bare number or ordinal right after a search picks that result («1»، «رقم 2»، «الثانية»).
  const n=+(t.match(/نتيجه(?: رقم)? (\d+)/)?.[1]||t.match(/^(?:رقم )?(\d+)$/)?.[1]||0)||(Object.hasOwn(ORDINALS,t)&&ORDINALS[t])||(/(?:افتح|وديني|روح)/.test(t)&&ORDINALS[t.split(' ').find(w=>ORDINALS[w])])||(/^(?:افتحها|افتحهالي|افتحهولي|وديني عليها|روحلها)$/.test(t)?1:0);
  if(n){const r=lastResults[n-1];if(!r)return `عندي ${lastResults.length} نتايج بس.`;const out=act('go_to_ayah',{surah:r.surah,ayah:r.ayah,to_ayah:null});return `فتحتلك ${out.opened}.`;}
 }
 // Tajweed: a rule explained («يعني ايه الإخفاء؟»، «اشرحلي القلقلة»، «احكام النون الساكنة»).
 const RULE_WORDS=/(اخفاء|ادغام|اقلاب|اظهار|قلقله|غنه|مد (?:متصل|منفصل|لازم|عارض|واجب|جائز)|المدود|انواع المد|لام شمسيه|لام قمريه|اللام الشمسيه|اللام القمريه|النون الساكنه|التنوين|الميم الساكنه|مخارج|المخارج|صفات الحروف|الصفات|علامات الوقف|تفخيم|ترقيق|التفخيم والترقيق|السكت|سكتات|لفظ الجلاله)/;
 if(RULE_WORDS.test(t)&&!/(الايه|ايه \d|سوره)/.test(t.replace(/^(?:يعني )?ايه /,''))){
  const asked=t.match(RULE_WORDS)[1],topic={'مخارج':'المخارج','صفات الحروف':'الصفات','تفخيم':'التفخيم والترقيق','ترقيق':'التفخيم والترقيق','سكتات':'السكتة','السكت':'السكتة','لفظ الجلاله':'لام لفظ الجلالة'}[asked]||asked;
  const r=tools.explain_tajweed_rule({rule:topic.replace(/^ال(?=نون|ميم|مد|لام)/,'')});chip(actionLabel.explain_tajweed_rule);
  return r.rules.slice(0,5).map(x=>`**${x.rule}** (${x.group}): ${x.how_to_read}`).join(' ');
 }
 // Tajweed of an ayah («احكام التجويد في الآية دي»، «تجويد آية الكرسي»): shown in the chat and in the panel's tab.
 if(/(تجويد|احكام التلاوه|احكام الايه|احكام القراءه)/.test(t)){
  const {surah,ayah}=where(),r=tools.get_tajweed({surah,ayah});chip(actionLabel.get_tajweed);
  if(Number($('surah').value)===surah&&rangeNumbers()[0]===ayah){const box=$('tafsirBox');if(box){box.open=true;box.querySelector?.('[data-src="tajweed"]')?.click();}}
  if(!r.rules.length)return `مفيش أحكام نون أو ميم أو مدود أو قلقلة ظاهرة في ${nameOf(surah)}، الآية ${ayah}.`;
  const signs=r.waqf_signs.length?' وعلامات الوقف: '+r.waqf_signs.map(w=>`«${w.sign}» بعد «${w.after_word}» (${w.meaning})`).join('، ')+'.':'';
  return `أحكام التجويد في ${nameOf(surah)}، الآية ${ayah} (رواية حفص): `+r.rules.map(x=>`**${x.rule}** في «${x.words.slice(0,3).join('، ')}»`).join('، ')+'.'+signs+' اسألني «يعني ايه الإخفاء» مثلًا عشان أشرحلك أي حكم.';
 }
 // Quran sciences: counts from this Mushaf, and a few well-established facts.
 const FACTS=[
  [/(كام سوره|عدد السور)/,f=>`القرآن ${f.surahs} سورة، منها ${f.meccan_surahs} مكية و${f.medinan_surahs} مدنية.`],
  [/(مكيه|مدنيه)/,f=>`السور المكية ${f.meccan_surahs} والمدنية ${f.medinan_surahs}، حسب تصنيف المصحف ده.`],
  [/(كام ايه|عدد الايات|عدد اياته)/,f=>`القرآن ${f.ayat} آية بـ${f.ayah_count_method}.`],
  [/(كام كلمه|عدد الكلمات|عدد كلمات)/,f=>`حوالي ${f.words.toLocaleString('ar-EG')} كلمة في المصحف ده (العدد بيختلف شوية حسب طريقة العد).`],
  [/(كام جزء|عدد الاجزاء|كام حزب|عدد الاحزاب|كام صفحه|عدد الصفحات)/,f=>`القرآن ${f.juz} جزء، و${f.hizb} حزب (${f.hizb_quarters} ربع)، و${f.pages} صفحة في مصحف المدينة، و${f.manzil} منازل.`],
  [/(سجد)/,f=>`سجدات التلاوة ${f.sajdat_tilawa.length}: `+f.sajdat_tilawa.map(x=>`${QuranCompare.normalize(x.name)} ${x.ayah}`).join('، ')+'.'],
  [/(اطول سوره)/,f=>`أطول سورة ${QuranCompare.normalize(f.longest_surah.name)}: ${f.longest_surah.ayat} آية.`],
  [/(اقصر سوره)/,f=>`أقصر السور ${f.shortest_surahs.map(x=>QuranCompare.normalize(x.name)).join(' و')}: ${f.shortest_surahs[0].ayat} آيات لكل واحدة.`],
 ];
 const CLASSICAL=[[/(اول ما نزل|اول ايه نزلت|اول سوره نزلت)/,0],[/(اخر ما نزل|اخر ايه نزلت)/,1],[/(بدون بسمله|من غير بسمله|مفيهاش بسمله|البسمله)/,2],[/(جمع القران|مين جمع|كتابه المصحف)/,3],[/(القراءات|القراء العشره|روايه حفص)/,4],[/(نزل القران في|مده نزول|نزل منجم)/,5],[/(الحروف المقطعه)/,6]];
 const fact=FACTS.find(([re])=>re.test(t)),old=CLASSICAL.find(([re])=>re.test(t));
 if((fact||old)&&!findSurahIn(t)){
  const all=tools.get_quran_facts();chip(actionLabel.get_quran_facts);
  return fact?fact[1](all.counted_from_this_mushaf):all.classical[old[1]];
 }
 // Hadith sciences (before tafsir: «يعني ايه حديث حسن» is a term, not a word to look up): «يعني ايه حديث حسن»، «الفرق بين الشاذ والمنكر»، «انواع الحديث»، «الجرح والتعديل».
 if(/(انواع الحديث|اقسام الحديث|درجات الحديث|مصطلح الحديث|علوم الحديث)/.test(t)){
  chip(actionLabel.explain_hadith_term);const groups={};for(const [k,v] of Object.entries(QuranKnowledge.MUSTALAH))(groups[v.group]??=[]).push(k);
  return 'أقسام الحديث في علم المصطلح: '+Object.entries(groups).map(([g,ks])=>`**${g}**: ${ks.join('، ')}`).join('. ')+'. اسألني عن أي واحد، مثلًا «يعني ايه حديث مرسل».';
 }
 const terms=/(يعني ايه|ما هو|ما هي|ايه هو|ايه هي|تعريف|عرف|الفرق بين|الحديث ال|حديث (?:صحيح|حسن|ضعيف|موضوع|مرسل|قدسي|متواتر|غريب|عزيز|مشهور)$|مين هو|مين هم|الجرح والتعديل|الكتب السته|متفق عليه)/.test(t)?QuranKnowledge.findMustalah(t):[];
 if(terms.length&&!/(في|فيه|عن) .+ (?:في|من) (?:البخاري|مسلم|سنن)/.test(t)){
  const r=tools.explain_hadith_term({term:t});chip(actionLabel.explain_hadith_term);
  return r.terms.slice(0,3).map(x=>`**${x.term}** (${x.group}): ${x.definition}`).join(' ')+` (المصدر: ${r.source}.)`;
 }
 // «معني» only as a whole word: it is also inside «سمعني» (play it for me).
 const wantsTafsir=/(تفسير|فسر|(?:^| )معني(?: |$)|يعني ايه|(?:^| )(?:اشرح|اشرحلي|شرح)(?: |$)|سبب نزول|سبب النزول)/.test(t);
 // Advice on memorising and reviewing: a fixed, reviewed answer about the app's own tools (the small model does this poorly).
 if(/(?:كيف|ازاي|طريقه|نصيحه|نصايح|نصائح|خطه|عايز احفظ).*(?:احفظ|الحفظ|حفظي|حفظت|اراجع|المراجعه|اثبت)|(?:بنسي|انسي|نسيت).*(?:احفظ|حفظ)/.test(t)&&!/حفظ الله|جمع القران/.test(t))
  return 'هذه نصائح عامة من طريقة عمل التطبيق، لا فتوى ولا منهج ملزم: اختر آيات قليلة، واستمع لها مع التكرار، ثم فعّل «إخفاء الآية للتسميع» واقرأها بصوتك، وراجع الكلمات المختلفة واستمع لنطقها الصحيح. وزر «🧠 اقترح آية للمراجعة» وقائمة «آيات تحتاج مراجعة» يساعدانك على تثبيت الأضعف أولًا. وللخطة المناسبة لك وإتقان التلاوة، اعرض حفظك على معلم متقن.';
 // A word in one surah, or which surahs have it. The whole Mushaf is counted, not just the first results.
 const wordAsk=wantsTafsir?null:surahWordAsk(t);
 if(wordAsk?.surah)return knowledgeTurn(`هل كلمه ${wordAsk.query} موجوده في سوره ${wordAsk.surah}`,raw);
 if(wordAsk){
  const {query}=wordAsk,said=shown(query),search=partial=>QuranKnowledge.searchQuran(simple,query,{partial,phrase:!partial&&query.includes(' '),limit:6236});
  let r=search(false),close=false;if(!r.total&&!query.includes(' ')&&query.length>=3){r=search(true);close=r.total>0;}
  chip(actionLabel.search_quran);
  if(!r.total)return `«${said}» مش موجودة في أي سورة بالشكل ده. جرّب جزء من الكلمة أو من غير «ال».`;
  lastResults=r.results.slice(0,15);
  const bySurah=new Map;for(const x of r.results)bySurah.set(x.surah,(bySurah.get(x.surah)||0)+1);
  const list=[...bySurah].slice(0,10).map(([s,n])=>`${nameOf(s)} (${ayat(n)})`).join('، ')+(bySurah.size>10?'، وغيرها':'');
  const first=[...bySurah.keys()][0];
  return `${close?`«${said}» مش موجودة بالشكل ده، لكن كلمات قريبة منها`:`«${said}»`} موجودة في ${count(bySurah.size,'سورة واحدة','سورتين','سور','سورة')} و${ayat(r.total)}: ${list}. قول مثلًا «كلمة ${said} في ${nameOf(first)}» وأجيبلك آياتها.`;
 }
 // 2. An ayah quoted from memory: find it, and explain it if asked.
 // Not «وكم آية فيها؟» (how many ayat a surah has): that is a question about the surah.
 if(/(?:الايه|ايه|اللي)(?: اللي)? (?:بتقول|بيقول|تقول|فيها)$/.test(t)&&!/(?:كم|كام) (?:ايه|ايات) فيها$/.test(t))return 'الآية بتقول إيه؟ قول جزء منها، مثلًا: «فين الآية اللي بتقول وجعلنا من الماء كل شيء حي».';
 const quote=quoteIn(t,raw);
 if(quote&&quote.split(' ').length>=2){
  const r=tools.find_ayah({text:quote});chip(actionLabel.find_ayah);
  if(!r.total)return `مالقيتش آية فيها «${shown(quote)}». اتأكد من الكلام أو قول جزء تاني من الآية.`;
  lastResults=r.results;
  const best=r.results[0],sure=r.exact_match?'':' (مش متطابقة حرفيًا، دي أقرب آية)';
  if(wantsTafsir)return tafsirReply(best.surah,best.ayah,source||'muyassar',`دي ${nameOf(best.surah)}، الآية ${best.ayah}${sure}. `);
  if(r.results.length===1||!r.exact_match&&best.words_matched_percent>r.results[1].words_matched_percent)return `دي ${nameOf(best.surah)}، الآية ${best.ayah}${sure}. قول «افتحها» وأفتحهالك.`;
  return `لقيتها في ${count(r.total,'مكان واحد','مكانين','أماكن','مكان')}: ${refs(r.results)}. قول «افتح النتيجة 1» مثلًا وأفتحهالك.`;
 }
 // 3. The meaning of one word: in the ayah on screen if it has the word, else where it first comes in the Mushaf.
 const word=wantsTafsir&&(t.match(/(?:معني|تفسير|شرح) (?:كلمه|لفظ|لفظه) (.+)$/)||t.match(/(?:^| )معني (.+)$/)||t.match(/يعني ايه (.+)$/)||t.match(/^(.+) يعني ايه$/))?.[1]?.replace(/ (?:في|فى) (?:الايه|القران|المصحف|سوره).*$/,'').replace(/^(?:كلمه|لفظ|لفظه) /,'').trim();
 if(word&&/^(?:كلمه|لفظ|لفظه|الكلمه|كلمه دي)$/.test(word))return 'معنى أنهي كلمة؟ قول مثلًا: «معنى كلمة الصمد».';
 if(word&&!POINTER.test(word)&&word.split(' ').length<=3){
  const {surah,ayah}=current(),here=QuranKnowledge.searchQuran([{number:surah,ayahs:[simple[surah-1].ayahs[ayah-1]]}],word).total;
  let at={surah,ayah};
  if(!here){const r=tools.search_quran({query:word,surah:findSurahIn(t),partial:false,phrase:true});chip(actionLabel.search_quran);if(!r.ayat_count)return `مالقيتش كلمة «${shown(word)}» في المصحف بالشكل ده. اكتبها زي ما هي في الآية.`;at=r.results[0];}
  return tafsirReply(at.surah,at.ayah,source||'muyassar',`كلمة «${shown(word)}» جت في ${nameOf(at.surah)}، الآية ${at.ayah}، ومعناها في سياق الآية: `);
 }
 // 4. Tafsir of an ayah by place (the one on screen by default). Asbab al-nuzul: Ibn Kathir mentions them.
 if(wantsTafsir){const {surah,ayah}=where();return tafsirReply(surah,ayah,source||(/نزول/.test(t)?'ibn_kathir':'muyassar'));}
 // 5. Surah facts.
 if(/(معلومات|مكيه ولا مدنيه|مكيه|مدنيه|كام ايه|عدد ايات|عدد اياتها)/.test(t)&&(findSurahIn(t)||/السوره دي|السوره/.test(t))){
  const i=tools.get_surah_info({surah:findSurahIn(t)||Number($('surah').value)});chip(actionLabel.get_surah_info);
  return `${QuranCompare.normalize(i.name)} ${i.revelation}، عدد آياتها ${i.ayat} وكلماتها ${i.words}، في الجزء ${i.juz.join(' و')}${i.pages?` من صفحة ${i.pages[0]} لـ ${i.pages[1]}`:''}${i.sajda_ayat.length?`، وفيها سجدة في الآية ${i.sajda_ayat.join(' و')}`:''}.`;
 }
 // 7. Hadith search, with grades: «حديث عن النية»، «درجة حديث …»، «حديث … في سنن أبي داود»، «في الكتب الستة».
 if(/(حديث|احاديث|السنه|قال النبي|قال الرسول)/.test(t)){
  const src=n=>new RegExp(`(?:في|من|عند|رواه|اخرجه|عن) (?:صحيح |سنن |كتاب )?(?:${n})(?: |$)`);
  const BOOKS=[[src('ابي داود|ابو داود'),'abudawud'],[src('الترمذي'),'tirmidhi'],[src('النسائي'),'nasai'],[src('ابن ماجه'),'ibnmajah'],[src('البخاري'),'bukhari'],[src('مسلم'),'muslim'],[src('النوويه|الاربعين النوويه|الاربعين'),'nawawi'],[src('الكتب السته|السنن'),'six']];
  const grading=/(درجه|صحه|هل .*صحيح|صحيح ولا|ضعيف ولا|مكذوب|موضوع ولا)/.test(t),book=BOOKS.find(([re])=>re.test(t))?.[1]||(grading?'six':'all');
  const query=shown(after(/(?:حديث|احاديث|السنه)(?: عن| في| فيه| بيقول)? (.+)$/).replace(/ (?:في|من|عند|رواه) (?:سنن|صحيح|كتب|الكتب|البخاري|مسلم|الاربعين|ابي داود|الترمذي|النسائي|ابن ماجه).*$/,'').replace(/ (?:صحيح|ضعيف) (?:ولا|او) .*$/,'').trim());
  if(!query)return 'قوللي الحديث عن إيه؟ مثلًا: «حديث عن النية» أو «حديث فيه إنما الأعمال بالنيات».';
  const r=await tools.search_hadith({query,book});chip(actionLabel.search_hadith);
  const where=book==='all'?'البخاري ومسلم والأربعين النووية':book==='six'?'الكتب الستة':QuranKnowledge.HADITH[book].name;
  if(!r.total)return `مالقيتش حديث فيه «${query}» في ${where}. جرّب كلمات تانية من نص الحديث${book==='all'?'، أو قول «في الكتب الستة»':''}.`;
  // The grade comes from the source (the Sahihs, or named scholars for the Sunan), never guessed.
  const h=r.results[0],grade=h.grades?.length?' — درجته: '+h.grades.slice(0,3).map(g=>`${g.grade} (${g.by})`).join('، '):' (الدرجة غير مذكورة في المصدر)';
  return `لقيت ${count(r.total,'حديث واحد','حديثين','أحاديث','حديث')} فيه «${query}» في ${where}. ${r.total>1?'أولهم ':''}من ${h.book} رقم ${h.number}${grade}: ${h.text}`;
 }
 // 7. Word search, in the whole Mushaf or one surah, with how many times it comes.
 const inQuran=t.match(WORD_IN_QURAN);
 if(inQuran||/(?:^| )(?:كلمه|لفظ|لفظه) .*(?:موجوده?(?: |$)|القران|المصحف)|(?:القران|المصحف) .*(?:كلمه|لفظ|لفظه) /.test(t)||/(ابحث|(?:^| )(?:دور|دورلي)(?: |$)|(?:^| )فين(?: |$)|كام مره|عدد مرات|وردت|اتذكرت|اتكررت|جت كلمه|^(?:كلمه|لفظ|لفظه) )/.test(t)){
  const inPart=t.match(/ (?:(?:في|فى) |ب)(سوره .+)$/),surah=inPart?findSurahIn(inPart[1]):null;
  let query=((t.match(/(?:كلمه|لفظ|لفظه) (.+)$/)||t.match(/(?:ابحث|دور|ابحثلي|دورلي)(?: عن| علي)? (.+)$/)||t.match(/(?:فين|كام مره|عدد مرات)(?: (?:اتذكرت|وردت|جت|ذكرت|اتكررت))? (.+)$/)||inQuran)?.[1]||'')
   .replace(/ (?:(?:في|فى) (?:سوره|القران|المصحف)|بسوره|بالقران|بالمصحف).*$/,'').replace(/ (?:اتذكرت|وردت|جت|ذكرت|اتكررت|موجوده?|كام مره).*$/,'').replace(/^(?:جزء من |اي )?(?:كلمه|لفظ|لفظه) /,'').trim();
  if(/^(?:عن|علي|في|كلمه|لفظ|لفظه)$/.test(query))query='';
  if(!query)return 'قوللي الكلمة اللي عايز تدور عليها، مثلًا: «ابحث عن كلمة الصبر» أو «كام مرة اتذكرت الجنة».';
  const partial=/(جزء من|اي كلمه فيها|مشتقات|اشتقاقات)/.test(t),said=shown(query);
  const r=tools.search_quran({query,surah,partial,phrase:query.includes(' ')});chip(actionLabel.search_quran);
  const inSurah=surah?` في ${nameOf(surah)}`:'';
  if(!r.ayat_count&&!partial&&!query.includes(' ')&&query.length>=3){
   // Not in this exact form: show the Mushaf's words that contain it, and say plainly that they are other forms.
   const near=tools.search_quran({query,surah,partial:true});
   if(near.ayat_count){
    lastResults=near.results;
    const forms=[...new Set(near.results.flatMap(x=>norm(x.text).split(' ')).filter(w=>w.includes(query)))].slice(0,4);
    return `«${said}» مش موجودة${inSurah} بالشكل ده، لكن فيه كلمات قريبة منها${forms.length?` (${forms.join('، ')})`:''} في ${ayat(near.ayat_count)}: ${refs(near.results.slice(0,5))}. قول «افتح النتيجة 1» وأفتحهالك.`;
   }
  }
  if(!r.ayat_count)return `«${said}» مش موجودة${inSurah} بالشكل ده. جرّب جزء من الكلمة («ابحث عن جزء من كلمة ${said}») أو من غير «ال».`;
  lastResults=r.results;
  const how=/(كام مره|عدد مرات|اتكررت)/.test(t)?`اتذكرت ${times(r.occurrences)} في ${ayat(r.ayat_count)}`:`جت في ${ayat(r.ayat_count)}`;
  const yes=/^هل |موجوده?(?: |$)/.test(t)?`أيوه، «${said}» موجودة${inSurah||' في القرآن'}: ${how}`:`«${said}» ${how}${inSurah}`;
  return `${yes}. ${r.ayat_count>5?'أولهم':'وهي'}: ${refs(r.results.slice(0,5))}. قول «افتح النتيجة 1» وأفتحهالك.`;
 }
 return null;
}
async function localTurn(text){
 const t=norm(text);
 if(loading){bubble('assistant','المصحف لسه بيحمّل، استنى ثانية وجرّب تاني.');return;}
 try{const answer=await knowledgeTurn(t,text);if(answer){bubble('assistant',answer);speak(answer);return;}}
 catch(e){const m=String(e.message||e);bubble('note',/does not exist|has \d+ ayat|still loading/.test(m)?'الرقم ده مش موجود في المصحف، أو المصحف لسه بيحمّل. اتأكد من رقم السورة والآية.':'تعذّر الوصول للمصدر: '+m+'. تحقق من الإنترنت.');return;}
 // With the local model on, a real question («ما الفرق بين…؟») goes to it instead of being read as a command.
 if(globalThis.LocalLLM?.ready()&&(/[؟?]\s*$/.test(text)||/^(?:ما|ماذا|لماذا|ليه|كيف|ازاي|هل|مين|من هو|من هي|متي|اين|اشرح|وضح|عرفني|احكيلي|ايه الفرق|ما الفرق|ايه فضل|ما فضل)(?: |$)/.test(t))&&!/^(?:افتح|شغل|اقرا|سمع|روح|وديني|خبي|اخفي|اظهر|ابحث|دور)/.test(t)&&!quranWordOnly(t)){await llmTurn(text,t);return;}
 const said=[];let did=false;
 try{
  // 1. Where to go: «آية الكرسي», a surah by name or number, an ayah number, or a range.
  let surah=/ايه الكرسي/.test(t)?2:findSurahIn(t),ayah=/ايه الكرسي/.test(t)?255:null,to=null;
  const range=t.match(/من (?:الايه )?(\d+) (?:الي|حتي|لحد|لغايه|ل) (?:الايه )?(\d+)/);
  const single=t.match(/(?:الايه|ايه|الايات|ايات)(?: رقم)? (\d+)/);
  if(range){ayah=+range[1];to=+range[2];}else if(single&&!ayah)ayah=+single[1];
  if(!surah&&ayah)surah=Number($('surah').value);
  if(surah){const out=act('go_to_ayah',{surah,ayah:ayah||1,to_ayah:to});said.push(`فتحتلك ${out.opened}.`);did=true;}
  else if(/التاليه|بعدها|اللي بعد/.test(t)){step(1);chip('الآية التالية');said.push(`دي ${place(Number($('surah').value),rangeNumbers())}.`);did=true;}
  else if(/السابقه|قبلها|اللي قبل/.test(t)){step(-1);chip('الآية السابقة');said.push(`دي ${place(Number($('surah').value),rangeNumbers())}.`);did=true;}
  // 2. Hide or show for memorisation.
  if(/(اخف|خب|اخفاء)/.test(t)){act('set_ayah_hidden',{hidden:true});said.push('خبّيت الآية، اقراها من حفظك وبعدين دوس «ابدأ التسميع».');did=true;}
  else if(/(اظهر|ظهر|اكشف|اعرض الايه)/.test(t)){act('set_ayah_hidden',{hidden:false});said.push('ظهّرتلك الآية.');did=true;}
  // 3. Listening, optionally with a reciter and repetitions.
  const reciterId=findReciter(t),repeat=repeatIn(t);
  // Egyptian: «سمّعني» = play it for me, «عايز اسمع» = I want to listen.
  if(/(شغل|استمع|اسمع|سمعني|اقرا|يقرا|تلاوه|رتل|بصوت)/.test(t)||reciterId){const out=act('play_recitation',{reciter:reciterId,repeat});said.push(`هشغّلك ${said.length?out.playing.replace(/^.*?، /,''):out.playing} بصوت ${out.reciter}${out.repeat>1?` ${out.repeat} مرات`:''}.`);did=true;}
  // Letters the reader confuses: «ايه الحروف اللي بغلط فيها؟»
  const letters=/(حروف|حرف)/.test(t)&&/(بغلط|اغلط|غلط|اخطا|بخطئ|بخلط|اخلط|ضعيف|محتاج)/.test(t);
  if(letters&&/(بغلط|اغلط|غلط|اخطا|بخطئ|بخلط|اخلط|ضعيف|محتاج)/.test(t)){
   const l=typeof weakLetters==='function'?weakLetters():[];chip(actionLabel.get_progress);did=true;
   said.push(l.length?'أكتر حروف بتلخبط فيها: '+l.map(x=>`بتقرا «${x.spoken}» بدل «${x.expected}» (${x.count} مرات)`).join('، ')+'.'+(l[0].tip?' نصيحة: '+l[0].tip:''):'لسه مفيش حروف بتتكرر فيها الأخطاء. كمّل تسميع وأنا هتابع معاك.');
  }
  // 4. Progress and mistakes.
  if(!letters&&/(تقدم|احتاج|محتاج|اراجع|مراجعتها|ضعيف|اضعف|احصائ)/.test(t)){
   const p=tools.get_progress();
   if(!p.ayat_reviewed)said.push('لسه ما راجعتش ولا آية. اختار آية ودوس «ابدأ التسميع» عشان نبدأ.');
   else{said.push(`راجعت ${p.ayat_reviewed} آية ومتوسط دقتك ${p.average_accuracy}٪، وبقالك ${p.streak_days} يوم ورا بعض.`);if(p.weakest.length)said.push('أكتر آيات محتاجة مراجعة: '+p.weakest.map(w=>`${w.name} ${w.ayah} (احتمال إنك فاكرها ${w.predicted_recall}٪)`).join('، ')+'.');}
   chip(actionLabel.get_progress);did=true;
  }
  if(!letters&&/(اخطا|خطا|ملاحظ|غلط)/.test(t)){
   const r=tools.get_app_state().last_review;
   said.push(r.notes.length?'في آخر تسميع: '+r.notes.join(' '):'مفيش أخطاء متسجّلة في آخر تسميع. سمّع آية الأول وبعدين اسألني.');
   chip(actionLabel.get_app_state);did=true;
  }
  if(/(سمع|اختبر|تسميع)/.test(t)&&!/(اسمع|استمع|سمعني)/.test(t)){said.push('دوس «ابدأ التسميع» واقرا، وبعدين وقّف عشان تشوف النتيجة.');did=true;}
 }catch(e){bubble('note',String(e.message||e));return;}
 if(!did){
  if(/^(السلام|سلام|مرحبا|اهلا|هلا|صباح|مساء|ازيك|ازاي)/.test(t)&&!/(تعمل|تقدر|تساعد)/.test(t))said.push('وعليكم السلام ورحمة الله وبركاته! أهلًا بيك. '+CAN);
  else if(/(ماذا|كيف|شو|ايش|ايه|ازاي).*(تستطيع|تقدر|تساعد|يمكنك|تعمل|بتعمل)|مساعده|ساعدني/.test(t))said.push(CAN);
  else if(globalThis.LocalLLM?.ready()&&quranWordOnly(t))said.push(await knowledgeTurn('ابحث عن '+t,text));
  else if(globalThis.LocalLLM?.ready()&&!/^\d+$/.test(t)){await llmTurn(text,t);return;}
  else if(t.split(' ').length<=2&&tools.search_quran({query:t,phrase:t.includes(' ')}).ayat_count){said.push(await knowledgeTurn('ابحث عن '+t,text));}
  else said.push('معلش، مفهمتش طلبك في الوضع المحلي. '+CAN+' وللمحادثة الحرة استخدم زر التفعيل أعلى المحادثة.');
 }
 const reply=said.join(' ');bubble('assistant',reply);speak(reply);
}

// ---------- Conversation with the server ----------
// The Android app and the static copies of the site have no server of their own, so they use the one on Render.
const REMOTE_ASSISTANT=!!globalThis.Capacitor?.isNativePlatform?.()||/(?:^|\.)(?:netlify\.app|github\.io)$/.test(globalThis.location?.hostname||'');
const ASSISTANT_API=REMOTE_ASSISTANT?'https://telawa-exame.onrender.com/api/assistant':'api/assistant';
// Claude answers only after the person turns it on, and only if the server has a key.
let claudeOn=false;
const claudeReady=()=>claudeOn&&!!status?.available&&!!status?.configured;
const CLAUDE_NOTE='اختياري: تُرسل رسائلك وما يلزم للرد إلى Anthropic. قد يخطئ، فتأكد من المصدر.';
function claudeUI(message){
 const button=$('claudeToggle');if(!button)return;
 const usable=!!status?.available&&!!status?.configured;
 // The phone app shows it only when it can work, so nobody meets a button that does nothing.
 $('claudeBar').hidden=!!globalThis.Capacitor?.isNativePlatform?.()&&!usable;
 button.textContent=claudeReady()?'إيقاف Claude':'✨ تفعيل Claude';
 $('claudeStatus').textContent=message??(claudeReady()?'✓ مفعّل: تُرسل رسائلك وما يلزم للرد إلى Anthropic حتى توقفه.':CLAUDE_NOTE);
}
async function checkStatus(){
 if(status&&!status.retry)return status;
 // A free server may be asleep: do not wait long, answer locally, and look again on the next question.
 try{const r=await fetch(ASSISTANT_API,{signal:AbortSignal.timeout(6000)});status=r.ok?await r.json():{available:false,retry:true};}catch{status={available:false,retry:true};}
 const claude=claudeReady();
 $('aiMode').textContent=claude?'Claude · محادثة وصوت':globalThis.LocalLLM?.remote?.()?'الوضع المحلي + نموذج على الخادم':'الوضع المحلي · أوامر أساسية';
 claudeUI();
 return status;
}
// ---------- Free conversation with the local model (computers only, see llm.js) ----------
// Words that say nothing about the subject, so they are not searched in the Mushaf.
const LLM_STOP=new Set('الفرق فرق بين وبين سبب اسباب فضل اذكر اعطني اديني عايزه سميت تسميه سؤال ايه ازاي ليه امتي مين هل ما ماذا كيف لماذا متي اين فين عن في من علي الي اللي ده دي دول هو هي هم انا انت احنا القران سوره الايه ايه يعني قول قولي عايز عاوز ممكن اشرح تشرح اعرف معني الله كان كانت التي الذي هذا هذه ذلك لكن او ثم قال كلمه لفظ لفظه بهذا الاسم اسم قوله تعالي عدد كم وردت ورد ذكرت تعريف عرف حكم احكام الحروف حروف اي ايش موجوده موجود فيها فيه مكتوب جاءت جاء تكررت تكرر مره مرات الكريم المصحف ايات الايات اسمها لها له'.split(' '));
const ayatWord=n=>n>=3&&n<=10?'آيات':'آية';
// One or two Mushaf words on their own («سفينة»): the app can answer exactly, so this never needs the model.
const quranWordOnly=t=>{const w=t.split(' ');return w.length<=2&&w.every(x=>x.length>=3&&!LLM_STOP.has(x))&&!findSurahIn(t)&&tools.search_quran({query:t,phrase:w.length>1}).ayat_count>0;};
// The sources for one question: the open ayah, named surahs' facts, hadith terms, tajweed rules, Quran sciences facts,
// and — for questions about the Mushaf's words — matching ayat and where a word occurs.
function llmSources(text,t){
 const parts=[],surah=Number($('surah').value),ayah=rangeNumbers()[0],open=surahs[surah-1]?.ayahs[ayah-1];
 if(open)parts.push(`الآية المفتوحة في التطبيق: ${nameOf(surah)} ${ayah}: ${open.text}`);
 // Every surah named in the question («الفرق بين الفاتحة والفتح»), not just the first.
 surahNames??=surahs.map(x=>({n:x.number,forms:namesOf(x)}));
 const named=new Set(surahNames.filter(({forms})=>forms.some(f=>new RegExp(`(?:^| )(?:و|ب|ل)?${f.length>3?'':'سوره '}${f}(?: |$)`).test(t))).map(x=>x.n));
 const one=findSurahIn(t);if(one)named.add(one);
 for(const s of [...named].slice(0,3)){const i=tools.get_surah_info({surah:s});parts.push(`معلومات ${nameOf(s)}: سورة ${i.revelation}، عدد آياتها ${i.ayat}، ترتيبها ${s} في المصحف، في الجزء ${[].concat(i.juz).join(' و')}.`);}
 const m=QuranKnowledge.findMustalah(text);
 if(m.length)parts.push(`من مصطلح الحديث (${QuranKnowledge.MUSTALAH_SOURCE}): `+m.slice(0,2).map(x=>`${x.term}: ${x.def}`).join(' | '));
 // Tajweed rules and recitation topics named in the question («ما هو الإقلاب»، «مخارج الحروف»).
 const bare=w=>w.replace(/^(?:و|ب|ف)?ال(?=..)/,''),tw=t.split(' ').map(bare);
 const rules=[...Object.values(QuranKnowledge.TAJWEED_RULES).map(r=>({name:r.name,how:r.how})),...Object.entries(QuranKnowledge.RECITATION_TOPICS).map(([name,r])=>({name,how:r.how}))]
  .filter(r=>{
   // Whole words only, without «و/ب/ف» and «ال» in front; a rule is named in full, by its first word, or by two of its words («المد المتصل»).
   const n=norm(r.name).split(' ').map(bare),has=ws=>tw.some((_,i)=>ws.every((w,j)=>tw[i+j]===w));
   return [n,...(/^(?:مد|لام|تفخيم|ترقيق|علامات|غنه)$/.test(n[0])?[]:[[n[0]]]),...(n.length>2?[[n[0],n[1]],[n[0],n.at(-1)]]:[])].some(has);
  });
 if(rules.length)parts.push('من أحكام التجويد: '+rules.slice(0,3).map(r=>`${r.name}: ${r.how}`).join(' | '));
 // Quran sciences facts counted from the Mushaf, when the question is about them.
 // Not for a named surah («كم عدد آيات سورة البقرة» has its own facts above).
 const facts=!named.size&&/(?:عدد|كم|كام) (?:سور|سوره|ايات|ايه|كلمات|اجزاء|جزء|احزاب|حزب)|فيه كام|اطول سوره|اقصر سوره|سجد|اول (?:ما|ايه|سوره) نزل|اخر (?:ما|ايه|سوره) نزل|جمع القران|القراءات|القراء العشره|الحروف المقطعه|نزل القران|مده نزول|السور المكيه|السور المدنيه/.test(t);
 if(facts){
  const q=QuranKnowledge.quranFacts(surahs),c=q.counted_from_this_mushaf;
  parts.push(`من علوم القرآن (محسوب من المصحف في التطبيق، ${c.ayah_count_method}): عدد السور ${c.surahs}، والآيات ${c.ayat}، والكلمات ${c.words}، المكية ${c.meccan_surahs} والمدنية ${c.medinan_surahs}، الأجزاء ${c.juz} والأحزاب ${c.hizb} والصفحات ${c.pages}، أطول سورة ${nameOf(c.longest_surah.number)} (${c.longest_surah.ayat} آية)، وأقصر السور ${c.shortest_surahs.map(x=>nameOf(x.number)).join(' و')} (3 آيات)، وسجدات التلاوة ${c.sajdat_tilawa.length}.`);
  parts.push('ومن المشهور في علوم القرآن: '+q.classical.join(' '));
 }
 // The Mushaf's own words: skipped for a question about a hadith term, a tajweed rule or the facts above, unless a word is asked about.
 const asksWord=/(?:^| )(?:كلمه|لفظ|لفظه|وردت|ورد|ذكرت|تكررت|قوله تعالي|الايه)(?: |$)/.test(t);
 if(!asksWord&&(m.length||rules.length||facts))return parts.join('\n');
 const surahWords=new Set([...named].flatMap(n=>surahNames[n-1].forms).flatMap(f=>f.split(' ')));
 const content=t.split(' ').filter(w=>w.length>=3&&!LLM_STOP.has(w)&&!surahWords.has(w));
 const f=content.length>=2?tools.find_ayah({text:content.join(' ')}):{};
 if(f.results?.length&&(f.exact_match||(f.results[0].words_matched_percent||0)>=60))parts.push('آيات تطابق كلام السائل: '+f.results.slice(0,2).map(x=>`${nameOf(x.surah)} ${x.ayah}: ${x.text}`).join(' | '));
 for(const w of content.slice(0,3)){
  const r=tools.search_quran({query:w});
  if(r.ayat_count&&r.ayat_count<=40)parts.push(`كلمة «${w}» وردت في ${r.ayat_count} ${ayatWord(r.ayat_count)}: `+r.results.slice(0,10).map(x=>`${nameOf(x.surah)} ${x.ayah}`).join('، ')+(r.ayat_count>10?'، وغيرها':'')+'. ونص أولها: '+r.results.slice(0,2).map(x=>`${nameOf(x.surah)} ${x.ayah}: ${x.text}`).join(' | '));
 }
 return parts.join('\n');
}
const LLM_RULES='أنت مساعد في تطبيق «اختبار التلاوة» لمراجعة حفظ القرآن الكريم. أجب بالعربية الفصحى البسيطة في جمل قليلة. '
 +'اعتمد على «المصادر» وحدها: لا تضف معلومة تاريخية أو سبب نزول أو تاريخًا أو عددًا ليس فيها، وانقل الكلمات كما هي (مكية/مدنية). '
 +'لا تكتب نص آية أو حديث ولا رقم آية إلا إذا كان مكتوبًا في «المصادر» حرفيًا، ولا تنسب قولًا لعالم من عندك. '
 +'لا تحكم على صحة حديث ولا تُفتِ في الأحكام الشرعية؛ وجّه السائل لعالم موثوق. '
 +'إن لم يكن الجواب في المصادر فقل بوضوح إنك لا تعرفه من المصادر المتاحة، واقترح أمرًا من أوامر التطبيق مثل «ابحث عن كلمة…» أو «تفسير الآية» أو «افتح سورة…».';
let llmHistory=[];
async function llmTurn(text,t){
 const div=bubble('assistant','…');div.classList.add('ai-llm');
 try{
  const sources=llmSources(text,t);
  // Earlier turns only for a follow-up («وكم عدد آياتها؟»: short, or starting with «و», and naming no surah of its own);
  // otherwise a previous answer's wording leaks into an unrelated new question.
  const followUp=(/^(?:و|طب |طيب )/.test(t)||t.split(' ').length<=4)&&!/(?:^|\n)معلومات سورة /.test(sources);
  const earlier=followUp?llmHistory.slice(-4):[],onServer=LocalLLM.remote();
  const onToken=partial=>{div.textContent=partial;};
  const messages=[{role:'system',content:LLM_RULES},...earlier,{role:'user',content:(sources?`المصادر:\n${sources}\n\n`:'المصادر: لا يوجد.\n\n')+'السؤال: '+text}];
  const reply=onServer?await LocalLLM.askRemote({question:text,sources,history:earlier},onToken):await LocalLLM.answer(messages,onToken);
  // An empty reply is one the model could not finish reliably (see LocalLLM.broken): nothing of it is shown or kept.
  if(!reply){div.textContent='لم أستطع صياغة إجابة موثوقة لهذا السؤال. جرّب أمرًا مثل «ابحث عن …» أو «تفسير الآية» أو «افتح سورة …».';return;}
  div.textContent=reply;
  div.append(Object.assign(document.createElement('small'),{className:'ai-llm-tag',textContent:(onServer?'🌐 نموذج على خادم التطبيق':'🧠 نموذج محلي على جهازك')+' — قد يخطئ، فتأكد من المصدر'}));
  llmHistory.push({role:'user',content:text},{role:'assistant',content:reply});
  speak(reply);
 }catch(e){
  div.textContent=e.friendly?e.message:'تعذّر تشغيل النموذج المحلي: '+(e.message||e);
  if(e.quota){$('llmStatus').textContent='الحد المجاني انتهى الآن. يعمل البحث والأوامر، وستُجرَّب الخدمة لاحقًا.';$('aiMode').textContent='الوضع المحلي · أوامر أساسية';}
 }
}
// Free chat through the app's server (adel203047/tarteel-assistant), off until the person turns it on, and it can be turned off again.
function setupRemoteLLM(L){
 const button=$('llmEnable'),note=$('llmStatus');
 const OFF='🌐 تفعيل المحادثة الحرة عبر الخادم',NOTE='اختياري ومجاني: يُرسل سؤالك ومصادره إلى Hugging Face. نحو 3 أسئلة يوميًا، وقد يتأخر أول رد.';
 const off=()=>{L.disableRemote();save('llmRemote',false);button.textContent=OFF;note.textContent=NOTE;status=null;checkStatus();};
 const on=async()=>{
  button.disabled=true;note.textContent='جارٍ الاتصال بالخادم…';
  try{await L.enableRemote();save('llmRemote',true);button.textContent='إيقاف المحادثة عبر الخادم';note.textContent='✓ مفعّلة: أسئلتك الحرة تُرسل إلى الخادم حتى توقفها.';status=null;checkStatus();}
  catch(e){note.textContent=e.message;}
  button.disabled=false;
 };
 $('llmBar').hidden=false;button.textContent=OFF;note.textContent=NOTE;
 button.onclick=()=>L.remoteEnabled()?off():on();
 if(load('llmRemote',false)===true)on();
}
// The enable button: shown on computers with WebGPU only; once enabled, later visits load it from the browser's copy.
function setupLLM(){
 const L=globalThis.LocalLLM;if(!L||!$('llmBar'))return;
 // The on-device model is a lab option; everyone else gets the app's server model, off until they turn it on.
 if(!L.supported())return L.remoteSupported?.()?setupRemoteLLM(L):undefined;
 $('llmBar').hidden=false;
 const start=async()=>{
  $('llmEnable').disabled=true;$('llmProg').hidden=false;$('llmStatus').textContent='جارٍ تجهيز النموذج…';
  try{
   await L.load((p,msg)=>{$('llmFill').style.width=Math.round(p*100)+'%';$('llmStatus').textContent=/loading model from cache/i.test(msg)?'تحميل من نسخة الجهاز…':`تحميل النموذج ${Math.round(p*100)}٪ — مرة واحدة فقط`;});
   save('llm',true);$('llmProg').hidden=true;$('llmEnable').hidden=true;
   $('llmStatus').textContent='✓ المحادثة الحرة مفعّلة: اسأل بحرية، والأوامر المعروفة تُنفَّذ كما هي.';
   $('aiMode').textContent='الوضع المحلي + نموذج على جهازك';
  }catch(e){
   $('llmEnable').disabled=false;$('llmProg').hidden=true;
   $('llmStatus').textContent=/no-gpu|webgpu|adapter/i.test(String(e.message||e))?'كارت الشاشة في هذا الجهاز لا يدعم تشغيل النموذج.':'تعذّر التحميل: '+(e.message||e)+' — تأكد من الإنترنت ثم أعد المحاولة.';
  }
 };
 $('llmEnable').onclick=start;
 if(load('llm',false)===true)start();
}
setupLLM();
function setupClaude(){
 const button=$('claudeToggle');if(!button)return;
 claudeOn=load('claude',false)===true;claudeUI();
 button.onclick=async()=>{
  if(claudeReady()){claudeOn=false;save('claude',false);status=null;await checkStatus();return;}
  button.disabled=true;$('claudeStatus').textContent='جارٍ التحقق من الخدمة…';
  status=null;await checkStatus();
  if(status.available&&status.configured){claudeOn=true;save('claude',true);status=null;await checkStatus();}
  else{claudeOn=false;save('claude',false);claudeUI(status.retry?'الخادم يستيقظ أو غير متاح الآن. انتظر دقيقة ثم حاول مرة أخرى.':'Claude غير متاح الآن لأن الخدمة لم تُجهَّز على الخادم بعد. ما زالت أوامر المساعد تعمل.');}
  button.disabled=false;
 };
}
setupClaude();
async function useLocal(text){setBusy(true);try{await localTurn(text);}finally{setBusy(false);}}
async function ask(text){
 text=text.trim();if(!text||busy)return;
 $('aiInput').value='';$('aiSuggest').hidden=true;bubble('user',text);
 await checkStatus();
 if(!claudeReady())return useLocal(text);
 history.push({role:'user',content:text});
 setBusy(true);
 try{
  for(let step=0;step<MAX_STEPS;step++){
   let r,data;
   try{r=await fetch(ASSISTANT_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})});data=await r.json();}
   catch{data={message:'تعذّر الوصول إلى خادم التطبيق.'};}
   if(!r?.ok){
    // Drop the unanswered question so the next try does not send it twice.
    if(step===0)history.pop();
    // Claude is unavailable (no key, no SDK, server unreachable): answer this one locally and stay local.
    if(step===0&&(!r||['not_configured','no_sdk','network','daily_limit'].includes(data.error))){status={available:false};$('aiMode').textContent='الوضع المحلي · أوامر أساسية';claudeUI();bubble('note',data.message||'تعذّر الوصول إلى Claude، أجيب بالوضع المحلي.');setBusy(false);return useLocal(text);}
    bubble('note',data.message||'حدث خطأ في المساعد.');
    return;
   }
   history.push({role:'assistant',content:data.content});
   const said=data.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
   if(said){bubble('assistant',said);speak(said);}
   if(data.stop_reason==='refusal'){bubble('note','لا يستطيع المساعد الإجابة عن هذا الطلب.');return;}
   if(data.stop_reason==='max_tokens'){bubble('note','انقطع الرد لطوله. اطلب إجابة أقصر.');return;}
   if(data.stop_reason!=='tool_use')return;
   // Run every requested tool, then return all results together in one message.
   const results=[];
   for(const use of data.content.filter(b=>b.type==='tool_use')){
    try{const out=tools[use.name]?await tools[use.name](use.input||{}):(()=>{throw Error('Unknown tool '+use.name);})();results.push({type:'tool_result',tool_use_id:use.id,content:JSON.stringify(out)});chip(actionLabel[use.name]||use.name);}
    catch(e){results.push({type:'tool_result',tool_use_id:use.id,content:String(e.message||e),is_error:true});chip((actionLabel[use.name]||use.name)+': '+(e.message||e),true);}
   }
   history.push({role:'user',content:results});
  }
  bubble('note','توقف المساعد بعد عدة خطوات. أعد صياغة طلبك.');
 }finally{setBusy(false);}
}

// ---------- Panel ----------
function open(on){
 $('aiPanel').hidden=!on;$('aiFab').setAttribute('aria-expanded',String(on));$('aiFab').hidden=on;
 if(on){checkStatus();$('aiInput').focus();}else{recognizer?.stop();globalThis.speechSynthesis?.cancel();$('aiFab').focus();}
}
$('aiFab').onclick=()=>open(true);
$('aiClose').onclick=()=>open(false);
$('aiNew').onclick=()=>{if(busy)return;history=[];$('aiLog').replaceChildren();$('aiSuggest').hidden=false;globalThis.speechSynthesis?.cancel();status=null;checkStatus();};
$('aiForm').onsubmit=e=>{e.preventDefault();ask($('aiInput').value);};
$('aiInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask($('aiInput').value);}};
$('aiPanel').onkeydown=e=>{if(e.key==='Escape')open(false);};
for(const b of $('aiSuggest').querySelectorAll('button'))b.onclick=()=>ask(b.textContent);
globalThis.TarteelAssistant={tools,ask,get history(){return history;},llm:{sources:text=>llmSources(text,norm(text)),rules:LLM_RULES,nameOf,norm}};
})();
