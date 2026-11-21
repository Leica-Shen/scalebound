import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs=[]; page.on('pageerror',e=>{errs.push(e.message);console.error('PAGEERROR',e.message)});
page.on('console',m=>{if(m.type()==='error'){errs.push(m.text());console.error(m.text())}});
await page.goto('http://127.0.0.1:5198/', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(700);
await page.screenshot({path:'screenshots/loader.png'});
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:45000});
await page.waitForTimeout(800);
await page.setViewportSize({width:1280,height:720});
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/menu-1280.png'});
// start and catch intro with HUD hidden
await page.click('#startBtn');
await page.waitForFunction(()=>window.__SCALEBOUND__.game.mode==='flight',{timeout:10000});
await page.waitForTimeout(2100);
await page.screenshot({path:'screenshots/intro-cinematic.png'});
// press W to skip intro
await page.keyboard.down('KeyW');
await page.waitForTimeout(500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(500);
await page.screenshot({path:'screenshots/intro-skipped.png'});
console.log('state', await page.evaluate(()=>({intro:window.__SCALEBOUND__.game.introActive, controls:window.__SCALEBOUND__.game.controlsLocked, cinematic:document.getElementById('hud').classList.contains('is-cinematic')})));
console.log('errs',errs);
await browser.close();
