import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
await page.evaluate(()=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(8); g.menuYaw=g.menuCameraAngle+0.32; g.menuDistance=29; g.menuHeight=9.5; });
await page.waitForTimeout(800);
await page.evaluate(()=>{
 const {renderer,scene}=window.__SCALEBOUND__;
 renderer.toneMappingExposure=1.75;
 scene.traverse(o=>{ if(o.isHemisphereLight) { o.intensity=2.4; o.color.set('#cfe9eb'); o.groundColor.set('#7e6d55'); } if(o.isDirectionalLight) { if(o.intensity<1.0) o.intensity=1.8; else o.intensity=3.2; } });
});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/light-bright2.png'});
// now saturate by changing the postfx shader to add saturation and contrast
await page.evaluate(()=>{
 const p=window.__SCALEBOUND__.pipeline;
 p.material.fragmentShader = p.material.fragmentShader
  .replace('srgb = clamp((srgb - 0.5) * 1.045 + 0.5, 0.0, 1.0);', 'srgb = clamp((srgb - 0.5) * 1.13 + 0.5, 0.0, 1.0);\\n    float lum2 = dot(srgb, vec3(0.299, 0.587, 0.114));\\n    srgb = clamp(mix(vec3(lum2), srgb, 1.28), 0.0, 1.0);');
 p.material.needsUpdate = true;
});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/light-sat.png'});
// test exposure slightly lower with sat
await page.evaluate(()=>{ window.__SCALEBOUND__.renderer.toneMappingExposure=1.5; });
await page.waitForTimeout(400);
await page.screenshot({path:'screenshots/light-sat2.png'});
await browser.close();
