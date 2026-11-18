// Free conversation on computers: a small language model (Qwen2.5-1.5B, Apache-2.0, via WebLLM) runs on the computer's own GPU.
// Never on phones or in the phone app: it needs WebGPU and a ~0.85 GB one-time download (kept by the browser after).
// Phones can instead ask the same fine-tuned model on the app's server (Space/), but only after the person turns it on,
// because the question then leaves the device. Nothing is downloaded to the phone.
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
let remoteOn=false;
const native=!!scope.Capacitor?.isNativePlatform?.();
const phone=/Android|iPhone|iPad|iPod|Mobile/i.test(scope.navigator?.userAgent||'')||!!scope.matchMedia?.('(pointer: coarse)').matches;
let engine=null,loading=null;
const LocalLLM={
 // Off for everyone: in tests a small model was too slow and sometimes invented answers (see Document/). It can be tried on
 // a computer with WebGPU by setting localStorage «tarteel:llmLab» to true; phones never see it.
 supported:()=>{let lab=false;try{lab=scope.localStorage?.getItem('tarteel:llmLab')==='true';}catch{}return lab&&!native&&!phone&&!!scope.navigator?.gpu;},
 ready:()=>!!engine||remoteOn,
 remoteSupported:()=>!!remoteUrl()&&(native||phone),
 remote:()=>remoteOn,
 disableRemote(){remoteOn=false;},
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
   const start=await scope.fetch(remoteUrl()+'/gradio_api/call/ask',{method:'POST',headers:{'content-type':'application/json'},signal:stop.signal,body:JSON.stringify({data:[question,sources.slice(0,8000),turns]})});
   if(!start.ok)throw friendly(busy);
   const {event_id:id}=await start.json();
   const r=await scope.fetch(remoteUrl()+'/gradio_api/call/ask/'+encodeURIComponent(id),{signal:stop.signal});
   if(!r.ok)throw friendly(busy);
   const reader=r.body.getReader(),decoder=new TextDecoder;let buffer='',text='';
   for(;;){
    const {value,done}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'');
    const events=buffer.split('\n\n');buffer=events.pop();
    for(const block of events){
     const kind=block.match(/^event: (.+)$/m)?.[1],line=block.match(/^data: (.*)$/m)?.[1];
     if(kind==='error')throw friendly(/quota|runs limit/i.test(line||'')?'انتهت أسئلتك المجانية اليوم في الخدمة الذكية (نحو 3 أسئلة). ما زالت أوامر التطبيق تعمل، وحاول غدًا.':busy);
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
