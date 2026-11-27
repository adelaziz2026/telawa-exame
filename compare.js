(function(scope){
function normalize(text){return text.normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[^\u0621-\u063a\u0641-\u064a\s]/g,'').trim();}
// Spellings that sound the same are the same word: speech recognition writes «الصلاه» for «الصلاة», «يءمنون» for
// «يؤمنون», and the spoken long alif that the Mushaf leaves out («الرحمان، ذالك، هاذا، لاكن»). Only these known
// words get the alif rule, so a real slip such as «قال» for «قل» still counts.
function spell(w){
 return w.replace(/رحمان/,'رحمن').replace(/ذالك/,'ذلك').replace(/هاذ/,'هذ').replace(/لاكن/,'لكن').replace(/اولائك/,'اولئك').replace(/سماوات/,'سموات').replace(/هاؤلاء/,'هؤلاء').replace(/^مائ/,'مئ')
  .replace(/ة$/,'ه').replace(/ى$/,'ي').replace(/[ؤئ]/g,'ء');
}
function compare(expected,spoken){
 // Tokens with no letters are not words: waqf marks in the Mushaf text (ۚ ۖ ۗ ۞) and punctuation from speech
 // recognition («،» «.») would otherwise count as missing or extra words.
 const words=t=>t.trim().split(/\s+/).filter(w=>normalize(w)), a=words(expected), b=words(spoken);
 const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
 for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;
 // Substituting a similarly spelled word is cheaper, so a misread word pairs with its intended word rather than a neighbouring extra word.
 const na=a.map(w=>spell(normalize(w))),nb=b.map(w=>spell(normalize(w)));
 // These checks run for every word pair (hundreds of thousands in a long passage), so they use a bounded edit
 // distance, cached per pair of spellings, instead of the full letter alignment used for the written notes.
 const ids=new Map(),id=w=>{let v=ids.get(w);if(v===undefined)ids.set(w,v=ids.size);return v;};
 const ia=na.map(id),ib=nb.map(id),memo=new Map(),joinMemo=new Map();
 const similar=(x,y)=>{const key=ia[x]*65536+ib[y];let hit=memo.get(key);if(hit===undefined){hit=distance(na[x],nb[y],Math.max(1,Math.floor(Math.max(na[x].length,nb[y].length)/2)))<=Math.max(1,Math.floor(Math.max(na[x].length,nb[y].length)/2));memo.set(key,hit);}return hit;};
 // Ta marbuta read on (not stopped at) sounds «ت»: speech recognition writes «الزكات» for «الزكاة». Only a Mushaf word
 // that really ends in ة gets this, so «كانت» and «كانه» stay different.
 const ta=a.map(w=>{const n=normalize(w);return n.endsWith('ة')?spell(n.slice(0,-1)+'ت'):null;}),same=(x,y)=>ia[x]===ib[y]||ta[x]===nb[y];
 const cost=(x,y)=>same(x,y)?0:similar(x,y)?0.6:1;
 // Speech recognition sometimes splits one word in two (e.g. «الرَّ حِينِ»): matching two spoken tokens to one word is allowed when joining them fits it.
 const joined=nb.map((w,y)=>w+(nb[y+1]??'')),ij=joined.map(id);
 const joinCost=(x,y)=>{
  if(ij[y]===ia[x])return 0.2;
  const limit=Math.max(1,Math.floor(na[x].length/3));if(Math.abs(na[x].length-joined[y].length)>limit)return Infinity;
  const key=ia[x]*65536+ij[y];let hit=joinMemo.get(key);if(hit===undefined){hit=distance(na[x],joined[y],limit)<=limit;joinMemo.set(key,hit);}
  return hit?0.8:Infinity;
 };
 // And the reverse: two words of the ayah written as one («ياأيها»، «يابني»، «ياقوم»). Only an exact fit counts
 // (a doubled alif written once is the same), so both words are then correct.
 const one=w=>w.replace(/اا/g,'a').replace(/ا/g,'a');
 const mergeCost=(x,y)=>one(na[x]+na[x+1])===one(nb[y])?0.2:Infinity;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost(i-1,j-1),j>1?d[i-1][j-2]+joinCost(i-1,j-2):Infinity,i>1?d[i-2][j-1]+mergeCost(i-2,j-1):Infinity);
 let i=a.length,j=b.length,result=[];
 while(i||j){
  if(i&&j&&d[i][j]===d[i-1][j-1]+cost(i-1,j-1)){result.push({type:same(i-1,j-1)?'correct':'changed',expected:a[--i],spoken:b[--j]});}
  else if(i>1&&j&&d[i][j]===d[i-2][j-1]+mergeCost(i-2,j-1)){j--;result.push({type:'correct',expected:a[i-1],spoken:b[j]},{type:'correct',expected:a[i-2],spoken:b[j]});i-=2;}
  else if(i&&j>1&&d[i][j]===d[i-1][j-2]+joinCost(i-1,j-2)){const spokenWord=b[j-2]+' '+b[j-1];result.push({type:nb[j-2]+nb[j-1]===na[i-1]?'correct':'changed',expected:a[i-1],spoken:spokenWord});i--;j-=2;}
  else if(i&&d[i][j]===d[i-1][j]+1){result.push({type:'missing',expected:a[--i]});}
  else{result.push({type:'extra',spoken:b[--j]});}
 }
 return markRepeats(result.reverse());
}
// Readers often go back and repeat a word or a phrase («الحمد لله الحمد لله رب العالمين»), or stutter on the next
// word. Extra words that repeat what was just read, or the words about to be read, are marked «repeated» and are not
// counted as mistakes. Any other extra word still counts.
function markRepeats(items){
 const key=w=>spell(normalize(w||''));
 // Two spoken tokens matched to one word, where one of them is the word itself and the other repeats it or the word
 // before («رب رب العالمين» read as «رب» + «رب العالمين»): split them back into a repetition and the correct word.
 for(let k=0;k<items.length;k++){
  const it=items[k];if(it.type!=='changed'||!/\s/.test(it.spoken||''))continue;
  const [p1,p2]=it.spoken.split(/\s+/),word=key(it.expected),prev=[];
  for(let m=k-1;m>=0&&prev.length<8;m--)if(items[m].expected&&items[m].type!=='missing')prev.push(key(items[m].expected));
  const restart=key(p1).length>=2&&key(p1).length<word.length&&key(p1)[0]===word[0]&&distance(key(p1),word.slice(0,key(p1).length),1)<=1;
  if(key(p2)===word&&(key(p1)===word||prev.includes(key(p1))||restart))items.splice(k,1,{type:'repeated',spoken:p1},{type:'correct',expected:it.expected,spoken:p2});
  else if(key(p1)===word&&key(p2)===word)items.splice(k,1,{type:'correct',expected:it.expected,spoken:p1},{type:'repeated',spoken:p2});
  // One of the two is the word itself and the other is a stray token («عم الماعون»): the word was read correctly
  // and the stray token is an extra word, not a misreading of this one.
  else if(key(p2)===word)items.splice(k,1,{type:'extra',spoken:p1},{type:'correct',expected:it.expected,spoken:p2});
  else if(key(p1)===word)items.splice(k,1,{type:'correct',expected:it.expected,spoken:p1},{type:'extra',spoken:p2});
 }
 for(let k=0;k<items.length;k++){
  if(items[k].type!=='extra')continue;
  let e=k;while(e+1<items.length&&items[e+1].type==='extra')e++;
  const run=items.slice(k,e+1).flatMap(x=>String(x.spoken).split(/\s+/)).map(key).filter(Boolean),before=[],after=[];
  for(let m=k-1;m>=0&&before.length<8;m--)if(items[m].expected&&items[m].type!=='missing')before.unshift(key(items[m].expected));
  for(let m=e+1;m<items.length&&after.length<8;m++)if(items[m].expected)after.push(key(items[m].expected));
  const slice=list=>{for(let s=0;s+run.length<=list.length;s++)if(run.every((w,i)=>w===list[s+i]))return true;return false;};
  if(run.length&&(slice(before)||run.every((w,i)=>w===after[i])))for(let m=k;m<=e;m++)items[m].type='repeated';
  // A word started and then restarted («فأن… فأنجيناه»): a single extra token that is the beginning of the next word
  // (at least 2 letters, one letter off at most, as speech recognition writes a cut-off word) is a restart, not a mistake.
  else if(run.length===1&&after[0]&&run[0].length>=2&&run[0].length<after[0].length&&distance(run[0],after[0].slice(0,run[0].length),1)<=1&&run[0][0]===after[0][0])items[k].type='repeated';
  k=e;
 }
 return items;
}
// Edit distance between two normalised words, giving up (limit+1) as soon as it must exceed the limit.
function distance(a,b,limit){
 if(Math.abs(a.length-b.length)>limit)return limit+1;
 let prev=Array.from({length:b.length+1},(_,j)=>j);
 for(let i=1;i<=a.length;i++){
  const row=[i];let best=i;
  for(let j=1;j<=b.length;j++){row[j]=Math.min(prev[j]+1,row[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(row[j]<best)best=row[j];}
  if(best>limit)return limit+1;prev=row;
 }
 return prev[b.length];
}
// Letter-level alignment of one word (diacritics ignored): which letters were swapped, dropped or added.
function letterDiff(expected,spoken){
 const a=[...normalize(expected).replace(/\s+/g,'')],b=[...normalize(spoken).replace(/\s+/g,'')];
 const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i?(j?0:i):j));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
 let i=a.length,j=b.length;const ops=[];
 while(i||j){
  if(i&&j&&d[i][j]===d[i-1][j-1]+(a[i-1]===b[j-1]?0:1)){if(a[i-1]!==b[j-1])ops.push({op:'sub',from:a[i-1],to:b[j-1],pos:i-1});i--;j--;}
  else if(i&&d[i][j]===d[i-1][j]+1){ops.push({op:'del',from:a[i-1],pos:i-1});i--;}
  else{ops.push({op:'ins',to:b[j-1],pos:i});j--;}
 }
 return ops.reverse();
}
function where(pos,length){return length<3?'':pos===0?' في أول الكلمة':pos>=length-1?' في آخر الكلمة':' في وسط الكلمة';}
// A written note describing the mistake in plain Arabic.
function explain(item){
 if(item.type==='missing')return `لم تُسمع كلمة «${item.expected}»: ربما تخطيتها، أو لم يلتقطها التعرف الصوتي.`;
 if(item.type==='extra')return `كلمة زائدة «${item.spoken}» ليست في الآية.`;
 if(item.type!=='changed')return '';
 const ops=letterDiff(item.expected,item.spoken),length=[...normalize(item.expected)].length;
 if(ops.length>Math.max(2,Math.ceil(length/2)))return `قُرئت «${item.spoken}» بدل «${item.expected}»: الكلمة مختلفة كثيرًا، فقد تكون كلمة أخرى أو خطأً في التعرف الصوتي.`;
 const parts=ops.map(o=>o.op==='sub'?`نطقت «${o.to}» بدل «${o.from}»${where(o.pos,length)}`:o.op==='del'?`حذفت حرف «${o.from}»${where(o.pos,length)}`:`زدت حرف «${o.to}»${where(o.pos,length)}`);
 const tip=ops.map(o=>o.op==='sub'&&TIPS[[o.from,o.to].sort().join('')]).find(Boolean);
 return `في «${item.expected}»: ${parts.join('، ')}.${tip?` 💡 ${tip}`:''}`;
}
// Letters that are easily confused, with how each is articulated (makhraj and sifat), shown under the mistake.
// Speech recognition can also mishear these pairs, so the tip is advice, not a verdict.
const TIP={
 'سص':'الصاد مفخّمة مطبقة (يرتفع أقصى اللسان مع إطباق وسطه)، والسين مرققة؛ ومخرجهما من طرف اللسان فوق الثنايا السفلى.',
 'تط':'الطاء مفخّمة مطبقة والتاء مرققة، ومخرجهما واحد: طرف اللسان مع أصول الثنايا العليا.',
 'دض':'الضاد من حافة اللسان مع ما يحاذيها من الأضراس العليا وهي مفخّمة مطبقة، والدال من طرف اللسان مع أصول الثنايا العليا.',
 'ضظ':'الضاد من حافة اللسان مع الأضراس العليا، والظاء من طرف اللسان مع أطراف الثنايا العليا (يخرج طرف اللسان قليلًا).',
 'ذز':'الذال من طرف اللسان مع أطراف الثنايا العليا (يخرج طرف اللسان قليلًا)، والزاي حرف صفير من طرف اللسان فوق الثنايا السفلى.',
 'زظ':'الظاء من طرف اللسان مع أطراف الثنايا العليا وهي مفخّمة، والزاي حرف صفير من طرف اللسان فوق الثنايا السفلى.',
 'ثس':'الثاء من طرف اللسان مع أطراف الثنايا العليا (يخرج طرف اللسان قليلًا)، والسين حرف صفير من طرف اللسان فوق الثنايا السفلى.',
 'تث':'الثاء من طرف اللسان مع أطراف الثنايا العليا، والتاء من طرف اللسان مع أصول الثنايا العليا.',
 'دذ':'الذال من طرف اللسان مع أطراف الثنايا العليا، والدال من طرف اللسان مع أصول الثنايا العليا مع قلقلة عند السكون.',
 'حه':'الحاء من وسط الحلق، والهاء من أقصى الحلق (أعمق وأخف).',
 'اع':'العين من وسط الحلق، والهمزة والألف من أقصى الحلق والجوف؛ أعطِ العين حقها من وسط الحلق.',
 'ءع':'العين من وسط الحلق، والهمزة من أقصى الحلق.',
 'قك':'القاف من أقصى اللسان مع ما فوقه من الحنك الأعلى وهي مفخّمة، والكاف أدنى منها قليلًا إلى الفم وهي مرققة.',
 'خغ':'الغين والخاء من أدنى الحلق، والغين مجهورة (يجري معها الصوت) والخاء مهموسة (يجري معها النفس).',
 'حخ':'الحاء من وسط الحلق، والخاء من أدنى الحلق.',
};
const TIPS=Object.fromEntries(Object.entries(TIP).map(([k,v])=>[[...k].sort().join(''),v]));
// The letters swapped in a misread word ({expected, spoken} pairs), for tracking which letters a reader confuses.
// A word read very differently (another word, or misheard) says nothing about letters, so it gives none.
function confusedLetters(item){
 if(item.type!=='changed')return [];
 const ops=letterDiff(item.expected,item.spoken),length=[...normalize(item.expected)].length;
 // Only a near-miss (at most a third of the letters differ) points at specific letters.
 if(ops.length>Math.max(1,Math.floor(length/3)))return [];
 return ops.filter(o=>o.op==='sub').map(o=>({expected:o.from,spoken:o.to}));
}
const letterTip=(a,b)=>TIPS[[a,b].sort().join('')]||'';
const api={normalize,compare,letterDiff,explain,confusedLetters,letterTip};
if(typeof module!=='undefined')module.exports=api;else scope.QuranCompare=api;
})(globalThis);
