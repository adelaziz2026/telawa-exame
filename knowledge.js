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
 // The four Sunan, with each hadith's grade by named scholars (Al-Albani, Shu'ayb al-Arna'ut, Ahmad Shakir…).
 abudawud:{name:'سنن أبي داود',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-abudawud.min.json'},
 tirmidhi:{name:'سنن الترمذي',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-tirmidhi.min.json'},
 nasai:{name:'سنن النسائي',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-nasai.min.json'},
 ibnmajah:{name:'سنن ابن ماجه',url:'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-ibnmajah.min.json'},
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
// Each ayah's normalised text, worked out once (searches run over all 6,236 ayat).
const plainOf=new WeakMap(),plainAyah=a=>{let t=plainOf.get(a);if(t===undefined)plainOf.set(a,t=plain(a.text));return t;};
// For word search only: the alif that just carries tanween fath is dropped, so «مِصْرًا» is found as «مصر» while a
// real alif («تَابَا») stays. Quotes keep plainAyah, since people say and type that alif («إن مع العسر يسرا»).
const bareOf=new WeakMap(),searchText=a=>{let t=bareOf.get(a);if(t===undefined)bareOf.set(a,t=plain(String(a.text).replace(/ًا|اً/g,'')));return t;};
function searchQuran(chapters,query,{surah=null,limit=20,partial=false,phrase=false}={}){
 const q=plain(query);if(!q)return {query,total:0,occurrences:0,results:[]};
 const words=formsOf(q),results=[];let total=0,occurrences=0;
 for(const c of chapters){
  if(surah&&c.number!==surah)continue;
  for(const a of c.ayahs){
   const text=plainAyah(a),bare=searchText(a),n=Math.max(countHits(text.split(' '),text,words,{partial,phrase}),bare===text?0:countHits(bare.split(' '),bare,words,{partial,phrase}));
   if(n){total++;occurrences+=n;if(results.length<limit)results.push({surah:c.number,surah_name:c.name,ayah:a.numberInSurah,text:a.text});}
  }
 }
 return {query,total,occurrences,results};
}
// ---- Finding an ayah from a quote that may be misheard ----
// A word without the multi-letter prefixes written onto it (وال، بال، لل…), so «بالصبر» and «الصبر» compare as one.
const bare=w=>{for(const p of ['وبال','ولل','فلل','وال','فال','بال','كال','لل','ال'])if(w.startsWith(p)&&w.length-p.length>=2)return w.slice(p.length);return w;};
// Exactly one letter added, dropped or changed.
function oneEdit(a,b){
 if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(a.length<b.length)j++;else{i++;j++;}}
 return edits+(a.length-i)+(b.length-j)<=1;
}
// How well a heard word fits a Mushaf word: the same, the same with و ف ب ل ك in front, or one letter misheard.
function near(w,t){
 if(w===t)return 1;
 if((t.length===w.length+1&&t.endsWith(w)&&'وفبلك'.includes(t[0]))||(w.length===t.length+1&&w.endsWith(t)&&'وفبلك'.includes(w[0])))return 0.9;
 if(w.length===2&&t.length===2)return w[0]===t[0]||w[1]===t[1]?0.6:0;
 return w.length>=3&&t.length>=3&&oneEdit(w,t)?0.7:0;
}
// Built once per Mushaf: each ayah's words, and in how many ayat each word appears (rare words say more).
const indexes=new WeakMap();
function indexOf(chapters){
 let ix=indexes.get(chapters);if(ix)return ix;
 const ayat=[],df=new Map(),posts=new Map();
 for(const c of chapters)for(const a of c.ayahs){const tokens=plainAyah(a).split(' ').map(bare),n=ayat.length;ayat.push({c,a,tokens});for(const t of new Set(tokens)){df.set(t,(df.get(t)||0)+1);(posts.get(t)||posts.set(t,[]).get(t)).push(n);}}
 // posts: which ayat contain each word, so a search scores only the ayat sharing a word with the quote.
 ix={ayat,df,posts};indexes.set(chapters,ix);return ix;
}
// Which ayah says this? The words in order first. Otherwise (misheard, or half-remembered) every ayah is scored by
// the words it shares with the quote, weighted by how rare each word is, allowing one misheard letter per word and
// preferring the words in the same order; exact tells which of the two it is, match is the score in percent.
function findAyah(chapters,quote,{limit=5}={}){
 // Speech recognition runs «يا» into the next word («يامريم»): split it again when the joined word is not in the Mushaf.
 const {df}=indexOf(chapters);
 quote=plain(quote).split(' ').map(w=>w.length>=4&&w.startsWith('يا')&&!df.has(bare(w))&&df.has(bare(w.slice(2)))?'يا '+w.slice(2):w).join(' ');
 const exact=searchQuran(chapters,quote,{phrase:true,limit});
 if(exact.total)return {query:quote,exact:true,total:exact.total,results:exact.results};
 const q=plain(quote).split(' ').map(bare).filter(w=>w.length>1);if(q.length<2)return {query:quote,exact:false,total:0,results:[]};
 const {ayat,posts}=indexOf(chapters),N=ayat.length;
 // A word not in the Mushaf (misheard) gets an ordinary weight rather than the highest.
 const weights=q.map(w=>Math.log(1+N/((df.get(w)??50)+1))),sum=weights.reduce((x,y)=>x+y,0),memo=new Map();
 const fit=(w,t)=>{const k=w+' '+t;let v=memo.get(k);if(v===undefined)memo.set(k,v=near(w,t));return v;};
 const found=[];
 // Candidates: ayat with a word close to some word of the quote (one letter off at most).
 // Very common words («الله»، «لا»، «من») would bring in most of the Mushaf, so the rarer words pick the candidates.
 const rare=q.map((w,k)=>[w,weights[k]]).sort((x,y)=>y[1]-x[1]).slice(0,Math.max(2,Math.ceil(q.length/2))).map(([w])=>w);
 const candidates=new Set();for(const w of rare)for(const [t,list] of posts)if(Math.abs(t.length-w.length)<=1&&near(w,t))for(const n of list)candidates.add(n);
 for(const n of candidates){const {c,a,tokens}=ayat[n];
  let got=0,inOrder=0,last=-1;
  for(let k=0;k<q.length;k++){
   let best=0,pos=-1;for(let i=0;i<tokens.length;i++){const s=fit(q[k],tokens[i]);if(s>best){best=s;pos=i;if(s===1)break;}}
   if(best){got+=weights[k]*best;if(pos>last)inOrder++;last=pos;}
  }
  const score=got/sum;
  if(score>=0.5)found.push({score:score+0.05*inOrder/q.length,surah:c.number,surah_name:c.name,ayah:a.numberInSurah,text:a.text});
 }
 found.sort((x,y)=>y.score-x.score||x.text.length-y.text.length);
 return {query:quote,exact:false,total:found.length,results:found.slice(0,limit).map(({score,...r})=>({...r,match:Math.min(100,Math.round(score*100))}))};
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
 if(!cache.has(key)){onLoading?.(b.name);cache.set(key,fetchJson(b.url).then(j=>j.hadiths.filter(h=>h.text).map(h=>({number:h.hadithnumber,text:h.text,plain:plain(h.text),grades:gradesOf(id,h)}))).catch(e=>{cache.delete(key);throw e;}));}
 return cache.get(key);
}
async function searchHadith(query,{books=['nawawi','bukhari','muslim'],limit=8,onLoading}={}){
 const words=plain(query).split(' ').filter(w=>w.length>1);if(!words.length)return {query,total:0,results:[]};
 const results=[];let total=0;
 for(const id of books){
  for(const h of await hadithBook(id,onLoading)){
   if(words.every(w=>h.plain.includes(w))){total++;if(results.length<limit)results.push({book:HADITH[id].name,number:h.number,text:h.text.length>900?h.text.slice(0,900)+'…':h.text,grades:h.grades});}
  }
 }
 return {query,total,results};
}
// ---- Tajweed: the rules in an ayah (riwayat Hafs), read from the Uthmani text's letters and marks ----
// Marks are built from code points so the source stays readable (they are invisible combining characters).
const mk=n=>String.fromCharCode(n);
const FATHA=mk(0x64e),DAMMA=mk(0x64f),KASRA=mk(0x650),SHADDA=mk(0x651),SUKUN=mk(0x652),TANWEEN=[mk(0x64b),mk(0x64c),mk(0x64d)],MADDA=mk(0x653),DAGGER=mk(0x670),SILENT=mk(0x6df);
const VOWELS=[FATHA,DAMMA,KASRA,...TANWEEN];
const isMark=c=>{const n=c.codePointAt(0);return (n>=0x610&&n<=0x61a)||(n>=0x64b&&n<=0x65f)||n===0x670||(n>=0x6d6&&n<=0x6ed);};
const HAMZA='ءأإؤئآ',THROAT=HAMZA+'هعحغخ',IKHFA='تثجدذزسشصضطظفقك',QALQALA='قطبجد';
const TAJWEED_RULES={
 izhar:{name:'إظهار حلقي',group:'النون الساكنة والتنوين',how:'نون ساكنة أو تنوين قبل حرف حلقي (ء هـ ع ح غ خ): تُنطق النون واضحة من مخرجها بلا غنة زائدة.'},
 idgham_ghunna:{name:'إدغام بغنة',group:'النون الساكنة والتنوين',how:'نون ساكنة أو تنوين في آخر كلمة وبعدها (ي ن م و) في أول التالية: تُدغم النون في الحرف التالي مع غنة بمقدار حركتين.'},
 idgham_no_ghunna:{name:'إدغام بغير غنة',group:'النون الساكنة والتنوين',how:'نون ساكنة أو تنوين وبعدها (ل) أو (ر): تُدغم النون إدغامًا كاملًا بلا غنة.'},
 iqlab:{name:'إقلاب',group:'النون الساكنة والتنوين',how:'نون ساكنة أو تنوين وبعدها باء: تُقلب النون ميمًا مخفاة مع غنة بمقدار حركتين، والشفتان منطبقتان انطباقًا خفيفًا.'},
 ikhfa:{name:'إخفاء حقيقي',group:'النون الساكنة والتنوين',how:'نون ساكنة أو تنوين قبل أحد الحروف الخمسة عشر (ت ث ج د ذ ز س ش ص ض ط ظ ف ق ك): تُنطق النون بين الإظهار والإدغام مع غنة بمقدار حركتين.'},
 idgham_shafawi:{name:'إدغام شفوي',group:'الميم الساكنة',how:'ميم ساكنة بعدها ميم: تُدغم الأولى في الثانية مع غنة بمقدار حركتين.'},
 ikhfa_shafawi:{name:'إخفاء شفوي',group:'الميم الساكنة',how:'ميم ساكنة بعدها باء: تُخفى الميم عند الباء مع غنة بمقدار حركتين.'},
 izhar_shafawi:{name:'إظهار شفوي',group:'الميم الساكنة',how:'ميم ساكنة قبل غير الميم والباء: تُظهر الميم بلا غنة، ويُحذر من إخفائها خاصة عند الواو والفاء.'},
 ghunna:{name:'غنة مشددة',group:'النون والميم المشددتان',how:'نون أو ميم مشددة: غنة كاملة بمقدار حركتين.'},
 qalqala_sughra:{name:'قلقلة صغرى',group:'القلقلة',how:'حرف من (قطب جد) ساكن في وسط الكلام: يُنطق مع نبرة (اهتزاز) خفيفة حتى لا يختفي صوته.'},
 qalqala_kubra:{name:'قلقلة كبرى',group:'القلقلة',how:'الوقف على حرف من (قطب جد) في آخر الآية: قلقلة أوضح، ويزيد وضوحها إن كان مشددًا.'},
 lam_shamsiyya:{name:'لام شمسية',group:'لام التعريف',how:'لام «ال» قبل حرف شمسي (مشدد بعدها): تُدغم اللام فلا تُنطق.'},
 lam_qamariyya:{name:'لام قمرية',group:'لام التعريف',how:'لام «ال» قبل حرف قمري: تُظهر اللام ساكنة.'},
 madd_muttasil:{name:'مد واجب متصل',group:'المدود',how:'حرف مد بعده همزة في نفس الكلمة: يُمد 4 أو 5 حركات.'},
 madd_munfasil:{name:'مد جائز منفصل',group:'المدود',how:'حرف مد في آخر كلمة وهمزة في أول التالية: يُمد 4 أو 5 حركات لحفص من طريق الشاطبية.'},
 madd_lazim:{name:'مد لازم',group:'المدود',how:'حرف مد بعده سكون أصلي أو حرف مشدد: يُمد 6 حركات لزومًا.'},
 jalala_heavy:{name:'تفخيم لام لفظ الجلالة',group:'التفخيم والترقيق',how:'لام «الله» بعد فتح أو ضم أو في أول الكلام: تُنطق مفخمة.'},
 jalala_light:{name:'ترقيق لام لفظ الجلالة',group:'التفخيم والترقيق',how:'لام «الله» بعد كسر: تُنطق مرققة.'},
 madd_arid:{name:'مد عارض للسكون',group:'المدود',how:'الوقف على آخر الآية وقبل الحرف الأخير حرف مد: يجوز 2 أو 4 أو 6 حركات.'},
};
function lettersOf(text){
 const out=[];let word=0,started=false;
 // Not NFC: it would merge alif and madda into «آ» and hide the madd mark.
 for(const c of text){
  if(c===' '){if(started)word++;started=false;continue;}
  if(isMark(c)){if(out.length)out[out.length-1].marks+=c;continue;}
  if(c==='ـ')continue;
  out.push(c==='آ'?{c:'ا',marks:MADDA,word}:{c,marks:'',word});started=true;
 }
 return out;
}
const has=(l,m)=>l.marks.includes(m);
const vowelled=l=>VOWELS.some(v=>has(l,v))||has(l,SHADDA);
// A letter with neither a vowel nor shadda is quiescent (the Mushaf leaves the sukun off before ikhfa and idgham).
const sakin=l=>has(l,SUKUN)||(!vowelled(l)&&!has(l,DAGGER)&&!has(l,SILENT));
// The next letter that is pronounced: silent letters (marked ۟, the alif or ya carrying a tanween, hamzat al-wasl) are skipped.
function nextSounded(L,i){
 for(let j=i+1;j<L.length;j++){
  const x=L[j];
  if(has(x,SILENT)||x.c==='ٱ')continue;
  if((x.c==='ا'||x.c==='ى')&&!x.marks&&TANWEEN.some(t=>has(L[j-1],t)))continue;
  return j;
 }
 return -1;
}
function tajweed(text){
 const L=lettersOf(text),words=text.split(/\s+/).filter(w=>[...w].some(c=>!isMark(c))),found=[];
 const add=(rule,i,j=i)=>found.push({rule,word:[...new Set([L[i].word,L[j].word])].map(w=>words[w]).join(' ')});
 for(let i=0;i<L.length;i++){
  const l=L[i],j=nextSounded(L,i),n=j>=0?L[j]:null,last=j<0;
  // Noon sakinah and tanween.
  if((l.c==='ن'&&sakin(l)&&!last)||TANWEEN.some(t=>has(l,t))&&!last){
   if(THROAT.includes(n.c))add('izhar',i,j);
   else if(n.c==='ب')add('iqlab',i,j);
   else if('ينمو'.includes(n.c)){if(n.word!==l.word)add('idgham_ghunna',i,j);}
   else if('لر'.includes(n.c))add('idgham_no_ghunna',i,j);
   else if(IKHFA.includes(n.c))add('ikhfa',i,j);
  }
  // Meem sakinah.
  if(l.c==='م'&&sakin(l)&&!last){add(n.c==='م'?'idgham_shafawi':n.c==='ب'?'ikhfa_shafawi':'izhar_shafawi',i,j);}
  // Mushaddad noon and meem.
  if((l.c==='ن'||l.c==='م')&&has(l,SHADDA))add('ghunna',i);
  // Qalqalah: sakin in the middle, or the last letter where the reader stops.
  if(QALQALA.includes(l.c)){if(last)add('qalqala_kubra',i);else if(has(l,SUKUN))add('qalqala_sughra',i);}
  // Lam of «ال»: written sukun = qamariyya; no mark and the next letter doubled = shamsiyya.
  if(l.c==='ل'&&i>0&&(L[i-1].c==='ٱ'||L[i-1].c==='ا')&&L[i-1].word===l.word&&(i<2||L[i-2].word!==l.word||'وفبكل'.includes(L[i-2].c))){
   if(has(l,SUKUN))add('lam_qamariyya',i);else if(n&&!vowelled(l)&&has(n,SHADDA)&&n.word===l.word)add('lam_shamsiyya',i);
   // «ٱلَّذِينَ، ٱلَّيْلِ»: the lam of «ال» is not written, the doubled lam after hamzat al-wasl shows it.
   else if(L[i-1].c==='ٱ'&&has(l,SHADDA))add('lam_shamsiyya',i);
  }
  // «لِلْمُتَّقِينَ»: after «لِ» the alif of «ال» is dropped; a lam with sukun right after it is still qamariyya.
  if(l.c==='ل'&&has(l,SUKUN)&&i>0&&L[i-1].c==='ل'&&L[i-1].word===l.word&&(i<2||L[i-2].word!==l.word))add('lam_qamariyya',i);
  // Madd marked with ٓ: what follows decides its kind.
  if(has(l,MADDA)&&n){
   if(HAMZA.includes(n.c))add(n.word===l.word?'madd_muttasil':'madd_munfasil',i,j);
   else if(has(n,SHADDA)||has(n,SUKUN))add('madd_lazim',i,j);
  }
 }
 // Stopping at the end of the ayah after a long vowel.
 const e=L.length-1,p=L[e-1];
 if(p&&(p.c==='ا'&&!vowelled(p)||p.c==='و'&&!vowelled(p)&&has(L[e-2]||p,DAMMA)||p.c==='ي'&&!vowelled(p)&&has(L[e-2]||p,KASRA)||has(p,DAGGER)))add('madd_arid',e);
 // The lam of «الله»: heavy or light.
 for(const j of jalalaRules(text))found.push({rule:j.rule.startsWith('تفخيم')?'jalala_heavy':'jalala_light',word:j.word});
 // One entry per rule, with the words where it occurs.
 const byRule=new Map();
 for(const f of found){const r=byRule.get(f.rule)||byRule.set(f.rule,{rule:f.rule,...TAJWEED_RULES[f.rule],words:[]}).get(f.rule);if(!r.words.includes(f.word))r.words.push(f.word);}
 return [...byRule.values()];
}
// ---- Quran sciences: facts counted from the local Mushaf (exact), plus a few well-established classical facts ----
function quranFacts(chapters){
 const all=chapters.flatMap(c=>c.ayahs.map(a=>({c,a}))),byAyat=[...chapters].sort((x,y)=>y.ayahs.length-x.ayahs.length);
 const max=k=>Math.max(...all.map(x=>x.a[k]||0));
 return {
  counted_from_this_mushaf:{
   surahs:chapters.length,ayat:all.length,words:all.reduce((n,x)=>n+plain(x.a.text).split(' ').length,0),
   meccan_surahs:chapters.filter(c=>c.revelationType==='Meccan').length,medinan_surahs:chapters.filter(c=>c.revelationType==='Medinan').length,
   juz:max('juz'),hizb:Math.round(max('hizbQuarter')/4),hizb_quarters:max('hizbQuarter'),manzil:max('manzil'),pages:max('page'),ruku:max('ruku'),
   longest_surah:{number:byAyat[0].number,name:byAyat[0].name,ayat:byAyat[0].ayahs.length},shortest_surahs:byAyat.filter(c=>c.ayahs.length===byAyat.at(-1).ayahs.length).map(c=>({number:c.number,name:c.name,ayat:c.ayahs.length})),
   sajdat_tilawa:all.filter(x=>x.a.sajda).map(x=>({surah:x.c.number,name:x.c.name,ayah:x.a.numberInSurah})),
   ayah_count_method:'العدّ الكوفي (رواية حفص عن عاصم)',
  },
  classical:[
   'أول ما نزل من القرآن: أول خمس آيات من سورة العلق «اقرأ باسم ربك الذي خلق…» (في صحيح البخاري من حديث عائشة).',
   'آخر ما نزل على المشهور: قوله تعالى «واتقوا يومًا ترجعون فيه إلى الله» (البقرة 281)، وفيه أقوال أخرى.',
   'سورة التوبة وحدها لا تبدأ بالبسملة، والبسملة آية من سورة النمل (30) أيضًا.',
   'جُمع القرآن في عهد أبي بكر الصديق في صحف، ثم نسخه عثمان بن عفان في المصاحف ووزعها على الأمصار.',
   'القراءات العشر المتواترة: نافع، ابن كثير، أبو عمرو، ابن عامر، عاصم، حمزة، الكسائي، أبو جعفر، يعقوب، خلف العاشر. والمصحف في التطبيق برواية حفص عن عاصم.',
   'نزل القرآن منجّمًا (مفرّقًا) في نحو ثلاث وعشرين سنة: نحو ثلاث عشرة سنة بمكة وعشر بالمدينة.',
   'الحروف المقطعة افتُتحت بها 29 سورة، مثل «الم» و«حم» و«ق».',
  ],
 };
}
// ---- Hadith sciences (مصطلح الحديث): the standard definitions, as in Ibn Hajar's «نخبة الفكر» and «المنظومة البيقونية» ----
const MUSTALAH_SOURCE='تعريفات مصطلح الحديث المشهورة كما في «نخبة الفكر» لابن حجر و«المنظومة البيقونية»';
const MUSTALAH={
 'صحيح':{group:'مراتب القبول',def:'ما اتصل سنده بنقل العدل الضابط عن مثله إلى منتهاه، من غير شذوذ ولا علة. شروطه خمسة: اتصال السند، وعدالة الرواة، وتمام ضبطهم، وعدم الشذوذ، وعدم العلة.'},
 'حسن':{group:'مراتب القبول',def:'ما اتصل سنده بنقل العدل الذي خفّ ضبطه عن مثله إلى منتهاه، من غير شذوذ ولا علة؛ فهو كالصحيح إلا أن ضبط راويه أخف. وهو مقبول يُحتج به.'},
 'صحيح لغيره':{group:'مراتب القبول',def:'الحسن لذاته إذا رُوي من طريق آخر مثله أو أقوى منه، فيرتقي إلى الصحيح.'},
 'حسن لغيره':{group:'مراتب القبول',def:'الضعيف إذا تعددت طرقه ولم يكن سبب ضعفه فسق الراوي أو كذبه، فيرتقي إلى الحسن.'},
 'حسن صحيح':{group:'مراتب القبول',def:'مصطلح يكثر عند الترمذي، واختُلف في معناه؛ ومن أشهر الأقوال أنه رُوي بإسنادين أحدهما حسن والآخر صحيح، أو أنه حسن باعتبار وصحيح باعتبار آخر.'},
 'ضعيف':{group:'المردود',def:'ما لم تجتمع فيه صفات الصحيح ولا صفات الحسن، بفقد شرط أو أكثر من شروط القبول. وتتفاوت درجاته بحسب شدة ضعف رواته.'},
 'موضوع':{group:'المردود',def:'الحديث المكذوب المختلق المنسوب إلى النبي ﷺ، وهو شر الضعيف وأقبحه، ولا تحل روايته لمن علم حاله إلا مع بيان وضعه.'},
 'متواتر':{group:'عدد الرواة',def:'ما رواه جمع كثير يستحيل في العادة تواطؤهم على الكذب، عن مثلهم من أول السند إلى منتهاه، وكان مستندهم الحس (سمعنا أو رأينا). وهو يفيد العلم اليقيني.'},
 'آحاد':{group:'عدد الرواة',def:'ما لم يجمع شروط المتواتر، وهو ثلاثة أقسام: المشهور والعزيز والغريب.'},
 'مشهور':{group:'عدد الرواة',def:'من الآحاد: ما رواه ثلاثة فأكثر في كل طبقة من طبقات السند، ولم يبلغ حد التواتر.'},
 'عزيز':{group:'عدد الرواة',def:'من الآحاد: ما لا يقل رواته عن اثنين في جميع طبقات السند.'},
 'غريب':{group:'عدد الرواة',def:'من الآحاد: ما ينفرد بروايته راوٍ واحد في طبقة من طبقات السند أو أكثر، ويسمى الفرد.'},
 'مرفوع':{group:'من يُنسب إليه',def:'ما أُضيف إلى النبي ﷺ من قول أو فعل أو تقرير أو صفة.'},
 'موقوف':{group:'من يُنسب إليه',def:'ما أُضيف إلى الصحابي من قول أو فعل.'},
 'مقطوع':{group:'من يُنسب إليه',def:'ما أُضيف إلى التابعي فمن دونه من قول أو فعل.'},
 'قدسي':{group:'من يُنسب إليه',def:'الحديث القدسي: ما أضافه النبي ﷺ إلى ربه عز وجل من غير القرآن، كقوله «قال الله تعالى…». ويفارق القرآن في أنه لا يُتعبد بتلاوته ولا يُتحدى به.'},
 'متصل':{group:'اتصال السند',def:'ما سمعه كل راوٍ من شيخه حتى ينتهي السند، مرفوعًا كان أو موقوفًا.'},
 'مرسل':{group:'السقط في السند',def:'ما رفعه التابعي إلى النبي ﷺ دون أن يذكر الصحابي الذي سمعه منه. وهو من أقسام الضعيف عند جمهور المحدثين.'},
 'منقطع':{group:'السقط في السند',def:'ما سقط من إسناده راوٍ أو أكثر قبل الصحابي، في موضع واحد أو أكثر لا على التوالي.'},
 'معضل':{group:'السقط في السند',def:'ما سقط من إسناده اثنان فأكثر على التوالي.'},
 'معلق':{group:'السقط في السند',def:'ما حُذف من مبدأ إسناده راوٍ فأكثر على التوالي، كقول المصنف: «قال رسول الله ﷺ» دون سند.'},
 'مدلس':{group:'السقط في السند',def:'ما أُخفي فيه عيب في الإسناد مع تحسين ظاهره، كأن يروي الراوي عمن لقيه ما لم يسمعه منه بصيغة توهم السماع مثل «عن» و«قال».'},
 'شاذ':{group:'المخالفة',def:'ما رواه الراوي المقبول مخالفًا لمن هو أولى منه (أوثق أو أكثر عددًا).'},
 'منكر':{group:'المخالفة',def:'ما رواه الراوي الضعيف مخالفًا لما رواه الثقة. ويقابله «المعروف».'},
 'معلل':{group:'المخالفة',def:'ما اطُّلع فيه على علة خفية قادحة في صحته، مع أن ظاهره السلامة منها. وعلم العلل من أدق علوم الحديث.'},
 'مضطرب':{group:'المخالفة',def:'ما رُوي على أوجه مختلفة متساوية في القوة، لا يمكن الجمع بينها ولا ترجيح أحدها.'},
 'مدرج':{group:'المخالفة',def:'ما أُدخل في متنه أو سنده ما ليس منه بلا فصل، ككلام بعض الرواة يُظن أنه من الحديث.'},
 'متفق عليه':{group:'مصطلحات التخريج',def:'ما أخرجه البخاري ومسلم في صحيحيهما من حديث صحابي واحد، وهو أعلى درجات الصحيح.'},
 'الكتب الستة':{group:'مصطلحات التخريج',def:'صحيح البخاري، وصحيح مسلم، وسنن أبي داود، وسنن الترمذي، وسنن النسائي، وسنن ابن ماجه.'},
 'الإسناد':{group:'أركان الحديث',def:'الإسناد (السند): سلسلة الرواة الموصلة إلى المتن، كقول البخاري: «حدثنا الحميدي قال حدثنا سفيان…». والإسناد من خصائص هذه الأمة، قال ابن المبارك: «الإسناد من الدين».'},
 'المتن':{group:'أركان الحديث',def:'المتن: ما ينتهي إليه السند من الكلام، أي نص الحديث نفسه.'},
 'الجرح والتعديل':{group:'علوم الرواة',def:'علم يبحث في أحوال الرواة من حيث قبول روايتهم أو ردها؛ فالجرح الطعن في عدالة الراوي أو ضبطه، والتعديل وصفه بما تُقبل به روايته.'},
 'عدالة':{group:'علوم الرواة',def:'العدل: المسلم البالغ العاقل السالم من أسباب الفسق وخوارم المروءة.'},
 'ضبط':{group:'علوم الرواة',def:'الضبط: أن يحفظ الراوي ما سمعه ويؤديه كما سمعه، إما ضبط صدر (حفظ) أو ضبط كتاب.'},
 'صحابي':{group:'علوم الرواة',def:'من لقي النبي ﷺ مؤمنًا به ومات على الإسلام.'},
 'تابعي':{group:'علوم الرواة',def:'من لقي الصحابي مؤمنًا بالنبي ﷺ ومات على الإسلام.'},
};
// The grades in the hadith editions are in English; shown in Arabic, with the scholar's name.
const GRADE_AR=[[/^very da'?i?f isnaa?d/i,'إسناده ضعيف جدًا'],[/^very da'?i?f/i,'ضعيف جدًا'],[/^sanad da'?i?f/i,'إسناده ضعيف'],[/^isnaa?d ma'?lool/i,'إسناده معلول'],[/^maqtu/i,'مقطوع'],[/^mau?quf/i,'موقوف'],[/^mursal/i,'مرسل'],[/^batil/i,'باطل'],[/^sahih lighairihi/i,'صحيح لغيره'],[/^hasan lighairihi/i,'حسن لغيره'],[/^hasan sahih/i,'حسن صحيح'],[/^isnaa?d sahih/i,'إسناده صحيح'],[/^isnaa?d hasan/i,'إسناده حسن'],[/^isnaa?d (da'?if|daeef|dai?f)/i,'إسناده ضعيف'],[/^(da'?if|daeef|dai?f) jiddan/i,'ضعيف جدًا'],[/^sahih/i,'صحيح'],[/^hasan/i,'حسن'],[/^(da'?if|daeef|dai?f)/i,'ضعيف'],[/^(maud?u|mawdu|fabricated)/i,'موضوع'],[/^munkar/i,'منكر'],[/^shadh/i,'شاذ']];
const SCHOLAR_AR={'Al-Albani':'الألباني','Shuaib Al Arnaut':'شعيب الأرناؤوط','Ahmad Muhammad Shakir':'أحمد شاكر','Zubair Ali Zai':'زبير علي زئي','Muhammad Muhyi Al-Din Abdul Hamid':'محمد محيي الدين عبد الحميد','Darussalam':'دار السلام','Bashar Awad Maarouf':'بشار عواد معروف','Abu Ghuddah':'عبد الفتاح أبو غدة','Muhammad Fouad Abd al-Baqi':'محمد فؤاد عبد الباقي'};
const gradeAr=g=>{const t=String(g||'').trim(),hit=GRADE_AR.find(([re])=>re.test(t));return hit?hit[1]:t;};
function gradesOf(book,h){
 if(book==='bukhari'||book==='muslim')return [{by:book==='bukhari'?'رواه البخاري في صحيحه':'رواه مسلم في صحيحه',grade:'صحيح'}];
 return (h.grades||[]).filter(g=>g&&g.grade&&g.grade.trim()!=='-').map(g=>({by:SCHOLAR_AR[g.name]||g.name,grade:gradeAr(g.grade)}));
}
// A term from the user's words: «يعني ايه حديث حسن»، «الحديث المرسل»، «الفرق بين الشاذ والمنكر».
function findMustalah(query){
 // Word by word, without «و/ب/ف» and «ال» in front: «والمنكر» and «بالحسن» are «منكر» and «حسن». Longer terms first («حسن صحيح» before «حسن»).
 const words=t=>plain(t).split(' ').map(w=>w.replace(/^(?:و|ب|ف|وب)(?=ال..)/,'').replace(/^ال(?=..)/,'')).filter(Boolean);
 const q=words(query),used=new Set(),hits=[];
 for(const k of Object.keys(MUSTALAH).sort((a,b)=>words(b).length-words(a).length||b.length-a.length)){
  const p=words(k);
  for(let i=0;i+p.length<=q.length;i++)if(p.every((w,j)=>q[i+j]===w&&!used.has(i+j))){hits.push(k);p.forEach((_,j)=>used.add(i+j));break;}
 }
 return hits.map(k=>({term:k,...MUSTALAH[k]}));
}

// ---- Recitation: makharij, sifat, waqf signs, and the lam of «الله» ----
const RECITATION_TOPICS={
 'المخارج':{group:'مخارج الحروف',how:'مخارج الحروف خمسة مواضع عامة: الجوف (حروف المد)، والحلق (ء هـ ع ح غ خ)، واللسان (أكثر الحروف)، والشفتان (ف ب م و)، والخيشوم (الغنة). وعددها التفصيلي سبعة عشر مخرجًا على المختار عند ابن الجزري.'},
 'الصفات':{group:'صفات الحروف',how:'من أشهر الصفات: الجهر والهمس (حروف الهمس: «فحثه شخص سكت»)، والشدة والرخاوة (حروف الشدة: «أجد قط بكت»)، والاستعلاء والاستفال (حروف الاستعلاء: «خص ضغط قظ»)، والإطباق (ص ض ط ظ)، والقلقلة («قطب جد»)، والصفير (ص ز س).'},
 'التفخيم والترقيق':{group:'صفات الحروف',how:'حروف الاستعلاء السبعة «خص ضغط قظ» مفخمة دائمًا، وأقواها حروف الإطباق (ص ض ط ظ). وتُفخم لام لفظ الجلالة بعد فتح أو ضم وتُرقق بعد كسر، وتُفخم الراء غالبًا إذا كانت مفتوحة أو مضمومة وتُرقق إذا كانت مكسورة.'},
 'لام لفظ الجلالة':{group:'التفخيم والترقيق',how:'لام «الله» تُفخم إذا سبقها فتح أو ضم (قالَ اللهُ، رسولُ اللهِ) أو ابتُدئ بها، وتُرقق إذا سبقها كسر (بِسمِ اللهِ، لِلَّهِ).'},
 'علامات الوقف':{group:'الوقف والابتداء',how:'في مصحف المدينة: «مـ» وقف لازم، و«لا» لا تقف (الوقف ممنوع)، و«ج» وقف جائز يستوي فيه الوقف والوصل، و«صلى» الوصل أولى، و«قلى» الوقف أولى، و«∴» تعانق الوقف: إذا وقفت على أحد الموضعين فلا تقف على الآخر.'},
 'السكتة':{group:'الوقف والابتداء',how:'السكت: قطع الصوت زمنًا يسيرًا دون تنفس بنية الاستئناف، وعند حفص أربع سكتات واجبة من طريق الشاطبية: «عوجا ۜ قيما» (الكهف)، «مرقدنا ۜ هذا» (يس)، «من ۜ راق» (القيامة)، «بل ۜ ران» (المطففين).'},
};
// Waqf signs in the Uthmani text (small high letters) and what each means.
const WAQF_SIGNS={[mk(0x6d6)]:{sign:'صلى',meaning:'الوصل أولى'},[mk(0x6d7)]:{sign:'قلى',meaning:'الوقف أولى'},[mk(0x6d8)]:{sign:'مـ',meaning:'وقف لازم'},[mk(0x6d9)]:{sign:'لا',meaning:'لا تقف'},[mk(0x6da)]:{sign:'ج',meaning:'وقف جائز'},[mk(0x6db)]:{sign:'∴',meaning:'تعانق الوقف'},[mk(0x6dc)]:{sign:'س',meaning:'سكتة لطيفة بلا تنفس'}};
function waqfSigns(text){
 const out=[];const words=text.split(/\s+/);let prev='';
 for(const w of words){for(const c of w)if(WAQF_SIGNS[c])out.push({...WAQF_SIGNS[c],after:prev||w});if([...w].some(c=>!isMark(c)))prev=w;}
 return out;
}
// The lam of «الله»: heavy (tafkhim) after a fatha or damma or at the start, light (tarqiq) after a kasra.
function jalalaRules(text){
 const L=lettersOf(text),out=[];
 for(let i=0;i<L.length;i++){
  const l=L[i];if(l.c!=='ل'||!has(l,SHADDA)||L[i+1]?.c!=='ه')continue;
  // «الله» / «لله» / «اللهم»: the doubled lam then ه, with only «ال» or «ل» (and a prefix letter) before it in the word.
  // «الله» is written with two lams (ٱللَّه، لِلَّه); «لَّهُۥ» (to Him) has one, doubled by idgham, and is not it.
  if(L[i-1]?.c!=='ل'||L[i-1].word!==l.word)continue;
  let k=i-1;while(k>=0&&(L[k].c==='ٱ'||(L[k].c==='ل'&&!vowelled(L[k]))||has(L[k],SILENT)||(L[k].c==='ا'&&!L[k].marks)))k--;
  const heavy=k<0||!(has(L[k],KASRA)||has(L[k],TANWEEN[2]));
  out.push({rule:heavy?'تفخيم لام لفظ الجلالة':'ترقيق لام لفظ الجلالة',word:text.split(/\s+/).filter(w=>[...w].some(c=>!isMark(c)))[l.word]});
 }
 return out;
}
// ---- Surah names that were misheard or misspelled («الفتحه» for الفاتحة, «الفاتح» for الفتح) ----
// Edit distance where adding or dropping a long vowel (ا و ي) costs half: speech recognition often drops or adds them,
// so «الفتحه» is nearer الفاتحه (a dropped ا) than الفتح (an added ه).
function nameDistance(a,b){
 const soft=c=>'اوي'.includes(c)?0.5:1;let prev=[0];for(let j=1;j<=b.length;j++)prev[j]=prev[j-1]+soft(b[j-1]);
 for(let i=1;i<=a.length;i++){const row=[prev[0]+soft(a[i-1])];for(let j=1;j<=b.length;j++)row[j]=Math.min(prev[j]+soft(a[i-1]),row[j-1]+soft(b[j-1]),prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}
 return prev[b.length];
}
const surahForms=new WeakMap();
function formsOfSurahs(chapters){
 let f=surahForms.get(chapters);if(f)return f;f=[];
 for(const c of chapters){const raw=String(c.name).normalize('NFKC');for(const v of new Set([plain(raw),plain(raw.replace(/ٰ/g,'ا'))])){const n=v.replace(/^سوره /,'');f.push({n:c.number,form:n});if(n.startsWith('ال')&&n.length>4)f.push({n:c.number,form:n.slice(2)});}}
 surahForms.set(chapters,f);return f;
}
// The surah whose name is exactly the word, or failing that the nearest within about one letter; null if none is
// close enough or two different surahs are equally close (then it is better to ask than to guess).
function closestSurah(chapters,word){
 const w=plain(word).replace(/^سوره /,'');if(w.length<3)return null;
 let best=null,second=Infinity;
 for(const {n,form}of formsOfSurahs(chapters)){
  if(form===w)return n;if(form.length<4)continue;
  const d=nameDistance(w,form);
  if(!best||d<best.d){if(best&&best.n!==n)second=best.d;best={n,d};}else if(n!==best.n&&d<second)second=d;
 }
 const limit=w.length>=7?1.5:1;
 return best&&best.d<=limit&&second>best.d?best.n:null;
}
const api={closestSurah,MUSTALAH,MUSTALAH_SOURCE,findMustalah,RECITATION_TOPICS,waqfSigns,jalalaRules,gradeAr,TAJWEED_RULES,tajweed,quranFacts,TAFSIRS,HADITH,tafsir,paragraphs,plain,searchQuran,findAyah,surahInfo,searchHadith};
if(typeof module!=='undefined')module.exports=api;else scope.QuranKnowledge=api;
})(globalThis);
