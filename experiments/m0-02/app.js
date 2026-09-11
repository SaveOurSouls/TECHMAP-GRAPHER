(() => {
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d'),layer=document.createElement('canvas');layer.width=1000;layer.height=600;
const g=layer.getContext('2d'),G=Geometry;let frozen=null,offset={x:0,y:0},drag=null,current=null,coverage=null;
const number=id=>Number($(id).value),attached=()=>$('attached').checked;
function makeRoute(){const p=$('preset').value,y=270-number('rise');return G.route(p==='straight'?[{x:90,y:270},{x:930,y:270}]:p==='tight'?[{x:90,y:270},{x:450,y:270},{x:450,y:140},{x:930,y:140}]:[{x:90,y:270},{x:440,y:270},{x:590,y},{x:930,y}],number('radius'));}
function stroke(c,points,color,width){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=color;c.lineWidth=width;c.lineJoin='round';c.stroke();}
function mapped(path,s,u){const p=G.at(path,s,u);return {x:p.x+offset.x,y:p.y+offset.y};}
function draw(){
 current=makeRoute();if(attached()){offset={x:0,y:0};frozen=null;}const path=frozen||current,start=path.length*number('start')/100,end=path.length*number('end')/100,w=number('width'),pitch=number('pitch'),sign=number('direction');coverage={path,start,end,w};
 ctx.clearRect(0,0,1000,600);ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,600);
 for(let x=0;x<=1000;x+=20)stroke(ctx,[{x,y:0},{x,y:600}],x%100?'#eef3f6':'#e0e9ef',1);
 for(let y=0;y<=600;y+=20)stroke(ctx,[{x:0,y},{x:1000,y}],y%100?'#eef3f6':'#e0e9ef',1);
 ctx.font='16px Segoe UI';ctx.fillStyle='#577282';ctx.fillText('XS1',38,231);ctx.fillText('XS2',933,current.samples.at(-1).y-26);
 ctx.fillStyle='#dae2e8';ctx.fillRect(35,246,55,48);ctx.strokeStyle='#546d7d';ctx.strokeRect(35,246,55,48);
 const endPoint=current.samples.at(-1);ctx.fillStyle='#dae2e8';ctx.fillRect(930,endPoint.y-22,40,44);ctx.strokeRect(930,endPoint.y-22,40,44);
 if($('preset').value==='branch'){
  const lower=G.route([{x:90,y:279},{x:440,y:279},{x:590,y:385},{x:930,y:385}],number('radius'));
  stroke(ctx,lower.samples,'#283e4c',7);ctx.fillStyle='#dae2e8';ctx.fillRect(930,364,40,42);ctx.lineWidth=1;ctx.strokeRect(930,364,40,42);ctx.fillStyle='#577282';ctx.fillText('XS3',933,350);
 }
 stroke(ctx,current.samples,'#943c32',8);stroke(ctx,current.samples,'#da5945',4);
 if(attached()&&$('preset').value!=='straight'){ctx.setLineDash([4,5]);stroke(ctx,[{x:440,y:230},{x:440,y:420}],'#94aab8',1);ctx.setLineDash([]);ctx.fillStyle='#617b8b';ctx.fillText('Зона поворота / ответвления',340,451);}
 g.clearRect(0,0,1000,600);let border=[],steps=Math.ceil((end-start)/2);
 for(let i=0;i<=steps;i++)border.push(mapped(path,start+(end-start)*i/steps,-w/2));
 for(let i=steps;i>=0;i--)border.push(mapped(path,start+(end-start)*i/steps,w/2));
 g.save();g.beginPath();border.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();g.clip();
 const kind=$('material').value;
 for(let u=-w/2;u<=w/2;u+=1){const shade=Math.round((kind==='metal'?105:23)+Math.cos(u/w*Math.PI)*(kind==='metal'?116:43));const pts=[];for(let i=0;i<=steps;i++)pts.push(mapped(path,start+(end-start)*i/steps,u));stroke(g,pts,`rgb(${shade},${shade+2},${shade+4})`,2);}
 if(kind==='tube'){
  for(let s=start-pitch;s<end+pitch;s+=pitch/2){const pts=[];for(let u=-w/2;u<=w/2;u+=1)pts.push(mapped(path,s,u));stroke(g,pts,'#141b20',4);stroke(g,pts.map(p=>({x:p.x+1,y:p.y})),'#8c969c',1);}
 }else{
  for(const slope of [1,-1])for(let s=start-w-pitch;s<end+w+pitch;s+=pitch){const pts=[];for(let u=-w/2;u<=w/2;u+=1)pts.push(mapped(path,s+u*slope*sign,u));stroke(g,pts,kind==='metal'?(slope===1?'#52616d':'#fafcff'):(slope===1?'#111e28':'#92a0a8'),kind==='metal'?2:1.3);}
 }
 g.restore();stroke(g,[...border,border[0]],kind==='metal'?'#677b88':'#1d303d',1);
 ctx.globalAlpha=1-number('opacity')/100;ctx.drawImage(layer,0,0);ctx.globalAlpha=1;
 for(const s of [start,end]){const p=mapped(path,s,0);ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='#087f89';ctx.lineWidth=2;ctx.stroke();}
 const length=$('length').value,valid=length.trim()!==''&&Number.isFinite(Number(length))&&Number(length)>0;
 const a=mapped(path,start,w/2+32),b=mapped(path,end,w/2+32);
 ctx.setLineDash([3,4]);stroke(ctx,[a,b],'#88a3b1',1);ctx.setLineDash([]);ctx.font='16px Segoe UI';ctx.fillStyle='#245768';ctx.fillText(valid?`${length} мм · длина материала`:'Длина не задана',Math.max(15,Math.min(735,(a.x+b.x)/2-90)),Math.min(565,Math.max(a.y,b.y)+25));
 ['rise','radius','start','end','width','pitch','opacity'].forEach(id=>$(id+'Out').value=$(id).value+(['start','end','opacity'].includes(id)?' %':''));
 $('quantity').textContent=valid?`${(Number(length)/1000).toLocaleString('ru-RU')} м`:'Не включён';$('repeats').textContent=`${Math.floor((end-start)/(kind==='tube'?pitch/2:pitch))} повторов`;
 $('binding').textContent=attached()?'Привязка включена':'Ручное размещение';$('mode').textContent=attached()?'Вслед за проводом':'Независимая форма';
 $('hint').textContent=attached()?'Оплётка следует за формой провода.':'Форма сохранена. Перемещайте оплётку на поле. Повторное включение привязки вернёт её на провод.';
 const warnings=[];if(!valid)warnings.push('Укажите положительную длину: материал пока не включён в расход.');if(G.overlapsTightBend(path,start,end,w))warnings.push('Радиус не больше половины ширины: внутренняя сторона оболочки схлопывается или пересекается. Увеличьте радиус или уменьшите ширину.');
 $('warning').textContent=warnings.join(' ');canvas.style.cursor=attached()?'default':'move';
}
document.querySelectorAll('input,select').forEach(el=>el.addEventListener('input',()=>{if(el.id==='attached'&&!attached()){frozen=current;offset={x:0,y:0};}draw();}));
$('reset').onclick=()=>{const defaults={material:'metal',preset:'branch',rise:110,radius:60,start:8,end:89,width:38,pitch:24,opacity:12,direction:1,length:950};for(const [k,v]of Object.entries(defaults))$(k).value=v;$('attached').checked=true;frozen=null;offset={x:0,y:0};draw();};
function pos(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*1000/r.width,y:(e.clientY-r.top)*600/r.height};}
canvas.onpointerdown=e=>{if(attached())return;const p=pos(e),{path,start,end,w}=coverage;let hit=false;for(let s=start;s<=end;s+=3){const q=mapped(path,s,0);if(Math.hypot(q.x-p.x,q.y-p.y)<w/2+8){hit=true;break;}}if(!hit)return;canvas.focus({preventScroll:true});drag={p,original:{...offset}};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!drag)return;const p=pos(e);offset={x:Math.max(-60,Math.min(60,drag.original.x+p.x-drag.p.x)),y:Math.max(-80,Math.min(150,drag.original.y+p.y-drag.p.y))};draw();};
const stop=()=>drag=null;canvas.onpointerup=stop;canvas.onpointercancel=stop;canvas.onlostpointercapture=stop;
canvas.onkeydown=e=>{if(attached())return;const d={ArrowLeft:[-5,0],ArrowRight:[5,0],ArrowUp:[0,-5],ArrowDown:[0,5]}[e.key];if(!d)return;e.preventDefault();offset={x:Math.max(-60,Math.min(60,offset.x+d[0])),y:Math.max(-80,Math.min(150,offset.y+d[1]))};draw();};
draw();
})();
