(function(scope){
function normalize(text){return text.normalize('NFKC').replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[^\u0621-\u063a\u0641-\u064a\s]/g,'').trim();}
function compare(expected,spoken){
 const a=expected.trim().split(/\s+/).filter(Boolean), b=spoken.trim().split(/\s+/).filter(Boolean);
 const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
 for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;
 // Substituting a similarly spelled word is cheaper, so a misread word pairs with its intended word rather than a neighbouring extra word.
 const na=a.map(normalize),nb=b.map(normalize);
 // These checks run for every word pair (hundreds of thousands in a long passage), so they use a bounded edit
 // distance, cached per pair of spellings, instead of the full letter alignment used for the written notes.
 const ids=new Map(),id=w=>{let v=ids.get(w);if(v===undefined)ids.set(w,v=ids.size);return v;};
 const ia=na.map(id),ib=nb.map(id),memo=new Map(),joinMemo=new Map();
 const similar=(x,y)=>{const key=ia[x]*65536+ib[y];let hit=memo.get(key);if(hit===undefined){hit=distance(na[x],nb[y],Math.max(1,Math.floor(Math.max(na[x].length,nb[y].length)/2)))<=Math.max(1,Math.floor(Math.max(na[x].length,nb[y].length)/2));memo.set(key,hit);}return hit;};
 const cost=(x,y)=>ia[x]===ib[y]?0:similar(x,y)?0.6:1;
 // Speech recognition sometimes splits one word in two (e.g. «الرَّ حِينِ»): matching two spoken tokens to one word is allowed when joining them fits it.
 const joined=nb.map((w,y)=>w+(nb[y+1]??'')),ij=joined.map(id);
 const joinCost=(x,y)=>{
  if(ij[y]===ia[x])return 0.2;
  const limit=Math.max(1,Math.floor(na[x].length/3));if(Math.abs(na[x].length-joined[y].length)>limit)return Infinity;
  const key=ia[x]*65536+ij[y];let hit=joinMemo.get(key);if(hit===undefined){hit=distance(na[x],joined[y],limit)<=limit;joinMemo.set(key,hit);}
  return hit?0.8:Infinity;
 };
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost(i-1,j-1),j>1?d[i-1][j-2]+joinCost(i-1,j-2):Infinity);
 let i=a.length,j=b.length,result=[];
 while(i||j){
  if(i&&j&&d[i][j]===d[i-1][j-1]+cost(i-1,j-1)){result.push({type:na[i-1]===nb[j-1]?'correct':'changed',expected:a[--i],spoken:b[--j]});}
  else if(i&&j>1&&d[i][j]===d[i-1][j-2]+joinCost(i-1,j-2)){const spokenWord=b[j-2]+' '+b[j-1];result.push({type:nb[j-2]+nb[j-1]===na[i-1]?'correct':'changed',expected:a[i-1],spoken:spokenWord});i--;j-=2;}
  else if(i&&d[i][j]===d[i-1][j]+1){result.push({type:'missing',expected:a[--i]});}
  else{result.push({type:'extra',spoken:b[--j]});}
 }
 return result.reverse();
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
 return `في «${item.expected}»: ${parts.join('، ')}.`;
}
if(typeof module!=='undefined')module.exports={normalize,compare,letterDiff,explain};else scope.QuranCompare={normalize,compare,letterDiff,explain};
})(globalThis);
