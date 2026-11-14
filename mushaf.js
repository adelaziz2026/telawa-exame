// Full-surah listening: the whole surah is shown as one Mushaf page while the chosen reciter plays it ayah by ayah.
// The ayah being recited is highlighted and kept in view; tapping an ayah jumps there. Uses app.js globals
// (surahs, RECITERS, reciter, goTo, load, save, make, toast). Audio streams from everyayah.com, like the main player.
(()=>{
const $=id=>document.getElementById(id);
if(!$('mushafDialog'))return;
const audio=new Audio();audio.preload='auto';
let surah=1,ayah=1,playing=false,wakeLock=null,slowTimer=0,basmalaFirst=false,returnFocus=null;
const digits=n=>Number(n).toLocaleString('ar-EG');
const file=(s,a)=>`https://everyayah.com/data/${reciter().dir}/${String(s).padStart(3,'0')}${String(a).padStart(3,'0')}.mp3`;
// The basmala is recited before every surah except al-Fatiha (where it is ayah 1) and at-Tawba; everyayah keeps it as 001001.
const hasBasmala=s=>s!==1&&s!==9;
const status=text=>{$('mushafStatus').textContent=text;};

function renderPage(){
 const c=surahs[surah-1];
 $('mushafName').textContent=c.name;
 $('mushafInfo').textContent=`${c.revelationType==='Meccan'?'مكية':'مدنية'} • ${digits(c.ayahs.length)} آية`;
 $('mushafSurah').value=String(surah);
 $('mushafBasmala').textContent=c.basmala||'';$('mushafBasmala').hidden=!c.basmala;
 $('mushafText').replaceChildren(...c.ayahs.map(y=>{
  const span=make('span','m-ayah');span.dataset.ayah=y.numberInSurah;span.append(y.text+' ',make('span','m-num',`﴿${digits(y.numberInSurah)}﴾`),' ');
  span.onclick=()=>{ayah=y.numberInSurah;basmalaFirst=false;play();};
  return span;
 }));
 mark();
}
function mark(scroll){
 const c=surahs[surah-1];
 for(const el of $('mushafText').children)el.classList.toggle('current',Number(el.dataset.ayah)===ayah&&!basmalaFirst);
 $('mushafBasmala').classList.toggle('current',basmalaFirst);
 $('mushafFill').style.width=`${Math.round((ayah-(playing?0.5:1))/c.ayahs.length*100)}%`;
 $('mushafPos').textContent=basmalaFirst?'البسملة':`الآية ${digits(ayah)} من ${digits(c.ayahs.length)}`;
 if(scroll){const el=basmalaFirst?$('mushafBasmala'):$('mushafText').querySelector(`[data-ayah="${ayah}"]`);el?.scrollIntoView({behavior:'smooth',block:'center'});}
}
function setPlaying(on){
 playing=on;$('mushafPlay').textContent=on?'⏸':'▶';$('mushafPlay').setAttribute('aria-label',on?'إيقاف مؤقت':'تشغيل');
 if(navigator.mediaSession)navigator.mediaSession.playbackState=on?'playing':'paused';
 // Keep the screen on while listening, so the page can be followed without touching the phone.
 if(on&&!wakeLock)navigator.wakeLock?.request('screen').then(l=>{wakeLock=l;l.onrelease=()=>{wakeLock=null;};}).catch(()=>{});
 if(!on){wakeLock?.release().catch(()=>{});wakeLock=null;}
}
function mediaInfo(){
 if(!navigator.mediaSession||typeof MediaMetadata==='undefined')return;
 navigator.mediaSession.metadata=new MediaMetadata({title:`${surahs[surah-1].name} — الآية ${ayah}`,artist:reciter().name,album:'اختبار التلاوة',artwork:[{src:'icons/icon-512.png',sizes:'512x512',type:'image/png'}]});
}
function prefetch(){
 const c=surahs[surah-1],next=basmalaFirst?[surah,1]:ayah<c.ayahs.length?[surah,ayah+1]:null;
 if(next){const a=new Audio();a.preload='auto';a.src=file(...next);}
}
function play(){
 clearTimeout(slowTimer);
 audio.src=basmalaFirst?file(1,1):file(surah,ayah);
 setPlaying(true);mark(true);mediaInfo();status(`تلاوة ${reciter().name}`);
 slowTimer=setTimeout(()=>{if(playing&&audio.paused)status('الاتصال بطيء — ما زال تحميل التلاوة جاريًا…');},6000);
 audio.play().catch(()=>{setPlaying(false);status('اضغط ▶ لبدء الاستماع.');});
 prefetch();
}
function advance(){
 const c=surahs[surah-1];
 if(basmalaFirst){basmalaFirst=false;return play();}
 if(ayah<c.ayahs.length){ayah++;return play();}
 // End of the surah: carry on to the next one if asked, otherwise stop at the last ayah.
 if($('mushafContinue').checked&&surah<114){openSurah(surah+1,1,true);return;}
 setPlaying(false);mark();$('mushafFill').style.width='100%';status(`صدق الله العظيم — انتهت ${c.name}.`);
}
function openSurah(s,a=1,autoplay=false){
 audio.pause();surah=s;ayah=a;basmalaFirst=a===1&&hasBasmala(s);renderPage();
 $('mushafPage').scrollTop=0;
 if(autoplay)play();else{setPlaying(false);status('اضغط ▶ للاستماع، أو اضغط على أي آية لتبدأ منها.');}
}
function move(delta){
 const c=surahs[surah-1];basmalaFirst=false;
 const next=ayah+delta;
 if(next<1){if(surah>1)openSurah(surah-1,surahs[surah-2].ayahs.length,playing);return;}
 if(next>c.ayahs.length){if(surah<114)openSurah(surah+1,1,playing);return;}
 ayah=next;if(playing)play();else mark(true);
}
audio.onended=advance;
audio.onplaying=()=>{clearTimeout(slowTimer);status(`تلاوة ${reciter().name}`);};
// A missing file (a reciter without that ayah) is skipped rather than stopping the whole surah.
audio.onerror=()=>{if(!playing||!audio.src)return;status('تعذّر تحميل هذه الآية — انتقلت إلى التالية.');setTimeout(()=>{if(playing)advance();},900);};

function open(){
 if(typeof surahs==='undefined'||!surahs.length)return toast?.('انتظر حتى يكتمل تحميل المصحف.');
 $('audio').pause();
 returnFocus=document.activeElement;
 $('mushafReciter').value=$('reciter').value;
 $('mushafDialog').hidden=false;document.body.classList.add('mushaf-active');
 openSurah(Number($('surah').value),Number($('ayah').value));
 $('mushafPlay').focus();
}
function close(){
 const wasAt=[surah,ayah];
 audio.pause();audio.removeAttribute('src');setPlaying(false);clearTimeout(slowTimer);
 $('mushafDialog').hidden=true;document.body.classList.remove('mushaf-active');
 // Return to the main page at the ayah reached, so practice can continue from there.
 goTo(...wasAt);returnFocus?.focus?.();
}

const fillSurahs=()=>{if(!surahs.length||$('mushafSurah').options.length)return;$('mushafSurah').replaceChildren(...surahs.map(c=>new Option(`${c.number}. ${c.name}`,c.number)));};
$('mushafReciter').replaceChildren(...Object.entries(RECITERS).map(([id,r])=>new Option(r.name,id)));
$('mushafOpen').onclick=()=>{fillSurahs();open();};
$('mushafClose').onclick=close;
$('mushafPlay').onclick=()=>{if(playing){audio.pause();setPlaying(false);mark();status('متوقف مؤقتًا.');}else if(audio.src&&audio.currentTime>0&&!audio.ended){audio.play();setPlaying(true);mark();}else play();};
$('mushafPrev').onclick=()=>move(-1);
$('mushafNext').onclick=()=>move(1);
$('mushafSurah').onchange=()=>openSurah(Number($('mushafSurah').value),1,playing);
$('mushafReciter').onchange=()=>{$('reciter').value=$('mushafReciter').value;$('reciter').onchange?.();if(playing)play();};
$('mushafContinue').checked=load('mushafContinue',false)===true;
$('mushafContinue').onchange=()=>save('mushafContinue',$('mushafContinue').checked);
for(const [id,d]of [['mushafBigger',0.1],['mushafSmaller',-0.1]])$(id).onclick=()=>{const v=Math.round(Math.min(1.8,Math.max(0.7,(load('mushafScale',1)+d)))*10)/10;save('mushafScale',v);$('mushafPage').style.setProperty('--mushaf-scale',v);};
$('mushafPage').style.setProperty('--mushaf-scale',load('mushafScale',1));
$('mushafDialog').addEventListener('keydown',e=>{
 if(e.key==='Escape'){e.preventDefault();close();}
 else if(e.code==='Space'&&!/^(SELECT|BUTTON|INPUT)$/.test(e.target.tagName)){e.preventDefault();$('mushafPlay').click();}
});
if(navigator.mediaSession){
 const on=(action,fn)=>{try{navigator.mediaSession.setActionHandler(action,()=>{if(!$('mushafDialog').hidden)fn();});}catch{}};
 on('play',()=>{if(!playing)$('mushafPlay').click();});on('pause',()=>{if(playing)$('mushafPlay').click();});
 on('previoustrack',()=>move(-1));on('nexttrack',()=>move(1));
}
})();
