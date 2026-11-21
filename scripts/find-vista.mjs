import { heightAt, moistureAt, slopeAt, SEA_LEVEL } from '../src/core/terrain.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let results=[];
const R=7000, STEP=160;
for(let z=-R; z<=R; z+=STEP){
 for(let x=-R; x<=R; x+=STEP){
   const h=heightAt(x,z);
   if(h<10||h>55) continue;
   const sl=slopeAt(x,z,24);
   if(sl>0.45) continue;
   let best={score:-1};
   for(let a=0;a<32;a++){
     const ang=a/24*Math.PI*2;
     const dirx=Math.cos(ang), dirz=Math.sin(ang);
     let waterScore=0, mountainScore=0, blockPenalty=0, lowScore=0, lastWater=false, waterFirstAt=null, sampleHeights=[];
     for(let r=60;r<=900;r+=40){
       const hh=heightAt(x+dirx*r,z+dirz*r);
       sampleHeights.push(hh);
       if(r<260 && hh>h+10) blockPenalty += (hh-h-10)/30 * (1-r/320);
       if(r>=100&&r<480 && hh<SEA_LEVEL-0.4){ waterScore += (1-r/700); if(!waterFirstAt) waterFirstAt=r; }
       if(r>=320&&r<700 && hh>40){ mountainScore += clamp(hh/90,0,1.7)*(1-Math.abs(r-520)/700); }
       if(r>=120&&r<500 && hh>4 && hh<40) lowScore += 0.2;
     }
     const peakMax=Math.max(...sampleHeights.slice(7)); // beyond 320m
     const localMax=Math.max(...sampleHeights.slice(0,5));
     const openSky = localMax < h+22 ? 1 : 0;
     const score = waterScore*1.7 + mountainScore*3.2 + lowScore*0.8 + openSky*2 - blockPenalty*3 - Math.max(0,peakMax-115)*0.08;
     // prefer water nearby and green around
     const m=moistureAt(x,z);
     const total = score + m*1.2;
     if(total>best.score) best={score:total,ang,waterScore,mountainScore,blockPenalty,peakMax,waterFirstAt,m};
   }
   if(best.score>8 && best.waterScore>0.8 && best.mountainScore>2.0) results.push({x,z,h:+h.toFixed(1),sl:+sl.toFixed(2),...Object.fromEntries(Object.entries(best).map(([k,v])=>[k,typeof v==='number'?+v.toFixed(2):v]))});
 }
}
results.sort((a,b)=>b.score-a.score);
console.log('candidates',results.length);
console.dir(results.slice(0,20),{depth:null});
