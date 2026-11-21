import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(800);
console.log(await page.evaluate(()=>{
 const g=window.__SCALEBOUND__; const game=g.game; const rig=game.rig; game.camera.updateMatrixWorld();
 const out=[];
 for(const e of rig.eyes){
   const p=new g.camera.position.constructor(); e.getWorldPosition(p);
   const ndc=p.clone().project(game.camera);
   out.push({glow:!!e.isGlow, visible:e.visible, pos:{x:+p.x.toFixed(1),y:+p.y.toFixed(1),z:+p.z.toFixed(1)}, screen:{x:Math.round((ndc.x*.5+.5)*innerWidth),y:Math.round((-ndc.y*.5+.5)*innerHeight)}, scale:e.scale.toArray().map(n=>+n.toFixed(2)), matVisible:e.material?.visible, opacity:e.material?.opacity});
 }
 return out;
}));
// make eye sprites draw through geometry and huge for debugging
await page.evaluate(()=>{
 const g=window.__SCALEBOUND__; 
 for(const e of g.game.rig.eyes){ if(e.isGlow){ e.material.depthTest=false; e.material.opacity=1; e.material.sizeAttenuation=true; e.scale.multiplyScalar(2.5); } }
});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/eye-debug.png'});
await browser.close();
