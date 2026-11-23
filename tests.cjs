const {test}=require('node:test');const assert=require('node:assert/strict');const {compare,normalize}=require('./compare.js');
test('Arabic diacritics and alif normalization',()=>assert.equal(normalize('ٱلْحَمْدُ لِلَّهِ'),'الحمد لله'));
test('matching verse',()=>assert.ok(compare('الْحَمْدُ لِلَّهِ','الحمد لله').every(x=>x.type==='correct')));
test('missing word preserves alignment',()=>assert.deepEqual(compare('الحمد لله رب العالمين','الحمد رب العالمين').map(x=>x.type),['correct','missing','correct','correct']));
test('substitution and extra words',()=>{assert.equal(compare('مالك يوم الدين','ملك يوم الدين')[0].type,'changed');assert.equal(compare('الحمد لله','الحمد لله كثيرا')[2].type,'extra');});
test('empty transcript marks missing words',()=>assert.ok(compare('الحمد لله','').every(x=>x.type==='missing')));
test('complete consistent Quran editions',()=>{const q=require('./data/quran.json').data.surahs,s=require('./data/simple.json').data.surahs;assert.equal(q.length,114);assert.equal(q.reduce((n,s)=>n+s.ayahs.length,0),6236);q.forEach((chapter,i)=>assert.equal(chapter.ayahs.length,s[i].ayahs.length));});
const vm=require('node:vm');const fs=require('node:fs');
async function appHarness(extra={}){
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'1',textContent:'',disabled:false,checked:false,classList:{add(){},remove(){}},replaceChildren(...children){this.children=children;if(id==='surah'||id==='ayah')this.value=String(children[0]?.value||1);},append(){},pause(){},closest(){return this.details||(this.details={});},scrollIntoView(){}});return elements.get(id);};
 let instance,timers=[];
 class Speech {constructor(){instance=this;}start(){this.onstart();}stop(){this.stopped=true;}abort(){this.aborted=true;}}
 const data={data:{surahs:Array.from({length:114},(_,i)=>({number:i+1,name:'سورة',ayahs:[{number:1,numberInSurah:1,text:'الحمد لله'}]}))}};
 const ctx={document:{getElementById:el,createElement:()=>({append(){},setAttribute(){},classList:{add(){}}})},window:{SpeechRecognition:Speech},Option:function(text,value){this.value=value;},fetch:async()=>({ok:true,json:async()=>data}),QuranCompare:require('./compare.js'),QuranLearning:require('./learning.js'),Date,setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:fn=>{timers=timers.filter(x=>x!==fn);},AbortSignal,...extra};
 vm.runInNewContext(fs.readFileSync(require.resolve('./app.js'),'utf8'),ctx);
 await new Promise(resolve=>setImmediate(resolve));
 return {el,ctx,get speech(){return instance;},flush(){const pending=timers;timers=[];pending.forEach(fn=>fn());}};
}
test('stop reviews interim words even when browser never sends end',async()=>{
 const h=await appHarness();h.el('record').onclick();
 h.speech.onresult({results:[[{transcript:'الحمد لله'}]]});
 h.el('record').onclick();assert.equal(h.speech.stopped,true);assert.equal(h.el('record').disabled,true);
 h.flush();assert.equal(h.el('record').textContent,'ابدأ التسميع');assert.equal(h.el('record').disabled,false);assert.equal(h.el('resultLabel').textContent,'الكلمات متطابقة');assert.equal(h.speech.aborted,true);
});
test('stop without recognized words displays actionable message',async()=>{
 const h=await appHarness();h.el('record').onclick();h.el('record').onclick();h.flush();
 assert.equal(h.el('resultLabel').textContent,'لم تصل كلمات');assert.equal(h.el('transcript').details.open,true);assert.equal(h.el('surah').disabled,false);
});
test('final result arriving after stop is included and session can restart',async()=>{
 const h=await appHarness();h.el('record').onclick();h.el('record').onclick();
 h.speech.onresult({results:[[{transcript:'الحمد لله'}]]});h.speech.onend();h.flush();
 assert.equal(h.el('resultLabel').textContent,'الكلمات متطابقة');h.el('record').onclick();assert.equal(h.el('transcript').value,'');assert.equal(h.el('record').textContent,'إيقاف ومراجعة');
});
test('recognition error resets stuck controls without requiring end event',async()=>{
 const h=await appHarness();h.el('record').onclick();h.speech.onerror({error:'network'});
 assert.equal(h.el('record').textContent,'ابدأ التسميع');assert.equal(h.el('surah').disabled,false);assert.match(h.el('status').textContent,/تعذّر الاتصال/);
});

test('word correction plays verified word recording and resets on end',async()=>{
 const h=await appHarness();let player;
 h.ctx.fetch=async()=>({ok:true,json:async()=>({verse:{words:[{char_type_name:'word',text_imlaei:'رب',audio_url:'wbw/001_002_003.mp3'}]}})});
 h.ctx.Audio=class{constructor(url){this.url=url;player=this;}async play(){this.played=true;}pause(){this.paused=true;}};
 const button={};h.ctx.button=button;
 await vm.runInNewContext("playCorrection('1:2',0,'رب','رب',button,generation)",h.ctx);
 assert.equal(player.url,'https://audio.qurancdn.com/wbw/001_002_003.mp3');assert.equal(player.played,true);
 player.onended();assert.equal(button.disabled,false);assert.equal(button.textContent,'🔊 استمع للكلمة');
});
test('word correction refuses mismatched word instead of playing wrong audio',async()=>{
 const h=await appHarness();let played=false;
 h.ctx.fetch=async()=>({ok:true,json:async()=>({verse:{words:[{char_type_name:'word',text_imlaei:'يوم',audio_url:'wbw/001_004_002.mp3'}]}})});
 h.ctx.Audio=class{play(){played=true;}pause(){}};h.ctx.button={};
 await vm.runInNewContext("playCorrection('1:4',0,'الدين','الدين',button,generation)",h.ctx);
 assert.equal(played,false);assert.equal(h.ctx.button.disabled,false);assert.match(h.el('wordAudioStatus').textContent,/تعذّر تحميل/);
});


test('basmala is separated from ayah 1 except in Al-Fatiha and At-Tawbah',async()=>{
 const h=await appHarness();
 for(const file of ['quran','simple']){
  const chapters=JSON.parse(fs.readFileSync(`./data/${file}.json`,'utf8')).data.surahs;h.ctx.chapters=chapters;
  vm.runInNewContext('separateBasmala(chapters)',h.ctx);
  assert.equal(chapters.filter(c=>c.basmala).length,112);assert.equal(chapters[0].basmala,'');assert.equal(chapters[8].basmala,'');
  assert.equal(normalize(chapters[0].ayahs[0].text),'بسم الله الرحمن الرحيم');assert.equal(normalize(chapters[1].ayahs[0].text),'الم');
  assert.equal(normalize(chapters[112].ayahs[0].text),'قل اعوذ برب الفلق');
 }
});
test('navigation continues across surah boundaries',async()=>{
 const h=await appHarness();
 h.el('prev').onclick();assert.equal(String(h.el('surah').value),'1');
 h.el('next').onclick();assert.equal(String(h.el('surah').value),'2');assert.equal(String(h.el('ayah').value),'1');
 h.el('prev').onclick();assert.equal(String(h.el('surah').value),'1');
});
test('review reports a word accuracy score',async()=>{
 const h=await appHarness();h.el('transcript').value='الحمد';h.el('review').onclick();
 assert.equal(h.el('resultLabel').textContent,'موضع واحد للمراجعة · 50٪');assert.match(h.el('verseRef').textContent,/آخر مراجعة 50٪/);
});
test('PWA manifest and offline cache list point to real files',()=>{
 const manifest=JSON.parse(fs.readFileSync('./manifest.webmanifest','utf8'));
 assert.equal(manifest.display,'standalone');assert.ok(manifest.icons.some(i=>i.sizes==='512x512'&&i.purpose==='maskable'));
 const sw=fs.readFileSync('./sw.js','utf8');const cached=[...sw.matchAll(/'([\w\/-]+\.\w+)'/g)].map(m=>m[1]);
 assert.ok(cached.includes('data/quran.json'));
 for(const file of [...manifest.icons.map(i=>i.src),...cached])assert.ok(fs.existsSync(file),file);
});
const L=require('./learning.js');const HOUR=36e5;
test('ML recall model predicts forgetting over time and weaker recall after mistakes',()=>{
 const s=L.createState(),t=0;assert.equal(L.recall(s,'1:1',t,4),null);
 L.learn(s,'1:1',100,t,4);L.learn(s,'1:2',40,t,4);
 assert.ok(L.recall(s,'1:1',t,4)>L.recall(s,'1:1',t+720*HOUR,4));
 assert.ok(L.recall(s,'1:1',t,4)>L.recall(s,'1:2',t,4));
});
test('ML model weights train toward observed outcomes',()=>{
 const s=L.createState();L.learn(s,'1:1',100,0,4);const before=L.recall(s,'1:1',HOUR,4);
 for(let i=1;i<=20;i++)L.learn(s,'1:1',20,i*HOUR,4);
 assert.equal(s.updates,20);assert.ok(L.recall(s,'1:1',21*HOUR,4)<before);
});
test('RL agent explores unseen ayat first, then prefers ayat with mistakes',()=>{
 const s=L.createState(),c=[1,2,3].map(i=>({key:'1:'+i,words:4}));
 L.learn(s,'1:1',100,0,4);assert.notEqual(L.choose(s,c,HOUR,null).key,'1:1');
 L.learn(s,'1:2',30,0,4);L.learn(s,'1:3',100,0,4);
 assert.equal(L.choose(s,c,HOUR,null).key,'1:2');assert.notEqual(L.choose(s,c,HOUR,'1:2').key,'1:2');
});
test('app review trains the model and shows predicted recall',async()=>{
 const h=await appHarness();h.el('transcript').value='الحمد لله';h.el('review').onclick();
 assert.match(h.el('verseRef').textContent,/احتمال التذكر المتوقع \d+٪/);
});
test('on-device deep-learning engine records, transcribes and reviews',async()=>{
 const h=await appHarness();let cancelled=false;
 h.ctx.DeviceASR={supported:()=>true,load:async()=>{},record:async()=>({stop:async()=>'blob',cancel(){cancelled=true;}}),transcribe:async blob=>blob==='blob'?'الحمد لله':''};
 h.el('engine').value='device';h.el('engine').onchange();assert.equal(h.el('record').disabled,false);
 h.el('record').onclick();await new Promise(r=>setImmediate(r));assert.equal(h.el('record').textContent,'إيقاف ومراجعة');
 await h.el('record').onclick();await new Promise(r=>setImmediate(r));
 assert.equal(h.el('resultLabel').textContent,'الكلمات متطابقة');assert.equal(h.el('record').textContent,'ابدأ التسميع');assert.equal(cancelled,false);
});
test('on-device deep-learning engine is the default when the device can record',async()=>{
 const h=await appHarness({DeviceASR:{supported:()=>true}});
 assert.equal(h.el('engine').value,'device');assert.equal(h.el('modelStatus').hidden,false);assert.equal(h.el('record').disabled,false);
});
test('browser speech service stays the default where recording is unsupported',async()=>{
 const h=await appHarness();assert.equal(h.el('engine').value,'browser');
});

test('written mistake notes describe swapped, dropped and extra letters and words',()=>{
 const {explain}=require('./compare.js');const notes=compare('مَالِكِ يَوْمِ الرحيم','ملك يوم الرحين كثيرا').map(explain).filter(Boolean);
 assert.deepEqual(notes,['في «مَالِكِ»: حذفت حرف «ا» في وسط الكلمة.','في «الرحيم»: نطقت «ن» بدل «م» في آخر الكلمة.','كلمة زائدة «كثيرا» ليست في الآية.']);
 assert.match(explain({type:'missing',expected:'لله'}),/لم تُسمع كلمة «لله»/);
});
test('review shows written notes only when there are mistakes',async()=>{
 const h=await appHarness();h.el('transcript').value='الحمد';h.el('review').onclick();
 assert.equal(h.el('notes').hidden,false);assert.equal(h.el('notesList').children.length,1);
 h.el('transcript').value='الحمد لله';h.el('review').onclick();assert.equal(h.el('notes').hidden,true);
});

test('supervised classifier learns which flagged mistakes are recognition errors',()=>{
 const clf=L.createClassifier();
 const asrLike=L.mistakeFeatures({type:'changed',ops:[{op:'sub',from:'ث',to:'س'}],length:5});
 const mine=L.mistakeFeatures({type:'missing',length:4});
 for(let i=0;i<15;i++){L.label(clf,asrLike,true);L.label(clf,mine,false);}
 assert.equal(clf.n,30);assert.ok(L.classify(clf,asrLike)>0.8);assert.ok(L.classify(clf,mine)<0.2);assert.ok(clf.correct/clf.n>0.7);
 assert.equal(L.confusable('ث','س'),true);assert.equal(L.confusable('ب','م'),false);
});
test('labelling a written note trains the classifier and updates the AI panel',async()=>{
 const h=await appHarness();h.el('transcript').value='الحمد';h.el('review').onclick();
 assert.match(h.el('aiMl').textContent,/آية متتبعة/);assert.match(h.el('aiSl').textContent,/صنّف/);
 const note=h.el('notesList').children[0];assert.ok(note);
});
test('speech gate refuses silence and background noise instead of letting the model invent words',()=>{
 const {prepare}=require('./asr.js');let seed=3;const rand=()=>((seed=(seed*16807)%2147483647)/2147483647)*2-1;
 assert.equal(prepare(new Float32Array(16000*3)),null);
 assert.equal(prepare(Float32Array.from({length:16000*4},()=>rand()*0.004)),null);
});
test('speech gate trims silence around speech and normalises quiet recitation',()=>{
 const {prepare}=require('./asr.js');const sr=16000;
 const audio=new Float32Array(sr*6);for(let i=2*sr;i<3.5*sr;i++)audio[i]=0.03*Math.sin(i/5);
 const out=prepare(audio);assert.ok(out);assert.ok(out.length<2.5*sr&&out.length>1.4*sr);
 assert.ok(Math.max(...out.map(Math.abs))>0.5);
});
test('a word split in two by speech recognition is matched as one word',()=>{
 assert.deepEqual(compare('الرحمن الرحيم','الرحمن الر حيم').map(x=>x.type),['correct','correct']);
 const r=compare('الرَّحْمَٰنِ الرَّحِيمِ','الرَّحْمَنِ الرَّ حِينِ');assert.deepEqual(r.map(x=>x.type),['correct','changed']);
 assert.equal(require('./compare.js').explain(r[1]),'في «الرَّحِيمِ»: نطقت «ن» بدل «م» في آخر الكلمة.');
 assert.deepEqual(compare('الا انهم','الا انهم').map(x=>x.type),['correct','correct']);
});

