// Sparse, session-scoped height edits. They are applied after the procedural
// height field so dragon abilities can visibly raise hills or carve basins.
const edits = [];
let serial = 0;
export const MAX_EDITS = 32;

export function addTerrainEdit(x, z, radius, amount, kind = 'raise') {
  const edit = {
    id: ++serial, x, z, radius: Math.max(3, radius), amount,
    kind, born: performance.now(),
  };
  edits.push(edit);
  while (edits.length > MAX_EDITS) edits.shift();
  return edit;
}

export function clearTerrainEdits() {
  edits.length = 0;
}

export function getTerrainEdits() {
  return edits;
}

export function sampleTerrainEdits(x, z, base) {
  let h = base;
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const dx = x - e.x;
    const dz = z - e.z;
    const q2 = (dx * dx + dz * dz) / (e.radius * e.radius);
    if (q2 >= 1) continue;
    const q = Math.sqrt(q2);
    const f = 1 - q * q;
    const falloff = f * f * (3 - 2 * f);
    h += e.amount * falloff;
  }
  return h;
}
