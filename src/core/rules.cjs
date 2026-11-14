'use strict';
const {rules:validateRules,TAGS}=require('./catalog.cjs');
function score(row,tag) {const v=row.scores?.[tag];return Number.isFinite(v)?v:0;}
function qualifies(row,rule) {
  if(row.keys!==7||!row.classified)return false;
  if(rule.mode==='threshold')return score(row,rule.tag)>=rule.threshold;
  const family={rc:'RC',ln:'LN',hybrid:'Hybrid'}[rule.tag];
  return family?row.classificationFamily===family:row.tags.includes(rule.tag);
}
function preview(rows,input,limit=5) {
  return validateRules(input).map(rule=>{
    const eligible=rows.filter(r=>r.keys===7&&r.classified);
    const inside=eligible.filter(r=>qualifies(r,rule)).sort((a,b)=>score(a,rule.tag)-score(b,rule.tag)||a.file.localeCompare(b.file));
    const outside=eligible.filter(r=>!qualifies(r,rule)).sort((a,b)=>score(b,rule.tag)-score(a,rule.tag)||a.file.localeCompare(b.file));
    const compact=r=>({title:r.title,artist:r.artist,difficulty:r.difficulty,beatmapId:r.beatmapId,md5:r.md5,score:score(r,rule.tag),rating:r.rating});
    return {...rule,label:TAGS.find(t=>t.id===rule.tag).label,count:new Set(inside.map(r=>r.md5)).size,
      inside:inside.slice(0,limit).map(compact),outside:outside.slice(0,limit).map(compact),
      hashes:[...new Set(inside.map(r=>r.md5))].sort()};
  });
}
module.exports={score,qualifies,preview};
