const $=id=>document.getElementById(id);
// Inside the Android/iOS app (Capacitor) there is no local server, so server-only features are hidden there.
const NATIVE=!!globalThis.Capacitor?.isNativePlatform?.();
if(NATIVE)document.documentElement.classList.add('native');
// On free static hosting (GitHub Pages, Netlify…) there is no server either: detect it and hide the same features.
// Only a definite 404 means static hosting: a server that is waking up (free hosting sleeps) or a slow network must not hide the meeting.
else fetch('api/health',{cache:'no-store'}).then(r=>{if(r.status===404)document.documentElement?.classList.add('no-server');}).catch(()=>{});
// Start-up guard: if anything stops the page from starting (for example an old cached file that no longer matches
// the others), say so and offer a repair instead of showing "loading" forever.
function startupFailed(detail){
 if(typeof loading==='undefined'||!loading||$('versePanel')?.classList?.contains?.('failed'))return;
 $('versePanel')?.classList.remove('loading');$('versePanel')?.classList.add('failed');
 if($('verse'))$('verse').textContent='تعذّر تشغيل التطبيق. اضغط «إصلاح وإعادة التحميل» لتحديث ملفاته.';
 if($('status'))$('status').textContent=detail?'السبب: '+detail:'';
 const retry=$('retry');if(retry){retry.hidden=false;retry.textContent='إصلاح وإعادة التحميل';retry.onclick=repairAndReload;}
}
// Drops the offline copies of the app's files and reloads, so every file comes fresh and matching from the server.
async function repairAndReload(){
 try{for(const reg of await globalThis.navigator?.serviceWorker?.getRegistrations?.()||[])await reg.unregister();for(const key of await globalThis.caches?.keys?.()||[])if(key.startsWith('tarteel-'))await caches.delete(key);}catch{}
 location.reload();
}
window.addEventListener?.('error',e=>startupFailed(e.message));
window.addEventListener?.('unhandledrejection',e=>startupFailed(String(e.reason?.message||e.reason||'')));
setTimeout(()=>startupFailed('انتهت مهلة التحميل'),20000);
// Web fonts are added from here rather than as a <link> in the page, so they never block the first paint (text shows in fallback fonts until they arrive, and offline it simply stays that way).
if(document.head&&!document.getElementById('webfonts')){const link=document.createElement('link');link.id='webfonts';link.rel='stylesheet';link.href='https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap';document.head.append(link);}
let surahs=[],simple=[],recognition=null,listening=false,loading=true,generation=0,finishSession=null;
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
function selected(){return surahs[Number($('surah').value)-1]?.ayahs[Number($('ayah').value)-1];}
function stop(){if(finishSession)finishSession();}
const BASMALA='بسم الله الرحمن الرحيم';
// Al Quran Cloud prefixes the basmala to ayah 1 of most surahs; it is not part of the ayah, so show it apart and compare without it.
function separateBasmala(chapters){for(const c of chapters){for(const a of c.ayahs)a.text=a.text.replace(/^\s*/,'');c.basmala='';if(c.number===1||c.number===9)continue;const first=c.ayahs[0],m=first.text.match(/^((?:\S+\s+){3}\S+)\s+(?=\S)/);if(m&&QuranCompare.normalize(m[1])===BASMALA){c.basmala=m[1];first.text=first.text.slice(m[0].length);}}}
function load(key,fallback){try{return JSON.parse(localStorage.getItem('tarteel:'+key))??fallback;}catch{return fallback;}}
function save(key,value){try{localStorage.setItem('tarteel:'+key,JSON.stringify(value));}catch{}}
let scores=load('scores',{});
let brain=load('learning',null);if(brain?.weights?.length!==QuranLearning.PRIOR.length)brain=QuranLearning.createState();if(!brain.clf)brain.clf=QuranLearning.createClassifier();
function make(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!=null)node.textContent=text;return node;}
// Written notes, one card per mistake: quoted letters and words become highlighted chips, followed by the
// supervised classifier's guess and two buttons that label the example and train it.
function renderNotes(items){
 const device=onDevice();
 const notes=items.filter(item=>item.type!=='correct'&&QuranCompare.explain(item)).map((item,index)=>{
  const li=make('li',`note note-${item.type}`);li.style?.setProperty('--i',index);
  const text=make('p','note-text');
  for(const part of QuranCompare.explain(item).split(/(«[^»]*»)/))if(part)text.append(part.startsWith('«')?make('span','chip',part.slice(1,-1)):part);
  const length=QuranCompare.normalize(item.expected||item.spoken).length;
  const x=QuranLearning.mistakeFeatures({type:item.type,ops:item.type==='changed'?QuranCompare.letterDiff(item.expected,item.spoken):[],length,device});
  const p=QuranLearning.classify(brain.clf,x);
  const guess=make('span','note-guess',`🤖 تقدير المصنف: احتمال أن يكون خطأ تعرف ${Math.round(p*100)}٪`);
  const mine=make('button','note-label','خطأ مني'),asr=make('button','note-label','خطأ في التعرف');
  const teach=isRecognition=>{QuranLearning.label(brain.clf,x,isRecognition);save('learning',brain);mine.disabled=asr.disabled=true;(isRecognition?asr:mine).classList.add('chosen');(isRecognition?asr:mine).setAttribute('aria-pressed','true');guess.textContent=`✓ تعلّم المصنف من تصنيفك (${brain.clf.n} مثال حتى الآن)`;updatePanel();};
  mine.onclick=()=>teach(false);asr.onclick=()=>teach(true);
  const meta=make('div','note-ai');meta.append(guess,mine,asr);
  li.append(text,meta);return li;
 });
 $('notesList').replaceChildren(...notes);$('notes').hidden=!notes.length;
}
// Live view of the four learning components.
function updatePanel(){
 const device=onDevice(),updates=brain.updates,ayat=Object.keys(brain.ayat).length,clf=brain.clf;
 $('aiDl').textContent=globalThis.DeviceASR?.loaded?.(modelKind())?'نموذج Whisper محمّل ويعمل على جهازك':device?'يُحمَّل النموذج عند أول تسميع':'غير مفعّل — اختر نموذج التعلم العميق';
 $('aiMl').textContent=ayat?`${ayat} آية متتبعة · ${updates} تحديث للأوزان`:'يبدأ التعلم بعد أول مراجعة';
 $('aiRl').textContent=brain.pulls?`${brain.pulls} مكافأة من مراجعاتك`:'اضغط «اقترح آية» ليبدأ الاستكشاف';
 $('aiSl').textContent=clf.n?`${clf.n} مثال مصنّف · دقة التوقع ${Math.round(clf.correct/clf.n*100)}٪`:'صنّف ملاحظات الأخطاء لتدريبه';
}
function verseKey(){return $('surah').value+':'+$('ayah').value;}
function wordCount(){return simple[Number($('surah').value)-1].ayahs[Number($('ayah').value)-1].text.split(/\s+/).length;}
function showRef(){const a=selected(),key=verseKey(),score=scores[key],p=QuranLearning.recall(brain,key,Date.now(),wordCount()),nums=rangeNumbers();if(nums.length>1){const done=nums.filter(n=>scores[`${$('surah').value}:${n}`]!=null).length;$('verseRef').textContent=`${surahs[Number($('surah').value)-1].name} • الآيات ${nums[0]}–${nums.at(-1)}`+(done?` • راجعت منها ${done}`:'');return;}$('verseRef').textContent=`${surahs[Number($('surah').value)-1].name} • الآية ${a.numberInSurah}`+(score!=null?` • آخر مراجعة ${score}٪`:'')+(p!=null?` • احتمال التذكر المتوقع ${Math.round(p*100)}٪`:'');}
function ago(ms){const h=ms/36e5;return h<1?'منذ دقائق':h<24?`منذ ${Math.round(h)} ساعة`:`منذ ${Math.round(h/24)} يوم`;}
// Reinforcement learning: the agent picks the ayah in this surah whose review it expects to be most useful.
function smartPick(){
 if(loading)return;const s=Number($('surah').value),now=Date.now();
 const candidates=simple[s-1].ayahs.map(a=>({key:`${s}:${a.numberInSurah}`,words:a.text.split(/\s+/).length}));
 const pick=QuranLearning.choose(brain,candidates,now,verseKey());
 if(!pick){$('smartWhy').textContent='لا توجد آيات أخرى في هذه السورة.';return;}
 goTo(s,Number(pick.key.split(':')[1]));
 const p=QuranLearning.recall(brain,pick.key,now,candidates.find(c=>c.key===pick.key).words);
 $('smartWhy').textContent=pick.stat?`اختارها الوكيل: احتمال التذكر ${Math.round(p*100)}٪، آخر نتيجة ${pick.stat.lastScore}٪، ${ago(now-pick.stat.last)}.`:'آية لم تراجعها بعد — الوكيل يستكشف الآيات الجديدة أولًا.';
}
function engine(){const v=$('engine').value;return v==='device'||v==='device-fast'?v:'browser';}
function onDevice(){return engine()!=='browser';}
// The accurate on-device model is the default; the fast one trades accuracy for a smaller download.
function modelKind(){return engine()==='device-fast'?'fast':'accurate';}
function updateEngine(){
 const device=onDevice(),ok=device?!!globalThis.DeviceASR?.supported():!!SpeechRecognition;
 $('record').disabled=!ok;$('modelStatus').hidden=!device;
 $('status').textContent=ok?(device?'جاهز — التعرف يتم على جهازك بنموذج تعلم عميق.':'جاهز عندما تكون مستعدًا'):(device?'تسجيل الصوت غير مدعوم في هذا المتصفح.':'التعرف الصوتي غير مدعوم هنا. اختر «نموذج التعلم العميق على جهازك» أو استخدم النص اليدوي.');
}
let analyzing=false;
function showModelProgress(pct,mb){$('modelBar').hidden=pct>=100;$('modelBarFill').style?.setProperty('width',pct+'%');$('modelBar').setAttribute?.('aria-valuenow',pct);if(analyzing&&pct<100)$('status').textContent=`جارٍ تحميل النموذج لأول مرة (${pct}٪)، ثم يبدأ التحليل…`;$('modelStatus').textContent=pct<100?`تحميل نموذج التعلم العميق لأول مرة: ${pct}٪ من ${mb} م.ب`:'النموذج محمّل ومحفوظ على جهازك.';}
// A range of ayat ("من الآية" … "إلى الآية") is shown and tested as one passage, with ayah markers between them.
function rangeNumbers(){const a=Number($('ayah').value),e=Math.max(a,Number($('ayahEnd').value)||0);return Array.from({length:e-a+1},(_,i)=>a+i);}
const marker=n=>' ﴿'+n.toLocaleString('ar-EG')+'﴾';
let hintLevel=0;
// Hints for the hidden ayah: first the first letter of every word, then whole words one at a time.
// The first-letter hint keeps the definite article (ال) and adds the letter after it, which is the useful clue.
function hintText(words){return words.map((w,i)=>i<hintLevel-1?w:(w.match(/^(?:[اٱ]ل[\u064B-\u065F\u0670\u06D6-\u06ED]*)?\S[\u064B-\u065F\u0670\u06D6-\u06ED]*/u)?.[0]||w)+'…').join(' ');}
function showVerse(){
 const s=surahs[Number($('surah').value)-1],nums=rangeNumbers(),many=nums.length>1;
 $('verse').classList.remove('swap');void $('verse').offsetWidth;$('verse').classList.add('swap');
 if($('hide').checked){const words=nums.map(n=>s.ayahs[n-1].text).join(' ').split(/\s+/);$('verse').textContent=hintLevel?hintText(words):many?'الآيات مخفية — اقرأ من حفظك':'الآية مخفية — اقرأ من حفظك';$('hint').hidden=hintLevel>words.length;$('hint').textContent=hintLevel?'💡 تلميح إضافي':'💡 تلميح';}
 else{$('verse').textContent=many?nums.map(n=>s.ayahs[n-1].text+marker(n)).join(' '):selected().text;$('hint').hidden=true;}
 $('basmala').textContent=s.basmala;$('basmala').hidden=!(s.basmala&&$('ayah').value==='1');
}
function render(){stopWordAudio();generation++;stop();hintLevel=0;$('audio').onended=null;$('audio').pause();$('audio').hidden=true;$('audioStatus').textContent='';$('transcript').value='';$('result').replaceChildren();$('resultLabel').textContent='بانتظار تلاوتك';$('resultIntro').textContent='بعد التسميع ستظهر الكلمات المطابقة والاختلافات المحتملة هنا.';$('smartWhy').textContent='';$('score').hidden=true;listened=reviewed=false;$('notes').hidden=true;$('notesList').replaceChildren();const a=selected(),s=Number($('surah').value);showVerse();showRef();$('prev').disabled=s===1&&a.numberInSurah===1;$('next').disabled=s===114&&a.numberInSurah===surahs[s-1].ayahs.length;save('position',{surah:s,ayah:a.numberInSurah});updateSteps();updateProgress();}
function fillEnd(){const s=surahs[Number($('surah').value)-1],a=Number($('ayah').value),last=Math.min(s.ayahs.length,a+49);$('ayahEnd').replaceChildren(...Array.from({length:last-a+1},(_,i)=>new Option(a+i,a+i)));$('ayahEnd').disabled=$('ayah').disabled;}
function fillAyahs(){const s=surahs[Number($('surah').value)-1];$('ayah').replaceChildren(...s.ayahs.map(a=>new Option(a.numberInSurah,a.numberInSurah)));fillEnd();}
function changeSurah(){fillAyahs();render();}
function goTo(surah,ayah){$('surah').value=surah;fillAyahs();$('ayah').value=ayah;fillEnd();render();}
// Moving past either end of a surah continues into the neighbouring surah.
function step(delta){if(loading)return;let s=Number($('surah').value),a=Number($('ayah').value)+delta;if(a<1){if(s===1)return;s--;a=surahs[s-1].ayahs.length;}else if(a>surahs[s-1].ayahs.length){if(s===114)return;s++;a=1;}goTo(s,a);}
async function init(){try{const responses=await Promise.all(['data/quran.json','data/simple.json'].map(x=>fetch(x)));if(responses.some(r=>!r.ok))throw Error();const [q,s]=await Promise.all(responses.map(r=>r.json()));surahs=q.data.surahs;simple=s.data.surahs;if(surahs.length!==114||simple.length!==114)throw Error();separateBasmala(surahs);separateBasmala(simple);$('surah').replaceChildren(...surahs.map(s=>new Option(`${s.number}. ${s.name}`,s.number)));$('surah').disabled=$('ayah').disabled=false;loading=false;$('versePanel').classList.remove('loading','failed');globalThis.performance?.mark?.('tarteel-ready');fillSearch();const pos=load('position',null);$('hide').checked=load('hide',false)===true;if(pos&&surahs[pos.surah-1]?.ayahs[pos.ayah-1])goTo(pos.surah,pos.ayah);else changeSurah();$('engine').value=load('engine',globalThis.DeviceASR?.supported()||!SpeechRecognition?'device':'browser');updateEngine();updatePanel();}catch{$('versePanel').classList.remove('loading');$('versePanel').classList.add('failed');$('retry').hidden=false;$('verse').textContent='تعذّر تحميل المصحف. تحقق من الاتصال ثم أعد المحاولة.';$('status').textContent='النص القرآني غير متاح.';}}
$('surah').onchange=changeSurah;$('ayah').onchange=()=>{fillEnd();render();};$('ayahEnd').onchange=render;$('hide').onchange=()=>{save('hide',$('hide').checked);hintLevel=0;if(!loading)showVerse();};
$('hint').onclick=()=>{hintLevel++;showVerse();};
$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('smart').onclick=smartPick;
$('engine').onchange=()=>{save('engine',engine());if(!loading){render();updateEngine();updatePanel();}};
// Reciters, streamed per ayah from everyayah.com (one request, no API lookup).
// The teaching recitations («المعلّم») have children repeating after the sheikh.
const RECITERS={minshawi_teacher:{name:'المنشاوي المعلّم',dir:'Minshawy_Teacher_128kbps'},husary:{name:'الحصري مرتّل',dir:'Husary_128kbps'},husary_mujawwad:{name:'الحصري مجوّد',dir:'Husary_128kbps_Mujawwad'},husary_teacher:{name:'الحصري المعلّم',dir:'Husary_Muallim_128kbps'},jibreel:{name:'محمد جبريل',dir:'Muhammad_Jibreel_128kbps'},abdulbasit:{name:'عبد الباسط مرتّل',dir:'Abdul_Basit_Murattal_192kbps'},abdulbasit_mujawwad:{name:'عبد الباسط مجوّد',dir:'Abdul_Basit_Mujawwad_128kbps'},banna:{name:'محمود علي البنا',dir:'mahmoud_ali_al_banna_32kbps'},tablawi:{name:'محمد محمود الطبلاوي',dir:'Mohammad_al_Tablaway_128kbps'},shatri:{name:'أبو بكر الشاطري',dir:'Abu_Bakr_Ash-Shaatree_128kbps'},hudhaify:{name:'علي الحذيفي',dir:'Hudhaify_128kbps'},shuraym:{name:'سعود الشريم',dir:'Saood_ash-Shuraym_128kbps'}};
$('reciter').replaceChildren(...Object.entries(RECITERS).map(([id,r])=>new Option(r.name,id)));
// Al-Husary (murattal) is the default; an unknown saved choice (e.g. a removed reciter) falls back to him.
$('reciter').value=RECITERS[load('reciter','husary')]?load('reciter','husary'):'husary';
$('reciter').onchange=()=>{save('reciter',$('reciter').value);$('audio').pause();$('audio').onended=null;$('audioStatus').textContent='';};
function reciter(){return RECITERS[$('reciter').value]||RECITERS.husary;}
function ayahAudio({surah,ayah}){return `https://everyayah.com/data/${reciter().dir}/${String(surah).padStart(3,'0')}${String(ayah).padStart(3,'0')}.mp3`;}
// Plays the selected ayah or range, repeated as chosen (a common way to memorise).
$('repeat').value=String(load('repeat',1));$('repeat').onchange=()=>save('repeat',Number($('repeat').value));
$('listen').onclick=async()=>{
 if(loading)return;stopWordAudio();stop();
 const token=generation,surah=Number($('surah').value),nums=rangeNumbers(),times=Number($('repeat').value)||1,queue=[],name=reciter().name;
 for(let r=0;r<times;r++)nums.forEach(ayah=>queue.push({surah,ayah}));
 const total=queue.length,audio=$('audio'),live=()=>token===generation;let failed=0,slowTimer=0;
 const status=text=>{$('audioStatus').textContent=text;};
 // Position in the queue, so a skipped ayah does not shift the numbering.
 const playing=()=>status(`تلاوة ${name}`+(total>1?` — ${total-queue.length} من ${total}`:''));
 const finish=()=>{clearTimeout(slowTimer);audio.onended=audio.onerror=audio.onwaiting=audio.onplaying=null;};
 // Start downloading the next ayah while this one plays, so a passage flows without gaps on slow connections.
 const prefetch=()=>{if(queue[0]&&typeof Audio!=='undefined'){const next=new Audio();next.preload='auto';next.src=ayahAudio(queue[0]);}};
 // Explain a slow wait instead of leaving "loading" on screen.
 const slow=()=>{clearTimeout(slowTimer);slowTimer=setTimeout(()=>{if(live())status('الاتصال بطيء — ما زال تحميل التلاوة جاريًا…');},6000);};
 const playNext=async()=>{
  if(!live())return;
  if(!queue.length){finish();if(total>1)status('انتهى الاستماع.');return;}
  const item=queue.shift();let done=false;status('جارٍ تحميل التلاوة…');slow();
  // One missing or unreachable file skips to the next ayah instead of silently stopping the passage.
  const fail=()=>{
   if(done||!live())return;done=true;clearTimeout(slowTimer);failed++;
   const go=queue.length&&failed<3&&globalThis.navigator?.onLine!==false;
   status(`تعذّر تحميل الآية ${item.ayah} بصوت ${name}`+(go?' — ننتقل إلى التالية…':'. تحقق من الإنترنت وحاول مرة أخرى.'));
   if(go)setTimeout(()=>{if(live())playNext();},1500);else finish();
  };
  audio.onerror=fail;audio.onwaiting=()=>{if(live())slow();};audio.onplaying=()=>{if(live()){clearTimeout(slowTimer);playing();}};
  try{audio.src=ayahAudio(item);audio.hidden=false;await audio.play();if(!live()||done)return;clearTimeout(slowTimer);failed=0;playing();listened=true;updateSteps();prefetch();}
  catch{fail();}
 };
 audio.onended=playNext;await playNext();
};
// Compares the recitation with the selected ayah or range. Each word is traced back to its ayah, so a range
// gets per-ayah scores (for progress and the learning models) and the word-audio buttons point at the right ayah.
function review(){
 if(loading)return;const text=$('transcript').value.trim();
 if(!text){$('status').textContent='لم تصل كلمات للمقارنة. اقرأ مجددًا أو أدخل النص يدويًا.';return;}
 const s=Number($('surah').value),segs=rangeNumbers().map(n=>{const t=simple[s-1].ayahs[n-1].text;return {n,key:`${s}:${n}`,text:t,words:t.split(/\s+/).length,items:[]};});
 const items=QuranCompare.compare(segs.map(g=>g.text).join(' '),text),reviewToken=generation,many=segs.length>1;
 let seg=0,inSeg=0;
 for(const item of items){if(item.expected){while(inSeg>=segs[seg].words&&seg<segs.length-1){seg++;inSeg=0;}item.index=inSeg++;}item.seg=seg;segs[seg].items.push(item);}
 const nodes=[];
 for(const g of segs){
  if(many)nodes.push(make('span','ayah-sep',marker(g.n).trim()));
  for(const item of g.items){
   const span=make('span',`word ${item.type}`,item.expected||item.spoken);
   if(item.type!=='correct')span.append(make('small','',item.type==='missing'?'لم يُسمع':item.type==='extra'?'كلمة إضافية':`المسموع: ${item.spoken}`));
   if(item.expected&&item.type!=='correct'){const button=make('button','word-listen','🔊 استمع للكلمة');button.setAttribute('aria-label','استمع للنطق الصحيح: '+item.expected);button.onclick=()=>playCorrection(g.key,item.index,item.expected,g.text,button,reviewToken);span.append(button);}
   nodes.push(span);
  }
 }
 $('result').replaceChildren(...nodes);
 const now=Date.now();
 for(const g of segs){if(!g.items.length)continue;const score=Math.round(g.items.filter(i=>i.type==='correct').length/g.items.length*100);scores[g.key]=score;QuranLearning.learn(brain,g.key,score,now,g.words);recordActivity();}
 save('scores',scores);save('learning',brain);updateProgress();showRef();
 const count=items.filter(i=>i.type!=='correct').length,score=Math.round((items.length-count)/items.length*100);
 $('resultLabel').textContent=count?`${count} مواضع للمراجعة · ${score}٪`:'الكلمات متطابقة';showScore(score);reviewed=true;updateSteps();renderNotes(items);updatePanel();
 $('resultIntro').textContent=(many?`نتيجة ${segs.length} آيات معًا. `:'')+'راجع هذه المواضع بالاستماع؛ قد يكون الاختلاف ناتجًا عن التعرف الصوتي. تطابق الكلمات لا يعني صحة التجويد.';
}

