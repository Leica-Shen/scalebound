import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
await page.evaluate(()=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(8); g.menuYaw=g.menuCameraAngle+0.32; g.menuDistance=29; g.menuHeight=9.5; });
await page.waitForTimeout(800);
await page.screenshot({path:'screenshots/light-base.png'});
await page.evaluate(()=>{
 const {renderer,scene}=window.__SCALEBOUND__;
 renderer.toneMappingExposure=1.35;
 scene.traverse(o=>{ if(o.isHemisphereLight) o.intensity=1.35; if(o.isDirectionalLight) { if(o.intensity<1.0) o.intensity*=2.2; else o.intensity*=1.15; } });
});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/light-bright.png'});
await page.evaluate(()=>{
 const {scene}=window.__SCALEBOUND__;
 scene.fog.near=420; scene.fog.far=1250; scene.fog.color.set('#a9bdb4');
});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/light-fogfar.png'});
await page.evaluate(()=>{
 const {scene,renderer}=window.__SCALEBOUND__;
 renderer.toneMapping=7; renderer.toneMappingExposure=1.35;
 scene.traverse(o=>{ if(o.isMesh){ const arr=Array.isArray(o.material)?o.material:[o.material]; arr.forEach(m=>m.needsUpdate=true); } });
});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/light-neutral.png'});
await browser.close();
