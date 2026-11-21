import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=-2120,-2960,2.23', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.evaluate(()=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(8); g.menuDistance=23; g.menuHeight=6.5; });
const offs=[0,0.16,-0.16,0.55];
for(let i=0;i<offs.length;i++){
 await page.evaluate((off)=>{const g=window.__SCALEBOUND__.game; g.menuYaw=g.menuCameraAngle+off;},offs[i]);
 await page.waitForTimeout(700);
 await page.screenshot({path:`screenshots/front-${i}.png`});
}
await browser.close();
