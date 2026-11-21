import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e=>console.error('PAGEERROR',e.message));
await page.goto('http://127.0.0.1:5198/?spawn=360,-3320,6.02', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:40000});
await page.evaluate(()=>{ const g=window.__SCALEBOUND__.game; g.selectDragon(8); g.menuYaw=g.menuCameraAngle+0.32; g.menuDistance=29; g.menuHeight=9.5; });
await page.waitForTimeout(700);
await page.evaluate(()=>{
 const g=window.__SCALEBOUND__.game;
 const orig = g.animator.update.bind(g.animator);
 window.__pose = {root:0, knee:0, ankle:0, tilt:0};
 g.animator.update = (dt, state) => {
   orig(dt, state);
   for (const leg of g.rig.legs) {
     leg.root.rotation.x += window.__pose.root;
     leg.knee.rotation.x += window.__pose.knee;
     leg.ankle.rotation.x += window.__pose.ankle;
   }
   g.rig.group.rotation.z = window.__pose.tilt;
 };
});
const poses = [
  {name:'p0', root:0, knee:0, ankle:0, tilt:0},
  {name:'p1', root:0.65, knee:-0.8, ankle:0.4, tilt:-0.05},
  {name:'p2', root:1.0, knee:-1.5, ankle:0.8, tilt:-0.08},
  {name:'p3', root:1.3, knee:-2.2, ankle:1.1, tilt:-0.1},
  {name:'p4', root:1.1, knee:-0.5, ankle:0.2, tilt:-0.08},
];
for (const p of poses) {
  await page.evaluate((p)=>{ Object.assign(window.__pose, p); }, p);
  await page.waitForTimeout(700);
  await page.screenshot({path:`screenshots/pose-${p.name}.png`});
}
await browser.close();
