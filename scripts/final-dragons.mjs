import { chromium } from 'playwright-core';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport:{width:1440,height:900} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('file://'+path.resolve('scalebound.html'), {waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(800);
for(let i=0;i<9;i++){
 await page.evaluate(i=>window.__SCALEBOUND__.game.selectDragon(i), i);
 await page.waitForTimeout(550);
 await page.screenshot({path:`screenshots/final-dragon-${i}.png`, clip:{x:520,y:230,width:760,height:450}});
}
console.log('errs',errs);
await browser.close();
