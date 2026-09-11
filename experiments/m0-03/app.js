const $=id=>document.getElementById(id),t0=performance.now(),data=Catalog.generate(),generationMs=performance.now()-t0;
let page=0,report=null;const canvas=$('canvas'),ctx=canvas.getContext('2d'),cache=new Map();
function list(){const t=performance.now(),r=Catalog.search(data,$('query').value,$('type').value,page),elapsed=performance.now()-t;$('rows').replaceChildren(...r.rows.map(r=>{const tr=document.createElement('tr');[r.article,r.name,r.type==='Провод'?r.section:'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});return tr;}));$('count').textContent=`Найдено: ${r.total.toLocaleString('ru-RU')} · поиск ${elapsed.toFixed(2)} мс`;$('page').textContent=`${page+1} / ${Math.max(1,Math.ceil(r.total/40))}`;$('prev').disabled=page===0;$('next').disabled=(page+1)*40>=r.total;}
for(const id of ['query','type'])$(id).oninput=()=>{page=0;list();};$('prev').onclick=()=>{page--;list();};$('next').onclick=()=>{page++;list();};
function texture(){const c=document.createElement('canvas');c.width=1020;c.height=18;const g=c.getContext('2d'),grad=g.createLinearGradient(0,0,0,18);grad.addColorStop(0,'#53616b');grad.addColorStop(.5,'#e3e9ed');grad.addColorStop(1,'#53616b');g.fillStyle=grad;g.fillRect(0,0,1020,18);for(const sign of [-1,1]){g.beginPath();for(let x=-20;x<1040;x+=12){g.moveTo(x,sign===1?0:18);g.lineTo(x+18,sign===1?18:0);}g.strokeStyle=sign===1?'#ffffff':'#263f51';g.lineWidth=1;g.stroke();}return c;}
function draw(n,mode,phase=0){ctx.fillStyle='#fafcfd';ctx.fillRect(0,0,1200,700);const height=620/n;for(let i=0;i<n;i++){const y=40+i*height;ctx.strokeStyle=['#bd483d','#293d4a','#6488aa'][i%3];ctx.lineWidth=Math.max(.7,Math.min(3,height/6));ctx.beginPath();ctx.moveTo(25,y);ctx.lineTo(1175,y);ctx.stroke();let tex;if(mode==='cached'){if(!cache.has('braid'))cache.set('braid',texture());tex=cache.get('braid');}else tex=texture();ctx.drawImage(tex,70+Math.sin(phase/12+i)*8,y- Math.min(7,height*.35),1020,Math.min(14,height*.7));} }
function refresh(){draw(Number($('wires').value),$('render').value);}$('wires').onchange=refresh;$('render').onchange=refresh;
const tick=()=>new Promise(resolve=>requestAnimationFrame(resolve));
$('run').onclick=async()=>{
 $('run').disabled=true;$('save').disabled=true;report=null;const results=[];try{
  $('status').textContent='Поиск по каталогу…';await tick();const searches=Catalog.benchmark(data);
  for(const n of [20,300])for(const mode of ['direct','cached']){
   $('status').textContent=`Холст: ${n} проводов · ${mode==='direct'?'перестроение':'кеш'}…`;cache.clear();
   const cold=performance.now();draw(n,mode);ctx.getImageData(0,0,1,1);const coldMs=performance.now()-cold;
   for(let i=0;i<5;i++){await tick();draw(n,mode,i);ctx.getImageData(0,0,1,1);}
   const times=[];for(let i=0;i<30;i++){await tick();const t=performance.now();draw(n,mode,i);ctx.getImageData(0,0,1,1);times.push(performance.now()-t);}
   results.push({wires:n,mode,coldMs,...Catalog.stats(times)});
  }
  report={schema:1,at:new Date().toISOString(),environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio,viewport:[innerWidth,innerHeight],canvas:[1200,700]},catalog:{count:data.length,generationMs,searches},canvas:results,method:'5 warmups, 30 measured; canvas draw plus 1px readback; not display FPS'};
  $('results').textContent=JSON.stringify(report,null,2);$('status').textContent='Замеры завершены. Результаты доступны в JSON.';$('save').disabled=false;
 }catch(e){$('status').textContent=`Замер не завершён: ${e.message}`;}finally{$('run').disabled=false;refresh();}
};
$('save').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='m0-03-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};list();refresh();
