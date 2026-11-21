import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
const t=Date.now();
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
console.log('boot',Date.now()-t);
const variants = [
  {name:'a', off:0.22, dist:31, height:9},
  {name:'b', off:0.42, dist:31, height:9.5},
  {name:'c', off:0.15, dist:30, height:8.5},
  {name:'d', off:0.62, dist:33, height:10.5},
];
for (const v of variants) {
  await page.evaluate((v)=>{
    const g=window.__SCALEBOUND__.game;
    g.menuYaw = g.menuCameraAngle + v.off;
    g.menuDistance = v.dist;
    g.menuHeight = v.height;
  }, v);
  await page.waitForTimeout(900);
  await page.screenshot({path:`screenshots/menu-var-${v.name}.png`});
}
console.log(await page.evaluate(()=>({props:{trees:window.__SCALEBOUND__.world.trunkMesh.count, conifer:window.__SCALEBOUND__.world.coniferMesh.count, broad:window.__SCALEBOUND__.world.broadleafMesh.count, rocks:window.__SCALEBOUND__.world.rockMesh.count}})));
await browser.close();
