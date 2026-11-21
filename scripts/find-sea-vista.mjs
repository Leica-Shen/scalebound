import { heightAt, moistureAt, slopeAt } from '../src/core/terrain.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let results=[];
const STEP=140;
for(let z=-8000; z<=8000; z+=STEP){
 for(let x=-8000; x<=8000; x+=STEP){
   const h=heightAt(x,z);
   if(h<8||h>58) continue;
   const sl=slopeAt(x,z,24);
   if(sl>0.42) continue;
   let best=null;
   for(let a=0;a<48;a++){
     const ang=a/48*Math.PI*2;
     const dirx=Math.cos(ang), dirz=Math.sin(ang);
     let water=0, peaks=0, block=0, beach=0, waterCount=0;
     for(let r=50;r<=1100;r+=30){
       const hh=heightAt(x+dirx*r,z+dirz*r);
       const seen = hh < h + (r/300)*15; // line-of-sight-ish (camera above)
       if(!seen) block += Math.max(0,(hh-h-r*0.03)/50);
       if(r>=80 && r<=620 && hh<0){ water += 1 - Math.abs(r-280)/620; waterCount++; }
       if(r>=180 && r<=500 && hh>0 && hh<7) beach += 1;
       if(r>=500 && r<=1200 && hh>38){ peaks += clamp(hh/100,0,1.5); }
     }
     // prefer looking out over open sea with a chain of mountainous islands
     const score = water*1.0 + peaks*1.6 + beach*0.35 - block*6 + Math.min(waterCount,1)*1.5;
     if(!best||score>best.score) best={score, ang, water, peaks, block, beach, waterCount};
   }
   if(best && best.water>8 && best.block<3) results.push({x,z,h:+h.toFixed(1),sl:+sl.toFixed(2),...Object.fromEntries(Object.entries(best).map(([k,v])=>[k,typeof v==='number'?+v.toFixed(2):v]))});
 }
}
results.sort((a,b)=>b.score-a.score);
console.log('candidates', results.length);
console.dir(results.slice(0,25),{depth:null});
