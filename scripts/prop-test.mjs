import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal','--enable-webgl','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5198/', { waitUntil:'networkidle' });
await page.waitForFunction(()=>window.__SCALEBOUND__?.ready,{timeout:30000});
console.log(await page.evaluate(()=>{
 const w=window.__SCALEBOUND__.world;
 let treeCount=0, rockCount=0, chunkProps=0, chunksWithTrees=0;
 for(const c of w.chunks.values()){ treeCount+=c.props.trees.length; rockCount+=c.props.rocks.length; if(c.props.trees.length) chunksWithTrees++; chunkProps++; }
 return {treeCount, rockCount, chunkProps, chunksWithTrees, trunkCount:w.trunkMesh.count, conifer:w.coniferMesh.count, broadleaf:w.broadleafMesh.count, rocks:w.rockMesh.count, cloudCount:w.cloudMesh.count, chunkCount:w.chunks.size, spawn:w.spawn};
}));
await browser.close();
