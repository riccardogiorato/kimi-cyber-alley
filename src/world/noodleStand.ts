import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';
import { menuStripTexture } from '../core/textures';
import { addInvertedHull } from './props';

/* ---------------------------------------------------------------------------
 * Noodle stand — mid-alley, tucked against the +X wall, protruding ~1.2m.
 * Warm wood, striped awning, hanging menu strips, glowing warmer case,
 * paper lanterns, stools, counter props. Steam emitter positions are
 * declared here; the atmosphere module owns the particles.
 * ------------------------------------------------------------------------- */

const TAU = Math.PI * 2;

function rand(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export interface NoodleStandPart extends BuiltPart {
  /** World-space steam emitter positions for the atmosphere module. */
  steamEmitters: THREE.Vector3[];
}

/** Striped awning canvas, drawn inline. */
function awningTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  const stripes = ['#b8352c', '#e8ddc8'];
  const sw = 32;
  for (let i = 0; i < c.width / sw; i++) {
    g.fillStyle = stripes[i % 2]!;
    g.fillRect(i * sw, 0, sw, c.height);
  }
  // Grime along the lower edge.
  const grad = g.createLinearGradient(0, c.height * 0.6, 0, c.height);
  grad.addColorStop(0, 'rgba(20,16,10,0)');
  grad.addColorStop(1, 'rgba(20,16,10,0.45)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Ribbed paper-lantern banding, drawn inline. */
function lanternTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffb45e';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(160,60,20,0.55)';
  g.lineWidth = 2;
  for (let y = 4; y < 64; y += 8) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(64, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Simple paper lantern: squashed lathe with ribbed texture + caps. */
function buildPaperLantern(tex: THREE.CanvasTexture): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  const R = 0.11;
  const H = 0.13;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = (t - 0.5) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(0.02, Math.cos(a) * R), Math.sin(a) * H));
  }
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 14),
    makeEmissiveToon({
      color: 0xffc06a,
      emissive: 0xff9a3c,
      emissiveIntensity: 2.3,
      map: tex,
    }),
  );
  g.add(body);
  const capMat = makeToon({ color: 0x5a2c18 });
  const capGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10);
  const top = new THREE.Mesh(capGeo, capMat);
  top.position.y = H + 0.008;
  g.add(top);
  const bot = new THREE.Mesh(capGeo, capMat);
  bot.position.y = -H - 0.008;
  g.add(bot);
  // Hanging cord.
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 4), capMat);
  cord.position.y = H + 0.06;
  g.add(cord);
  return g;
}

