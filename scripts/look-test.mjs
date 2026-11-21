import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:30000});
await page.waitForTimeout(1000);
// take baseline menu with new exposure
await page.screenshot({path:'screenshots/look-menu-base.png'});
// toggle neutral tonemapping
await page.evaluate(()=>{
 const {renderer,scene}=window.__SCALEBOUND__;
 renderer.toneMapping=7; renderer.toneMappingExposure=1.25;
 scene.traverse(o=>{ if(o.isMesh){ const mats=Array.isArray(o.material)?o.material:[o.material]; mats.forEach(m=>{m.needsUpdate=true;}); } });
});
await page.waitForTimeout(700);
await page.screenshot({path:'screenshots/look-menu-neutral.png'});
// no fog and cooler
await page.evaluate(()=>{
 const {scene}=window.__SCALEBOUND__;
 scene.fog.near=600; scene.fog.far=1600; scene.fog.color.set('#b4c8bd');
 scene.traverse(o=>{ if(o.isHemisphereLight) o.intensity=1.4; if(o.isDirectionalLight) o.intensity*=1.15; });
});
await page.waitForTimeout(700);
await page.screenshot({path:'screenshots/look-menu-nofog.png'});
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(1400);
await page.evaluate(()=>window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(900);
await page.screenshot({path:'screenshots/look-flight-neutral.png'});
await browser.close();
