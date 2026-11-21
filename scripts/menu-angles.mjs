import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
await page.evaluate(()=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(5); g.menuHeight=11; g.menuDistance=30; });
const offs=[0,0.35,0.8,1.4,2.1,2.8,3.14159];
for (let i=0;i<offs.length;i++) {
  await page.evaluate((off)=>{ const g=window.__SCALEBOUND__.game; g.menuYaw=g.menuCameraAngle+off; }, offs[i]);
  await page.waitForTimeout(650);
  await page.screenshot({path:`screenshots/angle-${i}.png`, clip:{x:280,y:180,width:1160,height:600}});
}
await browser.close();
