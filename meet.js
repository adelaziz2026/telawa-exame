// Meeting room («حلقة»): mesh WebRTC calls (every participant connects to every other, up to 8), with the local
// server relaying set-up messages, chat, hands, reactions and the shared whiteboard (meeting.cjs).
(function(){
const $=id=>document.getElementById(id);
// Public STUN lets browsers on different networks find each other; media still flows directly between them.
const ICE={iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]};
const load=(k,f)=>{try{return JSON.parse(localStorage.getItem('tarteel:meet:'+k))??f;}catch{return f;}};
const save=(k,v)=>{try{localStorage.setItem('tarteel:meet:'+k,JSON.stringify(v));}catch{}};

let me=null,events=null,board=null;
const peers=new Map();
const state={mic:true,cam:true,hand:false,screen:false};
let local=new MediaStream(),camTrack=null,micTrack=null,screenTrack=null,placeholder=null;
let toastTimer=0,recorder=null,audioCtx=null;

function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true;},3000);}
const initials=name=>(name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('');

// ---------- Local media ----------
// A small painted frame stands in for the camera when it is off, so every connection always has a video sender
// (screen sharing then just swaps the track, with no renegotiation).
function makePlaceholder(name){
 const c=document.createElement('canvas');c.width=320;c.height=180;const g=c.getContext('2d');
 const paint=()=>{g.fillStyle='#1b2823';g.fillRect(0,0,320,180);g.fillStyle='#cfe3da';g.font='bold 54px Tahoma, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(initials(name),160,92);};
 paint();const stream=c.captureStream(2);
 // Repaint now and then: some browsers stop sending a canvas track that never changes.
 setInterval(paint,500);
 return stream.getVideoTracks()[0];
}
async function getCamera(){
 const track=(await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:24}}})).getVideoTracks()[0];
 // The camera can stop on its own (another app takes it, it is unplugged, the system revokes access):
 // show the "camera off" frame instead of a frozen or black picture, and let the user turn it back on.
 track.addEventListener('ended',()=>{
  console.warn('camera ended',document.visibilityState);
  if(camTrack!==track)return;
  camTrack=null;state.cam=false;
  if(me){if(!state.screen)setOutgoingVideo(placeholder);announce();toast('توقفت الكاميرا. اضغط 📷 لتشغيلها من جديد.');}else syncPreview();
 });
 return track;
}
async function startMedia(){
 const note=[];
 if(!navigator.mediaDevices?.getUserMedia){$('mediaNote').textContent='الكاميرا والميكروفون غير متاحين هنا (يلزم localhost أو HTTPS). يمكنك الدخول للدردشة والسبورة.';state.mic=state.cam=false;return syncPreview();}
 try{micTrack=(await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})).getAudioTracks()[0];}catch{note.push('لم يُسمح بالميكروفون');state.mic=false;}
 try{camTrack=await getCamera();}catch{note.push('لم يُسمح بالكاميرا');state.cam=false;}
 if(!load('mic',true)&&micTrack){state.mic=false;}
 if(!load('cam',true)&&camTrack){camTrack.stop();camTrack=null;state.cam=false;}
 $('mediaNote').textContent=note.join(' · ');
 syncPreview();
 // The camera arrived after joining (the join did not wait for a slow device): start sending it now.
 if(me&&camTrack&&state.cam&&!state.screen){setOutgoingVideo(camTrack);announce();}
}
function syncPreview(){
 if(micTrack)micTrack.enabled=state.mic;
 $('preview').srcObject=camTrack?new MediaStream([camTrack]):null;$('previewOff').hidden=!!camTrack;
 for(const [id,on]of [['pMic',state.mic],['pCam',state.cam]]){$(id).classList.toggle('on',on);$(id).setAttribute('aria-pressed',String(on));}
}
$('pMic').onclick=()=>{if(!micTrack)return toast('لا يوجد ميكروفون متاح.');state.mic=!state.mic;save('mic',state.mic);syncPreview();};
$('pCam').onclick=async()=>{
 if(state.cam){camTrack?.stop();camTrack=null;state.cam=false;}
 else{try{camTrack=await getCamera();state.cam=true;}catch{return toast('تعذّر تشغيل الكاميرا.');}}
 save('cam',state.cam);syncPreview();
};

