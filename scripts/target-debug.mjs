import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=-2120,-2960,2.23', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1200);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(700);
console.log(await page.evaluate(()=>{
 const g=window.__SCALEBOUND__; const game=g.game;
 const state=game._buildHudState();
 const el=document.getElementById('targetMarker');
 const cs=getComputedStyle(el);
 return {target:state.target, cls:el.className, style:el.getAttribute('style'), display:cs.display, visibility:cs.visibility, opacity:cs.opacity, nearest:g.world.souls.nearest, nd:g.world.souls.nearestDist, hudVisible:game.hudVisible};
}));
await browser.close();
