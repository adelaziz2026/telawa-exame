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
let surahs=[],index={surahs:{}},webRecorder=false,pending={};
const norm=t=>String(t).normalize('NFKD').replace(/[ً-ٰٟۖ-ۭـ]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/^سوره\s*/,'').trim();
const display=name=>String(name).replace(/[ً-ٰٟۖ-ۭـ]/g,'').replace(/ٱ/g,'ا').replace(/^سورة\s*/,'').trim();
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

async function phoneSignIn(password){
 const p=phone();
 try{
  const r=await nativeRequest('POST',pc('/login'),{headers:{'Content-Type':'application/json'},data:{user:p.user,password,device:true}});
  if(r.status===200&&r.data.token){setPhone({addr:p.addr,user:p.user,token:r.data.token});return 'ok';}
  if(r.status===401){setPhone({addr:p.addr,user:''});return 'wrong';}
  return 'error';
 }catch{return 'offline';}
}
async function sendPending(){
 const note=$('recPhoneNote'),items=Object.values(pending);
 if(!items.length){note.textContent='لا توجد تسجيلات بانتظار الإرسال.';return;}
 let p=phone();
 if(!p.token){
  if(!p.password){note.textContent='سجّل الدخول مرة أخرى وأنت على شبكة الكمبيوتر.';return;}
  const s=await phoneSignIn(p.password);
  if(s!=='ok'){note.textContent=s==='wrong'?'كلمة المرور غير صحيحة.':'الكمبيوتر غير متاح. تأكد أنك على شبكة Wi-Fi نفسها وأن start-recorder.cmd يعمل.';return;}
  p=phone();
 }
 let sent=0;
 for(const item of items){
  note.textContent=`جارٍ إرسال سورة ${surahs[item.surah-1]?.name||item.surah}…`;
  let r;try{r=await nativeRequest('PUT',pc('/'+item.surah),{headers:{'Content-Type':item.type||'application/octet-stream','x-file-ext':item.ext,Authorization:'Bearer '+p.token},data:await base64(item.blob),dataType:'file'});}
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
 webRecorder=!!status?.signedIn;
 $('recLogin').hidden=!(status?.local&&!status.signedIn);
 $('recTools').hidden=!webRecorder;
 if(status?.local&&!status.ready)$('recLoginNote').textContent='لم يُضبط حساب التسجيل بعد على هذا الكمبيوتر.';
 await loadPending();showPhone();render();
}
function progress(){
 const n=Object.keys(index.surahs).length;
 $('recFill').style.width=(n/114*100)+'%';
 $('recCount').textContent=n?`⭐ سُجّلت ${n} من 114 سورة`:'لا توجد تسجيلات منشورة بعد.';
}
function render(){
 progress();showPhone();
 const q=norm($('recSearch').value||''),only=$('recOnly').checked,list=$('recList');
 list.replaceChildren(...surahs.filter(s=>(!q||String(s.number)===q||s.key.includes(q))&&(!only||index.surahs[s.number]||pending[s.number])).map(card));
 if(!list.children.length)list.append(Object.assign(document.createElement('li'),{className:'rec-empty',textContent:'لا توجد سورة مطابقة.'}));
}
function card(s){
 const li=document.createElement('li');li.className='rec-card';li.id='s'+s.number;
 const rec=index.surahs[s.number],wait=pending[s.number];
 const state=wait?'⏳ على الهاتف':rec?'🎧 مسجّلة':'—';
 li.innerHTML=`<div class="rec-card-head"><span class="rec-num">${s.number}</span><div><b>سورة ${s.name}</b><small>${s.place} · ${s.ayat} ${s.ayat>=3&&s.ayat<=10?'آيات':'آية'}</small></div><span class="rec-state">${state}</span></div>`;
 if(rec){
  const audio=Object.assign(document.createElement('audio'),{controls:true,preload:'none',src:BASE+rec.file+'?v='+encodeURIComponent(rec.updated||'')});
  audio.setAttribute('aria-label','تسجيل سورة '+s.name);li.append(audio);
 }
 if(wait){
  const audio=Object.assign(document.createElement('audio'),{controls:true,src:URL.createObjectURL(wait.blob)});
  audio.setAttribute('aria-label','التسجيل المحفوظ على الهاتف');li.append(Object.assign(document.createElement('small'),{className:'rec-note',textContent:'محفوظ على الهاتف، ويُرسل إلى الكمبيوتر عند الاتصال بشبكته.'}),audio);
 }
 if(canRecord())li.append(recorderFor(s,!!rec||!!wait));
 return li;
}
// Saves a take or a chosen file: straight into Taskeeeel on the computer, or onto the phone's waiting list.
async function saveAudio(s,blob,ext,note){
 if(blob.size>MAX){note.textContent='الملف أكبر من 95 ميجابايت.';return false;}
 if(native){
  await keep({surah:s.number,blob,type:blob.type||'application/octet-stream',ext,saved:Date.now()});
  $('s'+s.number).replaceWith(card(s));showPhone();
  if(phone()?.token)sendPending();
  return true;
 }
 note.textContent='جارٍ الحفظ في Taskeeeel…';
 const r=await api('/'+s.number,{method:'PUT',headers:{'content-type':blob.type||'application/octet-stream','x-file-ext':ext},body:blob}).catch(()=>null),data=r?await r.json().catch(()=>({})):{};
 if(!r?.ok){note.textContent=data.message||'تعذّر الحفظ.';return false;}
 index.surahs[s.number]=data;
 const fresh=card(s);fresh.querySelector('.rec-actions .rec-note').textContent='✓ حُفظ على الكمبيوتر. اضغط «نشر على الموقع» ليسمعه الزوار.';
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
 let recorder,chunks=[],blob=null,timer=0,began=0;
 const reset=()=>{start.hidden=upload.hidden=false;stop.hidden=save.hidden=drop.hidden=true;take.hidden=true;blob=null;clearInterval(timer);active=null;};
 start.onclick=async()=>{
  if(active){note.textContent='أوقف التسجيل الجاري أولًا.';return;}
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}catch{note.textContent='لم يُسمح باستخدام الميكروفون.';return;}
  const type=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>globalThis.MediaRecorder?.isTypeSupported?.(t));
  recorder=new MediaRecorder(stream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:64000});chunks=[];active=recorder;
  recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(timer);blob=new Blob(chunks,{type:(recorder.mimeType||'audio/webm').split(';')[0]});take.src=URL.createObjectURL(blob);take.hidden=false;save.hidden=drop.hidden=false;stop.hidden=true;note.textContent='استمع للتسجيل، ثم احفظه أو ألغه.';};
  recorder.start(1000);began=Date.now();start.hidden=upload.hidden=true;stop.hidden=false;del.hidden=true;
  timer=setInterval(()=>{const t=Math.floor((Date.now()-began)/1000);note.textContent=`🔴 جارٍ التسجيل ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;},500);
 };
 stop.onclick=()=>recorder?.state==='recording'&&recorder.stop();
 drop.onclick=()=>{reset();del.hidden=!has;note.textContent='';};
 save.onclick=async()=>{if(!blob)return;save.disabled=true;const ok=await saveAudio(s,blob,extOf('',blob.type)||'webm',note);save.disabled=false;if(ok)active=null;};
 upload.onclick=()=>picker.click();
 picker.onchange=async()=>{
  const file=picker.files?.[0];picker.value='';if(!file)return;
  const ext=extOf(file.name,file.type);
  if(!ext&&!String(file.type).startsWith('audio/')){note.textContent='اختر ملفًا صوتيًا (mp3 أو m4a أو wav أو غيرها).';return;}
  await saveAudio(s,file,ext||'m4a',note);
 };
 del.onclick=async()=>{
  if(native&&pending[s.number]){await forget(s.number);$('s'+s.number).replaceWith(card(s));showPhone();return;}
  if(native){note.textContent='الحذف من الموقع يتم من الكمبيوتر.';return;}
  if(!confirm(`حذف تسجيل سورة ${s.name} من الكمبيوتر؟`))return;
  const r=await api('/'+s.number,{method:'DELETE'}).catch(()=>null);
  if(!r?.ok){note.textContent='تعذّر الحذف.';return;}
  delete index.surahs[s.number];const fresh=card(s);fresh.querySelector('.rec-actions .rec-note').textContent='حُذف. انشر ليُحذف من الموقع أيضًا.';$('s'+s.number).replaceWith(fresh);progress();
 };
 box.append(start,upload,stop,save,drop,del,picker,take,note);
 return box;
}

// ---------- Controls ----------
$('recSearch').oninput=render;$('recOnly').onchange=render;
for(const [eye,input] of [['recEye','recPass'],['recPEye','recPPass']])$(eye).onclick=()=>{const p=$(input),show=p.type==='password';p.type=show?'text':'password';$(eye).setAttribute('aria-label',show?'إخفاء كلمة المرور':'إظهار كلمة المرور');};
$('recLoginForm').onsubmit=async e=>{
 e.preventDefault();$('recLoginNote').textContent='جارٍ الدخول…';
 const r=await api('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:$('recUser').value.trim(),password:$('recPass').value})}).catch(()=>null);
 const data=r?await r.json().catch(()=>({})):{};
 if(!r?.ok){$('recLoginNote').textContent=data.message||'تعذّر الدخول.';return;}
 $('recPass').value='';load();
};
$('recLogout').onclick=async()=>{await api('/logout',{method:'POST'}).catch(()=>{});load();};
$('recPublish').onclick=async()=>{
 const b=$('recPublish');b.disabled=true;$('recToolsNote').textContent='جارٍ النشر على الموقع…';
 const r=await api('/publish',{method:'POST'}).catch(()=>null),data=r?await r.json().catch(()=>({})):{};
 b.disabled=false;$('recToolsNote').textContent=data.message||(r?.ok?'تم النشر.':'تعذّر النشر.');
};
// Phone sign-in: checked by the computer when it can be reached; otherwise recording starts now and the check happens when sending.
$('recPhoneForm').onsubmit=async e=>{
 e.preventDefault();const note=$('recPhoneLoginNote'),addr=$('recAddr').value.trim(),user=$('recPUser').value.trim(),password=$('recPPass').value;
 if(!addr||!user||!password)return;
 setPhone({addr,user});note.textContent='جارٍ الاتصال بالكمبيوتر…';
 const s=await phoneSignIn(password);
 if(s==='wrong'){note.textContent='اسم المستخدم أو كلمة المرور غير صحيحة.';return;}
 if(s==='offline'||s==='error')setPhone({addr,user,password});
 $('recPPass').value='';note.textContent='';
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