// ---------- Lobby ----------
const params=new URLSearchParams(location.search);
const newRoomId=()=>'halaqa-'+Math.random().toString(36).slice(2,7);
$('room').value=(params.get('room')||load('room','')||newRoomId()).toLowerCase();
$('name').value=load('name','');
$('newRoom').onclick=()=>{$('room').value=newRoomId();$('room').focus();};
$('joinForm').onsubmit=async e=>{e.preventDefault();await join($('name').value.trim(),$('room').value.trim().toLowerCase());};

async function api(path,body){
 const r=await fetch('api/meet/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Object.assign(Error(data.error||'failed'),{code:data.error,data});
 return data;
}
// Messages go out strictly one after another: otherwise a quick "raise hand" then "mute", or the growing updates
// of a whiteboard stroke, could arrive out of order and leave others with a stale state.
let outbox=Promise.resolve();
const send=(type,extra={})=>{
 const body={room:me.room,peer:me.peer,token:me.token,type,...extra};
 const sent=outbox.then(()=>api('send',body));outbox=sent.catch(()=>{});
 return sent.catch(e=>{if(e.code==='not_joined')lost();throw e;});
};

async function join(name,room){
 if($('joinBtn').disabled)return;
 $('joinError').textContent='';$('joinBtn').disabled=true;
 try{
  // …but never forever: an unanswered permission prompt or a stuck device must not block joining.
  await Promise.race([mediaReady,new Promise(r=>setTimeout(r,6000))]);
  const data=await api('join',{name,room});
  me={peer:data.peer,token:data.token,room,name:data.name};
  save('name',name);save('room',room);
  history.replaceState(null,'',`?room=${encodeURIComponent(room)}`);
  placeholder=makePlaceholder(name);
  local=new MediaStream([...(micTrack?[micTrack]:[]),outgoingVideo()]);
  enterMeeting(data);
 }catch(e){
  $('joinError').textContent=e.code==='room_full'?`الغرفة ممتلئة (الحد ${e.data.max} مشاركين).`:e.code==='bad_room'?'رمز الغرفة: حروف إنجليزية صغيرة وأرقام وشرطة (3–40).':'تعذّر الدخول. تأكد أن الخادم يعمل.';
 }finally{$('joinBtn').disabled=false;}
}
const outgoingVideo=()=>screenTrack||(state.cam&&camTrack)||placeholder;

function enterMeeting(data){
 $('lobby').hidden=true;$('meeting').hidden=false;
 $('roomTitle').textContent='🎥 '+me.room;
 board=new Whiteboard($('board'),{me:me.peer,onOp:op=>send('board',{op}).catch(()=>{})});
 board.load(data.board);
 addTile(me.peer,me.name+' (أنت)',state,true);
 data.chat.forEach(showChat);
 for(const p of data.peers)addPeer(p,true);
 updateControls();updateCount();
 openEvents();
 send('state',{state}).catch(()=>{});
 setInterval(detectSpeaking,250);
}
function openEvents(){
 events=new EventSource(`api/meet/events?room=${encodeURIComponent(me.room)}&peer=${me.peer}&token=${me.token}`);
 events.onmessage=e=>{try{onMessage(JSON.parse(e.data));}catch(err){console.warn(err);}};
 events.onerror=()=>{if(events.readyState===EventSource.CLOSED)lost();else $('netNote').hidden=false,$('netNote').textContent='جارٍ إعادة الاتصال…';};
 events.onopen=()=>{$('netNote').hidden=true;};
}
// The server forgot us (restart, or a long disconnect): offer to rejoin rather than failing silently.
function lost(){
 events?.close();$('netNote').hidden=false;$('netNote').textContent='انقطع الاتصال بالغرفة';
 if(confirm('انقطع الاتصال بالغرفة. هل تريد إعادة الدخول؟'))location.reload();
}

// ---------- Peers ----------
// Exactly one side starts each call: the newcomer offers to everyone already in the room, and they answer.
// (When both sides offered at once, one offer was discarded together with the network candidates sent for it.)
// Later video changes (camera, screen, placeholder) swap tracks in place, so no further offers are needed;
// only the side that started the call restarts it if the connection fails.
function addPeer({id,name,state:st},initiator){
 if(peers.has(id))return peers.get(id);
 const pc=new RTCPeerConnection(ICE);
 const p={id,name,state:st||{mic:true,cam:true,hand:false,screen:false},pc,initiator:!!initiator,candidates:[],stream:new MediaStream(),analyser:null,inbox:Promise.resolve()};
 peers.set(id,p);
 for(const track of local.getTracks())pc.addTrack(track,local);
 pc.onicecandidate=({candidate})=>{if(candidate)send('signal',{to:id,data:{candidate}}).catch(()=>{});};
 pc.onnegotiationneeded=async()=>{
  if(!p.initiator)return;
  try{await pc.setLocalDescription();await send('signal',{to:id,data:{description:pc.localDescription}});}
  catch(e){console.warn('offer',e);}
 };
 pc.ontrack=({track})=>{
  p.stream.addTrack(track);
  const video=document.querySelector(`#tile-${id} video`);if(video){if(video.srcObject!==p.stream)video.srcObject=p.stream;video.play().catch(()=>{});}
  if(track.kind==='audio')watchSpeaking(p);
 };
 pc.onconnectionstatechange=()=>{
  const s=pc.connectionState,el=document.querySelector(`#tile-${id} .status`);
  if(el){el.textContent=s==='connected'?'':s==='failed'?'تعذّر الاتصال':'جارٍ الاتصال…';el.hidden=s==='connected';}
  if(s==='failed'&&p.initiator)pc.restartIce();
 };
 addTile(id,name,p.state,false);
 return p;
}
async function onSignal(from,data){
 const p=peers.get(from);if(!p)return;const pc=p.pc;
 try{
  if(data.description){
   await pc.setRemoteDescription(data.description);
   // Candidates that arrived before this description are applied now instead of being lost.
   for(const c of p.candidates.splice(0))await pc.addIceCandidate(c).catch(e=>console.warn('candidate',e));
   if(data.description.type==='offer'){await pc.setLocalDescription();await send('signal',{to:from,data:{description:pc.localDescription}});}
  }else if(data.candidate){
   if(!pc.remoteDescription)p.candidates.push(data.candidate);
   else await pc.addIceCandidate(data.candidate).catch(e=>console.warn('candidate',e));
  }
 }catch(e){console.warn('signal',e);}
}
function removePeer(id){
 const p=peers.get(id);if(!p)return;
 p.pc.close();peers.delete(id);$('tile-'+id)?.remove();renderPeople();updateCount();
}
function onMessage(m){
 switch(m.type){
  case 'join':addPeer({id:m.from,...m.peer});toast(`انضم ${m.peer.name}`);renderPeople();updateCount();break;
  case 'leave':{const p=peers.get(m.from);if(p)toast(`غادر ${p.name}`);removePeer(m.from);break;}
  // One participant's set-up messages are handled strictly in order (a candidate must not overtake its offer).
  case 'signal':{const p=peers.get(m.from);if(p)p.inbox=p.inbox.then(()=>onSignal(m.from,m.data));break;}
  case 'state':{const p=peers.get(m.from);if(!p)break;const raised=!p.state.hand&&m.state.hand;p.state=m.state;updateTile(m.from,p.state);renderPeople();if(raised)toast(`✋ ${p.name} رفع يده`);break;}
  case 'chat':showChat(m.entry);break;
  case 'board':board.apply(m.op);if(!boardOpen())toast('🖊 تحديث على السبورة');break;
  case 'reaction':{const p=peers.get(m.from);floatReaction(m.emoji,p?.name);break;}
 }
}

// ---------- Tiles ----------
function addTile(id,name,st,mine){
 if($('tile-'+id))return;
 const tile=document.createElement('div');tile.className='tile'+(mine?' me':'');tile.id='tile-'+id;
 const video=document.createElement('video');video.autoplay=true;video.playsInline=true;if(mine){video.muted=true;video.srcObject=local;}
 else{const p=peers.get(id);if(p)video.srcObject=p.stream;}
 const label=document.createElement('div');label.className='label';
 const status=document.createElement('span');status.className='status';status.textContent=mine?'':'جارٍ الاتصال…';status.hidden=mine;
 tile.append(video,label,status);
 tile.onclick=()=>{const was=tile.classList.contains('pinned');document.querySelectorAll('.tile.pinned').forEach(t=>t.classList.remove('pinned'));tile.classList.toggle('pinned',!was);};
 tile.dataset.name=name;
 $('grid').append(tile);updateTile(id,st);
}
function updateTile(id,st){
 const tile=$('tile-'+id);if(!tile)return;
 const label=tile.querySelector('.label');label.textContent=`${st.mic?'':'🔇 '}${tile.dataset.name}`;
 tile.classList.toggle('screen',!!st.screen);
 let hand=tile.querySelector('.hand');
 if(st.hand&&!hand){hand=document.createElement('span');hand.className='hand';hand.textContent='✋';tile.append(hand);}else if(!st.hand)hand?.remove();
}
function updateCount(){$('peerCount').textContent=`${peers.size+1} مشارك`;renderPeople();}
function renderPeople(){
 const items=[{id:me.peer,name:me.name+' (أنت)',state},...[...peers.values()].map(p=>({id:p.id,name:p.name,state:p.state}))];
 $('people').replaceChildren(...items.map(({name,state:s})=>{
  const li=document.createElement('li');const who=document.createElement('span');who.className='who';who.textContent=name;
  const icons=document.createElement('span');icons.className='icons';icons.textContent=`${s.hand?'✋':''}${s.screen?'🖥':''}${s.mic?'🎙':'🔇'}${s.cam?'📷':'🚫'}`;
  li.append(who,icons);return li;
 }));
}

// ---------- Active speaker ----------
function watchSpeaking(p){
 try{audioCtx??=new AudioContext();const a=audioCtx.createAnalyser();a.fftSize=512;audioCtx.createMediaStreamSource(p.stream).connect(a);p.analyser=a;}catch{}
}
function detectSpeaking(){
 for(const p of peers.values()){
  if(!p.analyser)continue;const data=new Uint8Array(p.analyser.fftSize);p.analyser.getByteTimeDomainData(data);
  let sum=0;for(const v of data)sum+=(v-128)**2;
  $('tile-'+p.id)?.classList.toggle('speaking',Math.sqrt(sum/data.length)>6&&p.state.mic);
 }
}

// ---------- Controls ----------
function updateControls(){
 const set=(id,on)=>{$(id).classList.toggle('on',on);$(id).setAttribute('aria-pressed',String(on));};
 set('cMic',state.mic);set('cCam',state.cam);set('cShare',state.screen);set('cHand',state.hand);
 set('cBoard',boardOpen());set('cChat',sideTab()==='chat');set('cPeople',sideTab()==='people');set('cRec',!!recorder);
 $('cMic').querySelector('span').textContent=state.mic?'🎙':'🔇';
 updateTile(me.peer,state);
}
const announce=()=>{updateControls();renderPeople();send('state',{state}).catch(()=>{});};
// Swap the outgoing video on every connection (camera, screen or placeholder) without renegotiating.
function setOutgoingVideo(track){
 const old=local.getVideoTracks()[0];if(old)local.removeTrack(old);local.addTrack(track);
 for(const p of peers.values()){const sender=p.pc.getSenders().find(s=>s.track?.kind==='video'||(!s.track&&s.dtmf===null));sender?.replaceTrack(track);}
 const mine=document.querySelector(`#tile-${me.peer} video`);if(mine){mine.srcObject=null;mine.srcObject=local;}
}
$('cMic').onclick=()=>{if(!micTrack)return toast('لا يوجد ميكروفون متاح.');state.mic=!state.mic;micTrack.enabled=state.mic;save('mic',state.mic);announce();};
$('cCam').onclick=async()=>{
 if(state.cam){state.cam=false;if(!state.screen)setOutgoingVideo(placeholder);camTrack?.stop();camTrack=null;}
 else{try{camTrack=await getCamera();}catch{return toast('تعذّر تشغيل الكاميرا.');}state.cam=true;if(!state.screen)setOutgoingVideo(camTrack);}
 save('cam',state.cam);announce();
};
$('cShare').onclick=async()=>{
 if(state.screen)return stopShare();
 if(!navigator.mediaDevices?.getDisplayMedia)return toast('مشاركة الشاشة غير مدعومة في هذا المتصفح.');
 try{screenTrack=(await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15}},audio:false})).getVideoTracks()[0];}catch{return;}
 screenTrack.onended=stopShare;state.screen=true;setOutgoingVideo(screenTrack);announce();toast('تشارك شاشتك الآن');
};
function stopShare(){if(!state.screen)return;screenTrack?.stop();screenTrack=null;state.screen=false;setOutgoingVideo(outgoingVideo());announce();}
$('cHand').onclick=()=>{state.hand=!state.hand;announce();};

