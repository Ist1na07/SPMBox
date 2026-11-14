'use strict';
const {app,BrowserWindow,ipcMain,dialog,shell,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {Library}=require('./core/library.cjs');
const {TAGS,ENGINE_VERSION,DEFAULT_PRESET_NAME,options:validateOptions,rules:validateRules}=require('./core/catalog.cjs');
const {preview,qualifies}=require('./core/rules.cjs');
const collections=require('./core/collections.cjs');
const {atomicWrite,readJson}=require('./core/storage.cjs');
const osuDb=require('./core/osu-db.cjs');
const databaseWrite=require('./core/database-write.cjs');
const regrade=require('./core/regrade.cjs');
const {compile}=require('./core/filter.cjs');
const testMode=!app.isPackaged&&process.env.SPMBOX_TEST==='1';
if(testMode&&process.env.SPMBOX_TEST_DATA)app.setPath('userData',process.env.SPMBOX_TEST_DATA);
if(!app.requestSingleInstanceLock())app.quit();
let win,library,jobLibrary=null,settings={},settingsPath,previewToken=null,dbPreview=null,writing=false;
const html=path.join(__dirname,'ui/index.html'),trusted=pathToFileURL(html).href;
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{
  if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==trusted)throw Error('无效请求来源');
  try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}
});}
const persist=()=>atomicWrite(settingsPath,JSON.stringify(settings,null,2));
function available(){if(library.running)throw Error('请等待分析完成');if(!library.report?.complete||!library.rows.length)throw Error('请先完成谱面分析');}
function file(){if(!settings.osuRoot)throw Error('请先选择 osu!stable 文件夹');return path.join(settings.osuRoot,'collection.db');}
async function gameClosed(){
  if(process.platform!=='win32')return;
  const {stdout}=await promisify(execFile)('tasklist.exe',['/FO','CSV','/NH'],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024});
  if(/^"(?:osu!|osu)\.exe"/mi.test(stdout))throw Error('请先完全退出 osu!，再写入或恢复数据库');
}
function assertFreshLibrary(){
  available();if(library.root!==settings.songsRoot)throw Error('目录已变化，请重新分析');
  if(library.rows.some(r=>r.classificationPending))throw Error('少量旧缓存缺少整谱归属，请点击分析谱面补齐；其余结果直接复用');
}
function query(input={}){
  const q=typeof input.search==='string'?input.search.slice(0,500).toLowerCase():'';
  const keys=Number(input.keys)||0,tag=typeof input.tag==='string'?input.tag:'';
  const sort=['rating','rcRating','lnRating','title','beatmapId'].includes(input.sort)?input.sort:'rating';
  const direction=input.direction==='asc'?1:-1;
  const matchesTag=r=>!tag||(TAGS.find(t=>t.id===tag)?.kind==='family'?qualifies(r,{tag,mode:'upstream'}):tag==='native:ln'?[4,6].includes(r.keys)&&r.tags.includes('ln'):r.tags.includes(tag));
  const expression=compile(input.expression??'');
  const list=library.rows.filter(r=>(!keys||r.keys===keys)&&matchesTag(r)&&expression(r)&&(!q||`${r.artist} ${r.title} ${r.difficulty} ${r.creator} ${r.beatmapId}`.toLowerCase().includes(q)));
  list.sort((a,b)=>{
    const x=a[sort],y=b[sort];if(x==null)return y==null?0:1;if(y==null)return -1;
    return (typeof x==='string'?x.localeCompare(y):x-y)*direction||a.file.localeCompare(b.file);
  });return list;
}
const summary=()=>({count:library.rows.length,keys:[4,6,7].map(k=>({keys:k,count:library.rows.filter(r=>r.keys===k).length})),
  options:library.options??null,root:library.root??null,report:library.report,settings,tags:TAGS,pending:library.rows.filter(r=>r.classificationPending).length,defaultPresetName:DEFAULT_PRESET_NAME,engine:ENGINE_VERSION,version:app.getVersion()});