const http=require('node:http');
async function withServer(fn){
 const server=require('./server.cjs').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=(path,{method='GET',headers={}}={})=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path,method,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
 try{await fn(request);}finally{server.close();}
}
test('surah recordings: only a signed-in local user saves to the folder, and everyone can listen',async()=>{
 const dir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'rec-'));process.env.RECORDINGS_DIR=dir;
 try{
  const R=require('./recordings.cjs');fs.writeFileSync(dir+'/.login.json',JSON.stringify({user:'moh',...R.hashPassword('moh')}));
  const server=require('./server.cjs').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  try{
   const H={'x-recorder':'1'};
   assert.deepEqual(await (await fetch(base+'/api/recordings/status')).json(),{local:true,online:false,signedIn:false,ready:true,code:false,max:95*1024*1024});
   assert.equal((await fetch(base+'/api/recordings/1',{method:'PUT',headers:{...H,'content-type':'audio/webm'},body:'x'})).status,401);
   assert.equal((await fetch(base+'/api/recordings/login',{method:'POST',headers:{...H,'content-type':'application/json'},body:JSON.stringify({user:'moh',password:'no'})})).status,401);
   assert.equal((await fetch(base+'/api/recordings/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'moh',password:'moh'})})).status,403);
   const ok=await fetch(base+'/api/recordings/login',{method:'POST',headers:{...H,'content-type':'application/json'},body:JSON.stringify({user:'moh',password:'moh'})});
   assert.equal(ok.status,200);const cookie=ok.headers.get('set-cookie').split(';')[0];assert.match(ok.headers.get('set-cookie'),/HttpOnly/);
   const A={...H,cookie};
   assert.equal((await fetch(base+'/api/recordings/0',{method:'PUT',headers:{...A,'content-type':'audio/webm'},body:'x'})).status,400);
   assert.equal((await fetch(base+'/api/recordings/115',{method:'PUT',headers:{...A,'content-type':'audio/webm'},body:'x'})).status,400);
   assert.equal((await fetch(base+'/api/recordings/1',{method:'PUT',headers:{...A,'content-type':'text/html'},body:'x'})).status,415);
   const audio=Buffer.from('fake-opus-audio-bytes');
   const saved=await fetch(base+'/api/recordings/18',{method:'PUT',headers:{...A,'content-type':'audio/webm'},body:audio});assert.equal(saved.status,200);
   assert.deepEqual(fs.readFileSync(dir+'/surah-018.webm'),audio);
   const index=await (await fetch(base+'/recordings/index.json')).json();assert.equal(index.surahs['18'].file,'surah-018.webm');
   const part=await fetch(base+'/recordings/surah-018.webm',{headers:{range:'bytes=0-3'}});assert.equal(part.status,206);assert.equal(await part.text(),'fake');
   assert.equal((await fetch(base+'/recordings/.login.json')).status,404);assert.equal((await fetch(base+'/recordings/../server.cjs')).status,404);assert.equal((await fetch(base+'/Taskeeeel/.login.json')).status,404);
   assert.equal((await fetch(base+'/api/recordings/18',{method:'DELETE',headers:A})).status,200);assert.equal(fs.existsSync(dir+'/surah-018.webm'),false);
   await fetch(base+'/api/recordings/logout',{method:'POST',headers:A});assert.equal((await fetch(base+'/api/recordings/2',{method:'DELETE',headers:A})).status,401);
  }finally{server.close();}
 }finally{delete process.env.RECORDINGS_DIR;fs.rmSync(dir,{recursive:true,force:true});}
});
test('surah recordings: the phone gets a device key, sends any common audio file, and only home-network addresses count as local',async()=>{
 const R=require('./recordings.cjs');
 for(const a of ['192.168.1.20','::ffff:10.0.0.5','172.20.3.4'])assert.ok(R.HOME_NETWORK.test(a),a);
 for(const a of ['8.8.8.8','172.32.0.1','::ffff:100.64.0.1'])assert.ok(!R.HOME_NETWORK.test(a),a);
 const dir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'rec-'));process.env.RECORDINGS_DIR=dir;
 try{
  fs.writeFileSync(dir+'/.login.json',JSON.stringify({user:'moh',...R.hashPassword('moh')}));
  const server=require('./server.cjs').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,H={'x-recorder':'1'};
  try{
   const login=await (await fetch(base+'/api/recordings/login',{method:'POST',headers:{...H,'content-type':'application/json'},body:JSON.stringify({user:'moh',password:'moh',device:true})})).json();
   assert.match(login.token,/^[a-f0-9]{48}$/);assert.ok(!fs.readFileSync(dir+'/.devices.json','utf8').includes(login.token));
   const A={...H,authorization:'Bearer '+login.token};
   const mp3=await fetch(base+'/api/recordings/2',{method:'PUT',headers:{...A,'content-type':'application/octet-stream','x-file-ext':'mp3'},body:Buffer.from('ID3')});assert.equal(mp3.status,200);assert.equal((await mp3.json()).file,'surah-002.mp3');
   const amr=await fetch(base+'/api/recordings/2',{method:'PUT',headers:{...A,'content-type':'audio/amr','x-duration':'125.4'},body:Buffer.from('#!AMR')});const amrSaved=await amr.json();assert.equal(amrSaved.file,'surah-002.amr');assert.equal(amrSaved.seconds,125);assert.equal(fs.existsSync(dir+'/surah-002.mp3'),false);
   assert.equal((await fetch(base+'/recordings/surah-002.amr')).headers.get('content-type'),'audio/amr');
   assert.equal((await fetch(base+'/api/recordings/3',{method:'PUT',headers:{...A,'content-type':'application/octet-stream','x-file-ext':'exe'},body:'MZ'})).status,415);
   assert.equal((await fetch(base+'/api/recordings/3',{method:'PUT',headers:{...H,authorization:'Bearer '+'0'.repeat(48),'content-type':'audio/mpeg'},body:'x'})).status,401);
   await fetch(base+'/api/recordings/logout',{method:'POST',headers:A});
   assert.equal((await fetch(base+'/api/recordings/2',{method:'DELETE',headers:A})).status,401);
  }finally{server.close();}
 }finally{delete process.env.RECORDINGS_DIR;fs.rmSync(dir,{recursive:true,force:true});}
});
test('surah recordings: home Wi-Fi sign-in needs the pairing code shown on the computer, and wrong tries lock out',async()=>{
 const R=require('./recordings.cjs');assert.equal(R.PAIR_CODE,'');assert.equal(R.needsPairCode('127.0.0.1'),false);assert.equal(R.needsPairCode('192.168.1.5'),true);
 const lan=Object.values(require('node:os').networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal&&R.HOME_NETWORK.test(n.address));
 if(!lan)return; // no home-network address on this machine: the HTTP part cannot run here
 const dir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'rec-'));fs.writeFileSync(dir+'/.login.json',JSON.stringify({user:'moh',...R.hashPassword('moh')}));
 const port=String(18700+Math.floor(Math.random()*800));
 const child=require('node:child_process').spawn(process.execPath,['server.cjs'],{env:{...process.env,HOST:'0.0.0.0',PORT:port,RECORD_LAN:'1',RECORDINGS_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{
  let out='';const ready=await new Promise((ok,fail)=>{child.stdout.on('data',d=>{out+=d;const code=/:\s+(\d{6})\s/.exec(out);if(out.includes('0.0.0.0:'+port)&&code)ok({port,code:code[1]});});setTimeout(()=>fail(Error('server did not start: '+out)),15000);});
  const url='http://'+lan.address+':'+ready.port+'/api/recordings/login',H={'x-recorder':'1','content-type':'application/json'};
  const tryLogin=body=>fetch(url,{method:'POST',headers:H,body:JSON.stringify({user:'moh',password:'moh',device:true,...body})});
  assert.equal((await tryLogin({})).status,401);
  const wrong=await tryLogin({code:'000000'});assert.equal(wrong.status,401);assert.equal((await wrong.json()).error,'pair_code');
  const ok=await tryLogin({code:ready.code});assert.equal(ok.status,200);assert.match((await ok.json()).token,/^[a-f0-9]{48}$/);
  for(let i=0;i<3;i++)await tryLogin({password:'no',code:ready.code});
  // two wrong codes and three wrong passwords make five wrong tries within a minute, so the next one is refused
  assert.equal((await tryLogin({password:'no',code:ready.code})).status,429);
 }finally{child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
test('surah recordings online: the website signs in with user and password, and commits each recording to GitHub',async()=>{
 // A small stand-in for the GitHub API: one branch whose recordings/ folder changes with each commit.
 let head='c0',n=0;const commits={c0:{tree:'t0',files:{}}},blobs={},trees={t0:{}};
 const gh=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null,u=new URL(req.url,'http://x'),p=u.pathname,out=(code,v)=>{res.writeHead(code,{'content-type':'application/json'});res.end(typeof v==='string'?v:JSON.stringify(v));};
  assert.equal(req.headers.authorization,'Bearer test-token');
  if(p==='/user')return out(200,{login:'owner',id:7});
  if(p.endsWith('/git/ref/heads/main'))return out(200,{object:{sha:head}});
  if(p.endsWith('/contents/recordings')){const names=Object.keys(commits[u.searchParams.get('ref')].files);return names.length?out(200,names.map(name=>({name}))):out(404,{});}
  if(p.endsWith('/contents/recordings/index.json')){const f=commits[u.searchParams.get('ref')].files['index.json'];return f?out(200,f):out(404,{});}
  if(/\/git\/commits\/c\d+$/.test(p))return out(200,{tree:{sha:commits[p.split('/').pop()].tree}});
  if(p.endsWith('/git/blobs')){const sha='b'+(++n);blobs[sha]=Buffer.from(body.content,'base64').toString();return out(201,{sha});}
  if(p.endsWith('/git/trees')){const next={...trees[body.base_tree]};for(const e of body.tree){const name=e.path.replace('recordings/','');if(e.sha===null)delete next[name];else next[name]=e.content??blobs[e.sha];}const sha='t'+(++n);trees[sha]=next;return out(201,{sha});}
  if(p.endsWith('/git/commits')){assert.match(body.message,/\[skip render\]/);assert.equal(body.author.email,'7+owner@users.noreply.github.com');const sha='c'+(++n);commits[sha]={tree:body.tree,files:trees[body.tree]};return out(201,{sha});}
  if(p.endsWith('/git/refs/heads/main')){head=body.sha;return out(200,{});}
  out(404,{});
 });
 await new Promise(r=>gh.listen(0,'127.0.0.1',r));
 const R=require('./recordings.cjs'),env={RENDER:'true',GITHUB_TOKEN:'test-token',GITHUB_API:'http://127.0.0.1:'+gh.address().port,RECORDER_LOGIN:JSON.stringify({user:'moh',...R.hashPassword('long-enough-pass')})};
 Object.assign(process.env,env);
 const server=require('./server.cjs').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,H={'x-recorder':'1','content-type':'application/json','x-forwarded-for':'203.0.113.9'};
 try{
  const status=await (await fetch(base+'/api/recordings/status')).json();assert.equal(status.online,true);assert.equal(status.local,false);assert.equal(status.code,false);assert.equal(status.max,50*1024*1024);
  assert.equal((await fetch(base+'/api/recordings/1',{method:'PUT',headers:{'x-recorder':'1','content-type':'audio/mpeg'},body:'x'})).status,401);
  assert.equal((await fetch(base+'/api/recordings/login',{method:'POST',headers:H,body:JSON.stringify({user:'moh',password:'wrong'})})).status,401);
  const ok=await fetch(base+'/api/recordings/login',{method:'POST',headers:H,body:JSON.stringify({user:'moh',password:'long-enough-pass'})});assert.equal(ok.status,200);
  assert.match(ok.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);const cookie=ok.headers.get('set-cookie').split(';')[0],A={'x-recorder':'1',cookie};
  assert.equal((await fetch(base+'/api/recordings/1',{method:'PUT',headers:{'x-recorder':'1',cookie:'rec=9999999999999.'+'0'.repeat(64),'content-type':'audio/mpeg'},body:'x'})).status,401);
  const saved=await fetch(base+'/api/recordings/36',{method:'PUT',headers:{...A,'content-type':'application/octet-stream','x-file-ext':'m4a','x-duration':'61'},body:Buffer.from('m4a-audio')});
  assert.equal(saved.status,200);const entry=await saved.json();assert.equal(entry.file,'surah-036.m4a');assert.equal(entry.seconds,61);
  assert.equal(commits[head].files['surah-036.m4a'],'m4a-audio');assert.equal(JSON.parse(commits[head].files['index.json']).surahs['36'].file,'surah-036.m4a');
  // a new take in another format replaces the old file in the same commit
  assert.equal((await fetch(base+'/api/recordings/36',{method:'PUT',headers:{...A,'content-type':'audio/mpeg'},body:'mp3-audio'})).status,200);
  assert.deepEqual(Object.keys(commits[head].files).sort(),['index.json','surah-036.mp3']);
  assert.equal((await (await fetch(base+'/recordings/index.json')).json()).surahs['36'].file,'surah-036.mp3');
  const audio=await fetch(base+'/recordings/surah-036.mp3',{redirect:'manual'});assert.equal(audio.status,302);assert.equal(audio.headers.get('location'),`https://raw.githubusercontent.com/adelaziz2026/telawa-exame/${head}/recordings/surah-036.mp3`);
  assert.equal((await fetch(base+'/recordings/surah-001.mp3',{redirect:'manual'})).status,404);
  assert.equal((await fetch(base+'/api/recordings/publish',{method:'POST',headers:A})).status,200);
  assert.equal((await fetch(base+'/api/recordings/36',{method:'DELETE',headers:A})).status,200);assert.deepEqual(Object.keys(commits[head].files),['index.json']);
 }finally{server.close();gh.close();for(const k of Object.keys(env))delete process.env[k];}
});
test('publishing from the computer keeps recordings saved on the website, but not ones deleted here',()=>{
 const os=require('node:os'),path=require('node:path'),{pullFromSite}=require('./publish-recordings.cjs');
 const site=fs.mkdtempSync(path.join(os.tmpdir(),'site-')),pc=fs.mkdtempSync(path.join(os.tmpdir(),'pc-')),synced=path.join(pc,'.synced');
 try{
  const day=t=>new Date(Date.UTC(2026,10,t)).toISOString();
  fs.writeFileSync(path.join(site,'index.json'),JSON.stringify({surahs:{1:{file:'surah-001.mp3',updated:day(20)},2:{file:'surah-002.m4a',updated:day(5)},3:{file:'surah-003.webm',updated:day(21)}}}));
  for(const f of ['surah-001.mp3','surah-002.m4a','surah-003.webm'])fs.writeFileSync(path.join(site,f),'site '+f);
  fs.writeFileSync(path.join(pc,'index.json'),JSON.stringify({surahs:{3:{file:'surah-003.ogg',updated:day(10)}}}));fs.writeFileSync(path.join(pc,'surah-003.ogg'),'old');
  fs.writeFileSync(synced,String(Date.parse(day(15))));
  assert.equal(pullFromSite(site,pc,synced),2);
  const idx=JSON.parse(fs.readFileSync(path.join(pc,'index.json'),'utf8')).surahs;
  assert.equal(idx[1].file,'surah-001.mp3');assert.equal(idx[2],undefined);assert.equal(idx[3].file,'surah-003.webm');
  assert.equal(fs.existsSync(path.join(pc,'surah-003.ogg')),false);assert.equal(fs.readFileSync(path.join(pc,'surah-001.mp3'),'utf8'),'site surah-001.mp3');
  assert.equal(pullFromSite(site,pc,synced),0);
 }finally{fs.rmSync(site,{recursive:true,force:true});fs.rmSync(pc,{recursive:true,force:true});}
});
test('memorising: each ayah repeats, the passage repeats, and a pause can follow each ayah',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});
 const q=h.ctx.buildQueue(2,[1,2],2,3);
 assert.equal(q.length,12);assert.equal(JSON.stringify(q.slice(0,4).map(x=>x.ayah)),'[1,1,1,2]');assert.equal(JSON.stringify([q[6].round,q[6].ayah,q[6].turn]),'[2,1,1]');
 assert.equal(h.ctx.gapSeconds('0',4),0);assert.equal(h.ctx.gapSeconds('5',4),5);assert.equal(h.ctx.gapSeconds('same',4.2),4.2);assert.equal(h.ctx.gapSeconds('same',500),60);
});
test('navigation: a Mushaf page or juz opens its ayat, and the assistant understands it',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});h.ctx.QuranKnowledge=require('./knowledge.js');
 assert.match(h.ctx.openPage(1),/الصفحة 1: .*من الآية 1 إلى 7\.$/);assert.equal(h.el('surah').value,1);assert.equal(String(h.el('ayahEnd').value),'7');
 const last=h.ctx.openPage(604);assert.match(last,/الصفحة 604: .*من الآية 1 إلى 4\. وتكمل الصفحة في /);assert.equal(h.el('surah').value,112);
 assert.match(h.ctx.openJuz(30),/^فتحتلك أول الجزء 30، الصفحة 582: /);assert.equal(h.el('surah').value,78);
 assert.equal(h.ctx.openPage(0),'');assert.equal(h.ctx.openPage(605),'');assert.equal(h.ctx.openJuz(31),'');
 const spoken=assistantHarness(h,[]),say=async x=>{await h.ctx.TarteelAssistant.ask(x);return spoken.at(-1).text;};
 assert.match(await say('افتح صفحة 50'),/^فتحتلك الصفحة 50: /);
 assert.match(await say('افتح جزء عم'),/^فتحتلك أول الجزء 30/);
 assert.match(await say('الجزء 2'),/^فتحتلك أول الجزء 2، الصفحة 22: /);
 assert.match(await say('صفحة 900'),/604 صفحة/);
});
test('a repeated word or phrase is not counted as a mistake, but a different extra word is',()=>{
 const C=require('./compare.js'),types=(e,h)=>C.compare(e,h).map(i=>i.type),count=(list,t)=>list.filter(x=>x===t).length;
 const back=types('الحمد لله رب العالمين','الحمد لله الحمد لله رب العالمين');assert.equal(count(back,'repeated'),2);assert.equal(count(back,'correct'),4);assert.equal(count(back,'extra'),0);
 const stutter=types('الحمد لله رب العالمين','الحمد لله رب رب العالمين');assert.equal(count(stutter,'repeated'),1);assert.equal(count(stutter,'extra'),0);
 const restart=types('قل هو الله احد الله الصمد','قل هو الله قل هو الله احد الله الصمد');assert.equal(count(restart,'repeated'),3);assert.equal(count(restart,'correct'),6);
 assert.deepEqual(types('الحمد لله','الحمد لله كثيرا'),['correct','correct','extra']);
 assert.equal(C.explain({type:'repeated',spoken:'لله'}),'');
});
test('server compresses the Quran data and revalidates it with ETags',()=>withServer(async request=>{
 const gz=await request('/data/simple.json',{headers:{'accept-encoding':'gzip'}});
 assert.equal(gz.status,200);assert.equal(gz.headers['content-encoding'],'gzip');assert.match(gz.headers['cache-control'],/max-age/);
 const raw=require('node:zlib').gunzipSync(gz.body);assert.equal(JSON.parse(raw).data.surahs.length,114);assert.ok(gz.body.length<raw.length/3);
 const br=await request('/data/simple.json',{headers:{'accept-encoding':'gzip, br'}});assert.equal(br.headers['content-encoding'],'br');
 const again=await request('/data/simple.json',{headers:{'if-none-match':gz.headers.etag}});assert.equal(again.status,304);assert.equal(again.body.length,0);
 const page=await request('/');assert.equal(page.status,200);assert.equal(page.headers['cache-control'],'no-cache');assert.match(page.headers['content-type'],/text\/html/);
}));
test('server sends security headers that still allow the on-device model',()=>withServer(async request=>{
 const {headers}=await request('/index.html');const csp=headers['content-security-policy'];
 for(const part of ["script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'","connect-src 'self' https:","worker-src 'self' blob:","frame-ancestors 'none'"])assert.ok(csp.includes(part),part);
 assert.match(headers['permissions-policy'],/microphone=\(self\)/);assert.equal(headers['x-content-type-options'],'nosniff');assert.ok(headers['referrer-policy']);
}));
test('server rejects traversal, hidden files, other methods, and answers HEAD and health',()=>withServer(async request=>{
 for(const p of ['/../package.json','/%2e%2e/server.cjs','/server.cjs','/package.json','/.claude/launch.json','/node_modules/x.js','/missing.js'])assert.equal((await request(p)).status,404,p);
 const post=await request('/',{method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.allow,'GET, HEAD');
 const head=await request('/app.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.ok(Number(head.headers['content-length'])>0);
 const health=await request('/api/health');assert.equal(JSON.parse(health.body).status,'ok');
}));
test('progress panel counts reviews, today and the day streak, and lists weak ayat',async()=>{
 const h=await appHarness();h.el('transcript').value='الحمد';h.el('review').onclick();
 assert.equal(String(h.el('statAyat').textContent),'1');assert.equal(h.el('statAvg').textContent,'50٪');assert.equal(String(h.el('statToday').textContent),'1');assert.equal(String(h.el('statStreak').textContent),'1');
 assert.equal(h.el('weakList').children.length,1);assert.equal(h.el('weakEmpty').hidden,true);
 const D=864e5,now=Date.UTC(2026,10,10,12),key=t=>new Date(t).toLocaleDateString('en-CA');h.ctx.now=now;
 h.ctx.log={[key(now)]:2,[key(now-D)]:1,[key(now-2*D)]:4,[key(now-4*D)]:1};assert.equal(vm.runInNewContext('streak(log,now)',h.ctx),3);
 h.ctx.log={[key(now-D)]:1,[key(now-2*D)]:1};assert.equal(vm.runInNewContext('streak(log,now)',h.ctx),2);
 h.ctx.log={[key(now-3*D)]:1};assert.equal(vm.runInNewContext('streak(log,now)',h.ctx),0);
});
test('offline banner follows the connection state',async()=>{
 const h=await appHarness({navigator:{onLine:false}});assert.equal(h.el('offline').hidden,false);
 h.ctx.navigator.onLine=true;h.ctx.window.ononline();assert.equal(h.el('offline').hidden,true);
});
const rangeData={data:{surahs:Array.from({length:114},(_,i)=>({number:i+1,name:'سورة',ayahs:i?[{number:i+10,numberInSurah:1,text:'قل'}]:[{number:1,numberInSurah:1,text:'الحمد لله'},{number:2,numberInSurah:2,text:'رب العالمين'},{number:3,numberInSurah:3,text:'الرحمن الرحيم'}]}))}};
test('a range of ayat is shown, reviewed as one passage, and scored per ayah',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData})});
 h.el('ayahEnd').value='3';h.el('ayahEnd').onchange();assert.match(h.el('verse').textContent,/﴿٢﴾/);assert.match(h.el('verse').textContent,/الرحمن الرحيم ﴿٣﴾/);
 h.el('transcript').value='الحمد لله رب الرحمن الرحيم';h.el('review').onclick();
 assert.equal(h.el('resultLabel').textContent,'موضع واحد للمراجعة · 83٪');
 assert.deepEqual(JSON.parse(vm.runInNewContext('JSON.stringify(scores)',h.ctx)),{'1:1':100,'1:2':50,'1:3':100});
 assert.equal(h.el('result').children.filter(c=>c.className==='ayah-sep').length,3);
 assert.equal(String(h.el('statAyat').textContent),'3');
});
test('hints reveal first letters, then whole words, while the ayah is hidden',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData})});
 h.el('hide').checked=true;h.el('hide').onchange();assert.equal(h.el('verse').textContent,'الآية مخفية — اقرأ من حفظك');assert.equal(h.el('hint').hidden,false);
 h.el('hint').onclick();assert.equal(h.el('verse').textContent,'الح… ل…');
 h.el('hint').onclick();assert.equal(h.el('verse').textContent,'الحمد ل…');
 h.el('hint').onclick();assert.equal(h.el('verse').textContent,'الحمد لله');assert.equal(h.el('hint').hidden,true);
});
test('text colours meet WCAG AA contrast in light and dark themes',()=>{
 const css=fs.readFileSync('./style.css','utf8');
 const block=sel=>{const i=css.indexOf(sel);return css.slice(i,css.indexOf('}',i));};
 const vars=text=>Object.fromEntries([...text.matchAll(/--([\w-]+):(#[0-9a-f]{6}|#fff)\b/gi)].map(m=>[m[1],m[2]==='#fff'?'#ffffff':m[2]]));
 const lum=h=>{const c=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
 for(const theme of [vars(block(':root{')),vars(block(':root[data-theme="dark"]{'))])for(const fg of ['ink','muted','gold-text','accent'])for(const bg of ['bg','surface','surface-2','soft'])assert.ok(ratio(theme[fg],theme[bg])>=4.5,`${fg} on ${bg}: ${ratio(theme[fg],theme[bg]).toFixed(2)}`);
});
test('server answers 304 for weak and listed ETags',()=>withServer(async request=>{
 const {headers}=await request('/style.css');
 assert.equal((await request('/style.css',{headers:{'if-none-match':`"x", W/${headers.etag}`}})).status,304);
}));
const namedData={data:{surahs:Array.from({length:114},(_,i)=>({number:i+1,name:i===17?'سُورَةُ ٱلْكَهْفِ':i===0?'سُورَةُ ٱلْفَاتِحَةِ':'سُورَةُ رقم',ayahs:[{number:i+1,numberInSurah:1,text:'الحمد لله'}]}))}};
test('surah search finds by name without diacritics or by number in either digit style',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>namedData})});
 for(const [q,n] of [['18',18],['١٨',18],['الكهف',18],['سورة الكهف',18],['الفاتح',1],['xyz',null]])assert.equal(vm.runInNewContext(`findSurah(${JSON.stringify(q)})`,h.ctx),n,q);
 h.el('surahSearch').value='الكهف';h.el('surahSearch').onchange();assert.equal(String(h.el('surah').value),'18');assert.match(h.el('toast').textContent,/انتقلت إلى/);
});
test('a failed load offers retry',async()=>{
 const f=await appHarness({fetch:async()=>({ok:false})});assert.equal(f.el('retry').hidden,false);assert.match(f.el('verse').textContent,/أعد المحاولة/);
});
test('listening plays the selection the chosen number of times',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData})});
 const played=[];h.el('audio').play=async()=>{played.push(h.el('audio').src.slice(-10,-4));};
 h.el('ayahEnd').value='2';h.el('ayahEnd').onchange();h.el('repeat').value='3';
 await h.el('listen').onclick();for(let i=0;i<6;i++)await h.el('audio').onended();
 assert.deepEqual(played,['001001','001002','001001','001002','001001','001002']);assert.equal(h.el('audioStatus').textContent,'انتهى الاستماع.');
});
test('every reciter streams from everyayah.com by surah and ayah number',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData})});
 const played=[];h.el('audio').play=async()=>{played.push(h.el('audio').src);};
 h.el('ayahEnd').value='3';h.el('ayahEnd').onchange();
 for(const [id,dir] of [['minshawi_teacher','Minshawy_Teacher_128kbps'],['husary','Husary_128kbps'],['husary_mujawwad','Husary_128kbps_Mujawwad'],['husary_teacher','Husary_Muallim_128kbps'],['jibreel','Muhammad_Jibreel_128kbps'],['abdulbasit','Abdul_Basit_Murattal_192kbps'],['abdulbasit_mujawwad','Abdul_Basit_Mujawwad_128kbps'],['banna','mahmoud_ali_al_banna_32kbps'],['tablawi','Mohammad_al_Tablaway_128kbps'],['shatri','Abu_Bakr_Ash-Shaatree_128kbps'],['hudhaify','Hudhaify_128kbps'],['shuraym','Saood_ash-Shuraym_128kbps']]){
  played.length=0;h.el('reciter').value=id;h.el('reciter').onchange();await h.el('listen').onclick();await h.el('audio').onended();await h.el('audio').onended();
  assert.deepEqual(played,['001001','001002','001003'].map(f=>`https://everyayah.com/data/${dir}/${f}.mp3`),id);
 }
 assert.match(h.el('audioStatus').textContent,/سعود الشريم/);
});
test('a missing ayah file skips to the next ayah instead of stopping the passage',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData})});
 const played=[];h.el('audio').play=async()=>{const f=h.el('audio').src.slice(-10,-4);if(f==='001002')throw Error('404');played.push(f);};
 h.el('ayahEnd').value='3';h.el('ayahEnd').onchange();h.el('reciter').value='husary';
 await h.el('listen').onclick();assert.deepEqual(played,['001001']);
 await h.el('audio').onended();assert.match(h.el('audioStatus').textContent,/تعذّر تحميل الآية 2 بصوت الحصري مرتّل — ننتقل إلى التالية/);
 h.flush();await new Promise(r=>setImmediate(r));assert.deepEqual(played,['001001','001003']);assert.match(h.el('audioStatus').textContent,/3 من 3/);
});
test('playback stops with a clear message when offline',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData}),navigator:{onLine:false}});
 h.el('audio').play=async()=>{throw Error('network');};h.el('ayahEnd').value='3';h.el('ayahEnd').onchange();
 await h.el('listen').onclick();assert.match(h.el('audioStatus').textContent,/تحقق من الإنترنت/);assert.equal(h.el('audio').onended,null);
});
test('a start-up failure shows a repair button instead of loading forever',async()=>{
 const h=await appHarness({fetch:()=>new Promise(()=>{})});
 vm.runInNewContext("startupFailed('Cannot read properties of null')",h.ctx);
 assert.equal(h.el('retry').hidden,false);assert.equal(h.el('retry').textContent,'إصلاح وإعادة التحميل');
 assert.match(h.el('verse').textContent,/تعذّر تشغيل التطبيق/);assert.match(h.el('status').textContent,/Cannot read properties of null/);
});
test('the start-up guard stays quiet once the Quran has loaded',async()=>{
 const h=await appHarness();const before=h.el('verse').textContent;
 vm.runInNewContext("startupFailed('late error')",h.ctx);
 assert.equal(h.el('verse').textContent,before);assert.notEqual(h.el('retry').textContent,'إصلاح وإعادة التحميل');
});