const boardOpen=()=>!$('boardWrap').hidden;
$('cBoard').onclick=()=>{$('boardWrap').hidden=boardOpen();$('stage').classList.toggle('board-open',boardOpen());if(boardOpen())board.resize();updateControls();};
const sideTab=()=>$('side').hidden?null:$('chatPane').hidden?'people':'chat';
function openSide(tab){
 if(sideTab()===tab){$('side').hidden=true;}
 else{$('side').hidden=false;$('chatPane').hidden=tab!=='chat';$('people').hidden=tab!=='people';$('tabChat').setAttribute('aria-selected',String(tab==='chat'));$('tabPeople').setAttribute('aria-selected',String(tab==='people'));if(tab==='chat'){$('unread').hidden=true;$('chatInput').focus();}}
 updateControls();
}
$('cChat').onclick=()=>openSide('chat');$('cPeople').onclick=()=>openSide('people');
$('tabChat').onclick=()=>openSide('chat');$('tabPeople').onclick=()=>openSide('people');$('sideClose').onclick=()=>{$('side').hidden=true;updateControls();};

// ---------- Chat ----------
function showChat(entry){
 const div=document.createElement('div');div.className='chat-msg'+(entry.from===me.peer?' mine':'');
 const who=document.createElement('b');who.textContent=entry.from===me.peer?'أنت':entry.name;
 const time=document.createElement('time');time.textContent=new Date(entry.at).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});who.append(time);
 div.append(who,entry.text);$('chatLog').append(div);div.scrollIntoView({block:'end'});
 if(sideTab()!=='chat'&&entry.from!==me.peer){$('unread').hidden=false;toast(`💬 ${entry.name}: ${entry.text.slice(0,60)}`);}
}
$('chatForm').onsubmit=async e=>{
 e.preventDefault();const text=$('chatInput').value.trim();if(!text)return;$('chatInput').value='';
 try{const {entry}=await send('chat',{text});showChat(entry);}catch{toast('تعذّر إرسال الرسالة.');$('chatInput').value=text;}
};