let wordPlayer=null,wordButton=null,wordRequest=0;
const wordCache=new Map();
function stopWordAudio(){
 wordRequest++;
 if(wordPlayer){wordPlayer.pause();wordPlayer.onended=wordPlayer.onerror=null;wordPlayer=null;}
 if(wordButton){wordButton.disabled=false;wordButton.textContent='🔊 استمع للكلمة';wordButton=null;}
}
async function playCorrection(key,index,word,expected,button,token){
 if(token!==generation||finishSession)return;
 stopWordAudio();$('audio').pause();const request=wordRequest;
 wordButton=button;button.disabled=true;button.textContent='جارٍ التحميل…';
 $('wordAudioStatus').textContent='جارٍ تحميل نطق الكلمة: '+word;
 try{
  let words=wordCache.get(key);
  if(!words){
   const r=await fetch(`https://api.quran.com/api/v4/verses/by_key/${key}?words=true&word_fields=text_imlaei`,{signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error();const data=await r.json();
   words=data.verse.words.filter(w=>w.char_type_name==='word');wordCache.set(key,words);
  }
  if(request!==wordRequest||token!==generation)return;
  const tokens=expected.trim().split(/\s+/);
  // Never guess positions when the two Quran editions tokenize differently.
  if(words.length!==tokens.length||QuranCompare.normalize(words[index]?.text_imlaei||'')!==QuranCompare.normalize(word))throw Error();
  const path=words[index].audio_url;
  if(!/^wbw\/\d{3}_\d{3}_\d{3}\.mp3$/.test(path))throw Error();
  wordPlayer=new Audio('https://audio.qurancdn.com/'+path);
  const done=()=>{if(request!==wordRequest)return;stopWordAudio();$('wordAudioStatus').textContent='يمكنك إعادة الاستماع بالضغط على زر الكلمة.';};
  wordPlayer.onended=done;
  wordPlayer.onerror=()=>{if(request!==wordRequest)return;stopWordAudio();$('wordAudioStatus').textContent='تعذّر تشغيل صوت الكلمة. تحقق من الإنترنت أو استمع للآية كاملة.';};
  await wordPlayer.play();
  if(request!==wordRequest)return;
  button.textContent='🔊 جارٍ التشغيل';$('wordAudioStatus').textContent='النطق الصحيح للكلمة: '+word;
 }catch{
  if(request!==wordRequest)return;stopWordAudio();
  $('wordAudioStatus').textContent='تعذّر تحميل نطق هذه الكلمة. تحقق من الإنترنت، أو استخدم «استمع للتلاوة» لسماع الآية كاملة.';
 }
}

$('review').onclick=()=>{stopWordAudio();review();};
$('record').onclick=()=>{
 if(finishSession){stop();return;}
 if(loading)return;
 if(onDevice()){recordOnDevice();return;}
 if(!SpeechRecognition)return;
 stopWordAudio();$('audio').pause();$('transcript').value='';
 const session=new SpeechRecognition();recognition=session;
 session.lang='ar-SA';session.continuous=true;session.interimResults=true;
 const token=generation;let ended=false,stopping=false,timer=null,failed=false;
 const active=()=>!ended&&recognition===session&&token===generation;
 function finish(){
  if(ended)return;ended=true;clearTimeout(timer);
  session.onstart=session.onresult=session.onerror=session.onend=null;
  try{session.abort();}catch{}
  if(recognition!==session)return;
  recognition=null;finishSession=null;listening=false;
  $('record').disabled=false;$('record').textContent='ابدأ التسميع';
  $('micIcon').classList.remove('listening');$('surah').disabled=$('ayah').disabled=false;
  if(token!==generation)return;
  if($('transcript').value.trim()){
   $('status').textContent=failed?'تمت مراجعة الكلمات المتاحة قبل تعذّر الاتصال.':'انتهى التسميع. راجع الكلمات أدناه.';
   review();$('result').scrollIntoView?.({behavior:'smooth',block:'center'});
  }else if(!failed){
   $('status').textContent='لم تصل كلمات من خدمة التعرف الصوتي. حاول مجددًا أو استخدم النص اليدوي.';
   $('resultLabel').textContent='لم تصل كلمات';
   $('resultIntro').textContent='لم تُنتج خدمة التعرف نصًا للمراجعة. تحقق من الميكروفون والإنترنت أو أدخل النص يدويًا.';
   $('transcript').closest('details').open=true;
  }
 }
 finishSession=()=>{
  if(ended||stopping)return;stopping=true;
  // Reflect the click immediately; do not rely on the browser delivering onend.
  listening=false;$('record').textContent='جارٍ إنهاء التسميع…';$('record').disabled=true;
  $('micIcon').classList.remove('listening');$('status').textContent='جارٍ مراجعة الكلمات المتاحة…';
  timer=setTimeout(finish,1500);
  try{session.stop();}catch{finish();}
 };
 $('record').textContent='جارٍ تشغيل الميكروفون…';
 session.onstart=()=>{if(!active()||stopping)return;listening=true;$('record').textContent='إيقاف ومراجعة';$('micIcon').classList.add('listening');$('status').textContent='أستمع إليك… اقرأ الآية المحددة';$('surah').disabled=$('ayah').disabled=true;};
 session.onresult=e=>{
  if(!active())return;
  // Rebuild from all results: final and interim words remain available on stop.
  $('transcript').value=Array.from(e.results,r=>r[0].transcript).join(' ').trim();
 };
 session.onerror=e=>{
  if(!active())return;failed=true;
  const messages={'not-allowed':'لم يُسمح بالميكروفون. فعّل الإذن من إعدادات المتصفح.','audio-capture':'لم يُعثر على ميكروفون.','network':'تعذّر الاتصال بخدمة التعرف الصوتي.','no-speech':'لم يُسمع صوت. حاول مرة أخرى.'};
  $('status').textContent=messages[e.error]||'تعذّر التعرف الصوتي. جرّب مجددًا أو استخدم النص اليدوي.';
  finish();
 };
 session.onend=finish;
 try{session.start();}catch{failed=true;$('status').textContent='تعذّر بدء التسميع. أعد المحاولة.';finish();}
};
// Deep learning: record locally, then transcribe with the on-device Whisper model when the reader stops.
async function recordOnDevice(){
 stopWordAudio();$('audio').pause();$('transcript').value='';
 const token=generation;let recording=null,stopped=false;
 const reset=()=>{finishSession=null;listening=false;$('record').disabled=false;$('record').textContent='ابدأ التسميع';$('micIcon').classList.remove('listening','analyzing');analyzing=false;$('surah').disabled=$('ayah').disabled=$('engine').disabled=false;updateSteps();};
 finishSession=()=>{stopped=true;};
 $('record').disabled=true;$('record').textContent='جارٍ تشغيل الميكروفون…';
 DeviceASR.load(modelKind(),showModelProgress).catch(()=>{});
 let quietSince=Date.now(),quietShown=false;
 // Show the live level, and warn when nothing is reaching the microphone (silence is what makes the model invent words).
 const onLevel=level=>{$('micIcon').style?.setProperty('--level',level.toFixed(3));if(!listening)return;if(level>0.06){quietSince=Date.now();if(quietShown){quietShown=false;$('status').textContent='أستمع إليك… التسجيل يبقى على جهازك';}}else if(!quietShown&&Date.now()-quietSince>3000){quietShown=true;$('status').textContent='لا نسمع صوتك جيدًا — اقترب من الميكروفون أو ارفع صوتك قليلًا.';}};
 try{recording=await DeviceASR.record(onLevel);}catch{reset();$('status').textContent='لم يُسمح بالميكروفون أو لم يُعثر عليه. فعّل الإذن من إعدادات المتصفح.';return;}
 if(stopped||token!==generation){recording.cancel();reset();return;}
 listening=true;$('record').disabled=false;$('record').textContent='إيقاف ومراجعة';$('micIcon').classList.add('listening');
 $('status').textContent='أستمع إليك… التسجيل يبقى على جهازك';$('surah').disabled=$('ayah').disabled=$('engine').disabled=true;updateSteps();
 finishSession=async()=>{
  if(stopped)return;stopped=true;listening=false;
  $('record').disabled=true;$('record').textContent='جارٍ التحليل…';$('micIcon').classList.remove('listening');$('micIcon').classList.add('analyzing');analyzing=true;
  $('status').textContent='يحلّل نموذج التعلم العميق تلاوتك على جهازك…';
  let failed=false;
  try{const blob=await recording.stop();if(token===generation)$('transcript').value=await DeviceASR.transcribe(blob,modelKind(),showModelProgress);}
  catch{failed=true;}
  reset();updatePanel();
  if(token!==generation)return;
  if($('transcript').value.trim()){$('status').textContent='انتهى التحليل. راجع الكلمات أدناه.';review();$('result').scrollIntoView?.({behavior:'smooth',block:'center'});}
  else if(failed)$('status').textContent='تعذّر تحليل التسجيل. أول استخدام يحتاج الإنترنت لتحميل النموذج.';
  else{$('status').textContent='لم يُلتقط كلام واضح، فلم نحلل الصمت أو الضوضاء حتى لا تظهر كلمات لم تقلها. اقرأ بصوت أوضح وأقرب للميكروفون.';$('resultLabel').textContent='لم تصل كلمات';}
 };
}
// Progress: a per-day review log for the streak, overall stats, current-surah coverage and the weakest ayat.
let activity=load('activity',{});
const day=(time=Date.now())=>new Date(time).toLocaleDateString('en-CA');
function streak(log,today=Date.now()){
 // A streak survives until the end of today, so start counting from yesterday when nothing is logged yet today.
 let n=0,t=today;if(!log[day(t)])t-=864e5;
 while(log[day(t)]){n++;t-=864e5;}
 return n;
}
function recordActivity(){const d=day();activity[d]=(activity[d]||0)+1;save('activity',activity);}
function updateProgress(){
 const keys=Object.keys(scores),values=Object.values(scores),now=Date.now();
 $('statAyat').textContent=keys.length;$('statAvg').textContent=values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length)+'٪':'—';
 $('statStreak').textContent=streak(activity);$('statToday').textContent=activity[day()]||0;
 if(loading)return;
 const s=Number($('surah').value),total=surahs[s-1].ayahs.length,done=keys.filter(k=>k.startsWith(s+':')).length,pct=Math.round(done/total*100);
 $('surahProgressLabel').textContent=`${surahs[s-1].name}: راجعت ${done} من ${total} آية`;$('surahProgressPct').textContent=pct+'٪';$('surahProgressFill').style?.setProperty('width',pct+'%');$('surahProgressBar').setAttribute?.('aria-valuenow',pct);
 // Weakest first: the recall model's prediction where it has one, otherwise the last score.
 const weak=keys.map(key=>{const [ks,ka]=key.split(':').map(Number),words=simple[ks-1]?.ayahs[ka-1]?.text.split(/\s+/).length||1,p=QuranLearning.recall(brain,key,now,words);return {key,s:ks,a:ka,p:p??scores[key]/100};}).filter(w=>surahs[w.s-1]?.ayahs[w.a-1]&&w.p<0.95).sort((x,y)=>x.p-y.p).slice(0,5);
 $('weakList').replaceChildren(...weak.map(w=>{const li=make('li',''),button=make('button','');const label=make('span','');label.append(make('span','',`${surahs[w.s-1].name} • الآية ${w.a}`),make('span','weak-meta',` — آخر نتيجة ${scores[w.key]}٪`));button.append(label,make('span',`weak-p${w.p>=0.6?' mid':''}`,Math.round(w.p*100)+'٪'));button.title='احتمال التذكر المتوقع';button.onclick=()=>{goTo(w.s,w.a);document.querySelector?.('.reader')?.scrollIntoView({behavior:'smooth',block:'start'});};li.append(button);return li;}));
 $('weakEmpty').hidden=weak.length>0;
}
// Backup and restore: everything the app keeps is in localStorage under "tarteel:".
const PREFS=['theme','verseScale','engine','hide'];
function storedKeys(){try{return Object.keys(localStorage).filter(k=>k.startsWith('tarteel:'));}catch{return [];}}
$('exportData').onclick=()=>{
 const data={};for(const k of storedKeys())data[k]=localStorage.getItem(k);
 const blob=new Blob([JSON.stringify({app:'quran-recitation-test',version:1,exported:new Date().toISOString(),data},null,1)],{type:'application/json'});
 const link=make('a','');link.href=URL.createObjectURL(blob);link.download=`tarteel-backup-${day()}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
 $('dataStatus').textContent=`حُفظت نسخة احتياطية (${Object.keys(data).length} عنصرًا).`;toast('⤓ حُفظت النسخة الاحتياطية في مجلد التنزيلات.');
};
$('importBtn').onclick=()=>$('importData').click();
$('importData').onchange=async()=>{
 const file=$('importData').files[0];$('importData').value='';if(!file)return;
 try{
  const backup=JSON.parse(await file.text()),entries=Object.entries(backup?.data||{});
  if(backup?.app!=='quran-recitation-test'||!entries.length||entries.some(([k,v])=>!k.startsWith('tarteel:')||typeof v!=='string'))throw Error();
  entries.forEach(([,v])=>JSON.parse(v));
  if(!confirm(`استعادة النسخة الاحتياطية بتاريخ ${backup.exported?.slice(0,10)||'غير معروف'}؟ سيحل محل تقدمك الحالي.`))return;
  for(const k of storedKeys())localStorage.removeItem(k);
  for(const [k,v] of entries)localStorage.setItem(k,v);
  location.reload();
 }catch{$('dataStatus').textContent='الملف ليس نسخة احتياطية صالحة من هذا التطبيق.';toast('الملف ليس نسخة احتياطية صالحة.');}
};
$('resetData').onclick=()=>{
 if(!confirm('مسح كل التقدم (النتائج وما تعلمته النماذج وسجل الأيام)؟ لا يمكن التراجع، فاحفظ نسخة احتياطية أولًا.'))return;
 for(const k of storedKeys())if(!PREFS.includes(k.slice(8)))localStorage.removeItem(k);
 location.reload();
};
// Toast: a short confirmation for actions that have no other visible result.
let toastTimer=0;
function toast(message){const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;},2800);}
// Surah search: names are offered without diacritics so typing «الكهف» matches; a number (also ١٨) jumps directly.
const plainName=name=>QuranCompare.normalize(name).replace(/^سورة\s+/,'');
function fillSearch(){$('surahNames').replaceChildren(...surahs.map(s=>{const o=document.createElement('option');o.value=`${s.number} ${plainName(s.name)}`;return o;}));$('surahSearch').disabled=false;}
function findSurah(query){
 const western=query.trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)),n=Number(western.match(/^\d+/)?.[0]);
 if(n>=1&&n<=114)return n;
 const q=QuranCompare.normalize(western).replace(/^سورة\s+/,'');if(!q)return null;
 return (surahs.find(s=>plainName(s.name)===q)||surahs.find(s=>plainName(s.name).includes(q)))?.number??null;
}
$('surahSearch').onchange=()=>{const value=$('surahSearch').value;if(!value.trim()||loading)return;const n=findSurah(value);$('surahSearch').value='';if(n){goTo(n,1);toast(`انتقلت إلى ${surahs[n-1].name}`);}else toast('لم أجد سورة بهذا الاسم أو الرقم.');};
$('retry').onclick=()=>{$('retry').hidden=true;$('versePanel').classList.remove('failed');$('versePanel').classList.add('loading');$('verse').textContent='جارٍ تحميل النص القرآني';init();};
// Offline notice: reading and manual review keep working; remote audio and the first model download do not.
function updateOnline(){$('offline').hidden=globalThis.navigator?.onLine!==false;}
window.ononline=window.onoffline=updateOnline;updateOnline();
// Interface helpers: step indicator, score ring, theme, verse size and the phone action bar.
let listened=false,reviewed=false;
function updateSteps(){
 // Listening is optional, so starting to recite or a finished review also completes that step.
 const state={choose:!loading,listen:listened||reviewed||!!finishSession,recite:reviewed,review:reviewed};
 const items=Array.from($('steps').children||[]);let activeSet=false;
 for(const li of items){const done=state[li.dataset.step]&&!(li.dataset.step==='recite'&&finishSession);li.classList.toggle('done',!!done);const active=!done&&!activeSet;li.classList.toggle('active',active);if(active)li.setAttribute?.('aria-current','step');else li.removeAttribute?.('aria-current');if(active)activeSet=true;}
}
function showScore(score){const ring=$('score');ring.hidden=false;ring.style?.setProperty('--p',score);ring.style?.setProperty('--c',score>=90?'var(--good)':score>=60?'var(--warn)':'var(--bad)');$('scoreText').textContent=score+'٪';ring.setAttribute?.('aria-label',`دقة الكلمات ${score}٪`);}
const root=document.documentElement;
function applyTheme(theme){if(!root)return;if(theme)root.dataset.theme=theme;else delete root.dataset.theme;const dark=theme?theme==='dark':!!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;$('theme').textContent=dark?'☀':'☾';$('theme').title=dark?'الوضع النهاري':'الوضع الليلي';$('theme').setAttribute?.('aria-pressed',String(dark));}
applyTheme(load('theme',null));
$('theme').onclick=()=>{const dark=$('theme').textContent==='☀';const next=dark?'light':'dark';save('theme',next);applyTheme(next);};
let verseScale=load('verseScale',1);
function applyScale(){root?.style.setProperty('--verse-scale',verseScale);$('fontDown').disabled=verseScale<=0.8;$('fontUp').disabled=verseScale>=1.6;}
applyScale();
for(const [id,delta]of [['fontUp',0.1],['fontDown',-0.1]])$(id).onclick=()=>{verseScale=Math.round(Math.min(1.6,Math.max(0.8,verseScale+delta))*10)/10;save('verseScale',verseScale);applyScale();};
$('mRecord').onclick=()=>$('record').click();$('mListen').onclick=()=>$('listen').click();
// The phone bar mirrors the main record button's label and state.
const syncMobile=()=>{$('mRecord').textContent=$('record').textContent;$('mRecord').disabled=$('record').disabled;};
if(typeof MutationObserver!=='undefined')new MutationObserver(syncMobile).observe($('record'),{attributes:true,childList:true,characterData:true,subtree:true});
// Shortcuts use physical key codes so they also work with an Arabic keyboard layout.
document.onkeydown=e=>{if(e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||''))return;const action={ArrowLeft:()=>step(1),ArrowRight:()=>step(-1),KeyR:()=>$('record').click(),KeyL:()=>$('listen').click(),KeyH:()=>$('hide').click()}[e.code];if(action){e.preventDefault();action();}};
// Installable app: cache for offline use, and offer an install button where the browser supports it.
globalThis.navigator?.serviceWorker?.register('sw.js').catch(()=>{});
let installPrompt=null;
window.onbeforeinstallprompt=e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;};
window.onappinstalled=()=>{installPrompt=null;$('install').hidden=true;};
$('install').onclick=async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install').hidden=true;};
init();
