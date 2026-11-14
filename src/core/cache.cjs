'use strict';
const {ENGINE_VERSION}=require('./catalog.cjs');
const RC=new Set(['anchor','chordjack','minijack','dense chordstream','fast chordstream','speed','tech','vibro','rc mix']);
const LN=new Set(['coordination','density','inverse','ln wildcard','release','technical','ln mix']);
function compatible(version) {
  return version===ENGINE_VERSION||[1,2,3].some(n=>version===ENGINE_VERSION+'-adapter-'+n);
}
function migrate(result) {
  const row=structuredClone(result);
  if(row.status!=='ok'||row.keys!==7||!row.classified)return row;
  row.scores.rc??=row.scores['rc mix'];row.scores.ln??=row.scores['ln mix'];
  if(!row.classificationFamily){
    const rc=row.tags.some(t=>RC.has(t)),ln=row.tags.some(t=>LN.has(t));
    // Exact nonempty-tag branch of the pinned upstream infer(), never Rating's family.
    row.classificationFamily=row.tags.includes('hybrid')||(rc&&ln)?'Hybrid':rc?'RC':ln?'LN':null;
  }
  // Only old tagless charts require a targeted refresh to recover the prior fallback.
  row.classificationPending=!row.classificationFamily||!Number.isFinite(row.scores.rc)||!Number.isFinite(row.scores.ln);
  if(!row.classificationPending)delete row.classificationPending;
  return row;
}
module.exports={compatible,migrate};
