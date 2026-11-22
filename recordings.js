// The surah recordings page: everyone can listen to published recordings; on the computer that keeps them
// (served by server.cjs from Taskeeeel/), the signed-in person can record, replace, delete and publish.
(()=>{
const $=id=>document.getElementById(id);
const native=!!globalThis.Capacitor?.isNativePlatform?.();
// The phone app has no copy of the recordings, so it listens to the published ones on GitHub Pages.
const BASE=native?'https://adelaziz2026.github.io/telawa-exame/recordings/':'recordings/';
const api=(path,opts={})=>fetch('api/recordings'+path,{...opts,headers:{'x-recorder':'1',...(opts.headers||{})},credentials:'same-origin'});
let surahs=[],index={surahs:{}},canRecord=false;
const norm=t=>String(t).normalize('NFKD').replace(/[ً-ٰٟۖ-ۭـ]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/^سوره\s*/,'').trim();
const display=name=>String(name).replace(/[ً-ٰٟۖ-ۭـ]/g,'').replace(/ٱ/g,'ا').replace(/^سورة\s*/,'').trim();

async function load(){
 const [quran,list,status]=await Promise.all([
  fetch('data/quran.json').then(r=>r.json()),
  fetch(BASE+'index.json',{cache:'no-store'}).then(r=>r.ok?r.json():{surahs:{}}).catch(()=>({surahs:{}})),
  native?null:fetch('api/recordings/status',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
 ]);
 surahs=(quran.data?.surahs||quran).map(s=>({number:s.number,name:display(s.name),key:norm(s.name),ayat:s.ayahs.length,place:s.revelationType==='Meccan'?'مكية':'مدنية'}));
 index=list&&typeof list.surahs==='object'?list:{surahs:{}};
 canRecord=!!status?.signedIn;
 $('recLogin').hidden=!(status?.local&&!status.signedIn);
 $('recTools').hidden=!canRecord;
 if(status?.local&&!status.ready)$('recLoginNote').textContent='لم يُضبط حساب التسجيل بعد على هذا الكمبيوتر.';
 render();
}
function progress(){
 const n=Object.keys(index.surahs).length;
 $('recFill').style.width=(n/114*100)+'%';
 $('recCount').textContent=n?`⭐ سُجّلت ${n} من 114 سورة`:'لا توجد تسجيلات منشورة بعد.';
}
function render(){
 progress();
 const q=norm($('recSearch').value||''),only=$('recOnly').checked,list=$('recList');
 list.replaceChildren(...surahs.filter(s=>(!q||String(s.number)===q||s.key.includes(q))&&(!only||index.surahs[s.number])).map(card));
 if(!list.children.length)list.append(Object.assign(document.createElement('li'),{className:'rec-empty',textContent:'لا توجد سورة مطابقة.'}));
}
function card(s){
 const li=document.createElement('li');li.className='rec-card';li.id='s'+s.number;
 const rec=index.surahs[s.number];
 li.innerHTML=`<div class="rec-card-head"><span class="rec-num">${s.number}</span><div><b>سورة ${s.name}</b><small>${s.place} · ${s.ayat} ${s.ayat>=3&&s.ayat<=10?'آيات':'آية'}</small></div><span class="rec-state">${rec?'🎧 مسجّلة':'—'}</span></div>`;
 if(rec){
  const audio=Object.assign(document.createElement('audio'),{controls:true,preload:'none',src:BASE+rec.file+'?v='+encodeURIComponent(rec.updated||'')});
  audio.setAttribute('aria-label','تسجيل سورة '+s.name);li.append(audio);
 }
 if(canRecord)li.append(recorderFor(s,!!rec));
 return li;
}
// One recorder at a time: record, listen to the take, then save it to Taskeeeel or discard it.
let active=null;
function recorderFor(s,has){
 const box=document.createElement('div');box.className='rec-actions';
 const btn=(text,cls)=>Object.assign(document.createElement('button'),{type:'button',textContent:text,className:cls});
 const start=btn(has?'🎙 إعادة التسجيل':'🎙 تسجيل','rec-primary'),stop=btn('⏹ إيقاف','rec-stop'),save=btn('💾 حفظ','rec-primary'),drop=btn('إلغاء','rec-ghost'),del=btn('🗑 حذف','rec-ghost');
 const note=Object.assign(document.createElement('small'),{className:'rec-note'});note.setAttribute('role','status');
 const take=Object.assign(document.createElement('audio'),{controls:true});take.hidden=true;
 stop.hidden=save.hidden=drop.hidden=true;del.hidden=!has;
 let recorder,chunks=[],blob=null,timer=0,began=0;
 const reset=()=>{start.hidden=false;stop.hidden=save.hidden=drop.hidden=true;take.hidden=true;blob=null;clearInterval(timer);active=null;};
 start.onclick=async()=>{
  if(active){note.textContent='أوقف التسجيل الجاري أولًا.';return;}
  let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}catch{note.textContent='لم يُسمح باستخدام الميكروفون.';return;}
  const type=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>globalThis.MediaRecorder?.isTypeSupported?.(t));
  recorder=new MediaRecorder(stream,{...(type?{mimeType:type}:{}),audioBitsPerSecond:64000});chunks=[];active=recorder;
  recorder.ondataavailable=e=>e.data.size&&chunks.push(e.data);
  recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(timer);blob=new Blob(chunks,{type:(recorder.mimeType||'audio/webm').split(';')[0]});take.src=URL.createObjectURL(blob);take.hidden=false;save.hidden=drop.hidden=false;stop.hidden=true;note.textContent='استمع للتسجيل، ثم احفظه أو ألغه.';};
  recorder.start(1000);began=Date.now();start.hidden=true;stop.hidden=false;del.hidden=true;
  timer=setInterval(()=>{const t=Math.floor((Date.now()-began)/1000);note.textContent=`🔴 جارٍ التسجيل ${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;},500);
 };
 stop.onclick=()=>recorder?.state==='recording'&&recorder.stop();
 drop.onclick=()=>{reset();del.hidden=!has;note.textContent='';};
 save.onclick=async()=>{
  if(!blob)return;save.disabled=true;note.textContent='جارٍ الحفظ في Taskeeeel…';
  const r=await api('/'+s.number,{method:'PUT',headers:{'content-type':blob.type},body:blob}).catch(()=>null),data=r?await r.json().catch(()=>({})):{};
  save.disabled=false;
  if(!r?.ok){note.textContent=data.message||'تعذّر الحفظ.';return;}
  index.surahs[s.number]=data;active=null;
  const fresh=card(s);fresh.querySelector('.rec-note').textContent='✓ حُفظ على الكمبيوتر. اضغط «نشر على الموقع» ليسمعه الزوار.';
  $('s'+s.number).replaceWith(fresh);progress();
 };
 del.onclick=async()=>{
  if(!confirm(`حذف تسجيل سورة ${s.name} من الكمبيوتر؟`))return;
  const r=await api('/'+s.number,{method:'DELETE'}).catch(()=>null);
  if(!r?.ok){note.textContent='تعذّر الحذف.';return;}
  delete index.surahs[s.number];const fresh=card(s);fresh.querySelector('.rec-note').textContent='حُذف. انشر ليُحذف من الموقع أيضًا.';$('s'+s.number).replaceWith(fresh);progress();
 };
 box.append(start,stop,save,drop,del,take,note);
 return box;
}

$('recSearch').oninput=render;$('recOnly').onchange=render;
$('recEye').onclick=()=>{const p=$('recPass'),show=p.type==='password';p.type=show?'text':'password';$('recEye').setAttribute('aria-label',show?'إخفاء كلمة المرور':'إظهار كلمة المرور');};
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
load().catch(()=>{$('recCount').textContent='تعذّر تحميل قائمة السور. تحقق من الإنترنت.';});
})();
