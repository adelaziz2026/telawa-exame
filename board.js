// Shared whiteboard for the meeting room. Every item is stored in proportional coordinates (0–1 across a 16:9
// board), so it looks the same on every screen. Local edits call onOp(op); remote ops arrive through apply(op).
(function(scope){
const ASPECT=9/16;
function uid(){return Math.random().toString(36).slice(2,10);}
class Whiteboard{
 // aspect is height÷width: 16:9 for meetings (everyone sees the same shape); a personal board may be taller.
 constructor(canvas,{onOp,me,aspect=ASPECT}){
  this.aspect=aspect;
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onOp=onOp;this.me=me;
  this.items=[];this.mine=[];this.tool='pen';this.color='#185c4c';this.size=0.004;this.current=null;this.lastSent=0;this.frame=0;
  canvas.addEventListener('pointerdown',e=>this.down(e));
  canvas.addEventListener('pointermove',e=>this.move(e));
  for(const type of ['pointerup','pointercancel','pointerleave'])canvas.addEventListener(type,e=>this.up(e));
  new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
  this.resize();
 }
 resize(){
  const w=this.canvas.parentElement.clientWidth,h=Math.round(w*this.aspect),dpr=window.devicePixelRatio||1;
  this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';
  this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);this.redraw();
 }
 point(e){const r=this.canvas.getBoundingClientRect();return [+((e.clientX-r.left)/r.width).toFixed(4),+((e.clientY-r.top)/r.height).toFixed(4)];}
 down(e){
  if(e.button>0)return;
  const p=this.point(e);
  // Keep the click from taking focus away from the text box it is about to open.
  if(this.tool==='text'){e.preventDefault();this.askText(p);return;}
  this.canvas.setPointerCapture?.(e.pointerId);
  const base={id:uid(),by:this.me,tool:this.tool,color:this.color,size:this.tool==='highlighter'?this.size*4:this.tool==='eraser'?this.size*5:this.size};
  this.current=['line','rect','ellipse','arrow'].includes(this.tool)?{...base,from:p,to:p}:{...base,points:[p]};
  this.upsert(this.current);
 }
 move(e){
  if(!this.current)return;
  const p=this.point(e);
  if(this.current.points)this.current.points.push(p);else this.current.to=p;
  this.schedule();
  // While drawing, others see the stroke grow (at most ~15 updates a second).
  if(Date.now()-this.lastSent>66){this.lastSent=Date.now();this.onOp({op:'item',item:this.current});}
 }
 up(){
  if(!this.current)return;
  this.onOp({op:'item',item:this.current});this.mine.push(this.current.id);this.current=null;
 }
 // Typing: a text box opens right where the user clicked, in the chosen colour and size. Enter writes it on the
 // board, Shift+Enter starts a new line, Escape cancels; clicking elsewhere also writes it.
 askText(p){
  this.editor?.commit();
  const area=this.canvas.parentElement,rect=this.canvas.getBoundingClientRect(),size=Math.max(0.02,this.size*6),px=size*rect.width;
  if(getComputedStyle(area).position==='static')area.style.position='relative';
  const box=document.createElement('textarea');box.className='board-text';box.dir='auto';box.rows=1;box.setAttribute('aria-label','اكتب على السبورة');
  const width=Math.min(rect.width*0.6,Math.max(160,rect.width*p[0]));
  // Text is drawn right-aligned at the click point, so the box's right edge sits there.
  Object.assign(box.style,{position:'absolute',left:(this.canvas.offsetLeft+p[0]*rect.width-width)+'px',top:(this.canvas.offsetTop+p[1]*rect.height)+'px',width:width+'px',font:`600 ${px}px 'Noto Sans Arabic',Tahoma,sans-serif`,lineHeight:'1.5',color:this.color,textAlign:'right'});
  const grow=()=>{box.style.height='auto';box.style.height=box.scrollHeight+'px';};
  let done=false;
  const finish=keep=>{
   if(done)return;done=true;this.editor=null;const text=box.value.trim();box.remove();
   if(keep&&text)this.add({id:uid(),by:this.me,tool:'text',at:p,text,color:this.color,size});
  };
  box.addEventListener('input',grow);
  box.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();finish(true);}else if(e.key==='Escape'){e.preventDefault();finish(false);}});
  box.addEventListener('blur',()=>finish(true));
  this.editor={commit:()=>finish(true)};
  area.append(box);grow();box.focus();
 }
 // Places an ayah (from the local Mushaf) centred near the top, in the Quran font.
 // Places an ayah (from the local Mushaf) centred, below whatever text is already on the board.
 addAyah(text,ref){this.add({id:uid(),by:this.me,tool:'text',at:[0.5,Math.min(0.85,Math.max(0.05,this.textBottom()+0.03))],text,ref,color:'#185c4c',size:0.034,font:'quran',align:'center',wrap:0.9});}
 // Lowest edge (0–1) of the text items, measured the same way they are drawn.
 textBottom(){
  const c=this.ctx,w=this.canvas.width,h=this.canvas.height;let bottom=0;
  for(const it of this.items){
   if(it.tool!=='text')continue;
   const px=Math.max(10,it.size*w);c.save();c.font=`${px}px ${it.font==='quran'?"'Amiri Quran',serif":"Tahoma,sans-serif"}`;
   const lines=this.wrap(c,it.text,it.wrap?it.wrap*w:Infinity).length;c.restore();
   bottom=Math.max(bottom,it.at[1]+(lines*px*(it.font==='quran'?2:1.5)+(it.ref?px*0.8:0))/h);
  }
  return bottom;
 }
 add(item){this.upsert(item);this.mine.push(item.id);this.onOp({op:'item',item});}
 undo(){const id=this.mine.pop();if(!id)return false;this.items=this.items.filter(i=>i.id!==id);this.schedule();this.onOp({op:'remove',id});return true;}
 clear(){this.items=[];this.mine=[];this.schedule();this.onOp({op:'clear'});}
 load(items){this.items=items.slice();this.schedule();}
 apply(op){
  if(op.op==='clear'){this.items=[];this.mine=[];}
  else if(op.op==='remove')this.items=this.items.filter(i=>i.id!==op.id);
  else if(op.op==='item')this.upsert(op.item);
  this.schedule();
 }
 upsert(item){const i=this.items.findIndex(x=>x.id===item.id);if(i>=0)this.items[i]=item;else this.items.push(item);this.schedule();}
 schedule(){if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.redraw();});}
 redraw(target=this.ctx,w=this.canvas.width,h=this.canvas.height,background=null){
  target.save();target.clearRect(0,0,w,h);
  if(background){target.fillStyle=background;target.fillRect(0,0,w,h);}
  for(const item of this.items)this.draw(target,item,w,h,!!background);
  target.restore();
 }
 draw(c,it,w,h,flat){
  c.save();c.lineCap=c.lineJoin='round';c.strokeStyle=c.fillStyle=it.color;c.lineWidth=Math.max(1,it.size*w);
  if(it.tool==='highlighter')c.globalAlpha=0.35;
  // The eraser cuts through to the board background (on an exported image, it paints the background colour).
  if(it.tool==='eraser'){if(flat){c.strokeStyle='#fff';}else c.globalCompositeOperation='destination-out';}
  if(it.points){
   c.beginPath();const [x0,y0]=it.points[0];c.moveTo(x0*w,y0*h);
   if(it.points.length===1)c.lineTo(x0*w+0.1,y0*h+0.1);
   for(let i=1;i<it.points.length;i++){const [x,y]=it.points[i];c.lineTo(x*w,y*h);}
   c.stroke();
  }else if(it.tool==='line'||it.tool==='arrow'){
   const [ax,ay]=it.from,[bx,by]=it.to;c.beginPath();c.moveTo(ax*w,ay*h);c.lineTo(bx*w,by*h);c.stroke();
   if(it.tool==='arrow'){const ang=Math.atan2((by-ay)*h,(bx-ax)*w),len=Math.max(10,it.size*w*4);c.beginPath();c.moveTo(bx*w,by*h);c.lineTo(bx*w-len*Math.cos(ang-0.45),by*h-len*Math.sin(ang-0.45));c.moveTo(bx*w,by*h);c.lineTo(bx*w-len*Math.cos(ang+0.45),by*h-len*Math.sin(ang+0.45));c.stroke();}
  }else if(it.tool==='rect'){
   const [ax,ay]=it.from,[bx,by]=it.to;c.strokeRect(Math.min(ax,bx)*w,Math.min(ay,by)*h,Math.abs(bx-ax)*w,Math.abs(by-ay)*h);
  }else if(it.tool==='ellipse'){
   const [ax,ay]=it.from,[bx,by]=it.to;c.beginPath();c.ellipse((ax+bx)/2*w,(ay+by)/2*h,Math.abs(bx-ax)/2*w,Math.abs(by-ay)/2*h,0,0,Math.PI*2);c.stroke();
  }else if(it.tool==='text'){
   const px=Math.max(10,it.size*w);
   c.font=`${it.font==='quran'?'':'600 '}${px}px ${it.font==='quran'?"'Amiri Quran','Traditional Arabic',serif":"'Noto Sans Arabic',Tahoma,sans-serif"}`;
   c.direction='rtl';c.textAlign=it.align==='center'?'center':'right';c.textBaseline='top';
   const lines=this.wrap(c,it.text,it.wrap?it.wrap*w:Infinity),lh=px*(it.font==='quran'?2:1.5);
   lines.forEach((line,i)=>c.fillText(line,it.at[0]*w,it.at[1]*h+i*lh));
   if(it.ref){c.font=`${px*0.5}px 'Noto Sans Arabic',Tahoma,sans-serif`;c.globalAlpha=0.7;c.fillText(it.ref,it.at[0]*w,it.at[1]*h+lines.length*lh+px*0.2);}
  }
  c.restore();
 }
 wrap(c,text,max){
  const out=[];
  for(const para of String(text).split('\n')){
   let line='';
   for(const word of para.split(' ')){const test=line?line+' '+word:word;if(line&&c.measureText(test).width>max){out.push(line);line=word;}else line=test;}
   out.push(line);
  }
  return out;
 }
 // Saves the board as a PNG on a white background.
 exportPng(name){
  const off=document.createElement('canvas');off.width=this.canvas.width;off.height=this.canvas.height;
  this.redraw(off.getContext('2d'),off.width,off.height,'#ffffff');
  const a=document.createElement('a');a.href=off.toDataURL('image/png');a.download=name;a.click();
 }
}
// Builds the standard toolbar (tools, colours, size, ayah, undo, clear, save) for a board.
// onAyah(ref) returns {text, ref} for a reference such as "2:255" or "1:1-7", or a string explaining what was wrong.
Whiteboard.toolbar=function(el,board,{onAyah,defaultRef,fileName='sabbora.png',extra=[]}={}){
 const button=(label,title,onclick,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);if(cls)b.className=cls;b.onclick=onclick;return b;};
 const sep=()=>Object.assign(document.createElement('span'),{className:'sep'});
 const tools=[['pen','✏️','قلم'],['highlighter','🖍','قلم تمييز'],['eraser','🧽','ممحاة'],['text','T','كتابة نص'],['line','╱','خط'],['arrow','↗','سهم'],['rect','▭','مستطيل'],['ellipse','◯','دائرة']];
 const toolButtons=tools.map(([tool,label,title])=>button(label,title,()=>{board.tool=tool;toolButtons.forEach(x=>x.classList.toggle('on',x.dataset.tool===tool));},'tool'+(tool===board.tool?' on':'')));
 toolButtons.forEach((b,i)=>b.dataset.tool=tools[i][0]);
 const colors=document.createElement('span');colors.className='colors';
 for(const [c,name]of [['#185c4c','أخضر'],['#1f2937','أسود'],['#c0392b','أحمر'],['#2563eb','أزرق'],['#b49860','ذهبي'],['#f59e0b','برتقالي']]){
  const b=button('',name,()=>{board.color=c;colors.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));},'color'+(c===board.color?' on':''));b.style.setProperty('--c',c);colors.append(b);
 }
 const size=document.createElement('label');size.className='size';size.textContent='الحجم';
 const range=Object.assign(document.createElement('input'),{type:'range',min:1,max:12,value:Math.round(board.size/0.0013)});range.oninput=()=>{board.size=Number(range.value)*0.0013;};size.append(range);
 const ayah=document.createElement('span');ayah.className='ayah-tool';
 const ref=Object.assign(document.createElement('input'),{dir:'ltr',placeholder:'2:255',title:'رقم السورة:رقم الآية (أو 1:1-7)'});ref.setAttribute('aria-label','مرجع الآية');
 const add=button('📖 آية','عرض آية من المصحف على السبورة',()=>{const out=onAyah(ref.value.trim()||defaultRef?.()||'');if(typeof out==='string')flash(out);else{board.addAyah(out.text,out.ref);ref.value='';}});
 ref.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add.click();}};
 ayah.append(ref,add);
 const flash=text=>{ref.value='';ref.placeholder=text;ref.classList.add('bad');setTimeout(()=>{ref.placeholder='2:255';ref.classList.remove('bad');},2500);};
 el.replaceChildren(...toolButtons,sep(),colors,size,sep(),...(onAyah?[ayah,sep()]:[]),
  button('↶','تراجع',()=>board.undo()),button('🗑','مسح السبورة',()=>{if(confirm('مسح السبورة؟'))board.clear();}),button('💾','حفظ صورة',()=>board.exportPng(fileName)),...extra);
};
scope.Whiteboard=Whiteboard;
})(globalThis);
