// The surah recordings page. Everyone can listen to published recordings.
// On the computer that keeps them (server.cjs serving Taskeeeel/), the signed-in person records or uploads straight into the folder.
// In the phone app, the person signs in once over the home Wi-Fi; recordings and uploaded files are kept on the phone and sent
// to the computer when it can be reached. The computer checks the login, so only that account can add recordings.
(()=>{
const $=id=>document.getElementById(id);
const native=!!globalThis.Capacitor?.isNativePlatform?.();
const BASE=native?'https://adelaziz2026.github.io/telawa-exame/recordings/':'recordings/';
const ACCEPT='audio/*,.mp3,.m4a,.mp4,.aac,.wav,.ogg,.opus,.webm,.flac,.amr,.3gp';
const EXTS=['webm','ogg','opus','m4a','mp4','aac','mp3','wav','flac','amr','3gp'];
const MAX=95*1024*1024;
const api=(path,opts={})=>fetch('api/recordings'+path,{...opts,headers:{'x-recorder':'1',...(opts.headers||{})},credentials:'same-origin'});
let surahs=[],index={surahs:{}},webRecorder=false,pending={},mode={},needCode=false;
const norm=t=>String(t).normalize('NFKD').replace(/[ً-ٰٟۖ-ۭـ]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/^سوره\s*/,'').trim();
const display=name=>String(name).replace(/[ً-ٰٟۖ-ۭـ]/g,'').replace(/ٱ/g,'ا').replace(/^سورة\s*/,'').trim();
const clock=t=>{t=Math.max(0,Math.round(t||0));const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=String(t%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;};
// The length of an uploaded file, read by the browser; 0 when it cannot tell (some formats such as amr).
const durationOf=file=>new Promise(done=>{const a=new Audio(),url=URL.createObjectURL(file),end=v=>{URL.revokeObjectURL(url);done(Math.round(v)||0);};a.preload='metadata';a.onloadedmetadata=()=>end(isFinite(a.duration)?a.duration:0);a.onerror=()=>end(0);setTimeout(()=>end(0),5000);a.src=url;});
const extOf=(name,type)=>{const e=String(name||'').toLowerCase().split('.').pop();if(EXTS.includes(e))return e;return {'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/mpeg':'mp3','audio/wav':'wav','audio/aac':'aac'}[String(type).split(';')[0]]||'';};

// ---------- Phone: login, the waiting list, and sending to the computer ----------
const PHONE_KEY='tarteel:recPhone';
const phone=()=>{try{return JSON.parse(localStorage.getItem(PHONE_KEY)||'null');}catch{return null;}};
const setPhone=v=>{try{v?localStorage.setItem(PHONE_KEY,JSON.stringify(v)):localStorage.removeItem(PHONE_KEY);}catch{}};
const pc=path=>'http://'+String(phone()?.addr||'').replace(/^https?:\/\//,'').replace(/\/+$/,'')+'/api/recordings'+path;
// Requests from the app go through Android itself: the computer is a plain http address on the home network.
async function nativeRequest(method,url,{headers={},data,dataType}={}){
 const r=await globalThis.Capacitor.nativePromise('CapacitorHttp','request',{url,method,headers:{'x-recorder':'1',...headers},data,dataType,responseType:'json',connectTimeout:8000,readTimeout:300000});
 let body=r.data;if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}
 return {status:r.status,data:body||{}};
}
const db=()=>new Promise((ok,fail)=>{const q=indexedDB.open('tarteel-recordings',1);q.onupgradeneeded=()=>q.result.createObjectStore('pending',{keyPath:'surah'});q.onsuccess=()=>ok(q.result);q.onerror=()=>fail(q.error);});
const store=async(mode,fn)=>{const d=await db();return new Promise((ok,fail)=>{const t=d.transaction('pending',mode),r=fn(t.objectStore('pending'));t.oncomplete=()=>ok(r?.result);t.onerror=()=>fail(t.error);});};
const loadPending=async()=>{if(!native)return;try{const all=await store('readonly',s=>s.getAll());pending=Object.fromEntries(all.map(x=>[x.surah,x]));}catch{pending={};}};
const keep=item=>store('readwrite',s=>s.put(item)).then(()=>{pending[item.surah]=item;});
const forget=surah=>store('readwrite',s=>s.delete(surah)).then(()=>{delete pending[surah];});
const base64=blob=>new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>fail(r.error);r.readAsDataURL(blob);});

async function phoneSignIn(password,code){
 const p=phone();
 try{
  const r=await nativeRequest('POST',pc('/login'),{headers:{'Content-Type':'application/json'},data:{user:p.user,password,code,device:true}});
  if(r.status===200&&r.data.token){setPhone({addr:p.addr,user:p.user,token:r.data.token});return 'ok';}
  if(r.status===401){setPhone({addr:p.addr,user:''});return r.data.error==='pair_code'?'code':'wrong';}
  if(r.status===429)return 'locked';
  return 'error';
 }catch{return 'offline';}
}
async function sendPending(){
 const note=$('recPhoneNote'),items=Object.values(pending);
 if(!items.length){note.textContent='لا توجد تسجيلات بانتظار الإرسال.';return;}
 let p=phone();
 if(!p.token){
  if(!p.password){note.textContent='سجّل الدخول مرة أخرى وأنت على شبكة الكمبيوتر.';return;}
  const s=await phoneSignIn(p.password,p.code);
  if(s!=='ok'){note.textContent={wrong:'كلمة المرور غير صحيحة. سجّل الدخول مرة أخرى.',code:'تغيّر رمز الاقتران. سجّل الدخول مرة أخرى بالرمز الظاهر على الكمبيوتر.',locked:'محاولات كثيرة. حاول بعد قليل.'}[s]||'الكمبيوتر غير متاح. تأكد أنك على شبكة Wi-Fi نفسها وأن start-recorder.cmd يعمل.';if(s==='wrong'||s==='code')showPhone();return;}
  p=phone();
 }
 let sent=0;
 for(const item of items){
  note.textContent=`جارٍ إرسال سورة ${surahs[item.surah-1]?.name||item.surah}…`;
  let r;try{r=await nativeRequest('PUT',pc('/'+item.surah),{headers:{'Content-Type':item.type||'application/octet-stream','x-file-ext':item.ext,'x-duration':String(item.seconds||''),Authorization:'Bearer '+p.token},data:await base64(item.blob),dataType:'file'});}
  catch{note.textContent=`أُرسل ${sent}. الكمبيوتر غير متاح الآن، وسيبقى الباقي على الهاتف.`;render();return;}
  if(r.status===401){setPhone({addr:p.addr,user:''});note.textContent='انتهت صلاحية الدخول. سجّل الدخول مرة أخرى.';showPhone();return;}
  if(r.status!==200){note.textContent=r.data.message||'رفض الكمبيوتر أحد الملفات.';render();return;}
  index.surahs[item.surah]=r.data;await forget(item.surah);sent++;
 }
 note.textContent=`✓ أُرسلت ${sent} إلى الكمبيوتر. اضغط «نشر على الموقع» ليسمعها الزوار.`;render();
}
function showPhone(){
 const p=phone(),on=!!p?.user;
 $('recPhone').hidden=!native||on;$('recPhoneTools').hidden=!native||!on;
 if(on)$('recPhoneUser').textContent=`✓ ${p.user}${p.token?'':' (لم يُتحقق بعد من الكمبيوتر)'}`;
 if(p?.addr)$('recAddr').value=p.addr;
 const n=Object.keys(pending).length;$('recPending').textContent=n?`بانتظار الإرسال: ${n}`:'لا شيء بانتظار الإرسال';
}

// ---------- Page ----------
const canRecord=()=>webRecorder||(native&&!!phone()?.user);
async function load(){
 const [quran,list,status]=await Promise.all([
  fetch('data/quran.json').then(r=>r.json()),
  fetch(BASE+'index.json',{cache:'no-store'}).then(r=>r.ok?r.json():{surahs:{}}).catch(()=>({surahs:{}})),
  native?null:fetch('api/recordings/status',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
 ]);
 surahs=(quran.data?.surahs||quran).map(s=>({number:s.number,name:display(s.name),key:norm(s.name),ayat:s.ayahs.length,place:s.revelationType==='Meccan'?'مكية':'مدنية'}));
 index=list&&typeof list.surahs==='object'?list:{surahs:{}};
 webRecorder=!!status?.signedIn;mode=status||{};
 // Signing in is offered on the computer, on its address from a phone browser on the home Wi-Fi, and on the online server.
 const can=!!(status?.local||status?.online);needCode=!!status?.code;
 $('recLogin').hidden=!(can&&!status.signedIn);$('recCodeRow').hidden=!needCode;$('recWebCode').required=needCode;
 $('recLoginIntro').textContent=status?.online?'سجّل الدخول لتسجّل من هنا. كل تسجيل تحفظه يُنشر على الموقع مباشرة.':needCode?'أنت تفتح الكمبيوتر من الهاتف. اكتب رمز الاقتران وبيانات الحساب.':'التسجيل متاح لصاحب الحساب فقط، والزوار يستمعون.';
 // On the public site there is nowhere to save recordings, so say where the record and upload buttons are.
 $('recPublic').hidden=native||can;
 $('recTools').hidden=!webRecorder;$('recPublish').hidden=!!status?.online;
 $('recToolsText').textContent=status?.online?'✓ أنت مسجّل الدخول. كل تسجيل تحفظه يُنشر على الموقع مباشرة، ويُنسخ إلى الكمبيوتر عند الضغط على «نشر» هناك.':'✓ أنت مسجّل الدخول. سجّل أي سورة، ثم انشر التسجيلات ليسمعها زوار الموقع.';
 if(can&&!status.ready)$('recLoginNote').textContent=status.online?'لم يُضبط حساب التسجيل على الموقع بعد.':'لم يُضبط حساب التسجيل بعد على هذا الكمبيوتر.';
 await loadPending();showPhone();render();
 // Arriving from the listening site with a surah and an action: ask for the login, then start it.
 const ask=new URLSearchParams(location.search),n=Number(ask.get('surah')),what=ask.get('do');
 if(n>=1&&n<=114&&(what==='rec'||what==='upload')){
  history.replaceState(null,'',location.pathname);
  if(webRecorder){gateAction={n,what};runGate();}else openGate(n,what);
 }
}
function progress(){
 const n=Object.keys(index.surahs).length;
 $('recFill').style.width=(n/114*100)+'%';
 $('recCount').textContent=n?`⭐ سُجّلت ${n} من 114 سورة`:'لا توجد تسجيلات منشورة بعد.';
}
function render(){
 progress();showPhone();
 const q=norm($('recSearch').value||''),show=$('recShow').value,list=$('recList'),has=s=>!!(index.surahs[s.number]||pending[s.number]);
 list.replaceChildren(...surahs.filter(s=>(!q||String(s.number)===q||s.key.includes(q))&&(show==='all'||(show==='rec')===has(s))).map(card));
 markPlaying();$('recPlayAll').hidden=!playable().length;
 if(!list.children.length)list.append(Object.assign(document.createElement('li'),{className:'rec-empty',textContent:'لا توجد سورة مطابقة.'}));
}
function card(s){
 const li=document.createElement('li');li.className='rec-card';li.id='s'+s.number;
 const rec=index.surahs[s.number],wait=pending[s.number];
 const state=wait?'⏳ على الهاتف':rec?'🎧 مسجّلة':'—';
 li.innerHTML=`<div class="rec-card-head"><span class="rec-num">${s.number}</span><div><b>سورة ${s.name}</b><small>${s.place} · ${s.ayat} ${s.ayat>=3&&s.ayat<=10?'آيات':'آية'}</small></div><span class="rec-state">${state}</span></div>`;
 if(rec||wait){
  const row=document.createElement('div');row.className='rec-play';
  const play=Object.assign(document.createElement('button'),{type:'button',className:'rec-primary rec-listen',textContent:'▶ استماع'});play.onclick=()=>playSurah(s.number);
  const seconds=(wait||rec).seconds,info=[seconds?'⏱ '+clock(seconds):'',wait?'على الهاتف':rec.updated?'🗓 '+new Date(rec.updated).toLocaleDateString('ar-EG',{day:'numeric',month:'long',year:'numeric'}):''].filter(Boolean).join(' · ');
  row.append(play,Object.assign(document.createElement('small'),{className:'rec-meta',textContent:info}));
  if(rec&&!wait&&!native)row.append(Object.assign(document.createElement('a'),{className:'rec-download',href:BASE+rec.file,download:`سورة ${s.name}.${rec.file.split('.').pop()}`,textContent:'⬇ تنزيل'}));
  li.append(row);
  if(wait)li.append(Object.assign(document.createElement('small'),{className:'rec-note',textContent:'محفوظ على الهاتف، ويُرسل إلى الكمبيوتر عند الاتصال بشبكته.'}));
 }
 li.append(canRecord()?recorderFor(s,!!rec||!!wait):gateButtons(s));
 return li;
}
// Saves a take or a chosen file: straight into Taskeeeel on the computer, or onto the phone's waiting list.
async function saveAudio(s,blob,ext,note,seconds=0){
 const max=!native&&mode.max||MAX;
 if(blob.size>max){note.textContent=`الملف أكبر من ${Math.round(max/1048576)} ميجابايت.`;return false;}
 if(native){
  await keep({surah:s.number,blob,type:blob.type||'application/octet-stream',ext,seconds,saved:Date.now()});
  $('s'+s.number).replaceWith(card(s));showPhone();
  if(phone()?.token)sendPending();
  return true;
 }
 note.textContent=mode.online?'جارٍ الرفع إلى الموقع…':'جارٍ الحفظ في Taskeeeel…';
 const r=await api('/'+s.number,{method:'PUT',headers:{'content-type':blob.type||'application/octet-stream','x-file-ext':ext,'x-duration':String(seconds||'')},body:blob}).catch(()=>null),data=r?await r.json().catch(()=>({})):{};
 if(!r?.ok){note.textContent=data.message||'تعذّر الحفظ.';return false;}
 index.surahs[s.number]=data;
 const fresh=card(s);fresh.querySelector('.rec-actions .rec-note').textContent=mode.online?'✓ نُشر على الموقع، ويسمعه الزوار الآن.':'✓ حُفظ على الكمبيوتر. اضغط «نشر على الموقع» ليسمعه الزوار.';
 $('s'+s.number).replaceWith(fresh);progress();return true;
}
// One recorder at a time: record, listen to the take, then save it or discard it. Or upload an audio file instead.
let active=null;
function recorderFor(s,has){
 const box=document.createElement('div');box.className='rec-actions';
 const btn=(text,cls)=>Object.assign(document.createElement('button'),{type:'button',textContent:text,className:cls});
 const start=btn(has?'🎙 إعادة التسجيل':'🎙 تسجيل','rec-primary'),upload=btn('📁 رفع ملف','rec-ghost'),stop=btn('⏹ إيقاف','rec-stop'),save=btn('💾 حفظ','rec-primary'),drop=btn('إلغاء','rec-ghost'),del=btn('🗑 حذف','rec-ghost');
 const picker=Object.assign(document.createElement('input'),{type:'file',accept:ACCEPT,hidden:true});
 const note=Object.assign(document.createElement('small'),{className:'rec-note'});note.setAttribute('role','status');
 const take=Object.assign(document.createElement('audio'),{controls:true});take.hidden=true;
 stop.hidden=save.hidden=drop.hidden=true;del.hidden=!has;
 // Browsers allow the microphone only on secure pages; the computer's plain home-network address is not one.
 const noMic=!native&&!globalThis.isSecureContext;
 if(noMic){start.hidden=true;note.textContent='سجّل بتطبيق المسجّل في هاتفك، ثم اضغط «رفع ملف».';}
 let recorder,chunks=[],blob=null,timer=0,began=0,seconds=0;
 const reset=()=>{start.hidden=noMic;upload.hidden=false;stop.hidden=save.hidden=drop.hidden=true;take.hidden=true;blob=null;clearInterval(timer);active=null;};
 start.onclick=async()=>{
  if(active){note.textContent='أوقف التسجيل الجاري أولًا.';return;}
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}catch{note.textContent='لم يُسمح باستخدام الميكروفون.';return;}
  const type=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>globalThis.MediaRecorder?.isTypeSupported?.(t));
  recorder=new MediaRecorder(stream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:64000});chunks=[];active=recorder;
  recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(timer);seconds=Math.round((Date.now()-began)/1000);blob=new Blob(chunks,{type:(recorder.mimeType||'audio/webm').split(';')[0]});take.src=URL.createObjectURL(blob);take.hidden=false;save.hidden=drop.hidden=false;stop.hidden=true;note.textContent='استمع للتسجيل، ثم احفظه أو ألغه.';};
  recorder.start(1000);began=Date.now();start.hidden=upload.hidden=true;stop.hidden=false;del.hidden=true;
  timer=setInterval(()=>{const t=Math.floor((Date.now()-began)/1000);note.textContent=`🔴 جارٍ التسجيل ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;},500);
 };
 stop.onclick=()=>recorder?.state==='recording'&&recorder.stop();
 drop.onclick=()=>{reset();del.hidden=!has;note.textContent='';};
 save.onclick=async()=>{if(!blob)return;save.disabled=true;const ok=await saveAudio(s,blob,extOf('',blob.type)||'webm',note,seconds);save.disabled=false;if(ok)active=null;};
 upload.onclick=()=>picker.click();
 picker.onchange=async()=>{
  const file=picker.files?.[0];picker.value='';if(!file)return;
  const ext=extOf(file.name,file.type);
  if(!ext&&!String(file.type).startsWith('audio/')){note.textContent='اختر ملفًا صوتيًا (mp3 أو m4a أو wav أو غيرها).';return;}
  note.textContent='جارٍ تجهيز الملف…';
  await saveAudio(s,file,ext||'m4a',note,await durationOf(file));
 };
 del.onclick=async()=>{
  if(native&&pending[s.number]){await forget(s.number);$('s'+s.number).replaceWith(card(s));showPhone();return;}
  if(native){note.textContent='الحذف من الموقع يتم من الكمبيوتر.';return;}
  if(!confirm(`حذف تسجيل سورة ${s.name} ${mode.online?'من الموقع':'من الكمبيوتر'}؟`))return;
  const r=await api('/'+s.number,{method:'DELETE'}).catch(()=>null);
  if(!r?.ok){note.textContent='تعذّر الحذف.';return;}
  delete index.surahs[s.number];const fresh=card(s);fresh.querySelector('.rec-actions .rec-note').textContent=mode.online?'حُذف من الموقع.':'حُذف. انشر ليُحذف من الموقع أيضًا.';$('s'+s.number).replaceWith(fresh);progress();
 };
 box.append(start,upload,stop,save,drop,del,picker,take,note);
 return box;
}

// ---------- Record and upload buttons on every surah: they ask for the recorder's login first ----------
// Where there is no server to save to (the listening site on GitHub), they open the online recording page instead.
const ONLINE_PAGE='https://telawa-exame.onrender.com/recordings.html';
let gateAction=null;
function gateButtons(s){
 const box=document.createElement('div');box.className='rec-actions rec-gate-row';
 for(const [what,text,cls] of [['rec','🎙 تسجيل','rec-primary'],['upload','📁 رفع ملف','rec-ghost']]){
  const b=Object.assign(document.createElement('button'),{type:'button',textContent:text,className:cls});
  b.onclick=()=>openGate(s.number,what);box.append(b);
 }
 return box;
}
function openGate(n,what){
 if(native){$('recPhone').scrollIntoView({behavior:'smooth',block:'center'});$('recAddr').focus();$('recPhoneLoginNote').textContent='سجّل الدخول أولًا، ثم اضغط زر التسجيل أو الرفع.';return;}
 if(!mode.local&&!mode.online){
  if(location.origin===new URL(ONLINE_PAGE).origin){alert('التسجيل من هذا الموقع غير مفعّل بعد. يجب إضافة RECORDER_LOGIN و GITHUB_TOKEN في إعدادات Render.');return;}
  location.href=`${ONLINE_PAGE}?surah=${n}&do=${what}`;return;
 }
 gateAction={n,what};
 $('recGateWhat').textContent=`${what==='rec'?'تسجيل':'رفع ملف'} لسورة ${surahs[n-1]?.name||n}`;
 $('recGateCodeRow').hidden=!needCode;$('recGateCode').required=needCode;$('recGateNote').textContent='';
 $('recGate').showModal();$('recGateUser').focus();
}
// After signing in, press the chosen button on that surah's card.
function runGate(){
 const a=gateAction;gateAction=null;if(!a)return;
 const box=$('s'+a.n);box?.scrollIntoView({block:'center'});
 const b=[...(box?.querySelectorAll('.rec-actions button')||[])].find(x=>!x.hidden&&x.textContent.includes(a.what==='rec'?'تسجيل':'رفع ملف'));
 if(b)b.click();else if(a.what==='rec'&&box)box.querySelector('.rec-actions .rec-note').textContent='التسجيل بالميكروفون غير متاح هنا. سجّل بتطبيق المسجّل في هاتفك، ثم اضغط «رفع ملف».';
}
$('recGateForm').onsubmit=async e=>{
 e.preventDefault();$('recGateNote').textContent='جارٍ الدخول…';
 const r=await api('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:$('recGateUser').value.trim(),password:$('recGatePass').value,...(needCode?{code:$('recGateCode').value.trim()}:{})})}).catch(()=>null);
 const data=r?await r.json().catch(()=>({})):{};
 if(!r?.ok){$('recGateNote').textContent=data.message||'تعذّر الدخول.';return;}
 $('recGatePass').value='';$('recGateCode').value='';$('recGate').close();
 // Shown at once (no reload), so the file picker still opens from this tap.
 webRecorder=true;$('recLogin').hidden=true;$('recTools').hidden=false;render();runGate();
};
$('recGateCancel').onclick=()=>{gateAction=null;$('recGate').close();};

// ---------- Controls ----------
$('recSearch').oninput=render;$('recShow').onchange=render;
// ---------- Shared player: one surah, or all recorded surahs in order, with speed and lock-screen controls ----------
const player=$('recAudio');let currentSurah=0,playAll=false,localUrls={};
const SPEED_KEY='tarteel:recSpeed';
function playable(){return surahs.filter(s=>pending[s.number]||index.surahs[s.number]).map(s=>s.number);}
function sourceOf(n){
 if(pending[n])return localUrls[n]??=URL.createObjectURL(pending[n].blob);
 const rec=index.surahs[n];return rec?BASE+rec.file+'?v='+encodeURIComponent(rec.updated||''):'';
}
function markPlaying(){
 for(const el of document.querySelectorAll('.rec-card.playing'))el.classList.remove('playing');
 if(currentSurah)$('s'+currentSurah)?.classList.add('playing');
}
function playSurah(n,all=false){
 const src=sourceOf(n);if(!src)return;
 playAll=all;currentSurah=n;player.src=src;player.playbackRate=+$('recSpeed').value||1;player.play().catch(()=>{});
 const name='سورة '+(surahs[n-1]?.name||n);
 $('recPlayer').hidden=false;$('recNow').textContent=(all?'▶ تشغيل الكل: ':'')+name;document.body.classList.add('rec-has-player');
 markPlaying();$('s'+n)?.scrollIntoView({block:'nearest',behavior:'smooth'});
 if('mediaSession'in navigator){try{navigator.mediaSession.metadata=new MediaMetadata({title:name,artist:'اختبار التلاوة',artwork:[{src:'icons/icon-512.png',sizes:'512x512',type:'image/png'}]});}catch{}}
}
function step(dir){
 const list=playable(),i=list.indexOf(currentSurah),next=list[i+dir];
 if(next)playSurah(next,playAll);else if(dir>0){playAll=false;$('recNow').textContent+=' — انتهت القائمة';}
}
player.onended=()=>{if(playAll)step(1);};
player.onplay=()=>{$('recToggle').textContent='⏸';$('recToggle').setAttribute('aria-label','إيقاف مؤقت');};
player.onpause=()=>{$('recToggle').textContent='▶';$('recToggle').setAttribute('aria-label','تشغيل');};
player.ontimeupdate=()=>{const d=player.duration;$('recSeek').value=d?String(player.currentTime/d*1000):'0';$('recTime').textContent=`${clock(player.currentTime)} / ${d&&isFinite(d)?clock(d):'--:--'}`;};
player.onerror=()=>{$('recNow').textContent='تعذّر تشغيل هذا الملف في هذا المتصفح. جرّب تنزيله.';};
$('recSeek').oninput=()=>{const d=player.duration;if(d&&isFinite(d))player.currentTime=$('recSeek').value/1000*d;};
$('recToggle').onclick=()=>player.paused?player.play().catch(()=>{}):player.pause();
$('recPrev').onclick=()=>step(-1);$('recNext').onclick=()=>step(1);
$('recClose').onclick=()=>{player.pause();$('recPlayer').hidden=true;document.body.classList.remove('rec-has-player');currentSurah=0;markPlaying();};
$('recPlayAll').onclick=()=>{const list=playable();if(list.length)playSurah(list[0],true);};
try{const sp=localStorage.getItem(SPEED_KEY);if(sp)$('recSpeed').value=sp;}catch{}
$('recSpeed').onchange=()=>{player.playbackRate=+$('recSpeed').value;try{localStorage.setItem(SPEED_KEY,$('recSpeed').value);}catch{}};
if('mediaSession'in navigator){for(const [a,f] of [['play',()=>player.play()],['pause',()=>player.pause()],['nexttrack',()=>step(1)],['previoustrack',()=>step(-1)]])try{navigator.mediaSession.setActionHandler(a,f);}catch{}}
for(const [eye,input] of [['recEye','recPass'],['recPEye','recPPass']])$(eye).onclick=()=>{const p=$(input),show=p.type==='password';p.type=show?'text':'password';$(eye).setAttribute('aria-label',show?'إخفاء كلمة المرور':'إظهار كلمة المرور');};
$('recLoginForm').onsubmit=async e=>{
 e.preventDefault();$('recLoginNote').textContent='جارٍ الدخول…';
 const r=await api('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:$('recUser').value.trim(),password:$('recPass').value,...(needCode?{code:$('recWebCode').value.trim()}:{})})}).catch(()=>null);
 const data=r?await r.json().catch(()=>({})):{};
 if(!r?.ok){$('recLoginNote').textContent=data.message||'تعذّر الدخول.';return;}
 $('recPass').value='';$('recWebCode').value='';$('recLoginNote').textContent='';load();
};
$('recLogout').onclick=async()=>{await api('/logout',{method:'POST'}).catch(()=>{});load();};
$('recPublish').onclick=async()=>{
 const b=$('recPublish');b.disabled=true;$('recToolsNote').textContent='جارٍ النشر على الموقع…';
 const r=await api('/publish',{method:'POST'}).catch(()=>null),data=r?await r.json().catch(()=>({})):{};
 b.disabled=false;
 if(r?.ok)await load().catch(()=>{}); // recordings saved from the website may have been copied into Taskeeeel
 $('recToolsNote').textContent=data.message||(r?.ok?'تم النشر.':'تعذّر النشر.');
};
// Phone sign-in: checked by the computer when it can be reached; otherwise recording starts now and the check happens when sending.
$('recPhoneForm').onsubmit=async e=>{
 e.preventDefault();const note=$('recPhoneLoginNote'),addr=$('recAddr').value.trim(),user=$('recPUser').value.trim(),password=$('recPPass').value,code=$('recCode').value.trim();
 if(!addr||!user||!password||!code)return;
 setPhone({addr,user});note.textContent='جارٍ الاتصال بالكمبيوتر…';
 const s=await phoneSignIn(password,code);
 if(s==='wrong'){note.textContent='اسم المستخدم أو كلمة المرور غير صحيحة.';return;}
 if(s==='code'){note.textContent='رمز الاقتران غير صحيح. اكتب الرمز الظاهر في نافذة start-recorder.';return;}
 if(s==='locked'){note.textContent='محاولات خاطئة كثيرة. حاول بعد قليل.';return;}
 if(s==='offline'||s==='error')setPhone({addr,user,password,code});
 $('recPPass').value='';$('recCode').value='';note.textContent='';
 $('recPhoneNote').textContent=s==='ok'?'✓ تم الدخول. التسجيلات تُحفظ على الهاتف وتُرسل إلى الكمبيوتر.':'الكمبيوتر غير متاح الآن. يمكنك التسجيل، وسيُتحقق من الدخول ويُرسل التسجيل عند الاتصال بشبكته.';
 render();
};
$('recSend').onclick=sendPending;
$('recPhonePublish').onclick=async()=>{
 const p=phone(),note=$('recPhoneNote');
 if(!p?.token){note.textContent='أرسل التسجيلات أولًا وأنت على شبكة الكمبيوتر.';return;}
 note.textContent='جارٍ النشر على الموقع…';
 try{const r=await nativeRequest('POST',pc('/publish'),{headers:{Authorization:'Bearer '+p.token}});note.textContent=r.data.message||(r.status===200?'تم النشر.':'تعذّر النشر.');}
 catch{note.textContent='الكمبيوتر غير متاح الآن.';}
};
$('recPhoneLogout').onclick=async()=>{
 const p=phone();
 if(p?.token)try{await nativeRequest('POST',pc('/logout'),{headers:{Authorization:'Bearer '+p.token}});}catch{}
 setPhone(p?.addr?{addr:p.addr,user:''}:null);render();
};
load().catch(()=>{$('recCount').textContent='تعذّر تحميل قائمة السور. تحقق من الإنترنت.';});
})();
