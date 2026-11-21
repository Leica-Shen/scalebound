import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5198/?spawn=-2120,-2960,2.23', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(800);
for (const e of [1.2,1.45,1.7]) {
 await page.evaluate((e)=>{window.__SCALEBOUND__.renderer.toneMappingExposure=e;}, e);
 await page.waitForTimeout(500);
 await page.screenshot({path:`screenshots/expo-${String(e).replace('.','')}.png`});
}
await browser.close();