// ---------- Reactions ----------
function floatReaction(emoji,name){
 const el=document.createElement('div');el.className='reaction';el.style.left=(10+Math.random()*75)+'%';el.textContent=emoji;
 if(name){const s=document.createElement('small');s.textContent=name;el.append(s);}
 $('reactions').append(el);setTimeout(()=>el.remove(),2700);
}
$('cReact').onclick=()=>{const open=$('reactMenu').hidden;$('reactMenu').hidden=!open;$('cReact').setAttribute('aria-expanded',String(open));};
for(const b of $('reactMenu').querySelectorAll('button'))b.onclick=()=>{floatReaction(b.textContent,'أنت');send('reaction',{emoji:b.textContent}).catch(()=>{});$('reactMenu').hidden=true;};

// ---------- Whiteboard toolbar ----------
for(const b of document.querySelectorAll('.board-tools .tool'))b.onclick=()=>{board.tool=b.dataset.tool;document.querySelectorAll('.board-tools .tool').forEach(x=>x.classList.toggle('on',x===b));};
for(const b of document.querySelectorAll('.board-tools .color'))b.onclick=()=>{board.color=b.dataset.color;document.querySelectorAll('.board-tools .color').forEach(x=>x.classList.toggle('on',x===b));};
$('penSize').oninput=()=>{board.size=Number($('penSize').value)*0.0013;};
$('undo').onclick=()=>{if(!board.undo())toast('لا يوجد ما يُتراجع عنه من رسمك.');};
$('clearBoard').onclick=()=>{if(confirm('مسح السبورة للجميع؟'))board.clear();};
$('saveBoard').onclick=()=>board.exportPng(`sabbora-${me.room}.png`);
// Ayat come from the app's own Mushaf file, never typed by hand.
let mushaf=null;
$('ayahAdd').onclick=async()=>{
 const m=$('ayahRef').value.trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/^(\d{1,3})\s*[:：]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
 if(!m)return toast('اكتب السورة:الآية مثل 2:255 أو 1:1-7');
 try{mushaf??=(await (await fetch('data/quran.json')).json()).data.surahs;}catch{return toast('تعذّر تحميل المصحف.');}
 const s=mushaf[+m[1]-1],from=+m[2],to=Math.min(+(m[3]||m[2]),from+9,s?.ayahs.length||0);
 if(!s||!s.ayahs[from-1]||to<from)return toast('لا توجد آية بهذا الرقم.');
 const words=n=>{let t=s.ayahs[n-1].text.replace(/^﻿/,'');
  // Ayah 1 carries the basmala in this edition (except Al-Fatiha and At-Tawbah); it is not part of the ayah.
  if(n===1&&s.number!==1&&s.number!==9)t=t.split(/\s+/).slice(4).join(' ');return t;};
 const text=Array.from({length:to-from+1},(_,i)=>`${words(from+i)} ﴿${(from+i).toLocaleString('ar-EG')}﴾`).join(' ');
 board.addAyah(text,`${s.name} ${from}${to>from?'–'+to:''}`);
 if(!boardOpen())$('cBoard').click();
};

