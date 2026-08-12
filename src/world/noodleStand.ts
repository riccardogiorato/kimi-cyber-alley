import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';
import { menuStripTexture } from '../core/textures';
import { addInvertedHull } from './props';

/* ---------------------------------------------------------------------------
 * Noodle stand — the alley's warm focal point, mid-alley against the +X wall.
 * Open-front stall with a visible interior: counter, noren curtain strips,
 * glowing menu board, stacked bowls, steaming pots, bottles, a lantern row,
 * a rim-lit cook silhouette with idle motion, and customers on stools out
 * front. A warm interior light spills onto the street as the warm anchor
 * against the cool alley. Steam emitter positions are declared here; the
 * atmosphere module owns the particles.
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

/** Deep-red noren fabric with a pale centre emblem, drawn inline. */
function norenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7e2a20';
  g.fillRect(0, 0, 64, 128);
  // Woven vertical shading.
  for (let x = 0; x < 64; x += 4) {
    g.fillStyle = x % 8 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.05)';
    g.fillRect(x, 0, 2, 128);
  }
  // Pale round emblem near the top.
  g.fillStyle = '#e8ddc8';
  g.beginPath();
  g.arc(32, 34, 14, 0, TAU);
  g.fill();
  g.fillStyle = '#7e2a20';
  g.fillRect(26, 26, 12, 16);
  // Frayed lower edge.
  g.fillStyle = 'rgba(20,12,8,0.35)';
  g.fillRect(0, 118, 64, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Backlit menu board: warm paper, dark dish rows, red price dots. */
function menuBoardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4e3bc';
  g.fillRect(0, 0, 128, 256);
  // Header band.
  g.fillStyle = '#b8352c';
  g.fillRect(0, 0, 128, 34);
  g.fillStyle = '#f4e3bc';
  g.fillRect(20, 10, 88, 14);
  // Dish rows: dark glyph ticks + red price dot.
  for (let r = 0; r < 6; r++) {
    const y = 52 + r * 32;
    g.fillStyle = '#3a2a1a';
    for (let k = 0; k < 4; k++) {
      g.fillRect(12 + k * 18, y, 12, 4);
      g.fillRect(12 + k * 18, y + 8, 8, 3);
    }
    g.fillStyle = '#b8352c';
    g.beginPath();
    g.arc(112, y + 6, 5, 0, TAU);
    g.fill();
  }
  // Edge grime.
  const grad = g.createLinearGradient(0, 200, 0, 256);
  grad.addColorStop(0, 'rgba(30,20,10,0)');
  grad.addColorStop(1, 'rgba(30,20,10,0.4)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
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
      emissiveIntensity: 1.3,
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

/**
 * Low-poly human silhouette. Dark cloth with a warm emissive rim so the
 * figure reads against the lit interior. Returns refs for idle animation.
 */
function buildFigure(opts: {
  cloth: number;
  rim: number;
  skin: number;
  seated?: boolean;
}): { group: THREE.Group; head: THREE.Mesh; armR: THREE.Group; armL: THREE.Group } {
  const g = new THREE.Group();
  const clothMat = makeToon({ color: opts.cloth, emissive: opts.rim, emissiveIntensity: 0.22 });
  const skinMat = makeToon({ color: opts.skin, emissive: opts.rim, emissiveIntensity: 0.35 });

  // Torso: slightly tapered box.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.5, 8), clothMat);
  torso.position.y = opts.seated ? 0.72 : 1.05;
  g.add(torso);

  // Head with a simple cap band.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), skinMat);
  head.position.y = torso.position.y + 0.36;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.05, 10), clothMat);
  cap.position.y = 0.055;
  head.add(cap);

  // Arms: pivoted groups at the shoulders so they can swing.
  const armGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.42, 6);
  armGeo.translate(0, -0.21, 0); // pivot at shoulder
  const armR = new THREE.Group();
  armR.position.set(0.19, torso.position.y + 0.2, 0);
  const armRMesh = new THREE.Mesh(armGeo, clothMat);
  armR.add(armRMesh);
  g.add(armR);
  const armL = new THREE.Group();
  armL.position.set(-0.19, torso.position.y + 0.2, 0);
  const armLMesh = new THREE.Mesh(armGeo, clothMat);
  armL.add(armLMesh);
  g.add(armL);

  if (opts.seated) {
    // Seated: upper legs forward, lower legs down.
    const legMat = clothMat;
    for (const sx of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.32, 6), legMat);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.set(sx * 0.08, 0.5, 0.16);
      g.add(thigh);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.42, 6), legMat);
      shin.position.set(sx * 0.08, 0.24, 0.3);
      g.add(shin);
    }
    // Lean toward the counter.
    torso.rotation.x = 0.12;
    head.position.z = 0.05;
    armR.rotation.x = -0.9;
    armL.rotation.x = -0.9;
  } else {
    // Standing legs.
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6), clothMat);
      leg.position.set(sx * 0.08, 0.31, 0);
      g.add(leg);
    }
  }
  return { group: g, head, armR, armL };
}

