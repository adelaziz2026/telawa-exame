(function(scope){
// Deep learning: on-device speech recognition with Whisper (a Transformer neural network) fine-tuned on Quran
// recitation by Tarteel AI. Runs in the browser with ONNX Runtime; audio never leaves the device.
// Each model downloads once on first use and is then cached for offline use.
const LIB='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
// The quantized encoders need an operator WASM lacks, so encoders stay fp32 and only the decoders are quantized.
// On ordinary readers (451 recordings by 57 non-professional readers, sobolev210/quran-recitation-errors) the word
// error rate is 28.6% for «accurate», ~28% for «best» and 40.7% for «fast» (34.1% / 33.8% / 45.6% before the speech
// gate stopped rejecting recitation with no silence around it). Fine-tuning whisper-base further on 15,000 Tarteel.io
// user recordings did not beat it on readers and reciters it had not seen (Training/asr), so these stay.
const MODELS={
 // whisper-base: fewer misheard words on quiet or noisy recordings (~160 MB).
 accurate:{id:'aaqibhabib/whisper-base-ar-quran-onnx',options:{}},
 // The same model with its full-precision decoder: about 10% fewer misheard words on professional recitations
 // (word error rate 10.3% vs 11.4% on 190 ayat by 2 reciters, everyayah.com audio), and faster, but ~400 MB: for computers.
 best:{id:'aaqibhabib/whisper-base-ar-quran-onnx',options:{},decoder:'fp32'},
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
 return models[kind]??=import(LIB).then(({pipeline,env})=>{env.allowLocalModels=false;for(const k in files)delete files[k];return pipeline('automatic-speech-recognition',MODELS[kind].id,{dtype:{encoder_model:'fp32',decoder_model_merged:MODELS[kind].decoder||'q8'},device:'wasm',progress_callback:report});}).then(asr=>{ready[kind]=true;return asr;}).catch(e=>{delete models[kind];throw e;});
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
const FRAME=480;// 30 ms at 16 kHz
const energy=audio=>{const rms=[];for(let i=0;i+FRAME<=audio.length;i+=FRAME){let s=0;for(let j=i;j<i+FRAME;j++)s+=audio[j]*audio[j];rms.push(Math.sqrt(s/FRAME));}return rms;};
// Whisper invents words when given silence or background noise. Keep only the span that contains speech
// (by frame energy relative to the recording's own noise floor), and return null when there is no speech at all.
// The ends are found with a lower threshold than speech itself, so a last word read more quietly is not cut off.
function prepare(audio){
 const rms=energy(audio),sorted=[...rms].sort((a,b)=>a-b),floor=sorted[Math.floor(sorted.length*0.1)]||0,peak=sorted.at(-1)||0;
 const threshold=Math.max(floor*3,peak*0.1,0.003),edge=Math.max(floor*2,peak*0.04,0.002);
 const voiced=rms.filter(r=>r>threshold).length;
 let start=0,end=audio.length;
 if(voiced*FRAME<0.3*SR||peak<floor*4){
  // No quiet stretch to measure the noise floor against: recitation that fills the whole recording (started
  // straight away, or a fan or street behind it) has its quietest frames inside the speech. Measured on 451 recordings
  // by 57 ordinary readers, 55 (12%) were rejected as silent and scored as all words missing. Speech still rises and
  // falls with the syllables in the upper frequencies, which steady noise and low rumble do not: with the low
  // frequencies taken out, the loud 10% of frames are over twice (e^0.8) as loud as the quiet 10%. Such audio is kept whole.
  const hp=new Float32Array(audio.length);for(let i=1;i<audio.length;i++)hp[i]=audio[i]-0.95*audio[i-1];
  const e=energy(hp).sort((a,b)=>a-b),p=q=>e[Math.floor(e.length*q)]||0;
  if(!(peak>=0.02&&Math.log((p(0.9)+1e-5)/(p(0.1)+1e-5))>=0.8))return null;
 }else{
  const first=rms.findIndex(r=>r>edge),last=rms.length-1-[...rms].reverse().findIndex(r=>r>edge);
  start=Math.max(0,first*FRAME-0.25*SR);end=Math.min(audio.length,(last+1)*FRAME+0.5*SR);
 }
 const clip=audio.slice(start,end);let max=0;for(const v of clip)max=Math.max(max,Math.abs(v));
 // Normalise loudness so quiet recitation is not mistaken for noise.
 const gain=Math.min(20,0.9/(max||1));
 return clip.map(v=>v*gain);
}
// Long recitations are cut at the reader's own pauses into pieces of about 4–15 seconds. Whisper sometimes stops
// before the end of a long recording (on professional recitations, half of all missed words were the last words of
// the ayah), and a stumble early on can derail the rest; short pieces avoid both. Returns [start,end] sample ranges.
function segments(audio){
 const rms=energy(audio),n=rms.length,sorted=[...rms].sort((a,b)=>a-b),floor=sorted[Math.floor(n*0.1)]||0,peak=sorted.at(-1)||0;
 if(audio.length<8*SR)return [[0,audio.length]];
 // Only real pauses: quiet enough and at least 0.4 s long. Shorter, shallower dips happen inside words (before a
 // stop like ت or a throat letter like ح), and a cut there splits the word (measured: «أحللنا» heard as «حللنا»).
 const quiet=Math.max(floor*2.5,peak*0.035),minPause=Math.round(0.4*SR/FRAME),cuts=[];
 for(let i=0;i<n;){if(rms[i]<quiet){let j=i;while(j<n&&rms[j]<quiet)j++;if(j-i>=minPause&&i>0&&j<n)cuts.push(Math.round((i+j)/2));i=j;}else i++;}
 const out=[];let from=0;
 const push=to=>{if(to>from)out.push([from*FRAME,Math.min(audio.length,to*FRAME)]);from=to;};
 for(const c of cuts){const len=(c-from)*FRAME/SR;if(len>=4)push(c);}
 // No pause for over 15 s: cut at the quietest frame of the last few seconds.
 const done=[];for(const [x,y] of (push(n),out)){
  let start=x;while((y-start)/SR>15){const lo=start/FRAME+Math.round(10*SR/FRAME),hi=start/FRAME+Math.round(15*SR/FRAME);let best=lo;for(let k=lo;k<hi&&k<n;k++)if(rms[k]<rms[best])best=k;done.push([start,best*FRAME]);start=best*FRAME;}
  done.push([start,y]);
 }
 // A last piece under 1.5 s joins the one before it.
 if(done.length>1&&(done.at(-1)[1]-done.at(-1)[0])/SR<1.5){const lastPiece=done.pop();done.at(-1)[1]=lastPiece[1];}
 return done;
}
async function transcribe(blob,kind='accurate',onProgress){
 const asr=await load(kind,onProgress);
 // Whisper expects 16 kHz mono; decoding into a 16 kHz context resamples automatically.
 const speech=prepare((await new OfflineAudioContext(1,1,SR).decodeAudioData(await blob.arrayBuffer())).getChannelData(0));
 if(!speech)return '';
 const options={...MODELS[kind].options,chunk_length_s:30,stride_length_s:5,no_repeat_ngram_size:3},parts=[];
 // Pieces do not overlap: measured on 60 long recordings (two reciters), overlapping them made the model repeat or
 // garble the words at the joins. Cutting only at real pauses works best: word error rate 25.3% (one pass) → 15.6%, better on 51 of 60 recordings.
 for(const [x,y] of segments(speech)){const text=(await asr(speech.slice(x,y),options)).text.trim();if(text)parts.push(text);}
 return parts.join(' ');
}
scope.DeviceASR={load,loaded,supported,record,prepare,segments,transcribe,MODELS};
if(typeof module!=='undefined')module.exports={prepare,segments};
})(globalThis);
