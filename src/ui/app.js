const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v==null?'—':Number(v).toFixed(2);
const integer=v=>Number(v).toLocaleString('en-US');
let state,tagRules=[],activeTag='rc',ready=null,busy=false,page=0,keys=0,total=0,queryVersion=0,lastRows=[],managedRows=[],modalAction;
let toastTimer,searchTimer;
let databaseReady=null,expression='';
async function api(name,...args){const r=await window.spm[name](...args);if(!r.ok)throw Error(r.error);return r.value;}
function toast(text,error=false){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?10000:6000);}
function action(fn){return async(...args)=>{try{await fn(...args);}catch(e){toast(e.message,true);}};}
function on(selector,event,fn){$(selector).addEventListener(event,action(fn));}
const label=id=>state.tags.find(t=>t.id===id)?.label??({'jack':'Jack',stamina:'Chordstream',ln:'LN'}[id]??id);
const tagFamily=id=>state.tags.find(t=>t.id===id)?.family?.toLowerCase()??(id==='ln'?'ln':'rc');
const chips=tags=>tags.map(t=>`<span class="tag-chip ${esc(tagFamily(t))}">${esc(label(t))}</span>`).join('');
function stale(){return state.options&&(state.options.model!==state.settings.model||state.options.rate!==state.settings.rate||state.root!==state.settings.songsRoot);}
function showNote(){const note=$('#global-note');note.hidden=!stale()&&!state.pending;note.textContent=state.pending?`${state.pending} 张旧缓存缺少整谱归属，点击分析谱面即可定向补齐；其余结果不会重跑。`:'目录、模型或速率已改变。当前仍显示上一次结果；点击分析，已有组合直接复用缓存。';}
function applyState(next){
  state=next;
  $('#default-preset-name').textContent=state.defaultPresetName;
  $('#app-version').textContent='v'+state.version;
  $('#nav-count').textContent=integer(state.count);
  $('#stat-total').textContent=integer(state.count);
  const k7=state.keys.find(x=>x.keys===7)?.count??0;
  $('#stat-7k').textContent=integer(k7);$('#stat-other').textContent=integer(state.count-k7);
  $('#root-path').textContent=state.settings.songsRoot??'尚未连接 osu!stable 谱面库';$('#root-path').title=state.settings.songsRoot??'';
  const r=state.report;
  $('#stat-time').textContent=r?(r.elapsedMs/1000).toFixed(2)+' s':'尚未分析';
  $('#cache-detail').textContent=r?`缓存命中 ${integer(r.hits)} / ${integer(r.total)} · ${r.workers} 个后台线程`:'增量缓存已启用';
  const o=state.options??state.settings;
  $('.engine-badge').innerHTML=`SPM Rating 1.2.0 <b>${esc(o.model.toUpperCase())} · ${o.rate.toFixed(2)}×</b>`;
  $('#preview-context').textContent=state.options?`${o.model==='detail'?'Detailed':'Compact'} · ${o.rate.toFixed(2)}× · ${integer(k7)} 张 7K`:'请先完成谱面分析';
  $('#export').disabled=!state.count||busy;
  $('#model').value=state.settings.model;$('#rate').value=String(state.settings.rate);$('#workers').value=String(state.settings.workers);
  showNote();renderIssues();
}
function renderIssues(){
  const r=state.report,issues=$('#scan-issues');if(!r){issues.hidden=true;return;}
  const errors=r.errors??[],warnings=r.warnings??[];issues.hidden=!(errors.length||warnings.length||r.skipped);
  $('#issues-summary').textContent=`分析报告：${errors.length} 张失败 · ${warnings.length} 张分类失败 · ${r.skipped} 张不支持的谱面已跳过`;
  $('#issues-list').innerHTML=[...errors,...warnings].slice(0,100).map(e=>`<div>${esc(e.file)} — ${esc(e.reason)}</div>`).join('')+(errors.length+warnings.length>100?'<p>仅显示前 100 项。重新分析可重试失败文件。</p>':'');
}
function currentQuery(){const [sort,direction]=$('#sort').value.split(':');return {search:$('#search').value,keys,tag:$('#tag-filter').value,sort,direction,page,expression};}
async function loadRows(){
  const version=++queryVersion;const data=await api('query',currentQuery());if(version!==queryVersion)return;
  total=data.total;lastRows=data.rows;
  if(page>0&&page*100>=total){page=Math.max(0,Math.ceil(total/100)-1);return loadRows();}
  $('#library-rows').innerHTML=data.rows.map((r,i)=>`<tr tabindex="0" data-row="${i}" aria-label="${esc(r.title+' '+r.difficulty)}"><td class="number">${page*100+i+1}</td><td><div class="song-title">${esc(r.title)}</div><div class="song-sub" title="${esc(`${r.artist} · [${r.difficulty}] · ${r.creator}`)}">${esc(r.artist)} <span>· [${esc(r.difficulty)}]</span></div></td><td><span class="key-badge">${r.keys}K</span></td><td class="number rating">${num(r.rating)}</td><td class="number muted">${num(r.rcRating)}</td><td class="number muted">${num(r.lnRating)}</td><td>${r.classified?chips(r.tags):'<span class="tag-chip other">分类失败</span>'}</td><td class="number id-cell">${r.beatmapId>0?esc(r.beatmapId):'本地谱面'}</td></tr>`).join('');
  $('#empty-library').hidden=!!total;
  if(!state.count){$('#empty-library').innerHTML=`<div class="lane-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><h2>把你的谱面，整理成下一步。</h2><p>${state.settings.songsRoot?'谱面库已连接，点击右上角「分析谱面」开始。':'连接 osu!stable 文件夹，开始第一次 SPM 分析。'}<br>谱面文件与原版星数不会被改动。</p><button class="button primary" id="empty-connect">${state.settings.songsRoot?'开始分析 →':'连接谱面库 →'}</button><small>支持原生 4K · 6K · 7K，分类预设仅适用于 7K</small>`;
    $('#empty-connect').addEventListener('click',action(()=>state.settings.songsRoot?scan():chooseRoot()));
  }else if(!total){$('#empty-library').innerHTML='<h2>没有符合条件的谱面</h2><p>试着更换键数、键型或搜索词。</p>';}
  $('#result-count').textContent=`${integer(total)} 张谱面${total?` · 当前 ${page*100+1}–${Math.min((page+1)*100,total)}`:''}`;
  $('#page-number').textContent=`${page+1} / ${Math.max(1,Math.ceil(total/100))}`;
  $('#prev-page').disabled=page===0;$('#next-page').disabled=(page+1)*100>=total;
  $$('#library-rows tr').forEach(tr=>{tr.addEventListener('click',()=>showDetail(lastRows[Number(tr.dataset.row)]));tr.addEventListener('keydown',e=>{if(e.key==='Enter')showDetail(lastRows[Number(tr.dataset.row)]);});});
}
function showDetail(row){
  $('#detail-title').textContent=row.title;
  $('#detail-content').innerHTML=`<p class="muted">${esc(row.artist)} · [${esc(row.difficulty)}] · ${esc(row.creator)}</p><div class="muted">${row.keys}K · ${integer(row.notes)} notes · ${(row.duration/1000).toFixed(1)} s · ${row.bpm?Math.round(row.bpm)+' BPM':'BPM 未知'} · ${esc(row.model)} / ${row.rate}×</div><div class="detail-stats"><div><span>SPM Rating</span><strong>${num(row.rating)}</strong></div><div><span>RC Rating</span><strong>${num(row.rcRating)}</strong></div><div><span>LN Rating</span><strong>${num(row.lnRating)}</strong></div></div><div>${chips(row.tags)}</div>${row.classificationError?`<p class="notice">分类失败：${esc(row.classificationError)}</p>`:''}<p class="helper">${row.keys===7?'7K：重叠的难度负担占比；不是正确概率。':'4K / 6K：五类归一化形态支持；不与 7K 百分比混用。'}</p><div class="detail-scores">${Object.entries(row.scores).filter(([t])=>row.keys!==7||state.tags.some(tag=>tag.id===t)).sort((a,b)=>b[1]-a[1]).map(([t,v])=>`<div><span>${esc(label(t))}</span><span class="mono muted">${v.toFixed(2)}%</span></div>`).join('')}</div><p class="helper mono">ID ${row.beatmapId>0?row.beatmapId:'未提交'} · MD5 ${esc(row.md5)}</p><div class="detail-actions"><button id="reveal-current" class="button secondary">打开谱面所在文件夹 ↗</button>${row.beatmapId>0?'<button id="online-current" class="text-button">在线谱面 ↗</button>':''}</div>`;
  $('#reveal-current').addEventListener('click',action(()=>api('reveal-map',row.md5)));
  $('#online-current')?.addEventListener('click',action(()=>api('open-beatmap',row.beatmapId)));
  $('#detail-dialog').showModal();
}
async function chooseRoot(){const result=await api('choose-root');if(result){applyState(result);invalidate();toast('谱面库已连接，点击「分析谱面」开始。');await loadRows();}}
function setBusy(value){busy=value;$('#scan').disabled=value;$('#choose-root').disabled=value;$('#export').disabled=value||!state.count;$('#scan-progress').hidden=!value;$('#scan').textContent=value?'正在分析…':'分析谱面 →';$('#preview').disabled=value;$('#save-settings').disabled=value;$('#review').disabled=value||!ready;for(const s of ['#rating-prepare','#grade-prepare','#filter-collection'])$(s).disabled=value;}
async function scan(){
  if(busy)return;if(!state.settings.songsRoot){await chooseRoot();if(!state.settings.songsRoot)return;}
  invalidate();setBusy(true);$('#progress-bar').value=0;
  try{const result=await api('scan');applyState(result.summary);page=0;await loadRows();
    const r=result.report;toast(r.complete?`分析完成：${integer(state.count)} 张谱面，缓存命中 ${integer(r.hits)} 张。${r.errors.length||r.warnings.length?'请查看分析报告。':''}`:'已取消。保留上一次完整谱面库，已算结果仍会缓存。');
  }finally{setBusy(false);}
}
window.spm.onProgress(p=>{
  $('#progress-title').textContent=`${p.operation??'正在分析'} ${integer(p.done)} / ${integer(p.total)} 张谱面`;
  $('#progress-bar').max=Math.max(1,p.total);$('#progress-bar').value=p.done;
  $('#progress-detail').textContent=`${(p.elapsedMs/1000).toFixed(1)} s · ${p.workers} 个后台线程 · 缓存 ${p.hits} · 新分析 ${p.analysed} · 失败 ${p.errors}`;
});
function invalidate(){ready=null;databaseReady=null;$('#rating-write').disabled=true;$('#grade-write').disabled=true;$('#review').disabled=true;$('#boundary-preview').hidden=true;$('#preview-empty').hidden=false;}
function selectedRules(){return tagRules.filter(r=>r.enabled).map(({tag,mode,threshold})=>({tag,mode,threshold}));}
function renderTags(){
  $('#tag-rules').innerHTML=tagRules.map(r=>{const tag=state.tags.find(t=>t.id===r.tag);return `<div class="tag-rule ${tag.kind==='family'?'family-rule':tag.parent?'sub-rule':''} ${r.tag===activeTag?'active':''}"><input type="checkbox" data-enable="${esc(r.tag)}" aria-label="选择 ${esc(label(r.tag))}" ${r.enabled?'checked':''}><button data-tag="${esc(r.tag)}">${esc(label(r.tag))}</button><small>${tag.kind==='family'?'总类 · ':''}${r.mode==='upstream'?'AUTO':r.threshold+'%'}</small></div>`;}).join('');
  $$('#tag-rules [data-tag]').forEach(b=>b.addEventListener('click',()=>{activeTag=b.dataset.tag;renderTags();renderActiveRule();renderBoundary();}));
  $$('#tag-rules [data-enable]').forEach(c=>c.addEventListener('change',()=>{tagRules.find(r=>r.tag===c.dataset.enable).enabled=c.checked;invalidate();$('#selected-count').textContent=selectedRules().length+' 个已选分类';}));
  $('#selected-count').textContent=selectedRules().length+' 个已选分类';
}
function renderActiveRule(){
  const rule=tagRules.find(r=>r.tag===activeTag),tag=state.tags.find(t=>t.id===activeTag);$('#active-tag').textContent=label(activeTag);$('#tag-family').textContent=tag.kind==='family'?'7K 总类 · RC / LN / Hybrid 并列':tag.parent?`${label(tag.parent)} 子类 · 7K`:'其他 · 7K';
  $('#rule-mode option[value="upstream"]').textContent=tag.kind==='family'?'TagClassifier 整谱类型判定':'TagClassifier 默认判定';
  $('#rule-mode').value=rule.mode;$('#threshold').value=rule.threshold;$('#threshold').disabled=rule.mode==='upstream';
  if(tag.kind==='family'){
    $('#threshold-explanation').textContent=rule.mode==='upstream'?'按 TagClassifier 的整谱类型归入 RC、LN 或 Hybrid，不使用 Rating 的 RC/LN 类型。默认总类互斥；细分类保留各自的原始多标签判定。':activeTag==='hybrid'?'Hybrid 分数为 min(RC, LN) 的负担支持占比；分数 ≥ 阈值即入选。数值阈值模式允许总类之间重叠。':'使用对应家族的联合负担支持占比，分数 ≥ 阈值即入选。数值阈值模式允许总类之间重叠。';
    return;
  }
  $('#threshold-explanation').textContent=rule.mode==='upstream'?'默认判定保留上游的先验、增补与混合门控；它不等价于统一百分比阈值。数值模式初值取保留门限 25%。':['rc mix','ln mix'].includes(activeTag)?'数值模式使用对应家族（RC 或 LN）的联合负担支持占比；不再要求上游的混合多样性门控。分数 ≥ 阈值即入选。':'使用此键型的单一负担占比分数，分数 ≥ 阈值即入选。各键型占比可能重叠；不是正确概率。';
}
function renderBoundary(){
  const g=ready?.groups.find(g=>g.tag===activeTag);$('#boundary-preview').hidden=!g;$('#preview-empty').hidden=!!g;if(!g)return;
  $('#boundary-title').textContent=g.label+' · 边界预览';$('#boundary-count').textContent=integer(g.count)+' 张入选';
  const edgeRow=r=>`<div class="boundary-row"><div><strong title="${esc(r.title+' ['+r.difficulty+']')}">${esc(r.title)}</strong><div class="meta">[${esc(r.difficulty)}] · ID ${r.beatmapId>0?r.beatmapId:'未提交'}${r.beatmapId<=0?' · '+esc(r.md5.slice(0,8)):''}</div></div><div class="boundary-score">${r.score.toFixed(2)}%</div></div>`;
  $('#inside-rows').innerHTML=g.inside.map(edgeRow).join('')||'<div class="boundary-empty">没有入选谱面</div>';
  $('#outside-rows').innerHTML=g.outside.map(edgeRow).join('')||'<div class="boundary-empty">没有未入选谱面</div>';
  $('#boundary-note').textContent=g.mode==='upstream'?(state.tags.find(t=>t.id===g.tag).kind==='family'?'按整谱类型归属生成总类，分数仅用于边界排序，不是固定的入选门限。':'默认模式按原始标签判定。由于先验与混合门控，未入选分数可能高于入选分数。'):`当前阈值 ${g.threshold}%（含等号）。仅展示边界两侧各 5 张；同一 MD5 在收藏夹中只保留一次。`;
}
async function doPreview(){
  if(busy)throw Error('请等待分析完成');
  const rules=selectedRules();if(!rules.length)throw Error('请至少选择一种键型');
  await api('save-rules',rules);ready=await api('preview',rules);$('#review').disabled=false;renderBoundary();toast(`预览完成：${rules.length} 个分类。`);
}
function openConfirm(title,html,confirmation,buttonText,fn){
  $('#dialog-title').textContent=title;
  $('#dialog-content').innerHTML=html+`<label class="confirm-check"><input id="confirm-safe" type="checkbox"><span>${esc(confirmation)}</span></label>`;
  $('#dialog-confirm').textContent=buttonText;$('#dialog-confirm').disabled=true;modalAction=fn;
  $('#confirm-safe').addEventListener('change',e=>$('#dialog-confirm').disabled=!e.target.checked);
  $('#review-dialog').showModal();
}
function review(){
  if(!ready)throw Error('请先预览');const current=ready;
  openConfirm('确认创建收藏夹',`<p>将写入 <code>${esc(current.file)}</code>。管理凭证保存在旁边的记录文件。仅更新未经手动修改的自动收藏夹；旧长名会改成短名，已验证的废弃分类会删除。写入前备份。</p>${current.errors||current.warnings?`<div class="notice">本次分析有 ${current.errors} 张失败、${current.warnings} 张分类失败；这些谱面不会进入分类收藏夹。</div>`:''}<div class="review-list">${current.actions.map(a=>`<div class="review-row"><span>${a.type==='create'?'新建':a.type==='delete'?'删除废弃分类':'更新'} · ${esc(a.name.split(' [SPMBox:')[0])}${a.previousName?'（简化名称）':''}${a.count===0?'（空）':''}</span><span>${integer(a.count)} maps</span></div>`).join('')}</div>`,
    '我已完全退出 osu!，并确认上述分类和空收藏夹。','备份并写入',async()=>{
      const result=await api('write',current.token);invalidate();toast(`已保存 ${result.actions.length} 个收藏夹。备份：${result.backup}`);await loadManaged();
    });
}
async function loadManaged(){
  if(!state.settings.osuRoot){$('#managed-list').innerHTML='<div class="empty-state"><h2>先连接 osu!stable 文件夹</h2><p>选择谱面库后即可查看 collection.db 中的收藏夹。</p></div>';return;}
  let data;
  try{data=await api('collections');}
  catch(e){
    const recovery=await api('backups');fillBackups(recovery.backups);$('#managed-list').innerHTML=`<div class="notice">${esc(e.message)}。可在下方选择备份恢复。</div>`;return;
  }
  managedRows=data.rows;$('#managed-path').textContent=data.file;
  $('#managed-list').innerHTML=data.rows.map((r,i)=>{
    const friendly=r.name.split(' [SPMBox:')[0],marker=r.name.includes(' [SPMBox:')?r.name.slice(r.name.indexOf(' [SPMBox:')+1):'';
    return `<div class="managed-item"><input type="checkbox" data-managed="${i}" aria-label="选择收藏夹 ${esc(friendly)}" ${r.managed?'':'disabled'}><div class="name"><strong>${esc(friendly)}</strong>${marker?`<small>${esc(marker)}</small>`:''}</div><span class="collection-number">${integer(r.count)}</span><span class="collection-status ${r.managed?'owned':r.modified?'modified':''}">${r.managed?'SPM Box 管理':r.modified?'已改动 · 受保护':r.foreign?'标识未验证 · 受保护':'用户收藏夹 · 受保护'}</span></div>`;
  }).join('')||'<div class="empty-state"><h2>还没有收藏夹</h2><p>从收藏夹创建器开始，所有写入都会先备份。</p></div>';
  $$('#managed-list input').forEach(c=>c.addEventListener('change',()=>$('#delete-managed').disabled=!$$('#managed-list input:checked').length));
  $('#delete-managed').disabled=true;fillBackups(data.backups);
}
function fillBackups(backups){$('#backup-select').innerHTML=backups.map(id=>`<option value="${esc(id)}">${esc(id.split('_')[0])} UTC</option>`).join('')||'<option value="">暂无备份</option>';$('#restore').disabled=!backups.length;}
function switchPanel(id){
  $$('.panel').forEach(p=>p.hidden=p.id!=='panel-'+id);$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.panel===id));
  $('#breadcrumb').textContent={library:'谱面库',rating:'游戏内难度重排',grade:'成绩评级',creator:'收藏夹创建器',managed:'收藏夹管理',settings:'设置与关于'}[id];
  window.scrollTo(0,0);
  if(id==='managed')return loadManaged();
  if(id==='rating'&&state.settings.osuRoot)return loadDatabaseBackups();
}
async function loadDatabaseBackups(){const data=await api('database-backups');$('#database-backup').innerHTML=data.rows.map(e=>`<option value="${esc(e.id)}">${esc(e.id.split('_')[0])} UTC · ${esc(e.label)}</option>`).join('')||'<option value="">暂无备份</option>';$('#database-restore').disabled=!data.rows.length;}
const gradeName=n=>['银 SS','银 S','SS','S','A','B','C','D','F','无'][n]??String(n);
function databaseResult(kind,result){
  databaseReady={...result,kind};$('#rating-write').disabled=kind!=='rating'||!result.summary.maps;$('#grade-write').disabled=kind!=='grade'||!result.summary.maps;
  const panel=$('#'+kind+'-result');panel.hidden=false;
  const reports=result.reports??[],hits=reports.reduce((s,r)=>s+r.hits,0),analysed=reports.reduce((s,r)=>s+r.analysed,0),errors=reports.reduce((s,r)=>s+r.errors.length,0);
  panel.innerHTML=`<h2>预览：${integer(result.summary.maps)} 张谱面将变更</h2><p class="helper">${kind==='rating'?`缓存命中 ${integer(hits)} · 新分析 ${integer(analysed)} · 失败 ${errors} · 未匹配数据库 ${result.summary.unmatched} 个谱面/速率结果`:`读取 ${result.summary.scores} 条 mania 成绩`}。仅展示前 30 张。${result.summary.maps?'':'已是目标结果，或暂无匹配谱面。'}</p><div class="review-list">${result.changes.map(c=>`<div class="review-row"><span>${esc(c.title)} [${esc(c.difficulty)}]<small class="muted"> · ID ${c.beatmapId>0?c.beatmapId:c.md5.slice(0,8)}</small></span><span class="mono">${kind==='rating'?c.updates.map(u=>`${u.mod===576?'NC':u.rate===1?'NM':u.rate===.75?'HT':'DT'} ${num(u.before)} → ${num(u.after)}`).join('<br>'):`${gradeName(c.before)} → ${gradeName(c.after)}${c.stateChanges?.length?'<br>'+c.stateChanges.map(esc).join(' · '):''}`}</span></div>`).join('')}</div>`;
}
async function prepareRating(){invalidate();setBusy(true);try{const rates=$$('input[name="rating-rate"]:checked').map(e=>Number(e.value));databaseResult('rating',await api('rating-preview',{rates}));}finally{setBusy(false);}}
function gradeSettings(){return {thresholds:Object.fromEntries(['S','A','B','C','D'].map(g=>[g,Number($('#grade-'+g).value)])),mods:Object.fromEntries(['nf','ez','ht'].map(m=>[m,$('#grade-'+m).value])),lastPlayed:$('#grade-last').value,unplayedIfNoScore:$('#grade-unplayed').checked};}
function confirmDatabase(kind){const current=databaseReady;if(!current||current.kind!==kind)throw Error('请先重新预览');
  openConfirm(kind==='rating'?'确认游戏内难度重排':'确认成绩评级',`<p>将修改 <code>${esc(current.file)}</code> 中的 ${integer(current.summary.maps)} 张谱面。${kind==='rating'?'对应星数将替换为 SPM Rating，其他 Mod 星数、成绩和评级保持不变。':'仅修改 mania 评级及选定的游玩状态，不改原始成绩。'}</p><p>先备份整个 osu!.db，再写入。可从“游戏内难度重排”恢复备份。</p>`,'我已完全退出 osu!，确认备份并写入上述变更。','备份并写入',async()=>{const r=await api('database-write',current.token);invalidate();toast('数据库已更新。重新打开 osu! 后生效。备份：'+r.backup);await loadDatabaseBackups();});
}
async function init(){
  applyState(await api('state'));
  tagRules=state.tags.map(t=>({tag:t.id,mode:'upstream',threshold:t.defaultThreshold,enabled:false,...state.settings.rules?.find(r=>r.tag===t.id),...(state.settings.rules?.some(r=>r.tag===t.id)?{enabled:true}:{})}));
  if(!state.settings.rules)tagRules.forEach(r=>r.enabled=true);
  $('#tag-filter').innerHTML='<option value="">全部键型</option>'+[...state.tags.map(t=>[t.id,t.kind==='family'?t.label+' · 7K 总类':t.parent?label(t.parent)+' / '+t.label:t.label]),['jack','Jack (4K/6K)'],['stamina','Chordstream (4K/6K)'],['native:ln','LN (4K/6K)']].map(([id,text])=>`<option value="${esc(id)}">${esc(text)}</option>`).join('');
  renderTags();renderActiveRule();await loadRows();
  $$('.nav').forEach(b=>b.addEventListener('click',action(()=>switchPanel(b.dataset.panel))));
  on('#choose-root','click',chooseRoot);on('#scan','click',scan);on('#cancel','click',()=>api('cancel'));
  on('#rating-prepare','click',prepareRating);on('#rating-write','click',()=>confirmDatabase('rating'));
  $$('input[name="rating-rate"]').forEach(e=>e.addEventListener('change',()=>{databaseReady=null;$('#rating-write').disabled=true;}));
  for(const m of ['nf','ez','ht'])$('#grade-'+m).innerHTML='<option value="fixedD">固定为 D</option><option value="normal">等同 NM</option><option value="none">不显示评级</option><option value="ignore">忽略此成绩</option>';
  if(state.settings.grade){const g=state.settings.grade;for(const key of ['S','A','B','C','D'])$('#grade-'+key).value=g.thresholds[key];for(const key of ['nf','ez','ht'])$('#grade-'+key).value=g.mods[key];$('#grade-last').value=g.lastPlayed;$('#grade-unplayed').checked=g.unplayedIfNoScore;}
  if(state.settings.ratingRates)$$('input[name="rating-rate"]').forEach(e=>e.checked=state.settings.ratingRates.includes(Number(e.value)));
  on('#grade-prepare','click',async()=>{invalidate();setBusy(true);try{databaseResult('grade',await api('grade-preview',gradeSettings()));}finally{setBusy(false);}});
  on('#grade-write','click',()=>confirmDatabase('grade'));
  $$('#panel-grade input, #panel-grade select').forEach(e=>e.addEventListener('change',()=>{databaseReady=null;$('#grade-write').disabled=true;}));
  on('#database-restore','click',()=>{const id=$('#database-backup').value;if(!id)return;openConfirm('恢复整个 osu!.db','<div class="notice">星数、评级及谱面记录将回退到该备份状态，之后的数据库更改也会回退。当前文件会先另行备份。</div>','我已退出 osu!，确认恢复整个游戏数据库。','备份当前并恢复',async()=>{await api('database-restore',id);invalidate();toast('游戏数据库已恢复。');await loadDatabaseBackups();});});
  on('#apply-expression','click',async()=>{const previous=expression;expression=$('#expression').value;page=0;try{await loadRows();}catch(e){expression=previous;throw e;}});
  on('#filter-collection','click',async()=>{const r=await api('filter-preview',{name:$('#filter-name').value,query:currentQuery()});openConfirm('导出筛选结果',`<p>将 ${r.count} 张匹配谱面保存为 <strong>${esc(r.actions[0].name)}</strong>。包含全部匹配结果，不限当前页；自动备份并保护同名用户收藏夹。</p>`,'我已退出 osu!，确认创建或更新这个自动收藏夹。','备份并写入',async()=>{const result=await api('write',r.token);toast('收藏夹已保存。备份：'+result.backup);});});
  on('#search','input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(action(()=>{page=0;return loadRows();}),150);});
  for(const s of ['#sort','#tag-filter'])on(s,'change',()=>{page=0;return loadRows();});
  $$('#key-filter button').forEach(b=>b.addEventListener('click',action(()=>{keys=Number(b.dataset.keys);page=0;$$('#key-filter button').forEach(x=>x.classList.toggle('active',x===b));return loadRows();})));
  on('#prev-page','click',()=>{page--;return loadRows();});on('#next-page','click',()=>{page++;return loadRows();});
  on('#export','click',async()=>{const file=await api('export',currentQuery());if(file)toast('已导出：'+file);});
  on('#all-preset','click',()=>{tagRules=state.tags.map(t=>({tag:t.id,mode:'upstream',threshold:t.defaultThreshold,enabled:true}));invalidate();renderTags();renderActiveRule();toast(`已应用「${state.defaultPresetName}」预设，预览后即可一次创建。`);});
  on('#toggle-tags','click',()=>{const enable=!tagRules.every(r=>r.enabled);tagRules.forEach(r=>r.enabled=enable);invalidate();renderTags();});
  on('#rule-mode','change',e=>{tagRules.find(r=>r.tag===activeTag).mode=e.target.value;invalidate();renderTags();renderActiveRule();});
  on('#threshold','input',e=>{tagRules.find(r=>r.tag===activeTag).threshold=Number(e.target.value);invalidate();renderTags();});
  on('#reset-rule','click',()=>{Object.assign(tagRules.find(r=>r.tag===activeTag),{mode:'upstream',threshold:state.tags.find(t=>t.id===activeTag).defaultThreshold});invalidate();renderTags();renderActiveRule();});
  on('#preview','click',doPreview);on('#review','click',review);
  on('#dialog-confirm','click',async()=>{const b=$('#dialog-confirm');b.disabled=true;try{await modalAction();$('#review-dialog').close();}catch(e){$('#review-dialog').close();throw e;}finally{b.disabled=false;}});
  $$('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  on('#refresh-managed','click',loadManaged);
  on('#delete-managed','click',()=>{const selected=$$('#managed-list input:checked').map(c=>managedRows[Number(c.dataset.managed)]);openConfirm('删除自动收藏夹',`<p>仅删除以下 ${selected.length} 个未经改动的 SPM Box 收藏夹，操作前会备份。用户收藏夹不会被删除。</p><div class="review-list">${selected.map(r=>`<div class="review-row">${esc(r.name.split(' [SPMBox:')[0])}</div>`).join('')}</div>`,'我已退出 osu!，确认删除以上自动收藏夹。','备份并删除',async()=>{const result=await api('remove',selected.map(r=>r.key));invalidate();toast(`已删除 ${result.actions.length} 个自动收藏夹。`);await loadManaged();});});
  on('#restore','click',()=>{const id=$('#backup-select').value;if(!id)return;openConfirm('恢复整个收藏夹数据库',`<div class="notice">此操作会回退整个 collection.db。该备份之后创建或修改的用户收藏夹也会被回退。</div><p>备份：<code>${esc(id)}</code></p><p>当前数据库会另外备份，便于撤销本次恢复。</p>`,'我已退出 osu!，确认恢复整个数据库及管理标识。','备份当前并恢复',async()=>{await api('restore',id);invalidate();toast('收藏夹及管理标识已恢复。');await loadManaged();});});
  on('#save-settings','click',async()=>{applyState(await api('settings',{model:$('#model').value,rate:Number($('#rate').value),workers:Number($('#workers').value)}));invalidate();toast('设置已保存。回到谱面库重新分析后生效。');});
  for(const s of ['#repo-link','#about-repo'])on(s,'click',()=>api('repository'));
  on('#open-data','click',()=>api('open-data'));on('#open-backups','click',()=>api('open-backups'));
}
init().catch(e=>toast('启动失败：'+e.message,true));