// ---------- Recording (saved on this device) ----------
$('cRec').onclick=async()=>{
 if(recorder){recorder.stop();return;}
 if(!navigator.mediaDevices?.getDisplayMedia||typeof MediaRecorder==='undefined')return toast('التسجيل غير مدعوم في هذا المتصفح.');
 let capture;
 try{capture=await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'browser'},audio:true,preferCurrentTab:true,selfBrowserSurface:'include'});}catch{return;}
 // Mix everyone's voices (and the captured tab audio) into one track.
 audioCtx??=new AudioContext();const mix=audioCtx.createMediaStreamDestination();
 for(const s of [capture,...(micTrack?[new MediaStream([micTrack])]:[]),...[...peers.values()].map(p=>p.stream)])if(s.getAudioTracks().length)audioCtx.createMediaStreamSource(s).connect(mix);
 const chunks=[];recorder=new MediaRecorder(new MediaStream([...capture.getVideoTracks(),...mix.stream.getAudioTracks()]));
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 recorder.onstop=()=>{
  capture.getTracks().forEach(t=>t.stop());recorder=null;$('recBadge').hidden=true;updateControls();
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));a.download=`halaqa-${me.room}-${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.webm`;a.click();
  toast('حُفظ التسجيل على جهازك.');
 };
 capture.getVideoTracks()[0].onended=()=>recorder?.stop();
 recorder.start(1000);$('recBadge').hidden=false;updateControls();toast('بدأ التسجيل — يُحفظ على جهازك عند الإيقاف.');
};