export function buildNoodleStand(ctx: AlleyContext): NoodleStandPart {
  const { rng } = ctx;
  const group = new THREE.Group();
  group.name = 'noodle-stand';

  // Stand origin: against the +X wall, protruding into the walkway.
  const OX = ALLEY.halfWidth - 0.12; // back of the stall near the wall
  const OZ = 36;
  const root = new THREE.Group();
  root.position.set(OX, 0, OZ);
  root.rotation.y = -Math.PI / 2; // stall front faces -X (into the alley)
  group.add(root);

  const wood = makeToon({ color: 0x6e4a2e });
  const woodDark = makeToon({ color: 0x4a2f1c });
  const steel = makeToon({ color: 0x5a666e });

  /* --- Stall shell (hero prop) -------------------------------------------- */
  const cart = new THREE.Group();
  cart.name = 'noodle-cart';
  root.add(cart);

  // Counter block: 2.2 wide (along alley), 0.8 deep, 0.95 high.
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.8), wood);
  counter.name = 'noodle-cart-body';
  counter.position.set(0, 0.45, 0.45);
  cart.add(counter);
  // Counter top slab.
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.05, 0.9), woodDark);
  top.position.set(0, 0.925, 0.45);
  cart.add(top);
  // Kick panel.
  const kick = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.82), woodDark);
  kick.position.set(0, 0.06, 0.45);
  cart.add(kick);

  // Back wall + side panels: encloses the stall so the warm interior reads
  // as a lit box with an open front.
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.9, 0.06), wood);
  backWall.position.set(0, 0.95, 1.32);
  cart.add(backWall);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.9, 1.3), wood);
    side.position.set(sx * 1.17, 0.95, 0.68);
    cart.add(side);
  }
  // Warm interior backing panel: emissive so the open front glows from afar.
  const interiorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 1.3),
    makeEmissiveToon({ color: 0xffb35c, emissive: 0xff9440, emissiveIntensity: 0.85 }),
  );
  interiorGlow.position.set(0, 1.35, 1.28);
  interiorGlow.rotation.y = Math.PI; // face the open front
  cart.add(interiorGlow);
  // Shelf on the back wall with bottle silhouettes.
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.04, 0.18), woodDark);
  shelf.position.set(0, 1.55, 1.2);
  cart.add(shelf);
  const bottleColors = [0x8c3a3a, 0x3a5a8c, 0x4a6a5a, 0xd8b83a, 0x2e2e2e, 0xb82e2e];
  for (let i = 0; i < 9; i++) {
    const h = rand(rng, 0.12, 0.2);
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.032, h, 8),
      makeToon({ color: bottleColors[i % bottleColors.length]! }),
    );
    bottle.position.set(-0.9 + i * 0.22 + rand(rng, -0.03, 0.03), 1.57 + h / 2, 1.2);
    cart.add(bottle);
  }

  // Posts + sloped roof (wider than before — destination scale).
  const postGeo = new THREE.BoxGeometry(0.07, 2.1, 0.07);
  for (const sx of [-1, 1]) {
    for (const sz of [0, 1]) {
      const post = new THREE.Mesh(postGeo, woodDark);
      post.position.set(sx * 1.12, 1.05, sz === 0 ? 0.02 : 1.3);
      cart.add(post);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 1.7), woodDark);
  roof.position.set(0, 2.14, 0.66);
  roof.rotation.x = 0.1;
  cart.add(roof);

  // Striped awning canvas hanging off the roof front.
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.6),
    new THREE.MeshToonMaterial({ map: awningTexture(), side: THREE.DoubleSide }),
  );
  awning.position.set(0, 1.92, -0.2);
  awning.rotation.x = 0.55;
  cart.add(awning);

  // Hero outline on the cart body.
  addInvertedHull(counter, { thickness: 2.5 });

  /* --- Noren curtain strips across the open front --------------------------- */
  const norenTex = norenTexture();
  const norenStrips: { mesh: THREE.Mesh; phase: number; amp: number }[] = [];
  const norenCount = 5;
  for (let i = 0; i < norenCount; i++) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.6),
      new THREE.MeshToonMaterial({ map: norenTex, side: THREE.DoubleSide }),
    );
    // Pivot at the top so sway rotates around the hang point.
    strip.geometry.translate(0, -0.3, 0);
    strip.position.set(-0.88 + i * 0.44, 2.0, 0.04);
    cart.add(strip);
    norenStrips.push({ mesh: strip, phase: rng() * TAU, amp: rand(rng, 0.04, 0.1) });
  }

  /* --- Glowing menu board beside the front ----------------------------------- */
  const menuBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 1.0),
    makeEmissiveToon({
      color: 0xf4e3bc,
      emissive: 0xffd9a0,
      emissiveIntensity: 1.1,
      map: menuBoardTexture(),
    }),
  );
  menuBoard.position.set(1.45, 1.35, 0.1);
  menuBoard.rotation.y = -0.35; // angled toward approaching players
  cart.add(menuBoard);
  const menuFrame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1.06, 0.04), woodDark);
  menuFrame.position.set(1.45, 1.35, 0.07);
  menuFrame.rotation.y = -0.35;
  cart.add(menuFrame);

  /* --- Hanging menu strips under the roof edge -------------------------------- */
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
    strip.position.set(-0.95 + i * 0.38, 2.06, -0.06);
    cart.add(strip);
    menuStrips.push({ mesh: strip, phase: rng() * TAU, amp: rand(rng, 0.05, 0.12) });
  }

  /* --- Warmer case: glass box, warm interior, bun blobs ---------------------- */
  const warmer = new THREE.Group();
  warmer.position.set(-0.55, 0.95, 0.28);
  cart.add(warmer);

  const warmerGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.34, 0.4),
    makeEmissiveToon({ color: 0xffb35c, emissive: 0xff9a3c, emissiveIntensity: 1.0 }),
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

  /* --- Cooking pots on the back counter --------------------------------------- */
  const potPositions: [number, number][] = [
    [0.55, 0.62],
    [0.9, 0.55],
  ];
  for (const [px, pz] of potPositions) {
    const pot = new THREE.Group();
    pot.position.set(px, 0.95, pz);
    cart.add(pot);
    const potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.2, 14), steel);
    potBody.position.y = 0.1;
    pot.add(potBody);
    const potLid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.05, 14), steel);
    potLid.position.y = 0.225;
    potLid.rotation.z = rand(rng, -0.08, 0.08); // lid ajar so steam escapes
    pot.add(potLid);
    const lidKnob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), woodDark);
    lidKnob.position.y = 0.26;
    pot.add(lidKnob);
  }

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
  for (let i = 0; i < 5; i++) {
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.set(0.12, 0.95 + i * 0.045, 0.25);
    cart.add(bowl);
  }
  // Second, shorter stack for asymmetry.
  for (let i = 0; i < 3; i++) {
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.set(-0.15, 0.95 + i * 0.045, 0.3);
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

  /* --- The cook: rim-lit silhouette behind the counter ------------------------ */
  const cook = buildFigure({ cloth: 0x2a2622, rim: 0xff8a3c, skin: 0x8a6a4a });
  cook.group.position.set(0.25, 0, 1.0);
  cook.group.rotation.y = Math.PI; // face the open front
  cart.add(cook.group);
  // Cook's stirring ladle in the right hand.
  const ladle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), woodDark);
  ladle.position.y = -0.45;
  cook.armR.add(ladle);
  cook.armR.rotation.x = -1.1;
  cook.armL.rotation.x = -0.4;

  /* --- Stools + seated customers ------------------------------------------------ */
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

  // Two customers on the outer stools, facing the counter.
  const customers: { fig: ReturnType<typeof buildFigure>; phase: number }[] = [];
  const customerSeats = [stoolOffsets[0]!, stoolOffsets[2]!];
  const customerCloth = [0x3a3a4a, 0x4a3a2e];
  for (let i = 0; i < customerSeats.length; i++) {
    const fig = buildFigure({
      cloth: customerCloth[i]!,
      rim: 0xff8a3c,
      skin: 0x7a5a40,
      seated: true,
    });
    fig.group.position.copy(customerSeats[i]!).setY(0.12);
    fig.group.rotation.y = rand(rng, -0.15, 0.15); // roughly facing +z (the counter)
    cart.add(fig.group);
    customers.push({ fig, phase: rng() * TAU });
  }

  /* --- Lantern row across the front + warm interior light ---------------------- */
  const lanTex = lanternTexture();
  const lanternSways: { obj: THREE.Group; phase: number }[] = [];
  for (const lx of [-0.85, 0, 0.85]) {
    const lantern = buildPaperLantern(lanTex);
    lantern.position.set(lx, 1.78, -0.08);
    cart.add(lantern);
    lanternSways.push({ obj: lantern, phase: rng() * TAU });
  }
  // One shared lantern glow so we don't blow the light budget.
  const lanternLight = new THREE.PointLight(0xffa04a, 10, 4, 1.8);
  lanternLight.position.set(0, 1.7, -0.1);
  cart.add(lanternLight);

  // Warm interior key light: the anchor that spills onto the street.
  const interiorLight = new THREE.PointLight(0xffa04a, 15, 8, 1.7);
  interiorLight.position.set(0, 1.5, 0.5);
  cart.add(interiorLight);

  /* --- Colliders + steam emitters --------------------------------------------- */
  // Stall body collider (world space): deeper and wider than before.
  addCollider(ctx, OX - 0.55, 0.5, OZ, 1.15, 1.0, 2.4);

  // Steam emitters in world space: warmer case + both cooking pots.
  const rot = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
  const toWorld = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).applyMatrix4(rot).add(new THREE.Vector3(OX, 0, OZ));
  const steamEmitters = [
    toWorld(-0.55, 1.35, 0.28), // warmer case
    toWorld(0.55, 1.3, 0.62), // cooking pot 1
    toWorld(0.9, 1.3, 0.55), // cooking pot 2
  ];

  /* --- Update: sway + cook idle + customer idle -------------------------------- */
  const update = (_dt: number, t: number) => {
    for (const s of menuStrips) {
      s.mesh.rotation.x = Math.sin(t * 1.1 + s.phase) * s.amp;
      s.mesh.rotation.z = Math.cos(t * 0.8 + s.phase * 1.3) * s.amp * 0.6;
    }
    for (const s of norenStrips) {
      s.mesh.rotation.x = Math.sin(t * 0.9 + s.phase) * s.amp;
      s.mesh.rotation.z = Math.cos(t * 0.7 + s.phase * 1.4) * s.amp * 0.5;
    }
    for (const l of lanternSways) {
      l.obj.rotation.x = Math.sin(t * 0.9 + l.phase) * 0.06;
      l.obj.rotation.z = Math.cos(t * 0.7 + l.phase) * 0.05;
    }
    // Cook: slow head bob + circular stirring arm.
    cook.head.position.y = 1.41 + Math.sin(t * 1.6) * 0.015;
    cook.head.rotation.y = Math.sin(t * 0.5) * 0.2;
    cook.armR.rotation.x = -1.1 + Math.sin(t * 2.2) * 0.18;
    cook.armR.rotation.z = Math.cos(t * 2.2) * 0.15;
    // Customers: gentle eating bob.
    for (const c of customers) {
      c.fig.head.position.y = 1.08 + Math.sin(t * 1.3 + c.phase) * 0.012;
      c.fig.armR.rotation.x = -0.9 + Math.sin(t * 1.8 + c.phase) * 0.12;
    }
  };

  return { group, update, steamEmitters };
}
