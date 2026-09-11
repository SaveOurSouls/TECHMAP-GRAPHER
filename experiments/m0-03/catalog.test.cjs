const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('./catalog.js'),rows=C.generate();
test('50k stable unique identifiers and complete paging',()=>{assert.equal(new Set(rows.map(r=>r.article)).size,50000);assert.equal(C.search(rows,'','',1249).rows.at(-1).id,50000);assert.equal(C.search(rows,'','',1250).rows.length,0);});
test('type filter and case-insensitive AND query',()=>{assert.equal(C.search(rows,'','Провод').total,12500);assert.equal(C.search(rows,'  demo-049999 ').rows[0].id,49999);assert.equal(C.search(rows,'ТЕРМИНАЛ   серия 42').total,592);assert.equal(C.search(rows,'DEMO-049999','Провод').total,0);});
test('empty and absent matches remain distinct',()=>{assert.equal(C.search(rows,'').total,50000);assert.equal(C.search(rows,'несуществующий').total,0);});
test('reported statistics use nearest rank',()=>{assert.deepEqual(C.stats(Array.from({length:30},(_,i)=>i+1)),{samples:30,p50:15,p95:29,max:30});});
