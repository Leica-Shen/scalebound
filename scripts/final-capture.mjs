import { chromium } from 'playwright-core';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist','--allow-file-access-from-files','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors=[]; const external=[];
page.on('pageerror', e=>{errors.push('pageerror: '+e.message); console.error('PAGEERROR',e.message);});
page.on('console', m=>{if(m.type()==='error'){errors.push('console: '+m.text()); console.error('CONSOLE',m.text());}});
page.on('request', r=>{if(!r.url().startsWith('file:')&&!r.url().startsWith('data:')) external.push(r.url());});
const url='file://'+path.resolve('scalebound.html');
await page.goto(url,{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(1300);
await page.screenshot({path:'screenshots/final-menu.png'});
// start and catch the intro card + cinematic HUD
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:12000});
await page.waitForTimeout(2350);
await page.screenshot({path:'screenshots/final-intro.png'});
await page.waitForFunction(()=>!window.__SCALEBOUND__.game.controlsLocked,{timeout:12000});
await page.waitForTimeout(4300);
await page.screenshot({path:'screenshots/final-flight.png'});
// move a little and capture one more action frame
await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD');
await page.waitForTimeout(900);
await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW');
await page.keyboard.press('Space');
await page.waitForTimeout(250);
await page.screenshot({path:'screenshots/final-flight-action.png'});
// verify pause and help in production build
await page.keyboard.press('KeyH'); await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/final-help.png'});
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
await page.screenshot({path:'screenshots/final-pause.png'});
const pauseOk=await page.evaluate(()=>!document.getElementById('pauseModal').classList.contains('is-hidden'));
await page.click('#resumeBtn'); await page.waitForTimeout(300);
// teleport to a soul to verify pickups in standalone
const pickup=await page.evaluate(async()=>{const g=window.__SCALEBOUND__; const game=g.game; const orb=g.world.souls.nearest; if(!orb)return {err:1}; game.playerPos.set(orb.x,orb.y,orb.z); game.playerVelocity.set(0,0,0); game.speed=12; await new Promise(r=>setTimeout(r,450)); return {souls:game.souls, total:game.totalSouls, stamina:+game.stamina.toFixed(1)};});
// go back to menu, select another dragon, restart
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.click('#backMenuBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='menu',{timeout:12000});
await page.waitForTimeout(900);
await page.evaluate(()=>{localStorage.removeItem('scalebound.dragon'); window.__SCALEBOUND__.game.selectDragon(1);});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/final-menu-wuzhao.png'});
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:12000});
await page.waitForTimeout(1300);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(2600);
await page.screenshot({path:'screenshots/final-flight-wuzhao.png'});
console.log(JSON.stringify({
  title: await page.title(),
  errors, external,
  pauseOk, pickup,
  state: await page.evaluate(()=>window.__SCALEBOUND__.state()),
  font: await page.evaluate(()=>document.fonts.check('12px Zpix')),
  audio: await page.evaluate(()=>({started:window.__SCALEBOUND__.audio.started, state:window.__SCALEBOUND__.audio.ctx?.state})),
}, null, 2));
await browser.close();
