// Loads app.js + assistant.js in Node with the real Mushaf, so training prompts are built by the app's own llmSources().
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

async function loadApp(){
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'1',textContent:'',disabled:false,checked:false,hidden:true,style:{setProperty(){},removeProperty(){}},dataset:{},children:[],
  classList:{add(){},remove(){},toggle(){}},replaceChildren(...c){this.children=c;if(id==='surah'||id==='ayah')this.value=String(c[0]?.value||1);},
  append(){},prepend(){},pause(){},play(){return Promise.resolve();},closest(){return this.details||(this.details={});},scrollIntoView(){},setAttribute(){},
  addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},focus(){},remove(){}});return elements.get(id);};
 const files={'data/quran.json':JSON.parse(read('data/quran.json')),'data/simple.json':JSON.parse(read('data/simple.json'))};
 const node=()=>({append(){},prepend(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}},style:{setProperty(){},removeProperty(){}},dataset:{},remove(){},querySelector(){return null;},addEventListener(){}});
 const ctx={document:{getElementById:el,createElement:node,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},body:node(),documentElement:node()},
  window:{},navigator:{},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},Option:function(t,v){this.text=t;this.value=v;},
  fetch:async u=>{const k=String(u).replace(/^\.?\//,'');return files[k]?{ok:true,json:async()=>files[k]}:{ok:false,json:async()=>({})};},
  QuranCompare:require(path.join(ROOT,'compare.js')),QuranLearning:require(path.join(ROOT,'learning.js')),QuranKnowledge:require(path.join(ROOT,'knowledge.js')),
  Date,console,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},AbortSignal,URL,
  matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},speechSynthesis:{getVoices:()=>[],speak(){},cancel(){}}};
 ctx.globalThis=ctx;ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(read('app.js'),ctx);
 await new Promise(r=>setImmediate(r));await new Promise(r=>setTimeout(r,50));
 vm.runInContext(read('assistant.js'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 return {
  ctx,run,
  // The sources the app would send for this question, with surah:ayah open on the practice page.
  sources(question,surah=1,ayah=1){el('surah').value=String(surah);el('ayah').value=String(ayah);el('toAyah').value=String(ayah);
   return ctx.TarteelAssistant.llm.sources(question);},
  rules:()=>ctx.TarteelAssistant.llm.rules,
  surahs:()=>run('surahs'),
  nameOf:n=>ctx.TarteelAssistant.llm.nameOf(n),
  norm:s=>ctx.TarteelAssistant.llm.norm(s)
 };
}
module.exports={loadApp,ROOT};
