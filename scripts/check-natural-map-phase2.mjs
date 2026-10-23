// Run alongside check-natural-map.mjs. Playwright is an optional external QA tool.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = resolve(process.env.ARTIFACT_DIR || '.cache/natural-map-phase2-qa');
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true});
const report = {browser:browser.version(), cases:[], errors:[]};
let currentPage;
async function open({seed='jinglun-040', legacy=false, noCanvas=false, mobile=false}={}) {
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1680,height:1050}, deviceScaleFactor:mobile?2:1, isMobile:mobile, hasTouch:mobile, reducedMotion:'reduce',colorScheme:'light'});
  const page=await context.newPage();currentPage=page;
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
  await page.addInitScript(({seed,noCanvas})=>{
    localStorage.setItem('jinglun.map-settings.v1',JSON.stringify({seed,cell_count:100,relaxations:2,land_ratio:.45}));
    localStorage.setItem('jinglun.theme','light');
    if(noCanvas)HTMLCanvasElement.prototype.getContext=function(){return null};
  },{seed,noCanvas});
  let requests=0, data;
  await page.route('**/api/maps/generate',async route=>{
    requests++;const response=await route.fetch();data=await response.json();
    if(legacy)delete data.map.environment.natural_surface.detail;
    await route.fulfill({response,json:data});
  });
  await page.goto(base);await page.waitForSelector('.map-overlay',{state:'hidden',timeout:60000});
  if(!mobile){await page.keyboard.press('[');await page.keyboard.press(']');await page.keyboard.press('g');}
  await page.getByRole('button',{name:'自然地形',exact:true}).click();
  await page.waitForSelector('.world-svg[data-map-style="natural"]');
  return {context,page,data,requests:()=>requests};
}
const snapshot=page=>page.evaluate(()=>({camera:document.querySelector('.world-svg>g').getAttribute('transform'),selection:document.querySelector('.selected-ants').getAttribute('points')}));
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const href=page=>page.locator('.natural-texture').getAttribute('href');
const shot=async(page,name)=>{await page.mouse.move(780,20);await page.waitForTimeout(200);await page.screenshot({path:join(out,name+'.png'),animations:'disabled'})};
try{
  const a=await open();const {page}=a;
  const before=await snapshot(page);
  assert.equal(await page.locator('.world-svg').getAttribute('data-relief'),'true');
  assert.equal(await page.locator('.region-label').count(),0,'no governance labels at overview scale');
  const shaded=await href(page), minimap=await page.locator('.minimap canvas').evaluate(c=>c.toDataURL());
  await shot(page,'phase2-overview');
  await button(page,'地貌阴影').click();
  assert.equal(await page.locator('.world-svg').getAttribute('data-relief'),'false');
  assert.notEqual(await href(page),shaded);
  assert.notEqual(await page.locator('.minimap canvas').evaluate(c=>c.toDataURL()),minimap);
  assert.deepEqual(await snapshot(page),before);
  await button(page,'地貌阴影').click();assert.equal(await href(page),shaded,'cached texture exactly restored');
  await page.mouse.move(990,630);await page.mouse.wheel(0,-650);await page.waitForTimeout(150);
  const moved=await snapshot(page);
  assert.ok(await page.locator('.forest-symbol').count()>0);
  assert.ok(await page.locator('.mountain-symbol').count()>0);
  const ids=await page.locator('.region-label').evaluateAll(nodes=>nodes.map(e=>Number(e.dataset.regionId)));
  assert.ok(ids.length>0&&ids.length<=32);
  for(const id of ids)assert.ok(a.data.map.cells.some(c=>c.id===id));
  await shot(page,'phase2-detail');
  await button(page,'地表符号').click();assert.equal(await page.locator('.natural-details > *').count(),0);
  assert.deepEqual(await snapshot(page),moved);
  await button(page,'地表符号').click();assert.ok(await page.locator('.region-label').count()>0);
  await page.locator('.theme-picker select').selectOption('dark');assert.notEqual(await href(page),shaded);
  assert.deepEqual(await snapshot(page),moved);await shot(page,'phase2-dark-detail');
  await button(page,'地貌阴影').click();
  await page.keyboard.press('8');
  assert.equal(await page.locator('.world-svg').getAttribute('data-map-style'),'classic');
  assert.equal(await page.locator('.natural-details > *').count(),0);
  await page.keyboard.press('1');
  assert.equal(await page.locator('.world-svg').getAttribute('data-relief'),'false');
  assert.deepEqual(await snapshot(page),moved);
  assert.equal(a.requests(),1);
  // No texture is rebuilt during pan/zoom; same URL remains attached.
  const texture=await href(page);await page.mouse.move(900,550);await page.mouse.wheel(0,-120);await page.waitForTimeout(100);
  assert.equal(await href(page),texture);
  report.cases.push({name:'phase2 controls',passed:['shading/minimap sync','cached shade toggle','screen LOD','terrain-backed symbols','real region IDs','symbol toggle','theme','thematic isolation','camera/selection invariance','no regeneration','no per-frame texture rebuild']});
  await a.context.close();
  for(const variant of [{legacy:true},{noCanvas:true}]){
    const a=await open(variant);
    assert.equal(await a.page.locator('.world-svg').getAttribute('data-map-style'),'natural');
    assert.equal(await a.page.locator('.natural-texture').getAttribute('display'),'none');
    assert.ok(await a.page.locator('.natural-map path').count()>0);
    if(variant.legacy){await a.page.mouse.move(990,630);await a.page.mouse.wheel(0,-650);await a.page.waitForTimeout(100);assert.equal(await a.page.locator('.natural-details > *').count(),0);}
    report.cases.push({name:variant.legacy?'Phase 1 payload':'Canvas unavailable',passed:['SVG natural fallback','no crash',...(variant.legacy?['no unsupported detail at zoom']:[])]});
    await a.context.close();
  }
  const mobile=await open({mobile:true});
  assert.ok(await button(mobile.page,'地貌阴影').isVisible());
  assert.equal(await mobile.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await mobile.page.locator('.terrain-symbol,.region-label').count(),0);
  await shot(mobile.page,'phase2-mobile');
  report.cases.push({name:'390px / DPR2',passed:['controls visible','no overflow','clutter suppressed']});
  await mobile.context.close();
  const other=await open({seed:'经纶·山河初定'});
  assert.equal(await other.page.locator('.world-svg').getAttribute('data-relief'),'true');
  await shot(other.page,'phase2-other-seed');
  report.cases.push({name:'second seed',passed:['natural detail renders']});
  await other.context.close();
  assert.deepEqual(report.errors,[]);
  await writeFile(join(out,'detail-check.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}catch(e){if(currentPage&&!currentPage.isClosed())await shot(currentPage,'failure').catch(()=>{});console.error(e);process.exitCode=1}
finally{await browser.close()}
