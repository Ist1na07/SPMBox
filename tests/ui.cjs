'use strict';
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {fixture}=require('./fixtures.cjs');
const {encode,decode}=require('../src/core/collections.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.local');
async function waitFor(page,fn){await page.waitForFunction(fn,null,{timeout:60000});}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'SPM-Box-UI-'));
  const songs=path.join(temp,'Songs');await fs.mkdir(songs);
  const env={...process.env,SPMBOX_TEST:'1',SPMBOX_TEST_ROOT:temp,SPMBOX_TEST_DATA:path.join(temp,'app-data')};delete env.ELECTRON_RUN_AS_NODE;
  const packaged=process.env.SPMBOX_UI_PACKAGED==='1';
  const app=await electron.launch({...(packaged?{executablePath:path.join(root,'dist/win-unpacked/SPM Box.exe')}:{ }),args:packaged?['--user-data-dir='+path.join(temp,'packaged-data')]:[root],env});let page;
  try{
    page=await app.firstWindow();await page.waitForSelector('#stat-total');await waitFor(page,()=>document.querySelector('#empty-connect')!==null);
    if(packaged){
      // Mock only the OS directory picker; the packaged IPC, filesystem, worker
      // loading from app.asar and collection transaction paths remain real.
      await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},temp);
      await page.locator('#choose-root').click();await waitFor(page,()=>document.querySelector('#root-path').textContent.includes('Songs'));
    }
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.screenshot({path:path.join(output,'empty.png')});
    const titles=['Prism Archive','Asterism','Signal / Noise','Silver Lining','Release Geometry','Sevenfold','Parallel Lines','Night Transit','Afterimage','Pulse Study','Glassworks','Uncharted'];
    for(let i=0;i<titles.length;i++)await fs.writeFile(path.join(songs,`chart-${i}.osu`),fixture({title:titles[i],id:100000+i,keys:i===10?4:i===11?6:7,holds:i%3===0,step:55+i*9,count:300+i*14,chords:i%2+1}));
    // Ensure a manual collection with a similar display name is always protected.
    await fs.writeFile(path.join(temp,'collection.db'),encode({version:20260101,collections:[{name:'!SPM Box · 7K · Speed',hashes:['b'.repeat(32)]}]}));
    await page.locator('#scan').click();await waitFor(page,()=>document.querySelector('#stat-total').textContent==='12');
    await waitFor(page,()=>!document.querySelector('#scan').disabled);
    assert.equal(await page.locator('#library-rows tr').count(),12);
    const numbers=await page.locator('#library-rows .rating').allTextContents();assert.deepEqual(numbers.map(Number),numbers.map(Number).sort((a,b)=>b-a));
    await page.screenshot({path:path.join(output,'library.png')});
    await page.locator('#search').fill('Prism');await waitFor(page,()=>document.querySelectorAll('#library-rows tr').length===1);
    await page.locator('#library-rows tr').click();await page.locator('#detail-dialog').waitFor({state:'visible'});
    assert.match(await page.locator('#detail-content').innerText(),/100000/);await page.locator('#detail-dialog .close-dialog').click();
    await page.locator('#search').fill('');
    await page.locator('[data-panel="creator"]').click();
    assert.equal(await page.locator('#default-preset-name').innerText(),'!SPM Box · 全部 7K 键型');
    await page.locator('#all-preset').click();await page.locator('#preview').click();
    await waitFor(page,()=>!document.querySelector('#review').disabled);
    await page.locator('[data-tag="speed"]').click();await page.screenshot({path:path.join(output,'creator.png')});
    await page.locator('#rule-mode').selectOption('threshold');await page.locator('#threshold').fill('50');assert.equal(await page.locator('#review').isDisabled(),true);
    await page.locator('#preview').click();await waitFor(page,()=>!document.querySelector('#review').disabled);
    assert.match(await page.locator('#boundary-note').innerText(),/50%/);
    await page.locator('#review').click();await page.locator('#review-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('.review-row').count(),19);assert.equal(await page.locator('#dialog-confirm').isDisabled(),true);
    for(const text of await page.locator('.review-row').allTextContents())assert.match(text,/!SPM Box · 7K · /);
    await page.screenshot({path:path.join(output,'prefixed-review.png')});
    await page.locator('#confirm-safe').check();await page.locator('#dialog-confirm').click();
    await page.locator('#review-dialog').waitFor({state:'hidden'});
    // The runtime must refuse a real running osu! process, even in isolated tests.
    const bytes=decode(await fs.readFile(path.join(temp,'collection.db')));
    if(bytes.collections.length===1){assert.match(await page.locator('#toast').innerText(),/退出 osu!/);console.log('Write UI correctly blocked by running osu!; core transactions covered by unit tests.');}
    else{assert.equal(bytes.collections.length,20);assert.equal(bytes.collections[0].name,'!SPM Box · 7K · Speed');for(const c of bytes.collections.slice(1))assert.ok(c.name.startsWith('!SPM Box · 7K · '));}
    await page.locator('[data-panel="managed"]').click();await page.locator('#managed-list .managed-item').first().waitFor();
    assert.equal(await page.locator('#managed-list input').first().isDisabled(),true);
    await page.screenshot({path:path.join(output,'managed.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1050,800));
    await page.locator('[data-panel="creator"]').click();await page.screenshot({path:path.join(output,'creator-1050.png')});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);assert.equal(overflow,false);
    await page.locator('[data-panel="settings"]').click();await page.locator('#model').selectOption('compact');await page.locator('#rate').selectOption('1.5');await page.locator('#save-settings').click();
    await page.locator('#global-note').waitFor({state:'visible'});
    await page.locator('[data-panel="creator"]').click();await page.locator('#preview').click();await waitFor(page,()=>document.querySelector('#toast').textContent.includes('重新分析'));
    assert.deepEqual(errors,[]);console.log((packaged?'PACKAGED ':'')+'UI passed: scan, sorting, search, details, 19-tag preset, scalar threshold, boundary IDs, confirmation, ownership, narrow layout, stale analysis guard.');
  }finally{await app.close();await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