export function buildNoodleStand(ctx: AlleyContext): NoodleStandPart {
  const { rng } = ctx;
  const group = new THREE.Group();
  group.name = 'noodle-stand';

  // Stand origin: against the +X wall, protruding ~1.2m into the walkway.
  const OX = ALLEY.halfWidth - 0.12; // back of the stall near the wall
  const OZ = 36;
  const root = new THREE.Group();
  root.position.set(OX, 0, OZ);
  root.rotation.y = -Math.PI / 2; // stall front faces -X (into the alley)
  group.add(root);

  const wood = makeToon({ color: 0x6e4a2e });
  const woodDark = makeToon({ color: 0x4a2f1c });
  const steel = makeToon({ color: 0x5a666e });

  /* --- Cart body (hero prop) ---------------------------------------------- */
  const cart = new THREE.Group();
  cart.name = 'noodle-cart';
  root.add(cart);

  // Counter block: 1.7 wide (along alley), 0.75 deep, 0.95 high.
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 0.75), wood);
  counter.name = 'noodle-cart-body';
  counter.position.set(0, 0.45, 0.45);
  cart.add(counter);
  // Counter top slab.
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.05, 0.85), woodDark);
  top.position.set(0, 0.925, 0.45);
  cart.add(top);
  // Kick panel.
  const kick = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.78), woodDark);
  kick.position.set(0, 0.06, 0.45);
  cart.add(kick);

  // Posts + sloped roof.
  const postGeo = new THREE.BoxGeometry(0.06, 1.75, 0.06);
  for (const sx of [-1, 1]) {
    for (const sz of [0, 1]) {
      const post = new THREE.Mesh(postGeo, woodDark);
      post.position.set(sx * 0.82, 0.875, sz === 0 ? 0.06 : 0.86);
      cart.add(post);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 1.15), woodDark);
  roof.position.set(0, 1.82, 0.45);
  roof.rotation.x = 0.1;
  cart.add(roof);

  // Striped awning canvas hanging off the roof front.
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.55),
    new THREE.MeshToonMaterial({ map: awningTexture(), side: THREE.DoubleSide }),
  );
  awning.position.set(0, 1.6, -0.12);
  awning.rotation.x = 0.55;
  cart.add(awning);

  // Hero outline on the cart body.
  addInvertedHull(counter, { thickness: 2.5 });

  /* --- Hanging menu strips -------------------------------------------------- */
  const menuStrips: { mesh: THREE.Mesh; phase: number; amp: number }[] = [];
  const stripCount = 6;
  for (let i = 0; i < stripCount; i++) {
    const tex = menuStripTexture(rng, i);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.55),
      new THREE.MeshToonMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    // Pivot at the top so sway rotates around the hang point.
    strip.geometry.translate(0, -0.275, 0);
    strip.position.set(-0.75 + i * 0.3, 1.72, -0.04);
    cart.add(strip);
    menuStrips.push({ mesh: strip, phase: rng() * TAU, amp: rand(rng, 0.05, 0.12) });
  }

  /* --- Warmer case: glass box, warm interior, bun blobs ---------------------- */
  const warmer = new THREE.Group();
  warmer.position.set(-0.45, 0.95, 0.28);
  cart.add(warmer);

  const warmerGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.34, 0.4),
    makeEmissiveToon({ color: 0xffb35c, emissive: 0xff9a3c, emissiveIntensity: 1.9 }),
  );
  warmerGlow.position.y = 0.17;
  warmer.add(warmerGlow);

  // Buns / dumplings inside.
  const bunMat = makeToon({ color: 0xe8d9b8 });
  const bunGeo = new THREE.SphereGeometry(0.045, 8, 6);
  for (let i = 0; i < 6; i++) {
    const bun = new THREE.Mesh(bunGeo, bunMat);
    bun.scale.y = 0.75;
    bun.position.set(rand(rng, -0.2, 0.2), 0.1 + Math.floor(i / 3) * 0.1, rand(rng, -0.12, 0.12));
    warmer.add(bun);
  }

  const warmerGlass = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.36, 0.43),
    new THREE.MeshStandardMaterial({
      color: 0xcfe8ee,
      transparent: true,
      opacity: 0.16,
      roughness: 0.1,
      metalness: 0.3,
      depthWrite: false,
    }),
  );
  warmerGlass.position.y = 0.18;
  warmer.add(warmerGlass);

  /* --- Cooking pot on the back counter --------------------------------------- */
  const pot = new THREE.Group();
  pot.position.set(0.5, 0.95, 0.62);
  cart.add(pot);
  const potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.2, 14), steel);
  potBody.position.y = 0.1;
  pot.add(potBody);
  const potLid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.05, 14), steel);
  potLid.position.y = 0.225;
  pot.add(potLid);
  const lidKnob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), woodDark);
  lidKnob.position.y = 0.26;
  pot.add(lidKnob);

  /* --- Counter props: stacked bowls, chopstick cup, teapot, condiments ------- */
  // Stacked bowls (lathe).
  const bowlPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.05, 0.005),
    new THREE.Vector2(0.075, 0.03),
    new THREE.Vector2(0.08, 0.055),
  ];
  const bowlGeo = new THREE.LatheGeometry(bowlPts, 12);
  const bowlMat = makeToon({ color: 0x3a5a8c });
  for (let i = 0; i < 4; i++) {
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.set(0.12, 0.95 + i * 0.045, 0.25);
    cart.add(bowl);
  }

  // Chopstick cup.
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 10), makeToon({ color: 0x8c3a3a }));
  cup.position.set(-0.05, 1.0, 0.3);
  cart.add(cup);
  const stickGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.16, 4);
  const stickMat = makeToon({ color: 0xd8c8a0 });
  for (let i = 0; i < 6; i++) {
    const stick = new THREE.Mesh(stickGeo, stickMat);
    stick.position.set(-0.05 + rand(rng, -0.015, 0.015), 1.08, 0.3 + rand(rng, -0.015, 0.015));
    stick.rotation.set(rand(rng, -0.12, 0.12), 0, rand(rng, -0.12, 0.12));
    cart.add(stick);
  }

  // Teapot-ish lathe.
  const teapotPts = [
    new THREE.Vector2(0.01, 0),
    new THREE.Vector2(0.06, 0.01),
    new THREE.Vector2(0.075, 0.05),
    new THREE.Vector2(0.05, 0.09),
    new THREE.Vector2(0.02, 0.1),
  ];
  const teapot = new THREE.Mesh(new THREE.LatheGeometry(teapotPts, 12), makeToon({ color: 0x4a6a5a }));
  teapot.position.set(0.32, 0.95, 0.28);
  cart.add(teapot);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.08, 6), makeToon({ color: 0x4a6a5a }));
  spout.rotation.z = 0.9;
  spout.position.set(0.4, 1.0, 0.28);
  cart.add(spout);

  // Condiment bottles.
  const condColors = [0xb82e2e, 0x2e2e2e, 0xd8b83a];
  for (let i = 0; i < 3; i++) {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.028, 0.11, 8),
      makeToon({ color: condColors[i]! }),
    );
    bottle.position.set(-0.18 + i * 0.07, 1.005, 0.62);
    cart.add(bottle);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), woodDark);
    cap.position.set(-0.18 + i * 0.07, 1.07, 0.62);
    cart.add(cap);
  }

  /* --- Stools ---------------------------------------------------------------- */
  const stoolPts = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.14, 0.01),
    new THREE.Vector2(0.13, 0.04),
    new THREE.Vector2(0.15, 0.42),
    new THREE.Vector2(0.16, 0.45),
  ];
  const stoolGeo = new THREE.LatheGeometry(stoolPts, 12);
  const stoolMat = makeToon({ color: 0xa03828 });
  const stoolOffsets = [
    new THREE.Vector3(-0.55, 0, -0.55),
    new THREE.Vector3(0.05, 0, -0.62),
    new THREE.Vector3(0.6, 0, -0.5),
  ];
  for (const off of stoolOffsets) {
    const stool = new THREE.Mesh(stoolGeo, stoolMat);
    stool.position.copy(off);
    stool.rotation.y = rng() * TAU;
    cart.add(stool);
    // World-space collider per stool.
    const world = off.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    addCollider(ctx, OX + world.x, 0.24, OZ + world.z, 0.34, 0.48, 0.34);
  }

  /* --- Paper lanterns under the awning ---------------------------------------- */
  const lanTex = lanternTexture();
  const lanternSways: { obj: THREE.Group; phase: number }[] = [];
  for (const lx of [-0.55, 0.55]) {
    const lantern = buildPaperLantern(lanTex);
    lantern.position.set(lx, 1.5, -0.02);
    cart.add(lantern);
    lanternSways.push({ obj: lantern, phase: rng() * TAU });
    const light = new THREE.PointLight(0xffa04a, 12, 4, 1.8);
    light.position.set(lx, 1.45, -0.05);
    cart.add(light);
  }

  /* --- Colliders + steam emitters --------------------------------------------- */
  // Cart body collider (world space): 0.85 deep along X, 1.8 wide along Z.
  addCollider(ctx, OX - 0.42, 0.5, OZ, 0.9, 1.0, 1.8);

  // Steam emitters in world space: above the warmer case and the cooking pot.
  const rot = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
  const toWorld = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).applyMatrix4(rot).add(new THREE.Vector3(OX, 0, OZ));
  const steamEmitters = [
    toWorld(-0.45, 1.35, 0.28), // warmer case
    toWorld(0.5, 1.3, 0.62), // cooking pot
  ];

  /* --- Update: menu sway + lantern sway ---------------------------------------- */
  const update = (_dt: number, t: number) => {
    for (const s of menuStrips) {
      s.mesh.rotation.x = Math.sin(t * 1.1 + s.phase) * s.amp;
      s.mesh.rotation.z = Math.cos(t * 0.8 + s.phase * 1.3) * s.amp * 0.6;
    }
    for (const l of lanternSways) {
      l.obj.rotation.x = Math.sin(t * 0.9 + l.phase) * 0.06;
      l.obj.rotation.z = Math.cos(t * 0.7 + l.phase) * 0.05;
    }
  };

  return { group, update, steamEmitters };
}
