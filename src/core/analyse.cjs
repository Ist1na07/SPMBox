'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const vendor = path.join(__dirname,'../../vendor/spm');
// Execute trusted vendored source once per worker, with isolated browser globals.
const source = fs.readFileSync(path.join(vendor,'spm_algorithm.js'),'utf8')
  .replace('root.SPMExtHandRole = {','SPMExtHandRole = root.SPMExtHandRole = {')
  .replace('global.SPMExtGeometry = {','SPMExtGeometry = global.SPMExtGeometry = {');
const engine = new Function('globalThis','let SPMExtHandRole, SPMExtGeometry;\n'+source+'\nreturn SPMEngine;')({});
const classifier = require(path.join(vendor,'tag_engine.js'));
engine.loadDanConstants(JSON.parse(fs.readFileSync(path.join(vendor,'dan_constants.json'),'utf8')));
function field(text,section,key) {
  const body = text.match(new RegExp('^\\['+section+'\\][\\s\\S]*?(?=^\\[|$(?![\\s\\S]))','mi'))?.[0] ?? '';
  return body.match(new RegExp('^'+key+'\\s*:\\s*(.*)$','mi'))?.[1]?.trim() ?? '';
}
function analyse(buffer, options) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/,'');
  const keys = Number(field(text,'Difficulty','CircleSize'));
  if (field(text,'General','Mode') !== '3' || ![4,6,7].includes(keys)) return {status:'skipped',reason:'仅支持原生 4K / 6K / 7K mania 谱面'};
  // Use the exact whole-chart engine, omitting overlay-only display curves,
  // 400 ms buckets and dan formatting. This is not a lighter scoring model.
  const variant=engine.modelVariant(options.model);
  const result = engine.evaluateChart(text,options.rate,variant.params,variant.model);
  if (!result || result.error || !Number.isFinite(result.starAligned)) throw Error('SPM 无法分析此谱面（音符不足或格式损坏）');
  const evidence=keys===7?{schemaVersion:1,keyCount:keys,speedRate:options.rate,clock:'post-rate-ms',
    modelIdentity:options.model==='compact'?'55216a3abcf6653c4c78b2082c730d64a0ed4bc476d3e477c4789a39f309fb4e':'5b0ddc61be53f5107f3b4dfa26a8397aa515e316c16b244878d1fc7039d0ba8f',
    query:Array.from(result.b.t),demand:Array.from(result.D)}:null;
  const meta = engine.parseOsuMeta(text);
  let tags = null, classificationError = null;
  try {
    tags = classifier.analyzeMap(text,{speedRate:options.rate,...(keys===7?{ratingEvidence:evidence}:{})});
  } catch (e) { classificationError = e.message; }
  const o = tags?.overall;
  // 7K burden shares overlap; native 4K/6K instead expose a normalized composition.
  const scores = o?.percentages ? {...o.percentages} : Object.fromEntries(Object.entries(o?.composition??{}).map(([k,v])=>[k,v*100]));
  if (keys===7 && o) {
    scores.rc=(o.familyMass?.rc??0)*100;
    scores.ln=(o.familyMass?.ln??0)*100;
    for (const [k,v] of Object.entries(o.labelPercentages??{})) if (k!=='hybrid'&&Number.isFinite(v)) scores[k]=v;
    scores['rc mix'] ??= (o.familyMass?.rc??0)*100;
    scores['ln mix'] ??= (o.familyMass?.ln??0)*100;
    // Hybrid needs BOTH families: a pure RC map must not score 100% Hybrid.
    // This scalar adapter is explicit in the UI, distinct from the upstream
    // label percentage (which is the union of both families).
    scores.hybrid = Math.min(o.familyMass?.rc??0,o.familyMass?.ln??0)*100;
    // Fallback/rest classes have no continuous integral branch in the upstream model.
    // Expose duration-weighted local affinity for explicit numeric-threshold mode.
    for (const k of ['wildcard','break']) {
      let sum=0, duration=0;
      for (const s of tags.segments) { const d=Math.max(0,s.end-s.start);duration+=d;sum+=d*(s.distribution?.[k]??Number(s.tag===k)); }
      scores[k]=duration>0?100*sum/duration:0;
    }
  }
  return {
    status:'ok',md5:createHash('md5').update(buffer).digest('hex'), // osu! collection.db protocol identity
    beatmapId:Number(field(text,'Metadata','BeatmapID'))||0,
    beatmapSetId:Number(field(text,'Metadata','BeatmapSetID'))||0,
    title:meta.title||'Untitled',artist:meta.artist||'Unknown',creator:meta.creator||'',difficulty:meta.version||'',
    keys,rating:result.starAligned,rcRating:result.starRcAligned,lnRating:result.hasLn?result.starLnAligned:null,
    family:!result.hasLn||result.lnCov<.18?'RC':result.lnCov>.68?'LN':'HB',notes:result.nNotes,duration:meta.durationMs/options.rate,
    bpm:meta.bpm?meta.bpm*options.rate:null,
    tags:o?.tags??[],scores,classified:!!tags,classificationError,
    classificationFamily:({rc:'RC',ln:'LN',hb:'Hybrid'})[o?.sort]??null,
    model:options.model,rate:options.rate,
  };
}
module.exports = {analyse,engine,classifier,field};
