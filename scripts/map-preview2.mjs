import { heightAt, findSpawn } from '../src/core/terrain.js';
import fs from 'node:fs';
const N=480, SPAN=9000, ox=-4500, oz=-6500;
const H=new Float32Array(N*N);
for(let j=0;j<N;j++) for(let i=0;i<N;i++) H[j*N+i]=heightAt(ox+i/N*SPAN, oz+j/N*SPAN);
const sorted=Array.from(H).sort((a,b)=>a-b);
const q=(p)=>sorted[Math.floor(p*(sorted.length-1))].toFixed(1);
console.log('quantiles 5/25/50/75/90/99', q(.05),q(.25),q(.5),q(.75),q(.9),q(.99));
console.log('water%', (sorted.filter(v=>v<0).length/sorted.length*100).toFixed(1));
const rgb=new Uint8Array(N*N*3); const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
for(let j=0;j<N;j++) for(let i=0;i<N;i++){
 const h=H[j*N+i]; let r,g,b;
 if(h<0){ const d=clamp(-h/70,0,1); r=22-d*10; g=49-d*14; b=62-d*18; }
 else if(h<2.5){ r=202;g=183;b=127; }
 else if(h<26){ const t=h/26; r=96+t*18; g=132+t*3; b=74; }
 else if(h<50){ const t=(h-26)/24; r=88+t*16; g=104-t*8; b=69-t*9; }
 else if(h<76){ const t=(h-50)/26; r=94+t*32; g=88+t*30; b=75+t*30; }
 else { r=226;g=228;b=218; }
 const sh=clamp(1+(h-H[Math.max(0,(j-1)*N+i)])*0.05,0.7,1.3);
 rgb[(j*N+i)*3]=clamp(r*sh,0,255); rgb[(j*N+i)*3+1]=clamp(g*sh,0,255); rgb[(j*N+i)*3+2]=clamp(b*sh,0,255);
}
fs.writeFileSync('/tmp/map.ppm',Buffer.concat([Buffer.from(`P6\n${N} ${N}\n255\n`),Buffer.from(rgb)]));
console.log('spawn', findSpawn());
