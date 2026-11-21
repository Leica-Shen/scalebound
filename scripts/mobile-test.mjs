import { chromium, devices } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport:{width:844,height:390}, hasTouch:true, isMobile:true, deviceScaleFactor:1 });
const page = await context.newPage();
const errs=[]; page.on('pageerror',e=>{errs.push(e.message); console.error(e.message)});
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(700);
await page.screenshot({path:'screenshots/mobile-menu.png'});
// tap start
await page.evaluate(()=>window.__SCALEBOUND__.game.startRun());
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1400);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(600);
await page.screenshot({path:'screenshots/mobile-flight.png'});
console.log('errs',errs);
await browser.close();
