import * as THREE from 'three';
import { heightAt, colorAt, slopeAt, findSpawn } from '../src/core/terrain.js';
import fs from 'node:fs';
const sp=findSpawn(); console.log(sp);
const N=420, SPAN=2800, ox=sp.x-SPAN/2, oz=sp.z-SPAN/2;
const step=SPAN/N;
const H=new Float32Array(N*N);
for(let j=0;j<N;j++) for(let i=0;i<N;i++) H[j*N+i]=heightAt(ox+i*step, oz+j*step);
const rgb=new Uint8Array(N*N*3); const tmp=new THREE.Color();
let hs=Infinity, mh=-Infinity;
for(let j=0;j<N;j++) for(let i=0;i<N;i++){
 const h=H[j*N+i]; hs=Math.min(hs,h); mh=Math.max(mh,h);
 let c;
 if(h<0){ const d=Math.min(1,-h/30); c=new THREE.Color().setRGB(0.055+0.03*(1-d),0.16+0.08*(1-d),0.22+0.1*(1-d),THREE.SRGBColorSpace); }
 else {
   const sl=Math.hypot(H[j*N+Math.min(N-1,i+1)]-H[j*N+Math.max(0,i-1)],H[Math.min(N*N-1,(j+1)*N+i)]-H[Math.max(0,j-1)*N+i])/(2*step);
   c=colorAt(ox+i*step, oz+j*step, h, sl, tmp);
 }
 const shade = h>=0 ? 1 : 1;
 rgb[(j*N+i)*3]=Math.min(255,Math.max(0,Math.pow(c.r,1/2.2)*255));
 rgb[(j*N+i)*3+1]=Math.min(255,Math.max(0,Math.pow(c.g,1/2.2)*255));
 rgb[(j*N+i)*3+2]=Math.min(255,Math.max(0,Math.pow(c.b,1/2.2)*255));
}
fs.writeFileSync('/tmp/map.ppm',Buffer.concat([Buffer.from(`P6\n${N} ${N}\n255\n`),Buffer.from(rgb)]));
console.log({hs,mh,spawnH:heightAt(sp.x,sp.z)});
