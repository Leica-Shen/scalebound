import { heightAt, findSpawn } from '../src/core/terrain.js';
import fs from 'node:fs';
const N=420, SPAN=12000, ox=-6000, oz=-6000;
const H=new Float32Array(N*N);
let t=Date.now();
for(let j=0;j<N;j++) for(let i=0;i<N;i++) H[j*N+i]=heightAt(ox+i/N*SPAN, oz+j/N*SPAN);
console.log('heights ms',Date.now()-t);
const rgb=new Uint8Array(N*N*3);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
for(let j=0;j<N;j++) for(let i=0;i<N;i++){
 const h=H[j*N+i]; let r,g,b;
 if(h<0){ const d=clamp(-h/90,0,1); r=20-d*8; g=45-d*12; b=60-d*18; }
 else if(h<2.5){ r=200;g=182;b=126; }
 else if(h<30){ const t=h/30; r=100+t*20; g=130+t*5; b=75; }
 else if(h<55){ const t=(h-30)/25; r=90+t*30; g=90+t*20; b=65+t*20; }
 else if(h<80){ const t=(h-55)/25; r=135+t*30; g=125+t*30; b=115+t*25; }
 else { r=225;g=225;b=213; }
 const sh=clamp(1+(h-H[Math.min(N*N-1,Math.max(0,(j-1)*N+i))])*0.04,0.75,1.25);
 rgb[(j*N+i)*3]=clamp(r*sh,0,255); rgb[(j*N+i)*3+1]=clamp(g*sh,0,255); rgb[(j*N+i)*3+2]=clamp(b*sh,0,255);
}
fs.writeFileSync('/tmp/map.ppm',Buffer.concat([Buffer.from(`P6\n${N} ${N}\n255\n`),Buffer.from(rgb)]));
const sp=findSpawn(); console.log('spawn',sp);
console.log('height range', Math.min(...H).toFixed(1), Math.max(...H).toFixed(1));
