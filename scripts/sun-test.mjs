import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
await page.waitForTimeout(900);
console.log(await page.evaluate(()=>{
 const g=window.__SCALEBOUND__;
 g.camera.updateMatrixWorld();
 const v=g.camera.position.clone().add(g.world.sunDirection.clone().multiplyScalar(1000));
 const proj=v.clone().project(g.camera);
 const cam=g.camera.position.clone();
 const dir=g.world.sunDirection;
 return {sunDir:{x:dir.x,y:dir.y,z:dir.z}, ndc:{x:proj.x,y:proj.y,z:proj.z}, screen:{x:(proj.x*.5+.5)*innerWidth, y:(-proj.y*.5+.5)*innerHeight}, camera:{x:cam.x,y:cam.y,z:cam.z}, fov:g.camera.fov};
}));
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1200);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(800);
console.log(await page.evaluate(()=>{
 const g=window.__SCALEBOUND__;
 g.camera.updateMatrixWorld();
 const v=g.camera.position.clone().add(g.world.sunDirection.clone().multiplyScalar(1000));
 const proj=v.clone().project(g.camera);
 return {ndc:{x:proj.x,y:proj.y,z:proj.z}, screen:{x:(proj.x*.5+.5)*innerWidth, y:(-proj.y*.5+.5)*innerHeight}, fov:g.camera.fov, sunDir:{x:g.world.sunDirection.x,y:g.world.sunDirection.y,z:g.world.sunDirection.z}};
}));
await browser.close();