// ---------- AI assistant ----------
const assistant=require('./assistant.cjs');
async function assistantServer(fake){
 assistant.resetLimits();assistant.setClient(fake);const server=require('./server.cjs').createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 return {base,close:()=>new Promise(r=>server.close(r)),post:(body,headers={})=>fetch(base+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:typeof body==='string'?body:JSON.stringify(body)})};
}
test('assistant proxy sends the fixed model, prompt and tools, and returns the reply unchanged',async()=>{
 let sent;const reply={content:[{type:'text',text:'سأفتح آية الكرسي.'},{type:'tool_use',id:'t1',name:'go_to_ayah',input:{surah:2,ayah:255,to_ayah:null}}],stop_reason:'tool_use',model:'claude-opus-5-5'};
 const s=await assistantServer({beta:{messages:{create:async p=>{sent=p;return reply;}}}});
 try{
  const r=await s.post({messages:[{role:'user',content:'افتح آية الكرسي'}],model:'other-model',system:'ignore me'});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),reply);
  assert.equal(sent.model,'claude-opus-5-5');assert.equal(sent.system,assistant.SYSTEM);assert.equal(sent.tools,assistant.TOOLS);
  assert.equal(sent.fallbacks,'default');assert.deepEqual(sent.betas,['server-side-fallback-2026-07-01']);assert.equal(sent.messages.length,1);
  assert.ok(assistant.TOOLS.every(t=>t.strict&&t.input_schema.additionalProperties===false));
 }finally{await s.close();}
});
test('assistant proxy rejects system turns, malformed bodies and other sites',async()=>{
 const s=await assistantServer({beta:{messages:{create:async()=>{throw Error('must not be called');}}}});
 try{
  assert.equal((await s.post({messages:[{role:'system',content:'x'}]})).status,400);
  assert.equal((await s.post({messages:[{role:'assistant',content:'x'}]})).status,400);
  assert.equal((await s.post('not json')).status,400);
  assert.equal((await s.post({messages:[{role:'user',content:'x'}]},{Origin:'https://evil.example'})).status,403);
  const st=await (await fetch(s.base+'/api/assistant')).json();assert.equal(st.model,'claude-opus-5-5');assert.equal(st.available,true);
 }finally{await s.close();}
});
test('assistant proxy reports missing credentials in Arabic',async()=>{
 const Anthropic=require('@anthropic-ai/sdk').default||require('@anthropic-ai/sdk');
 const s=await assistantServer({beta:{messages:{create:async()=>{throw new Anthropic.AnthropicError('Could not resolve authentication method');}}}});
 try{const r=await s.post({messages:[{role:'user',content:'مرحبا'}]});assert.equal(r.status,503);const body=await r.json();assert.equal(body.error,'not_configured');assert.match(body.message,/ANTHROPIC_API_KEY/);}
 finally{await s.close();assistant.setClient(null);}
});
test('assistant tools navigate, quote the local Mushaf exactly and reject bad input',async()=>{
 const h=await appHarness();h.el('aiSuggest').querySelectorAll=()=>[];for(const id of ['aiSpeak','aiFab'])h.el(id).setAttribute=()=>{};h.ctx.document.querySelectorAll=()=>[];
 vm.runInNewContext(fs.readFileSync(require.resolve('./assistant.js'),'utf8'),h.ctx);
 const t=h.ctx.TarteelAssistant.tools;
 assert.deepEqual(JSON.parse(JSON.stringify(t.get_ayah_text({surah:1,ayah:1,to_ayah:null}))),{surah:'سورة',ayat:[{ayah:1,text:'الحمد لله'}]});
 t.go_to_ayah({surah:2,ayah:1,to_ayah:null});assert.equal(String(h.el('surah').value),'2');
 assert.throws(()=>t.go_to_ayah({surah:200,ayah:1,to_ayah:null}),/1-114/);
 assert.throws(()=>t.get_ayah_text({surah:1,ayah:9,to_ayah:null}),/has 1 ayat/);
 assert.throws(()=>t.play_recitation({reciter:'nobody',repeat:null}),/Unknown reciter/);
 const p=t.get_progress();assert.equal(p.ayat_reviewed,0);assert.deepEqual(JSON.parse(JSON.stringify(p.weakest)),[]);
});
test('assistant local mode works without Claude: navigation, ranges, and a greeting never plays audio',async()=>{
 const h=await appHarness();h.el('aiSuggest').querySelectorAll=()=>[];h.ctx.document.querySelectorAll=()=>[];for(const id of ['aiSpeak','aiFab'])h.el(id).setAttribute=()=>{};
 let played=0;h.el('listen').click=()=>{played++;};
 vm.runInNewContext(fs.readFileSync(require.resolve('./assistant.js'),'utf8'),h.ctx);
 // The harness server has no assistant route, so the panel falls back to local mode.
 h.ctx.fetch=async()=>({ok:false,json:async()=>({})});
 await h.ctx.TarteelAssistant.ask('السلام عليكم');assert.equal(played,0);
 await h.ctx.TarteelAssistant.ask('افتح سورة 7');assert.equal(String(h.el('surah').value),'7');
 await h.ctx.TarteelAssistant.ask('شغل سورة 3');assert.equal(played,1);assert.equal(String(h.el('surah').value),'3');
 assert.equal(h.ctx.TarteelAssistant.history.length,0);
});

