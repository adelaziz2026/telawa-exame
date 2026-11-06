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
 assert.equal(h.el('resultLabel').textContent,'1 مواضع للمراجعة · 50٪');assert.match(h.el('verseRef').textContent,/آخر مراجعة 50٪/);
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
 assert.equal(h.el('resultLabel').textContent,'1 مواضع للمراجعة · 83٪');
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
 assistant.setClient(fake);const server=require('./server.cjs').createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 return {base,close:()=>new Promise(r=>server.close(r)),post:(body,headers={})=>fetch(base+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)})};
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
 assert.ok(K.searchQuran(S,'تاب').results.every(r=>K.plain(r.text).split(' ').some(w=>/^(و|ف|ب|ل|ك|ال)*تاب$/.test(w))));
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
 await h.ctx.TarteelAssistant.ask('حديث عن انما الاعمال بالنيات');assert.match(spoken.at(-1).text,/لقيت حديث واحد فيه «انما الاعمال بالنيات». من صحيح البخاري رقم 1: إنما الأعمال بالنيات/);
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
