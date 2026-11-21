import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; page.on('pageerror',e=>{errs.push(e.message);console.error('PAGEERROR',e.message)});
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1400);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(600);
// boost test
const before=await page.evaluate(()=>window.__SCALEBOUND__.game.debugState());
await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1800); await page.keyboard.up('ShiftLeft');
const afterBoost=await page.evaluate(()=>({...window.__SCALEBOUND__.game.debugState(), stamina:window.__SCALEBOUND__.game.stamina}));
// stall test: set speed low and pitch up
await page.evaluate(()=>{const g=window.__SCALEBOUND__.game; g.speed=7; g.pitch=0.55; g.stamina=20;});
await page.waitForTimeout(1400);
const stall=await page.evaluate(()=>({stall:window.__SCALEBOUND__.game.stall, pitch:window.__SCALEBOUND__.game.pitch, warning:document.querySelector('#flightWarning span').textContent, warningLive:document.getElementById('flightWarning').classList.contains('is-live'), speed:window.__SCALEBOUND__.game.speed}));
await page.screenshot({path:'screenshots/physics-stall.png'});
// collision test: place just above terrain and dive
await page.evaluate(()=>{const g=window.__SCALEBOUND__; const game=g.game; const h=g.world.getHeight(game.playerPos.x, game.playerPos.z); game.playerPos.y=h+6; game.pitch=-0.8; game.speed=38; game.playerVelocity.set(0,-20,0);});
await page.waitForTimeout(500);
const coll=await page.evaluate(()=>{const g=window.__SCALEBOUND__; return {alt:g.game.playerPos.y-g.world.getHeight(g.game.playerPos.x,g.game.playerPos.z), speed:g.game.speed, shake:g.game.shake, warning:document.querySelector('#flightWarning span').textContent};});
await page.screenshot({path:'screenshots/physics-collision.png'});
// read hud target display
console.log('boost',{before:{speed:before.speed,stamina:before.stamina},after:{speed:afterBoost.speed,stamina:afterBoost.stamina}});
console.log('stall',stall);
console.log('collision',coll);
console.log('errs',errs);
await browser.close();