// ---------- Invite & leave ----------
$('invite').onclick=async()=>{
 const link=`${location.origin}${location.pathname}?room=${encodeURIComponent(me.room)}`;
 try{await navigator.clipboard.writeText(link);toast('نُسخ رابط الدعوة');}catch{prompt('انسخ رابط الدعوة:',link);}
};
function leave(){
 send('leave').catch(()=>{});events?.close();recorder?.stop();
 for(const p of peers.values())p.pc.close();
 [micTrack,camTrack,screenTrack].forEach(t=>t?.stop());
 location.href='./';
}
$('cLeave').onclick=leave;
addEventListener('pagehide',()=>{if(me)navigator.sendBeacon?.('api/meet/send',new Blob([JSON.stringify({room:me.room,peer:me.peer,token:me.token,type:'leave'})],{type:'application/json'}));});
// Zoom-style shortcuts: Alt+A microphone, Alt+V camera, Alt+S share, Alt+Y raise hand, Alt+W whiteboard.
addEventListener('keydown',e=>{
 if(!me||!e.altKey||e.ctrlKey||e.metaKey)return;
 const id={KeyA:'cMic',KeyV:'cCam',KeyS:'cShare',KeyY:'cHand',KeyW:'cBoard',KeyH:'cChat'}[e.code];
 if(id){e.preventDefault();$(id).click();}
});

// Joining waits for this, so a quick click cannot enter with the "camera off" frame while the camera is still starting.
const mediaReady=startMedia();
globalThis.TarteelMeeting={get me(){return me;},peers,state,get board(){return board;},join};
})();
