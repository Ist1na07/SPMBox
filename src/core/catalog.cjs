'use strict';
// Family collections are peers; the fine tags retain their original upstream IDs.
const TAGS = [
  ['rc','RC','RC'],
  ['chordjack','Chordjack','RC'], ['minijack','Minijack','RC'],
  ['dense chordstream','Dense Chordstream','RC'], ['fast chordstream','Fast Chordstream','RC'],
  ['speed','Speed','RC'], ['tech','Tech','RC'], ['vibro','Vibro','RC'], ['anchor','Anchor','RC'],
  ['rc mix','RC Mix','RC'],
  ['ln','LN','LN'],
  ['coordination','Coordination','LN'], ['density','Density','LN'], ['inverse','Inverse','LN'],
  ['release','Release','LN'], ['technical','Technical','LN'],
  ['ln mix','LN Mix','LN'],
  ['hybrid','Hybrid','Mix'],
].map(([id,label,family])=>({id,label,family,kind:['rc','ln','hybrid'].includes(id)?'family':'pattern',
  parent:['rc','ln','hybrid'].includes(id)||family==='Other'?null:family.toLowerCase(),
  defaultThreshold:id==='hybrid'?10:25}));
// Algorithm identity only. UI, collection rules and additive cache fields must NOT invalidate analysis.
const ENGINE_VERSION = 'spm-b074e0f-tag-b311c40';
const RETIRED_TAGS = ['wildcard','ln wildcard','break'];
const COLLECTION_PREFIX = '!7K ';
const DEFAULT_PRESET_NAME = '!7K 全部键型';
function collectionLabel(id) {
  const tag=TAGS.find(t=>t.id===id);
  if(!tag)throw Error('未知分类');
  return tag.label;
}
function collectionName(id,scope) {
  const match=/^(detail|compact)-(1|1\.5|0\.75)x$/.exec(scope);
  if(!match)throw Error('无效收藏夹模型或速率');
  return COLLECTION_PREFIX+collectionLabel(id)+(match[1]==='compact'?' Compact':'')+({'1':'','1.5':' DT','0.75':' HT'}[match[2]]);
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
module.exports = {TAGS,RETIRED_TAGS,ENGINE_VERSION,COLLECTION_PREFIX,DEFAULT_PRESET_NAME,collectionLabel,collectionName,options,rules};
