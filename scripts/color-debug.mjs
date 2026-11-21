import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
await page.evaluate(()=>{
 const {scene}=window.__SCALEBOUND__;
 let sky=null;
 scene.traverse(o=>{ if(o.isMesh && o.material?.isShaderMaterial && o.material.uniforms?.uSunDir) sky=o; });
 if(sky){ sky.material.fragmentShader='void main(){ gl_FragColor=vec4(0.0, 0.65, 0.0, 1.0); }'; sky.material.needsUpdate=true; }
 scene.children.forEach(o=>{ if(o!==sky && o.type!=='Sprite') o.visible=false; });
 // hide dragon too
});
await page.waitForTimeout(600);
await page.screenshot({path:'screenshots/color-green.png'});
// Now set postfx warmth 0 and flash 0, maybe saturation isn't a uniform. Check material uniforms keys
console.log(await page.evaluate(()=>{
 const p=window.__SCALEBOUND__.pipeline;
 return {uniforms:Object.keys(p.material.uniforms), toneMapping:window.__SCALEBOUND__.renderer.toneMapping, outputColorSpace:window.__SCALEBOUND__.renderer.outputColorSpace, rt:window.__SCALEBOUND__.pipeline.target.texture.colorSpace};
}));
await browser.close();
