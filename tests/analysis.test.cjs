'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyse,engine,classifier}=require('../src/core/analyse.cjs');
const {fixture}=require('./fixtures.cjs');
const {preview}=require('../src/core/rules.cjs');
const {options,rules,TAGS}=require('../src/core/catalog.cjs');
test('adapter preserves pinned rating and classifier outputs across native keys, models and rates',()=>{
  for(const keys of [4,6,7])for(const holds of [false,true])for(const model of ['detail','compact'])for(const rate of [.75,1,1.5]){
    const text=fixture({keys,holds}),actual=analyse(Buffer.from(text),{model,rate});
    const rated=engine.processMap(text,'full',rate,{model,includeTagEvidence:keys===7});
    const classified=classifier.analyzeMap(text,{speedRate:rate,...(keys===7?{ratingEvidence:rated.tagEvidence}:{})});
    assert.equal(actual.rating,rated.rating);assert.equal(actual.rcRating,rated.rcRating);assert.equal(actual.lnRating,rated.lnRating);
    assert.deepEqual(actual.tags,classified.overall.tags);assert.equal(actual.beatmapId,12345);assert.equal(actual.keys,keys);
    assert.equal(actual.classificationFamily,({rc:'RC',ln:'LN',hb:'Hybrid'})[classified.overall.sort]??null);
    assert.equal(actual.classified,true);assert.match(actual.md5,/^[a-f0-9]{32}$/);
    for(const [tag,value] of Object.entries(classified.overall.percentages??{}))assert.equal(actual.scores[tag],value);
    if(keys===7){assert.equal(classified.modelInfo.breakPolicy.ratingUsed,true);assert.equal(actual.scores.rc,classified.overall.familyMass.rc*100);assert.equal(actual.scores.ln,classified.overall.familyMass.ln*100);}
    else assert.ok(Math.abs(Object.values(actual.scores).reduce((a,b)=>a+b,0)-100)<1e-8);
  }
});
test('skip unsupported keys and non-mania, reject empty charts',()=>{
  assert.equal(analyse(Buffer.from(fixture({keys:5})),{model:'detail',rate:1}).status,'skipped');
  assert.equal(analyse(Buffer.from(fixture().replace('Mode:3','Mode:0')),{model:'detail',rate:1}).status,'skipped');
  assert.throws(()=>analyse(Buffer.from(fixture({count:0})),{model:'detail',rate:1}));
});
test('threshold boundary includes equals; lowest insiders, highest outsiders; 7K only; unique MD5s',()=>{
  const rows=[10,24,25,26,30,40,50,60].map((n,i)=>({file:String(i),title:'Chart '+i,beatmapId:i+100,keys:7,classified:true,scores:{speed:n},tags:i%2?['speed']:[],md5:String(i).padStart(32,'0')}));
  rows.push({...rows[0],keys:4,scores:{speed:99}});rows.push({...rows[7],file:'duplicate'});
  const [g]=preview(rows,[{tag:'speed',mode:'threshold',threshold:25}]);
  assert.equal(g.count,6);assert.deepEqual(g.inside.map(r=>r.score),[25,26,30,40,50]);assert.deepEqual(g.outside.map(r=>r.score),[24,10]);
  assert.equal(g.inside[0].beatmapId,102);assert.equal(g.hashes.length,6);
  const [native]=preview(rows,[{tag:'speed',mode:'upstream',threshold:25}]);assert.equal(native.count,4);
});
test('21 preset categories, strict user-input validation',()=>{
  assert.equal(TAGS.length,21);assert.equal(new Set(TAGS.map(t=>t.id)).size,21);
  for(const rate of [0,-1,1.1,NaN])assert.throws(()=>options({rate}));
  for(const threshold of [-1,101,NaN])assert.throws(()=>rules([{tag:'speed',mode:'threshold',threshold}]));
  assert.throws(()=>rules([]));assert.throws(()=>rules([{tag:'unknown',mode:'upstream',threshold:25}]));
});
test('default preset retains upstream tags; scalar Hybrid excludes pure-family charts',()=>{
  const row={...analyse(Buffer.from(fixture()),{model:'detail',rate:1}),file:'fixture.osu'};
  assert.equal(row.scores.hybrid,0);
  const preset=preview([row],TAGS.map(t=>({tag:t.id,mode:'upstream',threshold:t.defaultThreshold})));
  for(const g of preset){const family={rc:'RC',ln:'LN',hybrid:'Hybrid'}[g.tag];assert.equal(g.count,Number(family?row.classificationFamily===family:row.tags.includes(g.tag)));}
  assert.equal(preview([row],[{tag:'hybrid',mode:'threshold',threshold:10}])[0].count,0);
  assert.equal(preview([{...row,classified:false}],[{tag:'speed',mode:'threshold',threshold:0}])[0].count,0);
});
test('RC and LN are parents, peers of Hybrid; default family collections use classifier sort, not rating or leaf union',()=>{
  assert.deepEqual(TAGS.filter(t=>t.kind==='family').map(t=>[t.id,t.parent]),[['rc',null],['ln',null],['hybrid',null]]);
  for(const tag of ['speed','chordjack','rc mix','wildcard'])assert.equal(TAGS.find(t=>t.id===tag).parent,'rc');
  for(const tag of ['coordination','inverse','ln mix','ln wildcard'])assert.equal(TAGS.find(t=>t.id===tag).parent,'ln');
  const rows=[['RC','LN',['speed'],90,10],['LN','RC',['coordination'],10,90],['Hybrid','RC',['speed','coordination'],55,45]].map(([classificationFamily,family,tags,rc,ln],i)=>({file:String(i),keys:7,classified:true,classificationFamily,family,tags,scores:{rc,ln,hybrid:Math.min(rc,ln)},md5:String(i).padStart(32,'0')}));
  rows.push({...rows[0],keys:4},{...rows[1],classified:false});
  for(const [i,tag] of ['rc','ln','hybrid'].entries())assert.deepEqual(preview(rows,[{tag,mode:'upstream',threshold:25}])[0].hashes,[String(i).padStart(32,'0')]);
  assert.equal(preview(rows,[{tag:'speed',mode:'upstream',threshold:25}])[0].count,2);
  assert.equal(preview(rows,[{tag:'rc',mode:'threshold',threshold:55}])[0].count,2);
});
