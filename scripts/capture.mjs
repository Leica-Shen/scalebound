import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (msg) => { logs.push(`[${msg.type()}] ${msg.text()}`); console.log(`[${msg.type()}]`, msg.text()); });
page.on('pageerror', (err) => { logs.push(`[pageerror] ${err.stack}`); console.error('[pageerror]', err); });
await page.goto('http://127.0.0.1:5198/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__SCALEBOUND__ && window.__SCALEBOUND__.ready, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'screenshots/menu-01.png' });
console.log('state', await page.evaluate(() => window.__SCALEBOUND__.state()));
// start game
await page.click('#startBtn');
await page.waitForFunction(() => window.__SCALEBOUND__.game.mode === 'flight', { timeout: 10000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__SCALEBOUND__.finishIntro());
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshots/flight-01.png' });
console.log('state flight', await page.evaluate(() => window.__SCALEBOUND__.state()));
// fly forward and turn slightly
await page.keyboard.down('KeyW');
await page.waitForTimeout(900);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD');
await page.waitForTimeout(500);
await page.keyboard.up('KeyD');
await page.keyboard.press('Space');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshots/flight-02.png' });
console.log('state flight2', await page.evaluate(() => window.__SCALEBOUND__.state()));
console.log('LOGS', logs.filter(l=>l.includes('error')||l.includes('Error')).slice(0,20));
await browser.close();
