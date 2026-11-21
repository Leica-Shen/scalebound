import { DRAGONS } from '../src/dragon/catalog.js';
import { buildDragon } from '../src/dragon/model.js';
import { DragonAnimator } from '../src/dragon/animation.js';
for (const d of DRAGONS) {
  const rig = buildDragon(d);
  const anim = new DragonAnimator(rig);
  for (let i=0;i<600;i++) {
    anim.update(1/60, {mode: i<300?'showcase':'flight', speed: 30, pitch: 0.2*Math.sin(i/50), roll: 0.3*Math.sin(i/60), turn: Math.sin(i/40), climb: Math.sin(i/70), boost: i>400?1:0, stall:0, brake:0});
    if (i===250) { anim.triggerFlap(); anim.triggerRoar(); }
  }
  const w=rig.wings[0];
  console.log(d.id, 'ok', 'wing z', w.root.rotation.z.toFixed(2), 'head', rig.head.rotation.x.toFixed(2));
}
