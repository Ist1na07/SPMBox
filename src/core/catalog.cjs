'use strict';
// Family collections are peers; the fine tags retain their original upstream IDs.
const TAGS = [
  ['rc','RC','RC'],
  ['chordjack','Chordjack','RC'], ['minijack','Minijack','RC'],
  ['dense chordstream','Dense Chordstream','RC'], ['fast chordstream','Fast Chordstream','RC'],
  ['speed','Speed','RC'], ['tech','Tech','RC'], ['vibro','Vibro','RC'], ['anchor','Anchor','RC'],
  ['rc mix','RC Mix','RC'], ['wildcard','Wildcard','RC'],
  ['ln','LN','LN'],
  ['coordination','Coordination','LN'], ['density','Density','LN'], ['inverse','Inverse','LN'],
  ['release','Release','LN'], ['technical','Technical','LN'], ['ln wildcard','LN Wildcard','LN'],
  ['ln mix','LN Mix','LN'],
  ['hybrid','Hybrid','Mix'], ['break','Break','Other'],
].map(([id,label,family])=>({id,label,family,kind:['rc','ln','hybrid'].includes(id)?'family':'pattern',
  parent:['rc','ln','hybrid'].includes(id)||family==='Other'?null:family.toLowerCase(),
  defaultThreshold:id==='hybrid'?10:25}));
const ENGINE_VERSION = 'spm-b074e0f-tag-b311c40-adapter-3';
const COLLECTION_PREFIX = '!SPM Box · ';
const DEFAULT_PRESET_NAME = COLLECTION_PREFIX+'全部 7K 键型';
function collectionLabel(id) {
  const tag=TAGS.find(t=>t.id===id);
  if(!tag)throw Error('未知分类');
  return tag.parent?TAGS.find(t=>t.id===tag.parent).label+' · '+tag.label:tag.label;
}
function options(input = {}) {
  const model = input.model ?? 'detail', rate = Number(input.rate ?? 1);
  if (!['detail','compact'].includes(model) || ![0.75,1,1.5].includes(rate)) throw Error('不支持的算法或速率');
  return {model,rate};
}
function rules(input) {
  if (!Array.isArray(input) || !input.length || input.length > TAGS.length) throw Error('请选择至少一种键型');
  const seen = new Set();
  return input.map(r=>{
    if (!r || !TAGS.some(t=>t.id===r.tag) || seen.has(r.tag)) throw Error('无效或重复的键型');
    seen.add(r.tag);
    const threshold = Number(r.threshold);
    if (!['upstream','threshold'].includes(r.mode) || !Number.isFinite(threshold) || threshold<0 || threshold>100) throw Error('阈值必须为 0–100');
    return {tag:r.tag,mode:r.mode,threshold};
  });
}
module.exports = {TAGS,ENGINE_VERSION,COLLECTION_PREFIX,DEFAULT_PRESET_NAME,collectionLabel,options,rules};
