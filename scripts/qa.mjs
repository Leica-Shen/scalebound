import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors=[];
page.on('pageerror', e=>{errors.push('pageerror: '+e.message);console.error('PAGEERROR',e.message);});
page.on('console', m=>{if(m.type()==='error'){errors.push('console: '+m.text());console.error('CONSOLE',m.text());}});
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
console.log('menu loaded', await page.evaluate(()=>window.__SCALEBOUND__.state()));
// audio click
await page.click('#audioBtn');
await page.click('#audioBtn');
// cycle selection via keys
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);
console.log('selected after arrows', await page.evaluate(()=>window.__SCALEBOUND__.state().selected));
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
// random
await page.click('#randomBtn');
await page.waitForTimeout(300);
// back to nidhogg via evaluate for predictable screenshots
await page.evaluate(()=>window.__SCALEBOUND__.game.selectDragon(0));
await page.waitForTimeout(300);
// start
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1700);
const introState=await page.evaluate(()=>({intro:window.__SCALEBOUND__.game.introActive, controlsLocked:window.__SCALEBOUND__.game.controlsLocked}));
console.log('intro state',introState);
await page.screenshot({path:'screenshots/qa-intro.png'});
await page.waitForFunction(()=>!window.__SCALEBOUND__.game.controlsLocked,{timeout:10000});
console.log('intro finished');
// pitch up
const s0=await page.evaluate(()=>window.__SCALEBOUND__.game.debugState());
await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
const s1=await page.evaluate(()=>window.__SCALEBOUND__.game.debugState());
await page.keyboard.down('KeyD'); await page.waitForTimeout(600); await page.keyboard.up('KeyD');
const s2=await page.evaluate(()=>window.__SCALEBOUND__.game.debugState());
// flap
await page.keyboard.press('Space'); await page.waitForTimeout(350);
const s3=await page.evaluate(()=>window.__SCALEBOUND__.game.debugState());
// boost
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
const s4=await page.evaluate(()=>window.__SCALEBOUND__.game.debugState());
console.log('flight deltas', {pitch:[s0.pitch,s1.pitch], yaw:[s1.yaw,s2.yaw], stam:[s2.stamina,s3.stamina,s4.stamina], speed:[s0.speed,s4.speed]});
// roar & camera
await page.keyboard.press('KeyF'); await page.waitForTimeout(300);
await page.keyboard.press('KeyV'); await page.waitForTimeout(300);
console.log('camera mode', await page.evaluate(()=>window.__SCALEBOUND__.game.cameraMode));
// help overlay
await page.keyboard.press('KeyH'); await page.waitForTimeout(400);
console.log('help visible', await page.evaluate(()=>!document.getElementById('helpModal').classList.contains('is-hidden')), 'paused', await page.evaluate(()=>window.__SCALEBOUND__.game.paused));
await page.screenshot({path:'screenshots/qa-help.png'});
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('after help close paused', await page.evaluate(()=>window.__SCALEBOUND__.game.paused));
// pause
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
console.log('pause visible', await page.evaluate(()=>!document.getElementById('pauseModal').classList.contains('is-hidden')));
await page.screenshot({path:'screenshots/qa-pause.png'});
// pause -> help -> close -> should reopen pause
await page.click('#pauseHelpBtn'); await page.waitForTimeout(300);
console.log('pause help visible', await page.evaluate(()=>({help:!document.getElementById('helpModal').classList.contains('is-hidden'), pause:!document.getElementById('pauseModal').classList.contains('is-hidden')})));
await page.keyboard.press('Escape'); await page.waitForTimeout(350);
console.log('pause reopened', await page.evaluate(()=>({help:!document.getElementById('helpModal').classList.contains('is-hidden'), pause:!document.getElementById('pauseModal').classList.contains('is-hidden')})));
await page.click('#resumeBtn'); await page.waitForTimeout(300);
console.log('resumed paused?', await page.evaluate(()=>window.__SCALEBOUND__.game.paused));
// teleport to orb
const orbRes=await page.evaluate(async()=>{
 const g=window.__SCALEBOUND__; const game=g.game; const orb=g.world.souls.nearest;
 if(!orb) return {err:'no orb'};
 game.playerPos.set(orb.x, orb.y, orb.z);
 game.playerVelocity.set(0,0,0);
 game.speed=12;
 await new Promise(r=>setTimeout(r,500));
 return {souls:game.souls, targetDistance:g.world.souls.nearestDist, pos:{x:game.playerPos.x,y:game.playerPos.y,z:game.playerPos.z}};
});
console.log('orb pickup', orbRes);
// teleport to ring
const ringRes=await page.evaluate(async()=>{
 const g=window.__SCALEBOUND__; const game=g.game; const ring=g.world.rings.nearest;
 if(!ring) return {err:'no ring'};
 game.playerPos.set(ring.x, ring.y, ring.z);
 game.playerVelocity.set(0,0,0);
 game.speed=15;
 await new Promise(r=>setTimeout(r,500));
 return {rings:game.rings, ringBlessing:game.ringBlessing, stamina:game.stamina};
});
console.log('ring', ringRes);
await page.screenshot({path:'screenshots/qa-flight.png'});
// back to menu
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.click('#backMenuBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='menu',{timeout:10000});
await page.waitForTimeout(900);
await page.screenshot({path:'screenshots/qa-backmenu.png'});
console.log('back menu', await page.evaluate(()=>window.__SCALEBOUND__.state()));
// second start with a different dragon
await page.evaluate(()=>window.__SCALEBOUND__.game.selectDragon(4));
await page.waitForTimeout(400);
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1200);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(600);
await page.screenshot({path:'screenshots/qa-flight-jiaolong.png'});
console.log('second run', await page.evaluate(()=>window.__SCALEBOUND__.state()));
// resize test
await page.setViewportSize({width:1280,height:720});
await page.waitForTimeout(600);
await page.screenshot({path:'screenshots/qa-1280.png'});
console.log('ERRORS',errors);
await browser.close();