// ---------- Meeting rooms ----------
async function meetServer(){
 const server=require('./server.cjs').createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,headers={})=>fetch(`${base}/api/meet/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 // Opens a participant's event stream and collects its messages.
 const listen=async who=>{
  const res=await fetch(`${base}/api/meet/events?room=${who.room}&peer=${who.peer}&token=${who.token}`);
  const got=[],reader=res.body.getReader(),dec=new TextDecoder();let buf='',closed=false;
  (async()=>{try{for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value);let i;while((i=buf.indexOf('\n\n'))>=0){const line=buf.slice(0,i);buf=buf.slice(i+2);if(line.startsWith('data: '))got.push(JSON.parse(line.slice(6)));}}}catch{}})();
  return {got,status:res.status,close:()=>{closed=true;reader.cancel().catch(()=>{});}};
 };
 const wait=(cond,ms=2000)=>new Promise((resolve,reject)=>{const t0=Date.now();const tick=()=>cond()?resolve():Date.now()-t0>ms?reject(Error('timeout')):setTimeout(tick,20);tick();});
 return {base,post,listen,wait,close:()=>{server.closeAllConnections?.();return new Promise(r=>server.close(r));}};
}
test('meeting: participants meet, relay signals privately, and share chat and board with late joiners',async()=>{
 const s=await meetServer();
 try{
  const a={...(await (await s.post('join',{room:'test-room',name:'أحمد'})).json()),room:'test-room'};
  assert.deepEqual(a.peers,[]);
  const ea=await s.listen(a);assert.equal(ea.status,200);
  const b={...(await (await s.post('join',{room:'test-room',name:'سارة'})).json()),room:'test-room'};
  assert.equal(b.peers[0].name,'أحمد');
  await s.wait(()=>ea.got.some(m=>m.type==='join'&&m.peer.name==='سارة'));
  const eb=await s.listen(b);
  const send=(who,body)=>s.post('send',{room:who.room,peer:who.peer,token:who.token,...body});
  assert.equal((await send(b,{type:'signal',to:a.peer,data:{description:{type:'offer',sdp:'x'}}})).status,200);
  await s.wait(()=>ea.got.some(m=>m.type==='signal'&&m.from===b.peer&&m.data.description.type==='offer'));
  assert.ok(!eb.got.some(m=>m.type==='signal'),'a signal goes only to its target');
  await send(a,{type:'chat',text:'السلام عليكم'});
  await send(a,{type:'board',op:{op:'item',item:{id:'s1',tool:'pen',points:[[0.1,0.1]]}}});
  await s.wait(()=>eb.got.some(m=>m.type==='chat')&&eb.got.some(m=>m.type==='board'));
  await send(b,{type:'state',state:{mic:false,cam:true,hand:true,screen:false}});
  await s.wait(()=>ea.got.some(m=>m.type==='state'&&m.state.hand===true));
  // A late joiner receives the chat and the board so far.
  const c=await (await s.post('join',{room:'test-room',name:'ضيف'})).json();
  assert.equal(c.chat[0].text,'السلام عليكم');assert.equal(c.board[0].id,'s1');assert.equal(c.peers.length,2);
  // Leaving (closing the stream) tells the others.
  eb.close();await s.wait(()=>ea.got.some(m=>m.type==='leave'&&m.from===b.peer));
  ea.close();
 }finally{await s.close();}
});
test('meeting: rejects bad rooms, impostors, other sites, and a ninth participant',async()=>{
 const s=await meetServer();
 try{
  assert.equal((await s.post('join',{room:'Bad Room!',name:'x'})).status,400);
  const a=await (await s.post('join',{room:'full-room',name:'a'})).json();
  assert.equal((await s.post('send',{room:'full-room',peer:a.peer,token:'wrong',type:'chat',text:'x'})).status,403);
  assert.equal((await fetch(`${s.base}/api/meet/events?room=full-room&peer=${a.peer}&token=wrong`)).status,403);
  assert.equal((await s.post('join',{room:'other',name:'x'},{Origin:'https://evil.example'})).status,403);
  for(let i=1;i<8;i++)assert.equal((await s.post('join',{room:'full-room',name:'p'+i})).status,200);
  const ninth=await s.post('join',{room:'full-room',name:'p9'});assert.equal(ninth.status,409);assert.equal((await ninth.json()).error,'room_full');
 }finally{require('./meeting.cjs').rooms.clear();await s.close();}
});
test('meeting: a message sent before the recipient opens its stream is held and delivered (no lost call offers)',async()=>{
 const s=await meetServer();
 try{
  const a={...(await (await s.post('join',{room:'early-room',name:'a'})).json()),room:'early-room'};
  const b={...(await (await s.post('join',{room:'early-room',name:'b'})).json()),room:'early-room'};
  // b sends its offer to a before a has opened its event stream.
  assert.equal((await s.post('send',{room:'early-room',peer:b.peer,token:b.token,type:'signal',to:a.peer,data:{description:{type:'offer',sdp:'early'}}})).status,200);
  const ea=await s.listen(a);
  await s.wait(()=>ea.got.some(m=>m.type==='signal'&&m.data.description.sdp==='early'));
  ea.close();
 }finally{require('./meeting.cjs').rooms.clear();await s.close();}
});
function assistantHarness(h,voices){
 h.el('aiSuggest').querySelectorAll=()=>[];h.ctx.document.querySelectorAll=()=>[];for(const id of ['aiSpeak','aiFab'])h.el(id).setAttribute=()=>{};
 const spoken=[];h.ctx.localStorage={getItem:k=>k==='tarteel:aiSpeak'?'1':null,setItem(){}};
 h.ctx.SpeechSynthesisUtterance=function(text){this.text=text;this.pitch=1;};h.ctx.speechSynthesis={getVoices:()=>voices,speak:u=>spoken.push(u),cancel(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./assistant.js'),'utf8'),h.ctx);h.ctx.fetch=async()=>({ok:false,json:async()=>({})});
 return spoken;
}
test('assistant answers whether a word is in the Quran, and never sends visitors to a README',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});h.ctx.QuranKnowledge=require('./knowledge.js');
 const spoken=assistantHarness(h,[]),say=async q=>{await h.ctx.TarteelAssistant.ask(q);return spoken.at(-1).text;};
 assert.match(await say('هل كلمة سفيه موجودة بالقران'),/^أيوه، «سفيه» موجودة في القرآن: جت في آية واحدة\. وهي: 1\) سورة البقرة 282/);
 assert.match(await say('هل الصبر موجود في القرآن'),/^أيوه، «الصبر» موجودة في القرآن/);
 assert.match(await say('كلمة الكوثر بالمصحف'),/«الكوثر» جت في آية واحدة/);
 assert.match(await say('هل كلمة سفيهون موجودة بالقران'),/مش موجودة بالشكل ده\. جرّب/);
 assert.match(await say('هل كلمة سفي موجودة بالقران'),/مش موجودة بالشكل ده، لكن فيه كلمات قريبة منها \(.*سفيه/);
 assert.doesNotMatch(await say('زززز ططططط قققق'),/README/);
 assert.match(await say('هل كلمة الرحمة موجودة في سورة الكهف'),/^أيوه، «الرحمة» موجودة في سورة الكهف: جت في 5 آيات\. وهي: 1\) سورة الكهف 10/);
 assert.match(await say('سورة الكهف فيها كلمة الرحمة'),/^أيوه، «الرحمة» موجودة في سورة الكهف/);
 assert.match(await say('كلمة الرحمة بسورة الكهف'),/^أيوه، «الرحمة» موجودة في سورة الكهف/);
 assert.match(await say('ابحث عن الرحمة بسورة الكهف'),/^«الرحمة» جت في 5 آيات في سورة الكهف/);
 assert.match(await say('هل كلمة الكوثر موجودة في سورة البقرة'),/«الكوثر» مش موجودة في سورة البقرة/);
 assert.match(await say('في أي سورة وردت كلمة الكوثر'),/^«الكوثر» موجودة في سورة واحدة وآية واحدة: سورة الكوثر \(آية واحدة\)/);
 assert.match(await say('افتح النتيجة 1'),/^فتحتلك سورة الكوثر، الآية 1\.$/);
 assert.match(await say('1'),/^فتحتلك سورة الكوثر، الآية 1\.$/);
 assert.match(await say('١'),/^فتحتلك سورة الكوثر، الآية 1\.$/);
 assert.match(await say('رقم 1'),/^فتحتلك سورة الكوثر، الآية 1\.$/);
 assert.match(await say('الاولى'),/^فتحتلك سورة الكوثر، الآية 1\.$/);
 assert.match(await say('9'),/^عندي 1 نتايج بس\.$/);
 assert.match(await say('ابحث عن كلمة الصبر في كل السور'),/^«الصبر» موجودة في \d+ سورة? ?.*سورة البقرة \(/);
 assert.match(await say('انهي سورة فيها قل اعوذ برب الفلق'),/^دي سورة الفلق، الآية 1/);
 assert.match(await say('سورة الكهف فيها كام آية'),/110/);
});
test('a Quran word never spends a server question, and the free limit hands over to local answers',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});h.ctx.QuranKnowledge=require('./knowledge.js');
 let open=true,calls=0;h.ctx.LocalLLM={supported:()=>false,remoteSupported:()=>false,ready:()=>open,remote:()=>open,broken:()=>false,askRemote:async()=>{calls++;open=false;throw Object.assign(Error('انتهت الأسئلة المجانية'),{friendly:true,quota:true});}};
 const spoken=assistantHarness(h,[]),last=()=>[...h.el('aiLog').children||[]].at(-1)?.textContent;
 for(const q of ['سفينة','سفينة؟']){await h.ctx.TarteelAssistant.ask(q);assert.match(spoken.at(-1).text,/^«سفينة» جت في \d+ آية|^«سفينة» جت في آيتين|^«سفينة» جت في \d+ آيات/);}
 assert.equal(calls,0);
 await h.ctx.TarteelAssistant.ask('ما الحكمة من الصبر؟');assert.equal(calls,1);assert.match(h.el('llmStatus').textContent,/الحد المجاني انتهى/);assert.equal(open,false);
 await h.ctx.TarteelAssistant.ask('ما الحكمة من الصبر؟');assert.equal(calls,1);assert.ok(last!==undefined);
});
test('Hugging Face sign-in uses PKCE, keeps the token off other servers, and can be undone',async()=>{
 const memory=()=>{const m=new Map;return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
 const localStorage=memory(),sessionStorage=memory(),sent=[];let opened='';
 const sse='event: complete\ndata: ["جواب"]\n\n';
 const fetch=async(u,o={})=>{sent.push({u:String(u),o});u=String(u);if(u.endsWith('/oauth/token'))return new Response(JSON.stringify({access_token:'hf_oauth_test',expires_in:3600}));if(u.endsWith('/oauth/userinfo'))return new Response(JSON.stringify({preferred_username:'reader'}));if(u.endsWith('/gradio_api/info'))return new Response('{}');if(u.endsWith('/gradio_api/call/ask'))return new Response(JSON.stringify({event_id:'e1'}));return new Response(sse);};
 const load=(search='')=>{const ctx={navigator:{userAgent:'Desktop'},localStorage,sessionStorage,fetch,setTimeout,clearTimeout,AbortController,AbortSignal,TextDecoder,TextEncoder,URLSearchParams,encodeURIComponent,JSON,btoa,crypto:require('node:crypto').webcrypto,location:{origin:'https://telawa-exame.netlify.app',pathname:'/index.html',search,hash:'',assign:u=>{opened=String(u);}},history:{replaceState(){ctx.cleaned=true;}}};ctx.globalThis=ctx;vm.runInNewContext(fs.readFileSync(require.resolve('./llm.js'),'utf8'),ctx);return ctx;};
 const first=load();assert.equal(first.LocalLLM.signInSupported(),true);await first.LocalLLM.signIn();
 const url=new URL(opened),p=url.searchParams;assert.equal(url.origin+url.pathname,'https://huggingface.co/oauth/authorize');assert.equal(p.get('redirect_uri'),'https://telawa-exame.netlify.app/');assert.equal(p.get('scope'),'openid profile');assert.equal(p.get('code_challenge_method'),'S256');assert.ok(p.get('code_challenge').length>=43);assert.equal(p.has('client_secret'),false);
 await assert.rejects(load('?code=c&state=wrong').LocalLLM.finishSignIn(),e=>e.friendly);
 await first.LocalLLM.signIn();const state=new URL(opened).searchParams.get('state'),back=load('?code=c1&state='+state);
 assert.equal(await back.LocalLLM.finishSignIn(),'reader');assert.equal(back.cleaned,true);assert.equal(back.LocalLLM.hfUser(),'reader');
 const body=new URLSearchParams(String(sent.find(x=>x.u.endsWith('/oauth/token')).o.body));assert.ok(body.get('code_verifier'));assert.equal(body.has('client_secret'),false);
 await back.LocalLLM.askRemote({question:'س'});const calls=sent.filter(x=>x.u.includes('/gradio_api/call/'));assert.equal(calls.length,2);for(const c of calls)assert.equal(c.o.headers.authorization,'Bearer hf_oauth_test');
 localStorage.setItem('tarteel:llmRemoteUrl','https://other.example');sent.length=0;await back.LocalLLM.askRemote({question:'س'});for(const c of sent)assert.equal(c.o.headers?.authorization,undefined);localStorage.removeItem('tarteel:llmRemoteUrl');
 back.LocalLLM.signOut();assert.equal(back.LocalLLM.hfUser(),'');sent.length=0;await back.LocalLLM.askRemote({question:'س'});for(const c of sent)assert.equal(c.o.headers?.authorization,undefined);
});
test('the server is asked only when needed: no sources and repeated questions cost no run',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});h.ctx.QuranKnowledge=require('./knowledge.js');
 const asked=[];h.ctx.LocalLLM={supported:()=>false,remoteSupported:()=>false,ready:()=>true,remote:()=>true,broken:()=>false,askRemote:async q=>{asked.push(q);return 'جواب من المصادر';}};
 const spoken=assistantHarness(h,[]),m=new Map;h.ctx.localStorage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};
 await h.ctx.TarteelAssistant.ask('زززز ططططط قققق؟');assert.equal(asked.length,0);
 await h.ctx.TarteelAssistant.ask('ما الحكمة من ذكر الصبر؟');assert.equal(asked.length,1);assert.doesNotMatch(asked[0].sources,/الآية المفتوحة/);assert.equal(spoken.at(-1).text,'جواب من المصادر');
 await h.ctx.TarteelAssistant.ask('ما الحكمة من ذكر الصبر؟');assert.equal(asked.length,1);assert.equal(spoken.at(-1).text,'جواب من المصادر');
});
test('when GPU runs end the same question is answered by the slower CPU route',async()=>{
 const urls=[],sse=(k,d)=>new Response('event: '+k+'\ndata: '+JSON.stringify(d)+'\n\n');
 const fetch=async(u,o={})=>{u=String(u);urls.push(u);if(u.endsWith('/gradio_api/info'))return new Response('{}');if(o.method==='POST')return new Response(JSON.stringify({event_id:u.endsWith('ask_cpu')?'c':'g'}));return u.includes('/ask_cpu/')?sse('complete',['جواب بطيء']):sse('error',{error:'You have exceeded your ZeroGPU runs limit.'});};
 const ctx={navigator:{userAgent:'Android'},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},fetch,setTimeout,clearTimeout,AbortController,AbortSignal,TextDecoder,TextEncoder,URLSearchParams,encodeURIComponent,JSON};ctx.globalThis=ctx;vm.runInNewContext(fs.readFileSync(require.resolve('./llm.js'),'utf8'),ctx);const L=ctx.LocalLLM;
 await L.enableRemote();const seen=[];assert.equal(await L.askRemote({question:'س'},t=>seen.push(t)),'جواب بطيء');assert.equal(L.lastMode,'cpu');assert.match(seen[0],/وضع أبطأ/);assert.equal(L.ready(),true);
 urls.length=0;assert.equal(await L.askRemote({question:'س'}),'جواب بطيء');assert.equal(urls.some(u=>u.endsWith('/call/ask')),false);
});
test('the sign-in description is served by GitHub Pages and lists every page that signs in',()=>{
 const app=JSON.parse(fs.readFileSync('./oauth-client.json','utf8'));
 assert.match(fs.readFileSync('./llm.js','utf8'),new RegExp("HF_CLIENT='"+app.client_id.replace(/[.]/g,'\\.')+"'"));
 assert.equal(app.client_id,'https://adelaziz2026.github.io/telawa-exame/oauth-client.json');assert.equal(app.token_endpoint_auth_method,'none');
 for(const page of ['https://adelaziz2026.github.io/telawa-exame/','https://telawa-exame.onrender.com/','http://localhost/'])assert.ok(app.redirect_uris.includes(page));
});
test('the phone app signs in with a device code approved in the browser',async()=>{
 const m=new Map,localStorage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};let polls=0,native,shown;
 const ctx={navigator:{userAgent:'Android'},Capacitor:{isNativePlatform:()=>true,nativePromise:async(p,a,o)=>{native={p,a,o};return {status:200,data:{device_code:'d1',user_code:'ABCD-1234',verification_uri:'https://hf.co/oauth/device',expires_in:60,interval:0}};}},localStorage,setTimeout:f=>setTimeout(f,0),clearTimeout,AbortController,AbortSignal,TextDecoder,TextEncoder,URLSearchParams,encodeURIComponent,JSON,fetch:async u=>{if(String(u).endsWith('/oauth/userinfo'))return new Response(JSON.stringify({preferred_username:'reader'}));polls++;return polls<2?new Response(JSON.stringify({error:'authorization_pending'}),{status:400}):new Response(JSON.stringify({access_token:'hf_oauth_device',expires_in:3600}));}};ctx.globalThis=ctx;
 vm.runInNewContext(fs.readFileSync(require.resolve('./llm.js'),'utf8'),ctx);const L=ctx.LocalLLM;
 assert.equal(L.signInSupported(),true);assert.equal(L.usesDeviceSignIn(),true);
 assert.equal(await L.deviceSignIn(x=>{shown=x;}),'reader');assert.equal(shown.code,'ABCD-1234');assert.equal(shown.url,'https://hf.co/oauth/device');assert.equal(native.p,'CapacitorHttp');assert.match(native.o.data,/scope=openid\+profile/);assert.equal(polls,2);assert.equal(L.hfUser(),'reader');
});
test('ChatGPT, Claude and Gemini get the question with a few app facts',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});h.ctx.QuranKnowledge=require('./knowledge.js');assistantHarness(h,[]);
 const E=h.ctx.TarteelAssistant.elsewhere,prompt=E.prompt('كم عدد آيات سورة الكهف؟');
 assert.match(prompt,/السؤال: كم عدد آيات سورة الكهف؟/);assert.match(prompt,/عدد آياتها 110/);assert.ok(prompt.length<1200);
 assert.ok(E.url('chatgpt',prompt).startsWith('https://chatgpt.com/?q='));assert.ok(E.url('claude',prompt).startsWith('https://claude.ai/new?q='));assert.equal(E.url('gemini',prompt),'https://gemini.google.com/app');
});
test('Claude runs only after its button is pressed, and only when the server is ready',async()=>{
 const h=await appHarness(),spoken=assistantHarness(h,[]);let configured=false,posts=0;
 h.ctx.fetch=async(u,o)=>{if(o?.method==='POST'){posts++;return {ok:true,json:async()=>({content:[{type:'text',text:'رد Claude'}],stop_reason:'end_turn'})};}return {ok:true,json:async()=>({available:true,configured})};};
 const press=()=>h.el('claudeToggle').onclick();
 await press();assert.match(h.el('claudeStatus').textContent,/غير متاح/);assert.match(h.el('claudeToggle').textContent,/تفعيل Claude/);
 configured=true;await h.ctx.TarteelAssistant.ask('السلام عليكم');assert.equal(posts,0);assert.match(spoken.at(-1).text,/أهلًا بيك/);
 await press();assert.match(h.el('claudeToggle').textContent,/إيقاف Claude/);
 await h.ctx.TarteelAssistant.ask('السلام عليكم');assert.equal(posts,1);assert.equal(spoken.at(-1).text,'رد Claude');
 await press();assert.match(h.el('claudeToggle').textContent,/تفعيل Claude/);
 await h.ctx.TarteelAssistant.ask('السلام عليكم');assert.equal(posts,1);
});
test('assistant speaks with an Egyptian male voice when available, else lowers a female voice',async()=>{
 const shakir={name:'Microsoft شاكر Online (Natural) - Arabic (Egypt)',lang:'ar-EG'},hoda={name:'Microsoft Hoda - Arabic (Egypt)',lang:'ar-EG'};
 const h1=await appHarness(),s1=assistantHarness(h1,[hoda,{name:'Microsoft حامد Online (Natural) - Arabic (Saudi Arabia)',lang:'ar-SA'},shakir,{name:'Microsoft سلمى Online (Natural) - Arabic (Egypt)',lang:'ar-EG'}]);
 await h1.ctx.TarteelAssistant.ask('السلام عليكم');
 assert.equal(s1[0].voice,shakir);assert.equal(s1[0].lang,'ar-EG');assert.equal(s1[0].pitch,1);assert.match(s1[0].text,/أهلًا بيك/);
 const h2=await appHarness(),s2=assistantHarness(h2,[hoda]);
 await h2.ctx.TarteelAssistant.ask('السلام عليكم');assert.equal(s2[0].voice,hoda);assert.equal(s2[0].pitch,0.7);
});
test('assistant understands Egyptian phrasing and says places naturally',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>rangeData})});let played=0;h.el('listen').click=()=>{played++;};
 const spoken=assistantHarness(h,[]);
 await h.ctx.TarteelAssistant.ask('سمعني سورة 1 من 1 لحد 3');assert.equal(played,1);assert.equal(String(h.el('ayahEnd').value),'3');
 assert.match(spoken.at(-1).text,/فتحتلك سورة، الآيات 1 إلى 3\. هشغّلك الآيات 1 إلى 3 بصوت/);
 await h.ctx.TarteelAssistant.ask('شغلها بصوت الحصري');assert.match(spoken.at(-1).text,/^هشغّلك سورة، الآيات 1 إلى 3 بصوت الحصري/);
});
// ---------- Knowledge: tafsir, Quran search, surah facts, hadith ----------
const K=require('./knowledge.js');
test('Quran word search matches whole words with attached prefixes, or any part of a word',()=>{
 const S=require('./data/simple.json').data.surahs;
 const sabr=K.searchQuran(S,'الصبر');assert.ok(sabr.total>=5);assert.ok(sabr.results.some(r=>r.surah===2&&r.ayah===45));
 assert.ok(K.searchQuran(S,'كتاب').total>K.searchQuran(S,'كتاب',{surah:2}).total);
 assert.ok(K.searchQuran(S,'تاب').results.every(r=>K.plain(r.text.replace(/ًا|اً/g,'')).split(' ').some(w=>/^(و|ف|ب|ل|ك|ال)*تاب$/.test(w))));
 assert.ok(K.searchQuran(S,'صبر',{partial:true}).total>K.searchQuran(S,'صبر').total);
 assert.equal(K.searchQuran(S,'').total,0);
});
test('surah facts come from the local Mushaf',()=>{
 const i=K.surahInfo(require('./data/quran.json').data.surahs,18);
 assert.equal(i.ayat,110);assert.equal(i.revelation,'مكية');assert.deepEqual(i.juz,[15,16]);
 assert.deepEqual(K.surahInfo(require('./data/quran.json').data.surahs,32).sajda_ayat,[15]);
 assert.throws(()=>K.surahInfo([],200),/1-114/);
});
test('tafsir text is reduced to plain paragraphs and long blocks are split',async()=>{
 assert.deepEqual(K.paragraphs('<p>أ <span class="x">ب</span></p><p>ج</p>'),['أ ب','ج']);
 const long='قوله تعالى : '+'كلام طويل. '.repeat(150)+'الثانية : '+'شرح. '.repeat(50);
 const parts=K.paragraphs(long);assert.ok(parts.length>=3);assert.ok(parts.every(p=>p.length<=900));
 const real=globalThis.fetch;let asked='';globalThis.fetch=async url=>{asked=url;return {ok:true,json:async()=>({tafsir:{text:'<p>هذه آية الكرسي</p>',verses:{'2:255':{}}}})};};
 try{const t=await K.tafsir('ibn_kathir',2,255);assert.equal(t.name,'تفسير ابن كثير');assert.deepEqual(t.paragraphs,['هذه آية الكرسي']);assert.match(asked,/tafsirs\/14\/by_ayah\/2:255/);}
 finally{globalThis.fetch=real;}
 await assert.rejects(()=>K.tafsir('nobody',1,1),/Unknown tafsir/);
});
test('hadith search downloads a book once and matches all words without diacritics',async()=>{
 const real=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({hadiths:[{hadithnumber:1,text:'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ'},{hadithnumber:2,text:'الدِّينُ النَّصِيحَةُ'}]})};};
 try{
  const r=await K.searchHadith('انما الاعمال بالنيات',{books:['nawawi']});assert.equal(r.total,1);assert.equal(r.results[0].number,1);assert.equal(r.results[0].book,'الأربعون النووية');
  await K.searchHadith('النصيحه',{books:['nawawi']});assert.equal(calls,1);
 }finally{globalThis.fetch=real;}
});
test('assistant answers tafsir, word search, surah facts and hadith in local mode, from the sources',async()=>{
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>namedData})});
 const asked=[];h.ctx.QuranKnowledge={...K,tafsir:async(source,s,a)=>{asked.push([source,s,a]);return {name:source==='qurtubi'?'تفسير القرطبي':'التفسير الميسّر',by:'x',verses:[`${s}:${a}`],paragraphs:['معنى الآية هنا']};},searchHadith:async q=>({query:q,total:1,results:[{book:'صحيح البخاري',number:1,text:'إنما الأعمال بالنيات'}]})};
 const spoken=assistantHarness(h,[]);
 await h.ctx.TarteelAssistant.ask('تفسير القرطبي لسورة الكهف');assert.deepEqual(asked.at(-1),['qurtubi',18,1]);assert.match(spoken.at(-1).text,/تفسير القرطبي — سورة الكهف، الآية 1: معنى الآية هنا/);
 await h.ctx.TarteelAssistant.ask('يعني ايه الاية دي');assert.equal(asked.at(-1)[0],'muyassar');
 await h.ctx.TarteelAssistant.ask('ابحث عن كلمة الحمد');assert.match(spoken.at(-1).text,/«الحمد» جت في 114 آية/);
 await h.ctx.TarteelAssistant.ask('حديث عن انما الاعمال بالنيات');assert.match(spoken.at(-1).text,/لقيت حديث واحد فيه «انما الاعمال بالنيات» في البخاري ومسلم والأربعين النووية\. من صحيح البخاري رقم 1.*: إنما الأعمال بالنيات/);
});
test('Quran search counts occurrences, matches phrases in order, and finds an ayah from a quote',()=>{
 const S=require('./data/simple.json').data.surahs;
 const jannah=K.searchQuran(S,'الجنة');assert.ok(jannah.occurrences>=jannah.total);
 const phrase=K.searchQuran(S,'رب العالمين',{phrase:true});assert.ok(phrase.total>=40);assert.ok(phrase.results.some(r=>r.surah===1&&r.ayah===2));
 assert.ok(K.searchQuran(S,'العالمين رب',{phrase:true}).total<phrase.total);
 const water=K.findAyah(S,'وجعلنا من الماء كل شيء حي');assert.equal(water.exact,true);assert.deepEqual([water.results[0].surah,water.results[0].ayah],[21,30]);
 // Half-remembered («يسري» for «يسرا»): the closest ayat, with how much of the quote they share.
 const near=K.findAyah(S,'ان مع العسر يسري');assert.equal(near.exact,false);assert.equal(near.results[0].surah,94);assert.ok(near.results[0].match>=60);
 assert.equal(K.findAyah(S,'زززز قققق').total,0);
 assert.deepEqual(Object.keys(K.TAFSIRS),['muyassar','saadi','ibn_kathir','qurtubi','tabari','baghawi','wasit']);
});
// The assistant's "training set": how people actually ask, in Egyptian and standard Arabic, and what must come back.
test('assistant understands tafsir and word-search phrasings, with follow-ups, on the real Mushaf',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});
 const asked=[];h.ctx.QuranKnowledge={...K,tafsir:async(src,s,a)=>{asked.push(`${src} ${s}:${a}`);return {name:K.TAFSIRS[src].name,by:'x',verses:[],paragraphs:src==='muyassar'?['المعنى']:['ف1','ف2','ف3']};}};
 const spoken=assistantHarness(h,[]),say=async q=>{await h.ctx.TarteelAssistant.ask(q);return spoken.at(-1).text;};
 const cases=[
  ['فين الآية اللي بتقول وجعلنا من الماء كل شيء حي',/^دي سورة الانبياء، الآية 30\. قول «افتحها»/],
  ['افتحها',/^فتحتلك سورة الانبياء، الآية 30\.$/],
  ['فسرها',/^التفسير الميسّر — سورة الانبياء، الآية 30: المعنى$/,'muyassar 21:30'],
  ['وعند ابن كثير؟',/^تفسير ابن كثير — سورة الانبياء، الآية 30: ف1 ف2 … قول «كمّل»/,'ibn_kathir 21:30'],
  ['كمّل',/^ف3 وكده خلص التفسير\.$/],
  ['طب السعدي',/^تفسير السعدي — سورة الانبياء، الآية 30/,'saadi 21:30'],
  ['فسّر قوله تعالى إن مع العسر يسرا',/^دي سورة الشرح، الآية 5\. التفسير الميسّر/,'muyassar 94:5'],
  ['ايه معنى كلمة الصمد',/^كلمة «الصمد» جت في سورة الاخلاص، الآية 2، ومعناها في سياق الآية/,'muyassar 112:2'],
  // A word's meaning does not move the page: «الآية دي» is still the one on screen.
  ['يعني ايه الآية دي',/سورة الانبياء، الآية 30/,'muyassar 21:30'],
  ['تفسير الطبري لآية الكرسي',/^تفسير الطبري — سورة البقرة، الآية 255/,'tabari 2:255'],
  ['سبب نزول الآية 5 من سورة المجادلة',/^تفسير ابن كثير — سورة المجادلة، الآية 5/,'ibn_kathir 58:5'],
  ['كام مرة اتذكرت كلمة الجنة',/^«الجنة» اتذكرت \d+ مرة في \d+ آية\. أولهم: 1\) سورة البقرة 35/],
  ['ابحث عن الرحمة في سورة الكهف',/^«الرحمة» جت في 5 آيات في سورة الكهف\. وهي: 1\) سورة الكهف 10/],
  ['افتح النتيجة 2',/^فتحتلك سورة الكهف، الآية 58\.$/],
  ['ابحث عن كلمة الكوثر',/^«الكوثر» جت في آية واحدة\. وهي: 1\) سورة الكوثر 1/],
  ['دورلي على رب العالمين في القرآن',/^«رب العالمين» جت في \d+ آية/],
  ['انهي سورة فيها قل اعوذ برب الفلق',/^دي سورة الفلق، الآية 1/],
  ['«الله نور السماوات والارض»',/^دي سورة النور، الآية 35/],
 ];
 for(const [q,reply,tafsir] of cases){
  const before=asked.length,text=await say(q);
  assert.match(text,reply,`«${q}» → ${text}`);
  if(tafsir)assert.equal(asked.slice(before).join(),tafsir,`«${q}» read the wrong tafsir`);
 }
 // «سمّعني» (play it for me) is not a request for «معنى».
 let played=0;h.el('listen').click=()=>{played++;};await say('سمعني الآية');assert.equal(played,1);
});
test('privacy: the server log keeps no query strings, and the page explains what stays on the device',()=>withServer(async request=>{
 const real=console.log,lines=[];console.log=(...a)=>lines.push(a.join(' '));
 try{await request('/missing-page?name=Ahmed&room=abc');}finally{console.log=real;}
 assert.ok(lines.some(l=>/404 GET \/missing-page$/.test(l)),lines.join('\n'));assert.ok(!lines.some(l=>/Ahmed|room=/.test(l)));
 const html=fs.readFileSync(require.resolve('./index.html'),'utf8');
 assert.match(html,/id="privacy"/);assert.match(html,/يُرسل الصوت لـ Google\/Microsoft/);
}));
test('a correct recitation is not marked wrong: waqf marks, punctuation and same-sounding spellings',()=>{
 const C=require('./compare.js'),ok=(e,s)=>C.compare(e,s).every(i=>i.type==='correct');
 // The simple Mushaf text has waqf marks as separate tokens.
 assert.ok(ok('ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ','ذلك الكتاب لا ريب فيه هدى للمتقين'));
 assert.ok(ok('الحمد لله رب العالمين','الحمد، لله رب العالمين.'));
 for(const [e,s] of [['الصلاة','الصلاه'],['يؤمنون','يءمنون'],['الرحمن','الرحمان'],['ذلك','ذالك'],['هذا','هاذا'],['لكن','لاكن'],['أولئك','اولائك'],['السماوات','السموات'],['على','علي']])assert.ok(ok(e,s),`${e} / ${s}`);
 // Real slips still count.
 for(const [e,s] of [['قالوا','قال'],['قل','قال'],['العالمين','العالمون']])assert.equal(C.compare(e,s)[0].type,'changed',`${e} / ${s}`);
});
test('the basmala and isti\'adha recited before ayah 1 are not extra words',async()=>{
 const data={data:{surahs:Array.from({length:114},(_,i)=>({number:i+1,name:'سورة',ayahs:[{number:1,numberInSurah:1,text:(i===0?'':'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ ')+'قُلْ هُوَ ٱللَّهُ أَحَدٌ'}]}))}};
 const h=await appHarness({fetch:async()=>({ok:true,json:async()=>structuredClone(data)})});h.el('surah').value='112';h.el('surah').onchange();
 h.el('transcript').value='أعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم قل هو الله أحد';h.el('review').onclick?.()??h.ctx.review();
 assert.equal(h.el('resultLabel').textContent,'الكلمات متطابقة');
});
test('words that speech recognition runs together still match both words of the ayah',()=>{
 const C=require('./compare.js');
 const r=C.compare('يا أيها الذين آمنوا','ياأيها الذين امنوا');assert.deepEqual(r.map(i=>i.type),['correct','correct','correct','correct']);
 assert.ok(C.compare('يا قوم اعبدوا الله','ياقوم اعبدوا الله').every(i=>i.type==='correct'));
 assert.equal(C.compare('مائة عام','مئة عام')[0].type,'correct');
 // Leaving out «يا» is still a mistake.
 assert.deepEqual(C.compare('يا قوم','قوم').map(i=>i.type),['missing','correct']);
});
// ---------- Training benchmark over the whole Mushaf (deterministic sample) ----------
// A correct reading in speech-recognition spelling must score 100%; a skipped word, a wrong word and a wrong letter
// must be caught; a quote (exact or with one misheard letter) must find its ayah.
test('benchmark: recitation over the Mushaf has no false alarms and catches every mistake',()=>{
 const C=require('./compare.js'),S=require('./data/simple.json').data.surahs;
 let seed=11;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
 const SWAP={'ص':'س','س':'ص','ح':'ه','ه':'ح','ذ':'ز','ز':'ذ','ض':'د','ظ':'ض','ث':'س','ق':'ك','ك':'ق','ط':'ت','ت':'ط','غ':'خ'};
 const heard=t=>C.normalize(t).replace(/ة(?= |$)/g,'ه').replace(/(^| )يا /g,'$1يا').split(/\s+/).filter(Boolean);
 const fails=[];let n=0;
 S.forEach((c,ci)=>c.ayahs.forEach((a,ai)=>{
  if((ci+ai)%4)return;n++;const key=`${c.number}:${a.numberInSurah}`,w=heard(a.text);
  if(!C.compare(a.text,w.join(' ')).every(i=>i.type==='correct'))fails.push('false alarm '+key);
  if(w.length<3)return;const k=Math.floor(rnd()*w.length);
  if(C.compare(a.text,w.filter((_,i)=>i!==k).join(' ')).every(i=>i.type==='correct'))fails.push('missed skip '+key);
  const l=[...w[k]],at=l.findIndex(x=>SWAP[x]);if(at<0)return;l[at]=SWAP[l[at]];
  if(C.compare(a.text,w.map((x,i)=>i===k?l.join(''):x).join(' ')).every(i=>i.type==='correct'))fails.push(`missed letter ${key} ${w[k]}→${l.join('')}`);
 }));
 assert.ok(n>1500);assert.deepEqual(fails,[]);
});
test('benchmark: a quote finds its ayah, also with one misheard letter',()=>{
 const S=require('./data/simple.json').data.surahs;
 const cases=[['وجعلنا من الماء كل شيء حي',21,30],['يامريم ان الله اصطفاك',3,42],['الله نور السماوات والارض',24,35],['ولقد يسرنا القران للذكر',54,17],['قل هو الله احد',112,1],['ان مع العسر يسرا',94,5],
  // One letter misheard (ص/س، ذ/ز، ح/ه، ق/ك):
  ['الله لا اله الا هو الحي القيوم لا تاخزه سنه',2,255],['والعسر ان الانسان لفي خسر',103,2],['انا اعطيناك الكوسر',108,1],['قل اعوز برب الناس',114,1],['ولسوف يعطيك ربك فترضي',93,5],['الحمد لله رب العالمين الرحمن الرهيم',1,2]];
 const fails=cases.filter(([q,s,a])=>!K.findAyah(S,q).results.some(r=>r.surah===s&&r.ayah===a)).map(([q])=>q);
 assert.deepEqual(fails,[]);
});
test('mistake notes explain how to articulate commonly confused letters',()=>{
 const C=require('./compare.js'),note=(e,s)=>C.explain(C.compare(e,s)[0]);
 assert.match(note('الصراط','السراط'),/نطقت «س» بدل «ص».*💡 الصاد مفخّمة/);
 assert.match(note('خسر','خصر'),/💡 الصاد مفخّمة/);
 assert.match(note('الحمد','الهمد'),/💡 الحاء من وسط الحلق/);
 assert.match(note('قل','كل'),/💡 القاف من أقصى اللسان/);
 assert.doesNotMatch(note('الرحيم','الرحيمم'),/💡/);
});
test('the letters a reader confuses are counted on the device, shown with a tip, and the assistant knows them',async()=>{
 const C=require('./compare.js');
 assert.deepEqual(C.confusedLetters(C.compare('الصراط','السراط')[0]),[{expected:'ص',spoken:'س'}]);
 assert.deepEqual(C.confusedLetters(C.compare('الصراط','الكتاب')[0]),[]);
 const data={data:{surahs:Array.from({length:114},(_,i)=>({number:i+1,name:'سورة',ayahs:[{number:1,numberInSurah:1,text:'اهدنا الصراط المستقيم'}]}))}};
 const saved={};const h=await appHarness({fetch:async()=>({ok:true,json:async()=>structuredClone(data)})});
 const spoken=assistantHarness(h,[]);h.ctx.localStorage={getItem:k=>saved[k]??null,setItem:(k,v)=>{saved[k]=v;}};
 for(let i=0;i<2;i++){h.el('transcript').value='اهدنا السراط المستكيم';h.ctx.review();}
 assert.deepEqual(JSON.parse(saved['tarteel:letters']),{'صس':2,'قك':2});
 assert.equal(h.el('letterList').children.length,2);
 await h.ctx.TarteelAssistant.ask('ايه الحروف اللي بغلط فيها');
 assert.match(spoken.at(-1).text,/بتقرا «س» بدل «ص» \(2 مرات\).*نصيحة: الصاد مفخّمة/);
 assert.equal(h.ctx.TarteelAssistant.tools.get_progress().weak_letters[0].instead_of,'ص');
});
// ---------- Tajweed and Quran sciences ----------
test('tajweed rules are found from the Uthmani text (Hafs)',()=>{
 const Q=require('./data/quran.json').data.surahs,rules=(s,a)=>Object.fromEntries(K.tajweed(Q[s-1].ayahs[a-1].text).map(r=>[r.name,r.words]));
 const falaq=rules(113,4);const bare=ws=>ws.map(w=>require('./compare.js').normalize(w));assert.deepEqual(bare(falaq['إخفاء حقيقي']),['ومن شر']);assert.ok(falaq['لام شمسية']);assert.ok(falaq['لام قمرية']);assert.ok(falaq['قلقلة كبرى']);assert.ok(falaq['غنة مشددة']);
 const ikhlas=rules(112,4);assert.ok(ikhlas['إظهار شفوي']);assert.deepEqual(bare(ikhlas['إدغام بغير غنة']),['يكن له']);assert.ok(ikhlas['إظهار حلقي']);
 assert.ok(rules(104,4)['إقلاب']);
 const fatiha=rules(1,7);assert.ok(fatiha['مد لازم']);assert.ok(fatiha['مد عارض للسكون']);
 assert.ok(rules(2,6)['مد واجب متصل']);assert.ok(rules(2,4)['مد جائز منفصل']);assert.ok(rules(2,4)['قلقلة صغرى']);
 // Every ayah of the Mushaf is handled.
 for(const c of Q)for(const a of c.ayahs)assert.ok(Array.isArray(K.tajweed(a.text)));
});
test('Quran sciences counts come from the Mushaf',()=>{
 const f=K.quranFacts(require('./data/quran.json').data.surahs).counted_from_this_mushaf;
 assert.deepEqual([f.surahs,f.ayat,f.meccan_surahs,f.medinan_surahs,f.juz,f.hizb,f.pages,f.sajdat_tilawa.length,f.longest_surah.number],[114,6236,86,28,30,60,604,15,2]);
});
test('assistant explains tajweed, finds it in an ayah, and answers Quran-sciences questions',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});
 h.ctx.QuranKnowledge=K;
 const spoken=assistantHarness(h,[]),say=async q=>{await h.ctx.TarteelAssistant.ask(q);return spoken.at(-1).text;};
 await say('افتح سورة الفلق آية 4');
 assert.match(await say('احكام التجويد في الآية دي'),/^أحكام التجويد في سورة الفلق، الآية 4 \(رواية حفص\): إخفاء حقيقي في «/);
 assert.match(await say('تجويد آية الكرسي'),/سورة البقرة، الآية 255.*مد جائز منفصل/);
 assert.match(await say('يعني ايه الاقلاب'),/^إقلاب \(النون الساكنة والتنوين\): نون ساكنة أو تنوين وبعدها باء/);
 const madd=await say('انواع المد');assert.match(madd,/مد واجب متصل/);assert.doesNotMatch(madd,/إخفاء/);
 assert.match(await say('كام سورة في القران'),/114 سورة، منها 86 مكية و28 مدنية/);
 assert.match(await say('سجدات التلاوة'),/^سجدات التلاوة 15:/);
 assert.match(await say('اول ما نزل من القران'),/سورة العلق/);
 // Earlier skills still work.
 assert.match(await say('فين الآية اللي بتقول وجعلنا من الماء كل شيء حي'),/سورة الانبياء، الآية 30/);
 const t=h.ctx.TarteelAssistant.tools;assert.equal(t.get_tajweed({surah:113,ayah:4}).riwaya,'حفص عن عاصم');assert.ok(t.explain_tajweed_rule({rule:'قلقلة'}).matched);
});
test('ta marbuta read on as «ت» is the same word; a classifier saved by an older version is upgraded',()=>{
 const C=require('./compare.js'),L=require('./learning.js');
 assert.equal(C.compare('وآتوا الزكاة','واتوا الزكات')[1].type,'correct');
 assert.equal(C.compare('رحمة الله','رحمت الله')[0].type,'correct');
 assert.equal(C.compare('كانت','كانه')[0].type,'changed');
 // Never trained: takes the new weights. Trained by the user: keeps them, plus the new feature's weight.
 assert.deepEqual(L.upgradeClassifier({weights:[0,0,0,0,0,0,0,0],n:0,correct:0}).weights,L.CLF_PRIOR);
 const mine=L.upgradeClassifier({weights:[1,2,3,4,5,6,7,8],n:4,correct:3});assert.deepEqual(mine.weights,[1,2,3,4,5,6,7,8,L.CLF_PRIOR[8]]);assert.equal(mine.n,4);
 assert.equal(L.mistakeFeatures({type:'changed',ops:[{op:'sub',from:'ص',to:'س'}],length:5,device:true}).length,L.CLF_PRIOR.length);
});
test('the most accurate on-device model uses the full-precision decoder',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync(require.resolve('./asr.js'),'utf8'),ctx);
 const M=ctx.DeviceASR.MODELS;assert.equal(M.best.id,M.accurate.id);assert.equal(M.best.decoder,'fp32');assert.equal(M.accurate.decoder,undefined);
 assert.match(fs.readFileSync(require.resolve('./index.html'),'utf8'),/<option value="device-best">/);
});
test('the server answers /favicon.ico with the app icon',()=>withServer(async request=>{
 const r=await request('/favicon.ico');assert.equal(r.status,200);assert.match(r.headers['content-type'],/image\/png/);
}));
test('assistant answers clearly when a place does not exist or a follow-up has nothing to follow',async()=>{
 const real={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>real[u]})});h.ctx.QuranKnowledge=K;
 const spoken=assistantHarness(h,[]),say=async q=>{await h.ctx.TarteelAssistant.ask(q);return spoken.at(-1).text;};
 assert.match(await say('كمل'),/لسه ما فسّرتلكش آية/);
 assert.match(await say('افتحها'),/مفيش نتايج بحث لسه/);
 assert.match(await say('معنى كلمة'),/معنى أنهي كلمة/);
 assert.match(await say('ابحث عن'),/قوللي الكلمة/);
 assert.match(await say('فين الآية اللي بتقول'),/الآية بتقول إيه/);
 assert.match(await say('تفسير سورة 200'),/القرآن 114 سورة بس/);
 assert.match(await say('احكام التجويد في سورة الفاتحة آية 99'),/سورة الفاتحة فيها 7 آيات بس، فمفيش آية 99/);
});
// ---------- Hadith sciences, grades, recitation topics, surah names (the assistant's training set) ----------
test('hadith-science terms are found from how people ask, with their standard definitions',()=>{
 const cases={'يعني ايه حديث حسن':'حسن','الفرق بين الشاذ والمنكر':'منكر','الجرح والتعديل':'الجرح والتعديل','الاسناد':'الإسناد','يعني ايه السند والمتن':'المتن','ما هو الحديث المرسل':'مرسل','الحديث المعلق':'معلق','يعني ايه متفق عليه':'متفق عليه','الحديث العزيز':'عزيز','حديث غريب':'غريب','المدلس':'مدلس','المضطرب':'مضطرب','المدرج':'مدرج','الحديث المعلل':'معلل','الحسن لغيره':'حسن لغيره','الصحيح لغيره':'صحيح لغيره','الحديث المقطوع':'مقطوع','الموقوف':'موقوف','المرفوع':'مرفوع','المنقطع':'منقطع','المعضل':'معضل','مين هو التابعي':'تابعي','الضبط':'ضبط','المتصل':'متصل','الآحاد':'آحاد','ما هو الحديث القدسي':'قدسي','الحديث الموضوع':'موضوع','ما هو المتواتر':'متواتر','حسن صحيح':'حسن صحيح','الكتب الستة':'الكتب الستة'};
 const misses=Object.entries(cases).filter(([q,want])=>!K.findMustalah(q).some(x=>x.term===want)).map(([q])=>q);
 assert.deepEqual(misses,[]);
 assert.match(K.MUSTALAH['صحيح'].def,/اتصل سنده.*العدل الضابط.*شذوذ ولا علة/);assert.match(K.MUSTALAH_SOURCE,/نخبة الفكر/);
 // «حسن صحيح» is one term, not «حسن» and «صحيح».
 assert.deepEqual(K.findMustalah('يعني ايه حسن صحيح').map(x=>x.term),['حسن صحيح']);
});
test('hadith grades are shown in Arabic with the scholar who gave them',()=>{
 for(const [g,ar] of [['Sahih','صحيح'],['Hasan Sahih','حسن صحيح'],['Daif','ضعيف'],['Very Daif','ضعيف جدًا'],['Sahih Lighairihi','صحيح لغيره'],['Isnaad Hasan','إسناده حسن'],['Sanad Daif','إسناده ضعيف'],['Maudu','موضوع'],['Batil','باطل'],['Mauquf','موقوف']])assert.equal(K.gradeAr(g),ar,g);
 assert.deepEqual(Object.keys(K.HADITH),['nawawi','bukhari','muslim','abudawud','tirmidhi','nasai','ibnmajah']);
});
test('the lam of «الله» and the waqf signs are read from the Mushaf',()=>{
 const Q=require('./data/quran.json').data.surahs,j=(s,a)=>K.jalalaRules(Q[s-1].ayahs[a-1].text).map(x=>x.rule);
 assert.deepEqual(j(1,2),['ترقيق لام لفظ الجلالة']);// لِلَّهِ
 assert.deepEqual(j(112,2),['تفخيم لام لفظ الجلالة']);// ٱللَّهُ ٱلصَّمَدُ
 assert.deepEqual(j(3,26).slice(0,1),['ترقيق لام لفظ الجلالة']);// قُلِ ٱللَّهُمَّ
 assert.ok(!K.jalalaRules(Q[1].ayahs[254].text).some(x=>/لَّهُۥ/.test(x.word)));// «لَّهُۥ» (to Him) is not «الله»
 assert.deepEqual(K.waqfSigns(Q[1].ayahs[1].text).map(w=>w.sign),['∴','∴']);// ريب ∴ فيه ∴
 assert.equal(K.waqfSigns(Q[1].ayahs[4].text)[0].meaning,'الوصل أولى');
 const kinds=new Set();for(const c of Q)for(const a of c.ayahs)for(const w of K.waqfSigns(a.text))kinds.add(w.sign);
 for(const sign of ['صلى','قلى','مـ','لا','ج','∴'])assert.ok(kinds.has(sign),sign);
});
test('assistant: every surah opens by its name, and command words inside names do not misfire',async()=>{
 const data={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>structuredClone(data[u])})});h.ctx.QuranKnowledge=K;assistantHarness(h,[]);
 const C=require('./compare.js'),misses=[];
 for(const s of data['data/quran.json'].data.surahs){
  const name=C.normalize(s.name).replace(/^سورة /,'');
  // Without «ال» only where people say it so («الكهف» or «كهف»); short names (الحج، الجن) are always said with it.
  for(const f of new Set([name,name.length>5?name.replace(/^ال(?=\S)/,''):name])){h.el('surah').value='1';await h.ctx.TarteelAssistant.ask('افتح سورة '+f);if(String(h.el('surah').value)!==String(s.number))misses.push(f);}
 }
 assert.deepEqual(misses,[]);
 for(const [alias,n] of [['الانشراح',94],['بني اسرائيل',17],['تبت',111],['الدهر',76]]){await h.ctx.TarteelAssistant.ask('افتح سورة '+alias);assert.equal(String(h.el('surah').value),String(n),alias);}
});
test('assistant answers hadith sciences, grades from the source, and recitation topics',async()=>{
 const data={'data/quran.json':require('./data/quran.json'),'data/simple.json':require('./data/simple.json')};
 const h=await appHarness({fetch:async u=>({ok:true,json:async()=>structuredClone(data[u])})});
 const searched=[];h.ctx.QuranKnowledge={...K,searchHadith:async(q,o)=>{searched.push([q,o.books]);return {query:q,total:1,results:[{book:'سنن ابن ماجه',number:224,text:'طلب العلم فريضة على كل مسلم',grades:[{by:'الألباني',grade:'صحيح'}]}]};}};
 const spoken=assistantHarness(h,[]),say=async q=>{await h.ctx.TarteelAssistant.ask(q);return spoken.at(-1).text;};
 assert.match(await say('يعني ايه حديث حسن'),/^حسن \(مراتب القبول\): ما اتصل سنده/);
 assert.match(await say('الفرق بين الشاذ والمنكر'),/منكر.*شاذ|شاذ.*منكر/);
 assert.match(await say('انواع الحديث'),/أقسام الحديث في علم المصطلح/);
 // A grade question searches the six books, and «كل مسلم» in the text is not the book «صحيح مسلم».
 assert.match(await say('درجة حديث طلب العلم فريضة على كل مسلم'),/في الكتب الستة.*درجته: صحيح \(الألباني\)/);assert.equal(searched.at(-1)[1].length,6);
 await say('حديث الدين النصيحة في سنن ابي داود');assert.equal(JSON.stringify(searched.at(-1)),JSON.stringify(['الدين النصيحة',['abudawud']]));
 assert.match(await say('علامات الوقف'),/«مـ» وقف لازم/);
 assert.match(await say('مخارج الحروف'),/الجوف.*الحلق.*اللسان.*الشفتان.*الخيشوم/);
 assert.match(await say('السكتات عند حفص'),/عوجا/);
 await say('افتح سورة البقرة آية 2');assert.match(await say('احكام التجويد في الآية دي'),/وعلامات الوقف: «∴» بعد/);
 assert.equal(h.ctx.TarteelAssistant.tools.explain_hadith_term({term:'المرسل'}).terms[0].term,'مرسل');
});

test('misheard or misspelled surah names find the right surah; «مصر» is found in all five ayat',async()=>{
 const Q=require('./data/quran.json').data.surahs,S=require('./data/simple.json').data.surahs;
 for(const [w,n]of [['الفاتحة',1],['الفاتحه',1],['فاتحه',1],['الفتحه',1],['الفتح',48],['الفاتح',48],['الكهوف',18],['البقره',2],['الرحمان',55],['المطففين',83]])assert.equal(K.closestSurah(Q,w),n,w);
 assert.equal(K.closestSurah(Q,'الصبر'),null);
 const r=K.searchQuran(S,'مصر');assert.deepEqual(r.results.map(x=>x.surah+':'+x.ayah),['2:61','10:87','12:21','12:99','43:51']);
 assert.equal(K.searchQuran(S,'تاب').results.some(x=>x.surah===4&&x.ayah===16),false);
});
test('«هل سورة يس مكية؟ وكم آية فيها؟» is answered with the surah facts, not read as an ayah search',async()=>{
 const a=await require('./Training/app-sources.cjs').loadApp(),out=[];
 a.ctx.document.getElementById('aiLog').append=(...x)=>out.push(...x);
 const base=a.ctx.document.createElement;a.ctx.document.createElement=()=>Object.assign(base(),{parts:[],append(...x){this.parts.push(...x);},scrollIntoView(){}});
 a.ctx.fetch=async()=>({ok:false,json:async()=>({})});
 const reply=async q=>{await a.ctx.TarteelAssistant.ask(q);return out.at(-1).parts.map(p=>typeof p==='string'?p:p.textContent).join('');};
 assert.match(await reply('هل سورة يس مكية؟ وكم آية فيها؟'),/مكية، عدد آياتها 83/);
 assert.match(await reply('الآية اللي فيها'),/الآية بتقول إيه/);
 for(const q of ['كيف أحفظ القرآن بسرعة؟','ازاي اراجع حفظي؟','أنا بنسى اللي بحفظه'])assert.match(await reply(q),/إخفاء الآية للتسميع/,q);
 assert.doesNotMatch(await reply('كيف حفظ الله القرآن؟'),/إخفاء الآية للتسميع/);
 // The local model's sources: tajweed rules, hadith terms and facts are passed in; question words are not searched.
 const src=a.sources('ما هو الإقلاب');assert.match(src,/من أحكام التجويد: إقلاب/);assert.doesNotMatch(src,/كلمة «/);
 assert.match(a.sources('ما الفرق بين سورة طه وسورة ق'),/معلومات سورة طه:[\s\S]*معلومات سورة ق:/);
 assert.match(a.sources('أين وردت كلمة مصر في القرآن'),/كلمة «مصر» وردت في 5 آيات: سورة البقرة 61، سورة يونس 87/);
});
test('phone free chat: off by default, sends only question and sources, streams, and drops broken replies',async()=>{
 const load=(fetch,url='https://server.example/')=>{const ctx={navigator:{userAgent:'Android'},localStorage:{getItem:k=>k==='tarteel:llmRemoteUrl'?url:null},fetch,setTimeout,clearTimeout,AbortController,AbortSignal,TextDecoder,encodeURIComponent,JSON};ctx.globalThis=ctx;vm.runInNewContext(fs.readFileSync(require.resolve('./llm.js'),'utf8'),ctx);return ctx.LocalLLM;};
 const sse=(...events)=>new Response(events.map(([k,d])=>`event: ${k}\ndata: ${JSON.stringify(d)}\n\n`).join(''),{status:200});
 const sent=[];let reply=()=>sse(['generating',['سورة ']],['generating',['سورة مكية']],['complete',['سورة مكية']]);
 const L=load(async(u,o={})=>{sent.push({u,o});if(u.endsWith('/gradio_api/info'))return new Response('{}');if(u.endsWith('/gradio_api/call/ask'))return new Response(JSON.stringify({event_id:'e1'}));return reply();});
 assert.equal(L.supported(),false);assert.equal(L.remoteSupported(),true);assert.equal(L.ready(),false);
 await L.enableRemote();assert.equal(L.ready(),true);
 const seen=[];assert.equal(await L.askRemote({question:'س',sources:'م',history:[]},t=>seen.push(t)),'سورة مكية');assert.deepEqual(seen,['سورة ','سورة مكية','سورة مكية']);
 assert.deepEqual(JSON.parse(sent.at(-2).o.body),{data:['س','م','[]']});assert.equal(sent.at(-1).u,'https://server.example/gradio_api/call/ask/e1');
 reply=()=>sse(['generating',['hello']]);assert.equal(await L.askRemote({question:'س'}),'');
 reply=()=>sse(['error',null]);await assert.rejects(L.askRemote({question:'س'}),e=>e.friendly&&!e.quota);assert.equal(L.ready(),true);
 reply=()=>sse(['error','You have exceeded your free GPU quota']);await assert.rejects(L.askRemote({question:'س'}),e=>e.quota);assert.equal(L.ready(),false);assert.equal(L.remote(),false);assert.equal(L.remoteEnabled(),true);
 L.disableRemote();await L.enableRemote();assert.equal(L.ready(),true);
 await assert.rejects(L.askRemote({question:'س'.repeat(501)}),e=>e.friendly);
 reply=()=>sse(['error',{error:'You have exceeded your ZeroGPU runs limit.'}]);await assert.rejects(L.askRemote({question:'س'}),e=>e.quota&&/الأسئلة المجانية/.test(e.message));
 assert.equal(load(async()=>new Response(''),'').remoteSupported(),true);
 if(fs.existsSync('./Space/rules.txt')){const a=await require('./Training/app-sources.cjs').loadApp();assert.equal(fs.readFileSync('./Space/rules.txt','utf8').trim(),a.rules().trim());}
});
test('assistant serves the app sites and phone app, refuses others, and stops at its limits',async()=>{
 let calls=0;const s=await assistantServer({beta:{messages:{create:async()=>{calls++;return {content:[{type:'text',text:'نعم'}],stop_reason:'end_turn',model:'m'};}}}});
 const body={messages:[{role:'user',content:'س'}]};
 try{
  for(const Origin of ['https://telawa-exame.netlify.app','https://adelaziz2026.github.io','https://localhost']){
   const pre=await fetch(s.base+'/api/assistant',{method:'OPTIONS',headers:{Origin,'Access-Control-Request-Method':'POST'}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),Origin);
   const r=await s.post(body,{Origin});assert.equal(r.status,200,Origin);assert.equal(r.headers.get('access-control-allow-origin'),Origin);
  }
  const other=await s.post(body,{Origin:'https://evil.example'});assert.equal(other.status,403);assert.equal(other.headers.get('access-control-allow-origin'),null);
  assert.equal((await fetch(s.base+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
  assert.equal(calls,3);
  assistant.resetLimits();let last;for(let i=0;i<11;i++)last=await s.post(body,{'CF-Connecting-IP':'203.0.113.9'});
  assert.equal(last.status,429);assert.equal((await last.json()).error,'rate_limited');
  assert.equal((await s.post(body,{'CF-Connecting-IP':'203.0.113.10'})).status,200);
 }finally{assistant.resetLimits();await s.close();assistant.setClient(null);}
});
test('a word started and then restarted is not a mistake; a real extra word still is',()=>{
 const C=require('./compare.js'),types=(e,s)=>C.compare(e,s).map(i=>i.type).join(',');
 assert.equal(types('فأنجيناه وأصحاب','فأن فأنجيناه وأصحاب'),'repeated,correct,correct');
 assert.equal(types('إنا أعطيناك الكوثر','إنا أع أعطيناك الكوثر'),'correct,repeated,correct,correct');
 assert.equal(types('فأنجيناه وأصحاب السفينة','فأنت أمجيناه وأصحاب السفينة'),'repeated,changed,correct,correct');
 assert.equal(types('الحمد لله رب العالمين','الحمد لله رب كتاب العالمين'),'correct,correct,correct,extra,correct');
});
test('on-device audio keeps a quieter ending and splits long recitations at pauses',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync(require.resolve('./asr.js'),'utf8'),ctx);const {prepare,segments}=ctx.DeviceASR,SR=16000;
 const syll=(sec,amp)=>Float32Array.from({length:sec*SR},(_,i)=>amp*Math.sin(i*0.3)*Math.max(0.05,Math.abs(Math.sin(i/2500)))),gap=s=>new Float32Array(Math.round(s*SR)).map((_,i)=>((i*7919)%13-6)*0.0002);
 const cat=(...p)=>{const out=new Float32Array(p.reduce((n,x)=>n+x.length,0));let o=0;for(const x of p){out.set(x,o);o+=x.length;}return out;};
 // A loud start and a last word at a twentieth of the volume: the last word stays.
 assert.ok(prepare(cat(gap(0.5),syll(2,0.8),gap(0.3),syll(1.5,0.04),gap(1))).length/SR>3.6);
 // 20 s with pauses: several pieces of 4–15 s that cover the recording without gaps; a short clip stays whole.
 const parts=[gap(0.4)];for(let i=0;i<7;i++)parts.push(syll(2.6,0.6),gap(0.5));const b=prepare(cat(...parts)),sb=segments(b);
 assert.ok(sb.length>=3);assert.ok(sb.every(([x,y])=>(y-x)/SR<=15));assert.equal(sb[0][0],0);assert.equal(sb.at(-1)[1],b.length);assert.ok(sb.every((s,i)=>!i||s[0]===sb[i-1][1]));
 assert.equal(segments(prepare(cat(gap(0.3),syll(5,0.6),gap(0.3)))).length,1);
});
test('without a server of its own the meeting links open the hosted meeting instead of disappearing',()=>{
 const src=fs.readFileSync(require.resolve('./app.js'),'utf8'),css=fs.readFileSync(require.resolve('./style.css'),'utf8');
 assert.match(src,/HOSTED_MEETING='https:\/\/telawa-exame\.onrender\.com\/meet\.html'/);assert.match(src,/if\(NATIVE\)useHostedMeeting\(\);/);
 assert.match(css,/\.native:not\(\.hosted-meet\) \.meet-link/);assert.doesNotMatch(css,/\.native \.meet-link,\.native \.meet-btn/);
});
