import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.evaluate(()=>{
 const g=window.__SCALEBOUND__.game;
 const orig=g.animator.update.bind(g.animator);
 window.__hp=0;
 g.animator.update=(dt,state)=>{ orig(dt,state); if(window.__hp) g.rig.head.rotation.x += window.__hp; };
});
for (const [i,v] of [[0,0],[1,-0.12],[2,-0.24],[3,0.12]]) {
 await page.evaluate(v=>window.__hp=v, v);
 await page.waitForTimeout(600);
 await page.screenshot({path:`screenshots/headpitch-${i}.png`, clip:{x:650,y:300,width:520,height:320}});
}
await browser.close();
