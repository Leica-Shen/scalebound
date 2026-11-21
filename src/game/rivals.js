import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/noise.js';
import { heightAt, SEA_LEVEL } from '../core/terrain.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
}

function wingGeometry() {
  const pts = [
    [0, 0, 0], [3.5, 0, 0.6], [5.4, -0.1, -1.4], [3.0, 0, -2.7], [0.6, 0, -1.2],
  ];
  const pos = [];
  const idx = [];
  for (const p of pts) pos.push(...p);
  idx.push(0,1,2, 0,2,3, 0,3,4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const WING_GEO = wingGeometry();

function buildRival(dragon) {
  const p = dragon.palette;
  const group = new THREE.Group();
  const material = mat(p.base);
  const dark = mat(p.dark);
  const light = mat(p.light);
  const belly = mat(p.belly);
  const accent = mat(p.accent);
  const membrane = new THREE.MeshLambertMaterial({ color: p.membrane, side: THREE.DoubleSide, transparent: true, opacity: 0.92, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: p.eye });
  const add = (geo, m, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const B = new THREE.BoxGeometry(1, 1, 1);
  add(B, material, 0, 0, 0).scale.set(1.55, 1.0, 3.5);
  add(B, belly, 0, -0.42, 0.1).scale.set(1.25, 0.45, 3.0);
  // neck + head
  const neck = new THREE.Group(); neck.position.set(0, 0.3, 1.55); group.add(neck);
  add(B, material, 0, 0.35, 0.6, neck).scale.set(0.62, 0.65, 1.55);
  const head = new THREE.Group(); head.position.set(0, 0.58, 1.35); neck.add(head);
  add(B, material, 0, 0.1, 0.32, head).scale.set(0.82, 0.65, 1.15);
  add(B, light, 0, 0.05, 0.82, head).scale.set(0.5, 0.34, 0.6);
  add(B, dark, 0, -0.16, 0.7, head).scale.set(0.62, 0.14, 0.6);
  for (const s of [-1,1]) {
    add(new THREE.ConeGeometry(0.12, 0.85, 4), accent, s*0.35, 0.68, 0.2, head).rotation.z = s*-0.45;
    add(B, eyeMat, s*0.29, 0.18, 0.64, head).scale.set(0.16, 0.12, 0.08);
    add(B, dark, s*0.29, 0.18, 0.61, head).scale.set(0.2, 0.17, 0.06);
  }
  // wings
  const wings = [];
  for (const s of [-1,1]) {
    const pivot = new THREE.Group(); pivot.position.set(s*0.72, 0.35, 0.25); group.add(pivot);
    const w = new THREE.Mesh(WING_GEO, membrane); w.scale.x = s; w.castShadow = true; pivot.add(w);
    const bone = add(B, accent, s*1.8, 0, 0.2, pivot); bone.scale.set(3.2, 0.09, 0.12);
    wings.push({ pivot, side:s, movie:s });
  }
  // tail and little legs
  const tail = new THREE.Group(); tail.position.set(0, 0.1, -1.6); group.add(tail);
  for (let i=0;i<4;i++) {
    const seg = add(B, i%2?dark:material, 0, -i*0.03, -i*0.52, tail);
    seg.scale.set(0.42-i*0.07, 0.34-i*0.05, 0.62);
  }
  for (const z of [0.95, -0.9]) for (const s of [-1,1]) {
    add(B, dark, s*0.62, -0.6, z).scale.set(0.22, 0.8, 0.28);
    add(B, accent, s*0.62, -0.98, z+0.12).scale.set(0.3, 0.16, 0.42);
  }
  // crown/back fins
  for (let i=0;i<5;i++) {
    const fin = add(new THREE.ConeGeometry(0.14, 0.6, 4), accent, 0, 0.56, -1.1+i*0.55, group);
    fin.rotation.x = -0.15; fin.rotation.z = 0.05;
  }
  group.scale.setScalar(0.85 + Math.random()*0.35);
  return { group, wings, neck, head, tail, materials:[material,dark,light,belly,accent,membrane,eyeMat] };
}

export class RivalDragons {
  constructor(scene, world, game, catalog) {
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.catalog = catalog;
    this.group = new THREE.Group();
    this.group.name = 'rival-dragons';
    this.group.visible = false;
    scene.add(this.group);
    this.list = [];
    this.target = null;
    this.spawnTimer = 0;
    this.enabled = false;
    this.rng = Math.random;
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled;
    if (!this.enabled) this.clear();
  }

  clear() {
    for (const n of this.list) {
      this.group.remove(n.root.group);
      for (const m of n.root.materials) m.dispose();
      n.root.group.traverse(o => { if (o.geometry && o.geometry !== WING_GEO) o.geometry.dispose(); });
    }
    this.list.length = 0;
    this.target = null;
  }

  _spawn(playerPos) {
    const dragon = this.catalog[Math.floor(Math.random()*this.catalog.length)];
    const a = Math.random()*Math.PI*2;
    const r = 150 + Math.random()*230;
    const x = playerPos.x + Math.cos(a)*r;
    const z = playerPos.z + Math.sin(a)*r;
    const ground = heightAt(x,z);
    const y = Math.max(SEA_LEVEL+18, ground+28+Math.random()*54);
    const root = buildRival(dragon);
    const scale = root.group.scale.x;
    root.group.position.set(x,y,z);
    root.group.rotation.y = Math.random()*6.28;
    this.group.add(root.group);
    const npc = {
      root, dragon, name: dragon.name, scale,
      pos: new THREE.Vector3(x,y,z), vel: new THREE.Vector3(),
      yaw: root.group.rotation.y, hp: 64 + (dragon.stats?.endurance||80)*0.35,
      maxHp: 0, state: 'patrol', waypoint: new THREE.Vector3(x+(Math.random()-0.5)*180,y+20,z+(Math.random()-0.5)*180),
      attackCd: 2 + Math.random()*3, aggression: 0.28 + Math.random()*0.55, alive: true, respawn: 0, flap: Math.random()*6.28,
      energy: 0.55 + Math.random()*0.4, hunger: 0.25 + Math.random()*0.45, stateTimer: 0,
    };
    npc.maxHp = npc.hp;
    this.list.push(npc);
    return npc;
  }

  update(dt, playerPos, environment) {
    if (!this.enabled) return;
    this.spawnTimer -= dt;
    if (this.list.length < 4 && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5 + Math.random()*2.5;
      this._spawn(playerPos);
    }
    const water = environment?.underwater;
    for (let i=this.list.length-1;i>=0;i--) {
      const n = this.list[i];
      if (!n.alive) { n.respawn -= dt; if (n.respawn <= 0) { this._remove(n); this._spawn(playerPos); } continue; }
      const toPlayer = _v.copy(playerPos).sub(n.pos);
      const dist = toPlayer.length();
      if (dist > 1100) {
        this._remove(n);
        this._spawn(playerPos);
        continue;
      }
      if (n.attackCd > 0) n.attackCd -= dt;
      // Living-state clock: rivals hunt when hungry, rest when exhausted, and
      // break off to fight the player or each other when blood is up.
      n.energy = clamp(n.energy - dt * (n.state === 'chase' ? 0.022 : 0.005), 0, 1);
      n.hunger = clamp(n.hunger + dt * 0.011, 0, 1);
      if (n.stateTimer > 0) {
        n.stateTimer -= dt;
        if (n.state === 'rest') {
          n.energy = Math.min(1, n.energy + dt * 0.065);
          if (n.energy > 0.72) { n.state = 'patrol'; n.stateTimer = 0; }
        } else if (n.state === 'hunt') {
          n.hunger = Math.max(0, n.hunger - dt * 0.045);
          if (n.hunger < 0.32) { n.state = 'patrol'; n.stateTimer = 0; }
        }
      }
      if (n.stateTimer <= 0 && (n.state === 'rest' || n.state === 'hunt')) n.state = 'patrol';
      if (n.stateTimer > 0) {
        // handled above
      } else if (dist < 155 && n.aggression > 0.34) {
        n.state = 'chase';
      } else if (n.energy < 0.24) {
        n.state = 'rest'; n.stateTimer = 7 + Math.random()*5;
        n.waypoint.set(n.pos.x + (Math.random()-0.5)*80, Math.max(SEA_LEVEL+18, heightAt(n.pos.x,n.pos.z)+24), n.pos.z + (Math.random()-0.5)*80);
      } else if (n.hunger > 0.74) {
        n.state = 'hunt'; n.stateTimer = 8 + Math.random()*5;
        n.waypoint.set(n.pos.x + (Math.random()-0.5)*150, Math.max(SEA_LEVEL+16, heightAt(n.pos.x,n.pos.z)+28), n.pos.z + (Math.random()-0.5)*150);
      } else if (dist < 52 && n.aggression < 0.3) {
        n.state = 'flee';
      } else if (n.state === 'chase' && dist > 220) {
        n.state = 'patrol';
      }
      if (n.state === 'chase') {
        n.waypoint.copy(playerPos);
      } else if (n.state === 'flee') {
        n.waypoint.copy(n.pos).addScaledVector(toPlayer.normalize(), 90);
      } else if (n.state === 'rest') {
        // hover low and slow to recover; this reads as a dragon bedding down.
        n.waypoint.y = Math.max(SEA_LEVEL+18, heightAt(n.pos.x,n.pos.z)+24);
      } else if (n.state === 'hunt') {
        n.waypoint.y = Math.max(SEA_LEVEL+16, heightAt(n.waypoint.x,n.waypoint.z)+30);
      } else if (n.state === 'patrol' && n.pos.distanceTo(n.waypoint) < 20) {
        n.waypoint.set(n.pos.x + (Math.random()-0.5)*260, Math.max(SEA_LEVEL+30, heightAt(n.pos.x,n.pos.z)+40+Math.random()*55), n.pos.z + (Math.random()-0.5)*260);
      }
      const toTarget = _v2.copy(n.waypoint).sub(n.pos);
      const targetYaw = Math.atan2(toTarget.x, toTarget.z);
      n.yaw = lerp(n.yaw, targetYaw, 1-Math.exp(-1.7*dt));
      const speed = n.state === 'chase' ? 30 : (n.state === 'flee' ? 27 : (n.state === 'rest' ? 9 : 20));
      n.pos.x += Math.sin(n.yaw) * speed * dt;
      n.pos.z += Math.cos(n.yaw) * speed * dt;
      const targetY = n.state === 'chase' ? playerPos.y + 7 : n.waypoint.y;
      if (n.state === 'rest') n.pos.y = damp(n.pos.y, n.waypoint.y, 1.2, dt);
      n.pos.y = damp(n.pos.y, targetY, 0.65, dt);
      const g = heightAt(n.pos.x,n.pos.z);
      n.pos.y = Math.max(n.pos.y, (g<SEA_LEVEL?SEA_LEVEL:g)+14);
      if (water && n.pos.y < SEA_LEVEL+16) n.pos.y = SEA_LEVEL+16;
      n.root.group.position.copy(n.pos);
      n.root.group.rotation.set(-0.035*Math.sin(n.flap*0.25), n.yaw, -0.08*Math.sin(n.yaw*2+n.flap*0.2));
      n.flap += dt * (6.5 + (n.state==='chase'?2.2:0));
      const beat = Math.sin(n.flap);
      for (const w of n.root.wings) w.pivot.rotation.z = w.side * (0.16 + beat*0.3);
      n.root.head.rotation.y = Math.sin(n.flap*0.5)*0.06;
      n.root.tail.rotation.y = Math.sin(n.flap*0.45)*0.12;
      if (n.state === 'chase' && dist < 38 && n.attackCd <= 0) {
        n.attackCd = 3.6 + Math.random()*2.4;
        this.game.takeRivalHit(7 + Math.round(Math.random()*7), n);
      }
      // body collisions between rivals create world conflicts
      for (const other of this.list) {
        if (other === n || !other.alive) continue;
        const d = n.pos.distanceTo(other.pos);
        if (d < 5 && n.attackCd <= 0 && n.aggression > 0.68) {
          n.attackCd = 4;
          other.hp -= 6;
          n.root.wingFlash = 0.2;
          this.game.world.effects.burst(_v.copy(other.pos).setY(other.pos.y+2), n.dragon.palette.glow, 10, 5, 0.2, 0.6);
          if (other.hp <= 0) this._kill(other, n);
        }
      }
      if (n.targetFlash > 0) n.targetFlash -= dt;
    }
    this.target = this.nearest(playerPos, 190);
  }

  nearest(pos, range=200) {
    let best=null, bd=range;
    for (const n of this.list) {
      if (!n.alive) continue;
      const d = n.pos.distanceTo(pos);
      if (d<bd) { bd=d; best=n; }
    }
    return best;
  }

  playerAttack(playerPos, forward) {
    const n = this.nearest(playerPos, 58);
    if (!n) return null;
    const dot = _v.copy(n.pos).sub(playerPos).normalize().dot(forward);
    if (dot < 0.15) return null;
    n.hp -= 20 + Math.random()*6;
    n.aggression = 1;
    n.state = 'chase';
    this.target = n;
    if (n.hp <= 0) this._kill(n);
    return n;
  }

  areaDamage(pos, radius, damage) {
    let count = 0;
    for (const n of [...this.list]) {
      if (!n.alive) continue;
      if (n.pos.distanceTo(pos) <= radius) {
        n.hp -= damage; n.aggression = 1; n.state='chase'; count++;
        if (n.hp<=0) this._kill(n);
      }
    }
    return count;
  }

  _kill(n, by=null) {
    if (!n.alive) return;
    n.alive = false; n.hp = 0; n.respawn = 7 + Math.random()*5;
    n.root.group.visible = false;
    if (this.target === n) this.target = null;
    this.game.world.effects.burst(n.pos, n.dragon.palette.glow, 36, 12, 0.35, 1.4);
    this.game.audio?.groundHit?.(0.5);
  }

  _remove(n) {
    const i=this.list.indexOf(n); if(i<0)return;
    this.group.remove(n.root.group);
    for (const m of n.root.materials) m.dispose();
    n.root.group.traverse(o => { if (o.geometry && o.geometry !== WING_GEO) o.geometry.dispose(); });
    this.list.splice(i,1);
    if (this.target===n) this.target=null;
  }
}
