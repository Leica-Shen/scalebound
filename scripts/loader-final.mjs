import { chromium } from 'playwright-core';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport:{width:1440,height:900} });
await page.goto('file://'+path.resolve('scalebound.html'), { waitUntil:'domcontentloaded' });
await page.waitForTimeout(650);
await page.screenshot({path:'screenshots/final-loader.png'});
await browser.close();
