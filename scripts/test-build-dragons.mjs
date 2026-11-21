import { DRAGONS } from '../src/dragon/catalog.js';
import { buildDragon } from '../src/dragon/model.js';
for (const d of DRAGONS) {
  let count = 0;
  const rig = buildDragon(d);
  rig.group.traverse(o => { if (o.isMesh) count++; });
  console.log(d.id, 'meshes', count, 'wings', rig.wings.length, 'neck', rig.neck.length, 'tail', rig.tail.length, 'whiskers', rig.whiskers.length, 'extraHeads', rig.extraHeads.length);
}
console.log('all 9 built');
