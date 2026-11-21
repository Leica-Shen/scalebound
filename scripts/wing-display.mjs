import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.evaluate(()=>{
 const g=window.__SCALEBOUND__.game;
 const orig=g.animator.update.bind(g.animator);
 window.__wing = {root:null, mid:null, tip:null, bank:null};
 g.animator.update=(dt,state)=>{
   orig(dt,state);
   if(window.__wing.root!==null){
     for(const w of g.rig.wings){
       w.root.rotation.z = w.side*window.__wing.root;
       w.mid.rotation.z = w.side*window.__wing.mid;
       w.tip.rotation.z = w.side*window.__wing.tip;
     }
     g.rig.group.rotation.z = window.__wing.bank;
   }
 };
});
const variants=[
 {name:'a', h:7.2, d:24.4, root:0.16, mid:-0.04, tip:-0.08, bank:-0.06},
 {name:'b', h:10.2, d:24.4, root:0.16, mid:-0.04, tip:-0.08, bank:-0.08},
 {name:'c', h:8.0, d:24.4, root:-0.02, mid:-0.03, tip:-0.05, bank:-0.1},
 {name:'d', h:10.0, d:25.5, root:-0.12, mid:-0.04, tip:-0.08, bank:-0.12},
 {name:'e', h:12.0, d:27, root:-0.2, mid:-0.05, tip:-0.1, bank:-0.14},
];
for(const v of variants){
 await page.evaluate((v)=>{
   const g=window.__SCALEBOUND__.game;
   g.menuHeight=v.h; g.menuDistance=v.d;
   window.__wing={root:v.root, mid:v.mid, tip:v.tip, bank:v.bank};
 },v);
 await page.waitForTimeout(800);
 await page.screenshot({path:`screenshots/wingdisp-${v.name}.png`});
}
await browser.close();
