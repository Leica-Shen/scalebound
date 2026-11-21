import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=-2120,-2960,2.23', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.evaluate(()=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(8); g.menuYaw=g.menuCameraAngle+0.34; });
await page.waitForTimeout(700);
await page.evaluate(()=>{
 const g=window.__SCALEBOUND__.game;
 const orig=g.animator.update.bind(g.animator);
 window.__headYaw = null;
 g.animator.update=(dt,state)=>{ orig(dt,state); if(window.__headYaw!==null){ g.rig.head.rotation.y=window.__headYaw; for(const e of g.rig.eyes){ /* nothing */ } } };
});
for (const [i,v] of [[0,0],[1,0.65],[2,-0.65],[3,1.1],[4,-1.1]]) {
  await page.evaluate((v)=>{window.__headYaw=v;},v);
  await page.waitForTimeout(500);
  await page.screenshot({path:`screenshots/head-${i}.png`});
}
await browser.close();
