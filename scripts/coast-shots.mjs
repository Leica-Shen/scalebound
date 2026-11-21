import { chromium } from 'playwright-core';
const cands = [
  ['A', -1980, -3240, 6.02],
  ['B', 1660, -1140, 5.76],
  ['C', -1700, -3520, 1.44],
  ['D', -2120, -2960, 2.23],
  ['E', -7020, -5340, 0.13],
];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
for (const [name,x,z,yaw] of cands) {
  const page = await browser.newPage({ viewport:{width:1440,height:900} });
  page.on('pageerror', e=>console.error('PAGEERR', name, e.message));
  await page.goto(`http://127.0.0.1:5198/?spawn=${x},${z},${yaw}`, {waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
  await page.waitForTimeout(900);
  await page.screenshot({path:`screenshots/coast-${name}.png`});
  await page.close();
  console.log(name, 'done');
}
await browser.close();
