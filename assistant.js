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
 get_progress(){
  const keys=Object.keys(scores),values=Object.values(scores),now=Date.now();
  const weakest=keys.map(key=>{const [s,a]=key.split(':').map(Number),words=simple[s-1]?.ayahs[a-1]?.text.split(/\s+/).length||1,p=QuranLearning.recall(brain,key,now,words);return {surah:s,ayah:a,name:surahName(s),last_score:scores[key],predicted_recall:Math.round((p??scores[key]/100)*100)};})
   .filter(w=>w.name).sort((x,y)=>x.predicted_recall-y.predicted_recall).slice(0,5);
  return {ayat_reviewed:keys.length,average_accuracy:values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null,streak_days:streak(activity),reviews_today:activity[day()]||0,weakest};
 },
};
// A short Arabic label shown in the chat for each action.
const actionLabel={get_app_state:'قراءة حالة التطبيق',go_to_ayah:'فتح الآية',get_ayah_text:'قراءة نص الآية من المصحف',play_recitation:'تشغيل التلاوة',set_ayah_hidden:'إخفاء/إظهار الآية',get_progress:'قراءة تقدمك'};

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
function findSurahIn(t){
 const byNumber=t.match(/سوره (?:رقم )?(\d+)/);if(byNumber&&+byNumber[1]>=1&&+byNumber[1]<=114)return +byNumber[1];
 surahNames??=surahs.map(s=>({n:s.number,forms:namesOf(s)}));
 let best=null;
 for(const {n,forms}of surahNames)for(const f of forms){
  // Very short names (ق، ص، ن، طه…) only count after the word «سورة».
  const re=f.length<=3?new RegExp(`سوره ${f}(?: |$)`):new RegExp(`(?:^| )(?:سوره )?${f}(?: |$)`);
  if(re.test(t)&&(!best||f.length>best.len))best={n,len:f.length};
 }
 return best?.n??null;
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
const CAN='أقدر من غير إنترنت أفتحلك سورة أو آية («افتح سورة الكهف»، «آية الكرسي»، «البقرة من آية 1 لحد 5»)، وأشغّلك التلاوة بصوت أي شيخ («شغّلها بصوت الحصري 3 مرات»)، وأخبّيلك الآية عشان تسمّع من حفظك، وأروح للآية اللي بعدها أو اللي قبلها، وأورّيك الآيات اللي محتاجة مراجعة، وأشرحلك أخطاء آخر تسميع.';
// Runs one tool through the same path as Claude's tool calls, so the chat shows the same action chips.
function act(name,input){const out=tools[name](input);chip(actionLabel[name]||name);return out;}
function localTurn(text){
 const t=norm(text);
 if(loading){bubble('assistant','المصحف لسه بيحمّل، استنى ثانية وجرّب تاني.');return;}
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
  // 4. Progress and mistakes.
  if(/(تقدم|احتاج|محتاج|اراجع|مراجعتها|ضعيف|اضعف|احصائ)/.test(t)){
   const p=tools.get_progress();
   if(!p.ayat_reviewed)said.push('لسه ما راجعتش ولا آية. اختار آية ودوس «ابدأ التسميع» عشان نبدأ.');
   else{said.push(`راجعت ${p.ayat_reviewed} آية ومتوسط دقتك ${p.average_accuracy}٪، وبقالك ${p.streak_days} يوم ورا بعض.`);if(p.weakest.length)said.push('أكتر آيات محتاجة مراجعة: '+p.weakest.map(w=>`${w.name} ${w.ayah} (احتمال إنك فاكرها ${w.predicted_recall}٪)`).join('، ')+'.');}
   chip(actionLabel.get_progress);did=true;
  }
  if(/(اخطا|خطا|ملاحظ|غلط)/.test(t)){
   const r=tools.get_app_state().last_review;
   said.push(r.notes.length?'في آخر تسميع: '+r.notes.join(' '):'مفيش أخطاء متسجّلة في آخر تسميع. سمّع آية الأول وبعدين اسألني.');
   chip(actionLabel.get_app_state);did=true;
  }
  if(/(سمع|اختبر|تسميع)/.test(t)&&!/(اسمع|استمع|سمعني)/.test(t)){said.push('دوس «ابدأ التسميع» واقرا، وبعدين وقّف عشان تشوف النتيجة.');did=true;}
 }catch(e){bubble('note',String(e.message||e));return;}
 if(!did){
  if(/^(السلام|سلام|مرحبا|اهلا|هلا|صباح|مساء|ازيك|ازاي)/.test(t)&&!/(تعمل|تقدر|تساعد)/.test(t))said.push('وعليكم السلام ورحمة الله وبركاته! أهلًا بيك. '+CAN);
  else if(/(ماذا|كيف|شو|ايش|ايه|ازاي).*(تستطيع|تقدر|تساعد|يمكنك|تعمل|بتعمل)|مساعده|ساعدني/.test(t))said.push(CAN);
  else said.push('معلش، مفهمتش طلبك في الوضع المحلي. '+CAN+' ولو عايز تتكلم معايا براحتك فعّل Claude (بص في README).');
 }
 const reply=said.join(' ');bubble('assistant',reply);speak(reply);
}

// ---------- Conversation with the server ----------
async function checkStatus(){
 if(status)return status;
 try{const r=await fetch('api/assistant');status=r.ok?await r.json():{available:false};}catch{status={available:false};}
 const claude=status.available&&status.configured;
 $('aiMode').textContent=claude?'Claude · محادثة وصوت':'الوضع المحلي · أوامر أساسية';
 // In the phone app the local mode is the assistant, so no hint about server keys.
 if(status.available&&!status.configured)bubble('note','المساعد شغّال بالوضع المحلي: بيفهم الأوامر الأساسية كتابة أو بالصوت. لو عايز محادثة حرة بالذكاء الاصطناعي ضيف مفتاح Claude API على الخادم (بص في README).');
 return status;
}
function useLocal(text){setBusy(true);try{localTurn(text);}finally{setBusy(false);}}
async function ask(text){
 text=text.trim();if(!text||busy)return;
 $('aiInput').value='';$('aiSuggest').hidden=true;bubble('user',text);
 const st=await checkStatus();
 if(!(st.available&&st.configured))return useLocal(text);
 history.push({role:'user',content:text});
 setBusy(true);
 try{
  for(let step=0;step<MAX_STEPS;step++){
   let r,data;
   try{r=await fetch('api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history})});data=await r.json();}
   catch{data={message:'تعذّر الوصول إلى خادم التطبيق.'};}
   if(!r?.ok){
    // Drop the unanswered question so the next try does not send it twice.
    if(step===0)history.pop();
    // Claude is unavailable (no key, no SDK, server unreachable): answer this one locally and stay local.
    if(step===0&&(!r||['not_configured','no_sdk','network'].includes(data.error))){status={available:false};$('aiMode').textContent='الوضع المحلي · أوامر أساسية';bubble('note',data.message||'تعذّر الوصول إلى Claude، أجيب بالوضع المحلي.');setBusy(false);return useLocal(text);}
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
    try{const out=tools[use.name]?tools[use.name](use.input||{}):(()=>{throw Error('Unknown tool '+use.name);})();results.push({type:'tool_result',tool_use_id:use.id,content:JSON.stringify(out)});chip(actionLabel[use.name]||use.name);}
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
globalThis.TarteelAssistant={tools,ask,get history(){return history;}};
})();
