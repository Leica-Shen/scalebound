import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(900);
for (let i=0;i<9;i++) {
  await page.evaluate((i)=>{ window.__SCALEBOUND__.game.selectDragon(i); },i);
  await page.waitForTimeout(650);
  await page.screenshot({path:`screenshots/dragon-${i}.png`, clip:{x:520,y:200,width:760,height:490}});
}
console.log('errs',errs);
await browser.close();
