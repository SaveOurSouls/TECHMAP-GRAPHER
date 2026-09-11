(function(root){
 const types=['Провод','Соединитель','Терминал','Аксессуар'];
 function generate(n=50000){return Array.from({length:n},(_,i)=>{const r={id:i+1,article:`DEMO-${String(i+1).padStart(6,'0')}`,type:types[i%4],name:`${types[i%4]} серия ${i%101} ${i%2?'чёрный':'красный'}`,section:[0.14,0.25,0.5,0.75,1,1.5][i%6]};r.search=`${r.article} ${r.name} ${r.section}`.toLocaleLowerCase('ru');return r;});}
 function search(rows,q='',type='',page=0,size=40){const words=q.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean),found=[];let total=0;const start=Math.max(0,page)*size;for(const r of rows){if(type&&r.type!==type)continue;if(!words.every(w=>r.search.includes(w)))continue;if(total>=start&&found.length<size)found.push(r);total++;}return {total,rows:found};}
 function stats(a){const s=[...a].sort((a,b)=>a-b);return {samples:s.length,p50:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};}
 function benchmark(rows,clock=()=>performance.now()){
  return ['', 'провод','DEMO-049999','терминал серия 42','несуществующий','0.75'].map(q=>{
   for(let i=0;i<5;i++)search(rows,q);
   const times=[];let result;for(let i=0;i<30;i++){const t=clock();result=search(rows,q);times.push(clock()-t);}
   return {query:q,count:result.total,...stats(times)};
  });
 }
 const api={generate,search,stats,benchmark};if(typeof module!=='undefined')module.exports=api;else root.Catalog=api;
})(typeof window==='undefined'?globalThis:window);
