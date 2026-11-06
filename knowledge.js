(function(scope){
// Knowledge sources for the page and the assistant: tafsir per ayah, word search in the local Mushaf, surah facts,
// and hadith search. Everything is fetched from public https APIs on demand and cached in memory; nothing is made up.
// quran.com serves the classical tafsirs by id; their text is simple HTML.
const qc=id=>({url:(s,a)=>`https://api.quran.com/api/v4/tafsirs/${id}/by_ayah/${s}:${a}`,read:j=>({text:j.tafsir?.text||'',verses:Object.keys(j.tafsir?.verses||{})})});
const TAFSIRS={
 muyassar:{name:'التفسير الميسّر',by:'مجمع الملك فهد',url:(s,a)=>`https://quranenc.com/api/v1/translation/aya/arabic_moyassar/${s}/${a}`,read:j=>({text:j.result?.translation||''})},
 saadi:{name:'تفسير السعدي',by:'الشيخ عبد الرحمن السعدي',...qc(91)},
 ibn_kathir:{name:'تفسير ابن كثير',by:'الحافظ ابن كثير',...qc(14)},
 qurtubi:{name:'تفسير القرطبي',by:'الإمام القرطبي',...qc(90)},
 tabari:{name:'تفسير الطبري',by:'الإمام ابن جرير الطبري',...qc(15)},
 baghawi:{name:'تفسير البغوي',by:'الإمام البغوي',...qc(94)},
 wasit:{name:'التفسير الوسيط',by:'د. محمد سيد طنطاوي',...qc(93)},
};
const HADITH={
 nawawi:{name:'الأربعون النووية',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-nawawi.min.json'},
 bukhari:{name:'صحيح البخاري',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-bukhari.min.json'},
 muslim:{name:'صحيح مسلم',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-muslim.min.json'},
};
const cache=new Map();
const fetchJson=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout?.(20000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json();};
// Tafsir text arrives as plain text or simple HTML (<p>, <span>); only its text is kept, split into paragraphs.
function paragraphs(text){
 const html=/<\w/.test(text);let parts;
 if(html&&typeof DOMParser!=='undefined'){const doc=new DOMParser().parseFromString(text,'text/html');parts=[...doc.querySelectorAll('p')].map(p=>p.textContent);if(!parts.length)parts=doc.body.textContent.split(/\n+/);}
 else parts=(html?text.replace(/<\/p>/gi,'\n').replace(/<[^>]+>/g,''):text).split(/\n+/);
 // Very long blocks (Al-Qurtubi's text has no line breaks) are split at his section markers, then at sentence ends.
 const out=[];
 for(const p of parts.map(p=>p.replace(/\s+/g,' ').trim()).filter(Boolean)){
  if(p.length<900){out.push(p);continue;}
  for(const piece of p.split(/(?=قوله تعالى|\[ ?الباب|(?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة) ?: )/)){
   let rest=piece.trim();
   while(rest.length>900){const cut=rest.slice(0,900).search(/[.؟!:][^.؟!:]*$/);const at=cut>300?cut+1:900;out.push(rest.slice(0,at).trim());rest=rest.slice(at).trim();}
   if(rest)out.push(rest);
  }
 }
 return out;
}
async function tafsir(source,surah,ayah){
 const t=TAFSIRS[source];if(!t)throw Error(`Unknown tafsir "${source}". Use: ${Object.keys(TAFSIRS).join(', ')}`);
 const key=`${source}:${surah}:${ayah}`;
 if(!cache.has(key))cache.set(key,fetchJson(t.url(surah,ayah)).then(j=>{const r=t.read(j);return {source,name:t.name,by:t.by,surah,ayah,verses:r.verses||[`${surah}:${ayah}`],paragraphs:paragraphs(r.text)};}).catch(e=>{cache.delete(key);throw e;}));
 return cache.get(key);
}
// Letters only, without diacritics; alif forms, ى/ي and ة/ه are treated alike so «الصلاة» finds «الصلوة».
const plain=t=>String(t).normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^\u0621-\u064a\s]/g,' ').replace(/\s+/g,' ').trim();
// Word search in the Mushaf already loaded by the page (simple edition). A whole word matches with the attached
// prefixes Arabic writes onto it («الصبر» finds «بالصبر» and «والصبر»); partial:true matches any part of a word;
// phrase:true needs the words together and in order (the last one may be unfinished, as when quoting from memory).
// total counts ayat; occurrences counts every time the word (or phrase) appears.
const PREFIXES=['','ال','و','ف','ب','ل','ك','وال','فال','بال','كال','لل','وب','ول','فب','فل','وك','وبال','ولل','فلل'];
const formsOf=q=>q.split(' ').map(w=>w.length>3&&w.startsWith('ال')?w.slice(2):w).map(w=>({w,forms:new Set(PREFIXES.map(p=>p+w))}));
function countHits(tokens,text,words,{partial,phrase}){
 if(partial){if(!words.every(x=>text.includes(x.w)))return 0;return words.length===1?text.split(words[0].w).length-1:1;}
 if(phrase&&words.length>1){
  let n=0;const last=words.length-1;
  for(let i=0;i+words.length<=tokens.length;i++)if(words.every((x,j)=>x.forms.has(tokens[i+j])||(j===last&&x.w.length>1&&[...x.forms].some(f=>tokens[i+j].startsWith(f)))))n++;
  return n;
 }
 if(!words.every(x=>tokens.some(t=>x.forms.has(t))))return 0;
 return words.length===1?tokens.filter(t=>words[0].forms.has(t)).length:1;
}
function searchQuran(chapters,query,{surah=null,limit=20,partial=false,phrase=false}={}){
 const q=plain(query);if(!q)return {query,total:0,occurrences:0,results:[]};
 const words=formsOf(q),results=[];let total=0,occurrences=0;
 for(const c of chapters){
  if(surah&&c.number!==surah)continue;
  for(const a of c.ayahs){
   const text=plain(a.text),n=countHits(text.split(' '),text,words,{partial,phrase});
   if(n){total++;occurrences+=n;if(results.length<limit)results.push({surah:c.number,surah_name:c.name,ayah:a.numberInSurah,text:a.text});}
  }
 }
 return {query,total,occurrences,results};
}
// Which ayah says this? The words in order first; otherwise (a misheard or half-remembered quote) the ayat that
// share most of its words, best first. exact tells which of the two it is.
function findAyah(chapters,quote,{limit=5}={}){
 const exact=searchQuran(chapters,quote,{phrase:true,limit});
 if(exact.total)return {query:quote,exact:true,total:exact.total,results:exact.results};
 const words=formsOf(plain(quote)).filter(x=>x.w.length>1);if(words.length<2)return {query:quote,exact:false,total:0,results:[]};
 const found=[];
 for(const c of chapters)for(const a of c.ayahs){
  const tokens=plain(a.text).split(' '),share=words.filter(x=>tokens.some(t=>x.forms.has(t))).length/words.length;
  if(share>=0.6)found.push({share,surah:c.number,surah_name:c.name,ayah:a.numberInSurah,text:a.text});
 }
 found.sort((x,y)=>y.share-x.share||x.text.length-y.text.length);
 return {query:quote,exact:false,total:found.length,results:found.slice(0,limit).map(({share,...r})=>({...r,match:Math.round(share*100)}))};
}
function surahInfo(chapters,n){
 const c=chapters[n-1];if(!c)throw Error(`Surah ${n} does not exist (1-114).`);
 const juz=[...new Set(c.ayahs.map(a=>a.juz).filter(Boolean))],pages=c.ayahs.map(a=>a.page).filter(Boolean);
 return {number:c.number,name:c.name,english_name:c.englishName,meaning:c.englishNameTranslation,revelation:c.revelationType==='Meccan'?'مكية':c.revelationType==='Medinan'?'مدنية':c.revelationType,ayat:c.ayahs.length,words:c.ayahs.reduce((n,a)=>n+plain(a.text).split(' ').length,0),juz,pages:pages.length?[pages[0],pages.at(-1)]:null,sajda_ayat:c.ayahs.filter(a=>a.sajda).map(a=>a.numberInSurah)};
}
// Hadith books download once on first search (the large ones are ~9 MB) and are then searched in memory.
async function hadithBook(id,onLoading){
 const b=HADITH[id];if(!b)throw Error(`Unknown hadith book "${id}". Use: ${Object.keys(HADITH).join(', ')}`);
 const key='hadith:'+id;
 if(!cache.has(key)){onLoading?.(b.name);cache.set(key,fetchJson(b.url).then(j=>j.hadiths.filter(h=>h.text).map(h=>({number:h.hadithnumber,text:h.text,plain:plain(h.text)}))).catch(e=>{cache.delete(key);throw e;}));}
 return cache.get(key);
}
async function searchHadith(query,{books=['nawawi','bukhari','muslim'],limit=8,onLoading}={}){
 const words=plain(query).split(' ').filter(w=>w.length>1);if(!words.length)return {query,total:0,results:[]};
 const results=[];let total=0;
 for(const id of books){
  for(const h of await hadithBook(id,onLoading)){
   if(words.every(w=>h.plain.includes(w))){total++;if(results.length<limit)results.push({book:HADITH[id].name,number:h.number,text:h.text.length>900?h.text.slice(0,900)+'…':h.text});}
  }
 }
 return {query,total,results};
}
const api={TAFSIRS,HADITH,tafsir,paragraphs,plain,searchQuran,findAyah,surahInfo,searchHadith};
if(typeof module!=='undefined')module.exports=api;else scope.QuranKnowledge=api;
})(globalThis);
