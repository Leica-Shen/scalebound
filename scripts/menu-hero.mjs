import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=-2120,-2960,2.23', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
const variants=[
 {off:0.5, dist:24.5, h:6.8, name:'a'},
 {off:0.62, dist:25, h:7.2, name:'b'},
 {off:0.4, dist:23, h:6.0, name:'c'},
 {off:0.55, dist:26, h:7.5, name:'d'},
];
for (const v of variants) {
 await page.evaluate((v)=>{const g=window.__SCALEBOUND__.game; g.menuYaw=g.menuCameraAngle+v.off; g.menuDistance=v.dist; g.menuHeight=v.h;},v);
 await page.waitForTimeout(750);
 await page.screenshot({path:`screenshots/hero-${v.name}.png`});
}
await browser.close();
