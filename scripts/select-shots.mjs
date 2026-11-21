import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
for (const [i,name] of [[1,'wuzhao'],[2,'yinglong'],[5,'lilong'],[8,'babylon'],[6,'welsh'],[7,'fivecolor']]) {
  await page.evaluate((i)=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(i); g.menuYaw=g.menuCameraAngle+0.32; g.menuDistance=30; g.menuHeight=9.5; }, i);
  await page.waitForTimeout(800);
  await page.screenshot({path:`screenshots/sel-${name}.png`});
}
await browser.close();
