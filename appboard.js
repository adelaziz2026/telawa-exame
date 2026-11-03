// Personal whiteboard in the main app: write by hand or keyboard, show ayat from the Mushaf, practise on ruled
// lines. Everything is kept on this device (localStorage) between visits. Uses app.js globals: surahs, rangeNumbers.
(function(){
const $=id=>document.getElementById(id);
if(!$('boardDialog'))return;
const KEY='tarteel:board';
let board=null,saveTimer=0;
const stored=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};}};
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify({items:board.items,aspect:board.aspect,lined:$('appBoardArea').classList.contains('lined')}));}catch{}},300);}

// "2:255" or "1:1-7" → the exact Uthmani text from the loaded Mushaf (at most 10 ayat), with ayah numbers.
function ayahText(value){
 if(typeof surahs==='undefined'||!surahs.length)return 'المصحف ما زال يُحمَّل';
 const m=String(value).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/^(\d{1,3})\s*[:：]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
 if(!m)return 'اكتب مثل 2:255';
 const s=surahs[+m[1]-1],from=+m[2];
 if(!s||!s.ayahs[from-1])return 'لا توجد آية بهذا الرقم';
 const to=Math.min(Math.max(from,+(m[3]||from)),from+9,s.ayahs.length);
 const text=Array.from({length:to-from+1},(_,i)=>`${s.ayahs[from+i-1].text} ﴿${(from+i).toLocaleString('ar-EG')}﴾`).join(' ');
 return {text,ref:`${s.name} ${from}${to>from?'–'+to:''}`};
}
const currentRef=()=>{try{const n=rangeNumbers();return `${$('surah').value}:${n[0]}${n.length>1?'-'+n.at(-1):''}`;}catch{return '';}};

function open(){
 $('boardDialog').hidden=false;document.body.classList.add('board-open-page');
 if(!board){
  const saved=stored();
  // The board keeps the shape it was first opened with: wide on a computer, a taller page on a phone held upright.
  const aspect=saved.aspect||(innerWidth<650&&innerHeight>innerWidth?1.3:9/16);
  board=new Whiteboard($('appBoard'),{me:'me',onOp:persist,aspect});
  if(saved.items)board.load(saved.items);
  $('appBoardArea').classList.toggle('lined',!!saved.lined);
  const lines=document.createElement('button');lines.type='button';lines.textContent='≡ سطور';lines.title='سطور للكتابة باليد';lines.className='tool'+(saved.lined?' on':'');
  lines.onclick=()=>{const on=$('appBoardArea').classList.toggle('lined');lines.classList.toggle('on',on);persist();};
  const current=document.createElement('button');current.type='button';current.textContent='📖 الآية الحالية';current.title='عرض الآية أو المقطع المختار في التطبيق';
  current.onclick=()=>{const out=ayahText(currentRef());if(typeof out!=='string')board.addAyah(out.text,out.ref);};
  Whiteboard.toolbar($('appBoardTools'),board,{onAyah:ayahText,defaultRef:currentRef,fileName:'sabbora.png',extra:[lines,current]});
 }
 board.resize();
 $('boardClose').focus();
}
function close(){board?.editor?.commit();$('boardDialog').hidden=true;document.body.classList.remove('board-open-page');$('boardOpen').focus();}
$('boardOpen').onclick=open;
$('boardClose').onclick=close;
// While the board is open, the app's one-key shortcuts (R record, L listen, H hide…) stay off.
$('boardDialog').addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'&&!e.target.classList?.contains('board-text'))close();});
globalThis.TarteelBoard={open,close,get board(){return board;},ayahText};
})();
