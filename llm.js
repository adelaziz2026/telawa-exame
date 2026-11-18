// Free conversation on computers: a small language model (Qwen2.5-1.5B, Apache-2.0, via WebLLM) runs on the computer's own GPU.
// Never on phones or in the phone app: it needs WebGPU and a ~0.85 GB one-time download (kept by the browser after).
// Phones and computers can instead ask the same fine-tuned model on the app's server (Space/), but only after the person turns it on,
// because the question then leaves the device. Nothing is downloaded to the device.
// The model only words the answer; facts come from the app's own sources, passed in by assistant.js.
(scope=>{
const WEBLLM='https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/+esm';
const MODELS={f16:'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',f32:'Qwen2.5-1.5B-Instruct-q4f32_1-MLC'};
// The app's fine-tuned weights (Training/), once hosted (q4f16_1 only). Empty = the original model.
// They run on WebLLM's own compiled Qwen2.5-1.5B library, since fine-tuning changes the weights only, not the architecture.
const TUNED_URL='';
const tunedUrl=()=>{try{return scope.localStorage?.getItem('tarteel:llmModelUrl')||TUNED_URL;}catch{return TUNED_URL;}};
// The phone server, once it is published. Empty = the option does not appear.
const REMOTE_URL='https://adel203047-tarteel-assistant.hf.space';
const remoteUrl=()=>{let u=REMOTE_URL;try{u=scope.localStorage?.getItem('tarteel:llmRemoteUrl')||REMOTE_URL;}catch{}return u.replace(/\/+$/,'');};
const friendly=m=>Object.assign(Error(m),{friendly:true});
// Optional «Sign in with Hugging Face» (OAuth with PKCE, no secret): the person signs in on huggingface.co, so the app never
// sees the password. The short-lived token asks only for the public profile and goes only to Hugging Face.
const HF='https://huggingface.co',HF_CLIENT='https://telawa-exame.netlify.app/.well-known/oauth-cimd',AUTH_KEY='tarteel:hfAuth',FLOW_KEY='tarteel:hfFlow';
const readJson=(area,key)=>{try{return JSON.parse(scope[area]?.getItem(key)||'null');}catch{return null;}};
const writeJson=(area,key,value)=>{try{if(value)scope[area].setItem(key,JSON.stringify(value));else scope[area].removeItem(key);}catch{}};
const b64url=bytes=>scope.btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const randomText=()=>b64url(scope.crypto.getRandomValues(new Uint8Array(32)));
const pageUrl=()=>scope.location.origin+scope.location.pathname.replace(/index\.html$/,'');
const auth=()=>{const a=readJson('localStorage',AUTH_KEY);return a?.token&&a.expires>Date.now()+60000?a:null;};
const authHeaders=()=>{const a=auth();return a&&remoteUrl()===REMOTE_URL?{authorization:'Bearer '+a.token}:{};};
let remoteOn=false,quotaUntil=0;
const remoteOpen=()=>remoteOn&&Date.now()>=quotaUntil;
const native=!!scope.Capacitor?.isNativePlatform?.();
const phone=/Android|iPhone|iPad|iPod|Mobile/i.test(scope.navigator?.userAgent||'')||!!scope.matchMedia?.('(pointer: coarse)').matches;
let engine=null,loading=null;
const LocalLLM={
 // Off for everyone: in tests a small model was too slow and sometimes invented answers (see Document/). It can be tried on
 // a computer with WebGPU by setting localStorage «tarteel:llmLab» to true; phones never see it.
 supported:()=>{let lab=false;try{lab=scope.localStorage?.getItem('tarteel:llmLab')==='true';}catch{}return lab&&!native&&!phone&&!!scope.navigator?.gpu;},
 ready:()=>!!engine||remoteOpen(),
 remoteSupported:()=>!!remoteUrl(),
 remote:remoteOpen,
 remoteEnabled:()=>remoteOn,
 signInSupported:()=>!native&&!!scope.crypto?.subtle&&!!scope.location?.origin,
 hfUser:()=>{const a=auth();return a?a.name||'حسابك':'';},
 signOut(){writeJson('localStorage',AUTH_KEY,null);quotaUntil=0;},
 async signIn(){
  const verifier=randomText(),state=randomText(),redirect=pageUrl();
  const digest=await scope.crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  writeJson('sessionStorage',FLOW_KEY,{verifier,state,redirect});
  scope.location.assign(HF+'/oauth/authorize?'+new URLSearchParams({client_id:HF_CLIENT,redirect_uri:redirect,response_type:'code',scope:'openid profile',state,code_challenge:b64url(digest),code_challenge_method:'S256'}));
 },
 // Runs when Hugging Face sends the person back. Returns their name, or '' when this is an ordinary page load.
 async finishSignIn(){
  const q=new URLSearchParams(scope.location?.search||''),state=q.get('state'),code=q.get('code'),failed=q.get('error');
  if(!state||(!code&&!failed))return '';
  const flow=readJson('sessionStorage',FLOW_KEY);writeJson('sessionStorage',FLOW_KEY,null);
  if(!flow)return '';
  scope.history?.replaceState(null,'',flow.redirect+(scope.location.hash||''));
  if(flow.state!==state)throw friendly('تعذّر التحقق من تسجيل الدخول. حاول مرة أخرى.');
  if(failed||!code)throw friendly('لم يكتمل تسجيل الدخول.');
  let token;
  try{
   const r=await scope.fetch(HF+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:flow.redirect,client_id:HF_CLIENT,code_verifier:flow.verifier})});
   if(r.ok)token=await r.json();
  }catch{}
  if(!token?.access_token)throw friendly('تعذّر إكمال تسجيل الدخول. حاول مرة أخرى.');
  let name='';
  try{const r=await scope.fetch(HF+'/oauth/userinfo',{headers:{authorization:'Bearer '+token.access_token}});if(r.ok)name=String((await r.json()).preferred_username||'').slice(0,60);}catch{}
  writeJson('localStorage',AUTH_KEY,{token:token.access_token,expires:Date.now()+1000*(Number(token.expires_in)||28800),name});
  quotaUntil=0;
  return name||'حسابك';
 },
 disableRemote(){remoteOn=false;quotaUntil=0;},
 // A sleeping free server needs a while to wake, so a failed check is reported as «try again», not as an error.
 async enableRemote(){
  let ok=false;try{ok=(await scope.fetch(remoteUrl()+'/gradio_api/info',{cache:'no-store',signal:AbortSignal.timeout(25000)})).ok;}catch{}
  if(!ok)throw friendly('الخادم يستيقظ أو غير متاح الآن. انتظر دقيقة ثم حاول مرة أخرى.');
  remoteOn=true;
 },
 // Sends only the question, the sources the app gathered for it, and the earlier turns of a follow-up.
 async askRemote({question,sources='',history=[]},onToken){
  if(question.length>500)throw friendly('السؤال طويل. اختصره إلى 500 حرف.');
  const stop=new AbortController,timer=setTimeout(()=>stop.abort(),240000);
  const busy='الخدمة المجانية مشغولة أو انتهى رصيدك اليومي. حاول لاحقًا.';
  try{
   const turns=JSON.stringify(history.map(h=>({role:h.role,content:h.content.slice(0,1000)})));
   const signedIn=authHeaders(),expired=()=>{LocalLLM.signOut();return friendly('انتهت جلسة Hugging Face. سجّل الدخول مرة أخرى أو أعد إرسال سؤالك.');};
   const start=await scope.fetch(remoteUrl()+'/gradio_api/call/ask',{method:'POST',headers:{'content-type':'application/json',...signedIn},signal:stop.signal,body:JSON.stringify({data:[question,sources.slice(0,8000),turns]})});
   if(start.status===401&&signedIn.authorization)throw expired();
   if(!start.ok)throw friendly(busy);
   const {event_id:id}=await start.json();
   const r=await scope.fetch(remoteUrl()+'/gradio_api/call/ask/'+encodeURIComponent(id),{headers:signedIn,signal:stop.signal});
   if(r.status===401&&signedIn.authorization)throw expired();
   if(!r.ok)throw friendly(busy);
   const reader=r.body.getReader(),decoder=new TextDecoder;let buffer='',text='';
   for(;;){
    const {value,done}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'');
    const events=buffer.split('\n\n');buffer=events.pop();
    for(const block of events){
     const kind=block.match(/^event: (.+)$/m)?.[1],line=block.match(/^data: (.*)$/m)?.[1];
     if(kind==='error'){
      // Out of free runs: rest the server for an hour, so the app's own search and commands answer meanwhile.
      if(/quota|runs limit/i.test(line||'')){quotaUntil=Date.now()+3600000;const more=signedIn.authorization?'انتهت حصة حسابك المجانية في الخدمة الذكية الآن.':LocalLLM.signInSupported()?'انتهت الأسئلة المجانية في الخدمة الذكية الآن. سجّل الدخول بحساب Hugging Face المجاني لتحصل على حصة أكبر.':'انتهت الأسئلة المجانية في الخدمة الذكية الآن.';throw Object.assign(friendly(more+' ما زال البحث في القرآن وأوامر التطبيق يعملان.'),{quota:true});}
      throw friendly(busy);
     }
     if((kind!=='generating'&&kind!=='complete')||!line)continue;
     const now=JSON.parse(line)?.[0];if(typeof now!=='string')continue;
     text=now;if(LocalLLM.broken(text)){stop.abort();return '';}
     onToken?.(text);
    }
   }
   return text.trim();
  }catch(e){
   if(e.friendly)throw e;
   throw friendly(stop.signal.aborted?'تأخر الخادم كثيرًا. حاول مرة أخرى.':'تعذّر الاتصال بالخادم. تحقق من الإنترنت.');
  }finally{clearTimeout(timer);}
 },
 async load(onProgress){
  if(engine)return engine;
  return loading??=(async()=>{
   const adapter=await navigator.gpu.requestAdapter();
   if(!adapter)throw Error('no-gpu');
   // Half-precision shaders are faster; older GPUs get the 32-bit build of the same model.
   const f16=adapter.features.has('shader-f16'),model=f16?MODELS.f16:MODELS.f32;
   // The fine-tuned weights exist in the half-precision format only.
   if(tunedUrl()&&!f16)throw Error('no-gpu');
   const webllm=await import(WEBLLM);
   const initProgressCallback=p=>onProgress?.(p.progress||0,p.text||''),url=tunedUrl();
   if(!url)engine=await webllm.CreateMLCEngine(model,{initProgressCallback});
   else{
    const base=webllm.prebuiltAppConfig.model_list.find(m=>m.model_id===model),id='Tarteel-'+model;
    engine=await webllm.CreateMLCEngine(id,{initProgressCallback,appConfig:{...webllm.prebuiltAppConfig,model_list:[{...base,model:url.replace('{q}','q4f16_1'),model_id:id}]}});
   }
   LocalLLM.tuned=!!url;
   return engine;
  })().catch(e=>{loading=null;throw e;});
 },
 // Streams the reply, decoding greedily with a light repetition penalty — the settings the fine-tuned model was tested
 // with (Training/evaluate.py). A frequency penalty is avoided: it pushes Arabic answers off words they must repeat
 // («سورة»). A reply that drifts out of Arabic (Latin or Chinese letters) or gets stuck repeating itself is stopped
 // and thrown away: '' means «no answer».
 async answer(messages,onToken){
  try{return await LocalLLM.once(messages,onToken);}
  catch(e){
   // The GPU can be reset under memory pressure (seen on the first question right after the download): the engine is
   // then gone. Load it again from the browser's copy — no new download — and try the question once more.
   if(!/disposed|device.*lost|lost.*device/i.test(String(e?.message||e)))throw e;
   engine=null;loading=null;onToken?.('…');
   await LocalLLM.load();
   return LocalLLM.once(messages,onToken);
  }
 },
 async once(messages,onToken){
  const stream=await engine.chat.completions.create({messages,stream:true,temperature:0,repetition_penalty:1.05,max_tokens:450});
  let text='',bad=false;
  for await(const chunk of stream){
   const t=chunk.choices[0]?.delta?.content||'';if(!t||bad)continue;
   text+=t;
   // Stop generating, but let the stream end by itself so the engine stays usable for the next question.
   if(LocalLLM.broken(text)){bad=true;engine.interruptGenerate();continue;}
   onToken?.(text);
  }
  return bad?'':text.trim();
 },
 broken:text=>/[A-Za-z぀-ヿ一-鿿]/.test(text)||/(.)\1{7}/u.test(text)||/(\S{2,12})(?:\s*\1){4}/u.test(text)
};
scope.LocalLLM=LocalLLM;
})(globalThis);
