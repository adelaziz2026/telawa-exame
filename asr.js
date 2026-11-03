(function(scope){
// Deep learning: on-device speech recognition with Whisper (a Transformer neural network) fine-tuned on Quran
// recitation by Tarteel AI. Runs in the browser with ONNX Runtime; audio never leaves the device.
// Each model downloads once on first use and is then cached for offline use.
const LIB='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
// The quantized encoders need an operator WASM lacks, so encoders stay fp32 and only the decoders are quantized.
const MODELS={
 // whisper-base: fewer misheard words on quiet or noisy recordings (~160 MB).
 accurate:{id:'aaqibhabib/whisper-base-ar-quran-onnx',options:{}},
 // whisper-tiny: faster and smaller (~63 MB), but mishears more.
 fast:{id:'Sharjeelbaig/whisper-tiny-ar-quran-onnx',options:{language:'arabic',task:'transcribe'}},
};
const SR=16000;
const models={},ready={},files={};
let progress=()=>{};
function report(e){
 if(e.status!=='progress'||!e.total)return;
 files[e.file]={loaded:e.loaded,total:e.total};
 const all=Object.values(files),loaded=all.reduce((n,f)=>n+f.loaded,0),total=all.reduce((n,f)=>n+f.total,0);
 progress(Math.round(loaded/total*100),Math.round(total/1e6));
}
function load(kind='accurate',onProgress){
 if(onProgress)progress=onProgress;
 return models[kind]??=import(LIB).then(({pipeline,env})=>{env.allowLocalModels=false;for(const k in files)delete files[k];return pipeline('automatic-speech-recognition',MODELS[kind].id,{dtype:{encoder_model:'fp32',decoder_model_merged:'q8'},device:'wasm',progress_callback:report});}).then(asr=>{ready[kind]=true;return asr;}).catch(e=>{delete models[kind];throw e;});
}
function loaded(kind){return kind?!!ready[kind]:Object.keys(ready).length>0;}
function supported(){return !!(scope.navigator?.mediaDevices?.getUserMedia&&scope.MediaRecorder&&scope.OfflineAudioContext);}
async function record(onLevel){
 // Browser noise suppression distorts speech for the model; Whisper copes with background noise better on raw audio.
 const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:false,autoGainControl:true}});
 const recorder=new MediaRecorder(stream),chunks=[];
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
 recorder.start();
 // Live input level (0–1) so the page can show whether the voice is being picked up.
 let meter=null,frame=0;
 if(onLevel&&scope.AudioContext){
  meter=new AudioContext();const analyser=meter.createAnalyser();analyser.fftSize=1024;
  meter.createMediaStreamSource(stream).connect(analyser);
  const data=new Float32Array(analyser.fftSize);
  const tick=()=>{analyser.getFloatTimeDomainData(data);let s=0;for(const v of data)s+=v*v;onLevel(Math.min(1,Math.sqrt(s/data.length)*8));frame=requestAnimationFrame(tick);};
  tick();
 }
 const release=()=>{cancelAnimationFrame(frame);meter?.close();onLevel?.(0);stream.getTracks().forEach(t=>t.stop());};
 return {
  stop:()=>new Promise((resolve,reject)=>{recorder.onstop=()=>{release();resolve(new Blob(chunks,{type:recorder.mimeType}));};recorder.onerror=e=>{release();reject(e);};recorder.stop();}),
  cancel(){recorder.onstop=null;try{recorder.stop();}catch{}release();}
 };
}
// Whisper invents words when given silence or background noise. Keep only the span that contains speech
// (by frame energy relative to the recording's own noise floor), and return null when there is no speech at all.
function prepare(audio){
 const frame=480,rms=[];
 for(let i=0;i+frame<=audio.length;i+=frame){let s=0;for(let j=i;j<i+frame;j++)s+=audio[j]*audio[j];rms.push(Math.sqrt(s/frame));}
 const sorted=[...rms].sort((a,b)=>a-b),floor=sorted[Math.floor(sorted.length*0.1)]||0,peak=sorted.at(-1)||0;
 const threshold=Math.max(floor*3,peak*0.1,0.003);
 const voiced=rms.map((r,i)=>r>threshold?i:-1).filter(i=>i>=0);
 if(voiced.length*frame<0.3*SR||peak<floor*4)return null;
 const start=Math.max(0,voiced[0]*frame-0.25*SR),end=Math.min(audio.length,(voiced.at(-1)+1)*frame+0.35*SR);
 const clip=audio.slice(start,end);let max=0;for(const v of clip)max=Math.max(max,Math.abs(v));
 // Normalise loudness so quiet recitation is not mistaken for noise.
 const gain=Math.min(20,0.9/(max||1));
 return clip.map(v=>v*gain);
}
async function transcribe(blob,kind='accurate',onProgress){
 const asr=await load(kind,onProgress);
 // Whisper expects 16 kHz mono; decoding into a 16 kHz context resamples automatically.
 const speech=prepare((await new OfflineAudioContext(1,1,SR).decodeAudioData(await blob.arrayBuffer())).getChannelData(0));
 if(!speech)return '';
 const result=await asr(speech,{...MODELS[kind].options,chunk_length_s:30,stride_length_s:5,no_repeat_ngram_size:3});
 return result.text.trim();
}
scope.DeviceASR={load,loaded,supported,record,prepare,transcribe,MODELS};
if(typeof module!=='undefined')module.exports={prepare};
})(globalThis);