async function exclusive(action){if(writing||library.running||jobLibrary?.running)throw Error('另一项任务正在运行');writing=true;try{return await action();}finally{writing=false;}}
async function selectRoot(){
  if(library.running||writing)throw Error('请先完成当前任务');
  const chosen=await dialog.showOpenDialog(win,{title:'选择 osu!stable 安装目录（或其 Songs 文件夹）',properties:['openDirectory']});
  if(chosen.canceled)return null;return configureRoot(chosen.filePaths[0]);
}
async function configureRoot(root){
  root=await fs.realpath(root);let osuRoot=root,songsRoot;
  if(path.basename(root).toLowerCase()==='songs'){songsRoot=root;osuRoot=path.dirname(root);}
  else{
    songsRoot=path.join(root,'Songs');
    // Respect stable's custom BeatmapDirectory instead of silently scanning the wrong folder.
    const names=await fs.readdir(root);
    for(const name of names.filter(n=>/^osu!.*\.cfg$/i.test(n)).sort()){
      const text=await fs.readFile(path.join(root,name),'utf8');const configured=text.match(/^BeatmapDirectory\s*=\s*(.+)$/mi)?.[1].trim();
      if(configured){songsRoot=path.resolve(root,configured);break;}
    }
  }
  const stat=await fs.stat(songsRoot);if(!stat.isDirectory())throw Error('未找到 Songs 目录');
  songsRoot=await fs.realpath(songsRoot);
  settings={...settings,osuRoot,songsRoot};previewToken=null;dbPreview=null;await persist();return summary();
}
app.whenReady().then(async()=>{
  const data=app.getPath('userData');await fs.mkdir(data,{recursive:true});settingsPath=path.join(data,'settings.json');
  settings=await readJson(settingsPath,{model:'detail',rate:1,workers:4,rules:TAGS.map(t=>({tag:t.id,mode:'upstream',threshold:t.defaultThreshold}))});
  library=new Library(data);await library.load();
  if(testMode&&process.env.SPMBOX_TEST_ROOT)await configureRoot(process.env.SPMBOX_TEST_ROOT);
  handle('state',()=>summary());
  handle('choose-root',selectRoot);
  handle('settings',async input=>{
    if(library.running||writing)throw Error('请等待当前任务完成');
    const opts=validateOptions(input),workers=Number(input.workers);
    if(!Number.isInteger(workers)||workers<1||workers>8)throw Error('并行数应为 1–8');
    settings={...settings,...opts,workers};previewToken=null;dbPreview=null;await persist();return summary();
  });
  handle('save-rules',async input=>{settings.rules=validateRules(input);previewToken=null;await persist();});
  handle('scan',async()=>{
    if(writing)throw Error('收藏夹正在写入');if(!settings.songsRoot)throw Error('请先选择 osu!stable 目录');
    previewToken=null;dbPreview=null;jobLibrary=library;
    try{const report=await library.scan(settings.songsRoot,settings,p=>{if(!win.isDestroyed())win.webContents.send('progress',p);});
      return {summary:summary(),report};}finally{jobLibrary=null;}
  });
  handle('cancel',()=>{library.cancel();jobLibrary?.cancel();});
  handle('query',input=>{
    const list=query(input),page=Math.max(0,Math.floor(Number(input?.page)||0));
    return {total:list.length,rows:list.slice(page*100,(page+1)*100),page};
  });
  handle('preview',async input=>{
    assertFreshLibrary();
    if(library.options.model!==settings.model||library.options.rate!==settings.rate)throw Error('算法或速率已变化，请先重新分析');
    const groups=preview(library.rows,input),dbFile=file(),state=await collections.readState(dbFile);
    const scope=`${library.options.model}-${library.options.rate}x`,change=collections.plan(state,dbFile,groups,scope);
    const token=randomUUID();previewToken={token,state,change,file:dbFile,created:Date.now()};
    return {token,groups:groups.map(({hashes,...g})=>g),actions:change.actions,file:dbFile,
      errors:library.report.errors.length,warnings:library.report.warnings.length};
  });
  handle('write',token=>exclusive(async()=>{
    if(!previewToken||previewToken.token!==token||Date.now()-previewToken.created>600000)throw Error('预览已过期，请重新预览');
    await gameClosed();
    const p=previewToken;previewToken=null;
    return collections.commit(p.file,p.state,p.change);
  }));
  handle('collections',async()=>{
    const target=file(),state=await collections.readState(target);
    return {rows:collections.managedState(state.db,state.manifest),backups:await collections.backups(target),file:target};
  });
  handle('filter-preview',async input=>{
    assertFreshLibrary();const name=String(input?.name??'').trim();
    if(!name||name.length>60||/[\r\n\x00-\x1f]/.test(name)||name.includes('[SPMBox:'))throw Error('收藏夹名应为 1–60 个可见字符');
    const rows=query(input.query),group={tag:name,name:name.startsWith('!')?name:'!'+name,hashes:[...new Set(rows.map(r=>r.md5))],mode:'filter',threshold:0};
    const target=file(),state=await collections.readState(target),change=collections.plan(state,target,[group],'filter');
    const token=randomUUID();previewToken={token,state,change,file:target,created:Date.now()};
    return {token,actions:change.actions,count:group.hashes.length,file:target};
  });
  const dbFile=()=>{file();return path.join(settings.osuRoot,'osu!.db');};
  // Variant preparation shares the cache without replacing the visible library snapshot.
  handle('rating-preview',input=>exclusive(async()=>{
    if(!settings.songsRoot)throw Error('请先连接谱面库');
    const rates=input?.rates;if(!Array.isArray(rates)||!rates.length||new Set(rates).size!==rates.length||rates.some(r=>![1,.75,1.5].includes(r)))throw Error('请选择 NM / HT / DT');
    const target=dbFile();osuDb.decode(await fs.readFile(target));dbPreview=null;
    const variants=[],reports=[];jobLibrary=new Library(data);
    try{for(const rate of rates){
      const report=await jobLibrary.scan(settings.songsRoot,{...settings,rate},p=>{if(!win.isDestroyed())win.webContents.send('progress',{...p,operation:`重排 · ${rate===1?'NM':rate===.75?'HT':'DT'}`});},{publish:false,requireClassification:false});
      if(!report.complete)throw Error('已取消难度准备；已完成的结果仍然缓存');variants.push(...report.rows);reports.push({...report,rows:undefined,rate});
    }}finally{jobLibrary=null;}
    const expected=await fs.readFile(target),change=osuDb.ratingPlan(expected,variants),token=randomUUID();
    const changed=new Set(change.changes.map(c=>c.md5));
    const source=new Map(variants.filter(r=>changed.has(r.md5)).map(r=>[r.file,r.signature]));
    dbPreview={token,file:target,expected,bytes:change.bytes,source,created:Date.now(),label:'SPM 难度重排'};
    settings.ratingRates=rates;await persist();
    return {token,file:target,summary:change.summary,changes:change.changes.slice(0,30),reports};
  }));
  handle('grade-preview',input=>exclusive(async()=>{
    const target=dbFile(),scoreFile=path.join(settings.osuRoot,'scores.db'),expected=await fs.readFile(target),scoreBytes=await fs.readFile(scoreFile);
    const change=regrade.plan(expected,scoreBytes,input),token=randomUUID();settings.grade=regrade.settings(input);await persist();
    dbPreview={token,file:target,expected,bytes:change.bytes,scoreFile,scoreBytes,created:Date.now(),label:'自定义成绩评级'};
    return {token,file:target,summary:change.summary,changes:change.changes.slice(0,30)};
  }));
  handle('database-write',token=>exclusive(async()=>{
    if(!dbPreview||dbPreview.token!==token||Date.now()-dbPreview.created>600000)throw Error('数据库预览已过期，请重新预览');
    await gameClosed();const p=dbPreview;
    if(p.source)for(const [file,signature] of p.source){const s=await fs.stat(file);if(JSON.stringify([s.size,s.mtimeMs,s.ctimeMs])!==JSON.stringify(signature))throw Error('预览后谱面已改动，请重新预览：'+file);}
    if(p.scoreFile&&!await collections.currentEquals(p.scoreFile,p.scoreBytes))throw Error('成绩数据库已变化，请重新预览');
    dbPreview=null;return databaseWrite.commit(p.file,p.expected,p.bytes,p.label,gameClosed);
  }));
  handle('database-backups',async()=>({rows:await databaseWrite.backups(dbFile()),file:dbFile()}));
  handle('database-restore',id=>exclusive(async()=>{await gameClosed();dbPreview=null;return databaseWrite.restore(dbFile(),id,gameClosed);}));
  handle('remove',keys=>exclusive(async()=>{
    await gameClosed();previewToken=null;const target=file(),state=await collections.readState(target);
    return collections.commit(target,state,collections.removePlan(state,keys));
  }));
  handle('backups',async()=>({backups:await collections.backups(file()),file:file()}));
  handle('restore',id=>exclusive(async()=>{await gameClosed();previewToken=null;return collections.restore(file(),id);}));
  handle('export',async input=>{
    available();const choice=await dialog.showSaveDialog(win,{title:'导出筛选后的谱面',defaultPath:'SPM-Box.csv',filters:[{name:'CSV',extensions:['csv']}]});
    if(choice.canceled)return null;
    const text=v=>{const s=String(v??'');return '"'+(/^[\s]*[=+@-]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';};
    const keys=['beatmapId','artist','title','difficulty','creator','keys','rating','rcRating','lnRating','model','rate','tags','md5'];
    const lines=[keys.join(','),...query(input).map(r=>keys.map(k=>text(Array.isArray(r[k])?r[k].join('; '):r[k])).join(','))];
    await atomicWrite(choice.filePath,'\uFEFF'+lines.join('\r\n'));return choice.filePath;
  });
  handle('reveal-map',async md5=>{const row=library.rows.find(r=>r.md5===md5);if(!row)throw Error('未找到谱面');shell.showItemInFolder(row.file);});
  handle('open-beatmap',async id=>{if(!Number.isSafeInteger(id)||id<=0)throw Error('该谱面尚无在线 ID');await shell.openExternal('https://osu.ppy.sh/beatmaps/'+id);});
  handle('open-data',()=>shell.openPath(data));
  handle('open-backups',async()=>{const root=path.join(path.dirname(file()),'.spmbox-backups');await fs.mkdir(root,{recursive:true});return shell.openPath(root);});
  handle('repository',()=>shell.openExternal('https://github.com/Ist1na07/SPMBox'));
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win=new BrowserWindow({width:1400,height:940,minWidth:1024,minHeight:720,backgroundColor:'#101216',title:'SPM Box',icon:path.join(__dirname,'../assets/icon.png'),
    autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==trusted)event.preventDefault();});
  win.on('close',event=>{if(writing){event.preventDefault();jobLibrary?.cancel();void dialog.showMessageBox(win,{message:'数据库任务尚未结束，已请求取消分析；请稍候再关闭。'});}else library.cancel();});
  await win.loadFile(html);
}).catch(e=>{dialog.showErrorBox('SPM Box 启动失败',e.message);app.quit();});
app.on('second-instance',()=>{win?.show();win?.focus();});
app.on('window-all-closed',()=>app.quit());
