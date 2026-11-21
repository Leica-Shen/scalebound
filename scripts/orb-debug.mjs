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
await page.waitForTimeout(800);
console.log(await page.evaluate(()=>{
 const g=window.__SCALEBOUND__; const game=g.game; const w=g.world;
 game.camera.updateMatrixWorld();
 const camSpace = game.playerPos.clone().applyMatrix4(game.camera.matrixWorldInverse);
 const list = w.souls.orbs.slice(0,25).map((o,i)=>{
   const v = new g.camera.position.constructor(o.x,o.y,o.z);
   const p = v.clone().project(game.camera);
   const d = v.distanceTo(game.playerPos);
   return {i, dist:+d.toFixed(0), sx:Math.round((p.x*.5+.5)*innerWidth), sy:Math.round((-p.y*.5+.5)*innerHeight), z:+p.z.toFixed(3)};
 }).sort((a,b)=>a.dist-b.dist);
 return {coreCount:w.souls.core.count, coreVisible:w.souls.core.visible, pointsVisible:w.souls.points.visible, orbs:w.souls.orbs.length, list, player:{x:game.playerPos.x,y:game.playerPos.y,z:game.playerPos.z}, nearest:w.souls.nearest?{x:w.souls.nearest.x,y:w.souls.nearest.y,z:w.souls.nearest.z}:null, ndcZ:camSpace.z};
}));
await page.screenshot({path:'screenshots/orb-debug.png'});
await browser.close();
