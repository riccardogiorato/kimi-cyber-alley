import * as THREE from 'three';
import { ALLEY, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';

/**
 * Flying traffic — a handful of small craft that cross the sky above the
 * alley. Deliberately sparse (not a swarm): each craft loops on its own
 * flight path high overhead, blinking nav lights, so the sky feels alive
 * without stealing focus from the alley.
 *
 * Craft fly in ALL directions: along the alley, across it (left-right),
 * and on climbing/diving diagonals. Altitudes stay well above the wall
 * height (20) plus margin so nothing clips the rooftops.
 *
 * Variation per craft: body style (3 silhouettes), size, tint, canopy
 * colour, nav-light colour/blink, altitude, speed, direction, vertical
 * drift. All deterministic from ctx.rng.
 */

interface Craft {
  root: THREE.Group;
  navL: THREE.Mesh;
  navR: THREE.Mesh;
  /** start + end of the flight line (world space) */
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** seconds for one A->B crossing */
  period: number;
  /** 0..1 offset so craft are spread along their paths, not bunched */
  phase: number;
  /** blinking nav-light speed */
  blink: number;
}

const BODY_TINTS = [
  0x2a3340, 0x3a2f42, 0x24363a, 0x40343a, 0x2e3a2e,
  0x4a2e2e, 0x2e4a5c, 0x5c4a2e, 0x38304e, 0x1e3a44,
];
const NAV_COLORS = [0xff3b30, 0x51ff7a, 0x38d6ff, 0xffd24d, 0xff2d95, 0xb44dff, 0x4dffd4];
const CANOPY_COLORS = [0x9fdcff, 0xffd9a0, 0xd0a0ff, 0xa0ffc8, 0xffa0b8];

/** Silhouette 0: sleek speeder (low box + needle nose + wing stubs). */
function buildSpeeder(root: THREE.Group, tint: number, canopyColor: number): void {
  const mat = makeToon({ color: tint });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.32, 0.6), mat);
  root.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 4), mat);
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.x = 1.1;
  root.add(nose);
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.08, 0.34),
    makeEmissiveToon({ color: 0x0a0a12, emissive: canopyColor, emissiveIntensity: 1.6 }),
  );
  canopy.position.set(0.2, 0.2, 0);
  root.add(canopy);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.9), makeToon({ color: 0x1a2129 }));
  wing.position.set(-0.2, 0, 0);
  root.add(wing);
}

/** Silhouette 1: bulky hauler (tall cab + twin hull pods + tail fin). */
function buildHauler(root: THREE.Group, tint: number, canopyColor: number): void {
  const mat = makeToon({ color: tint });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7), mat);
  cab.position.set(0.5, 0.1, 0);
  root.add(cab);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 0.6),
    makeEmissiveToon({ color: 0x0a0a12, emissive: canopyColor, emissiveIntensity: 1.8 }),
  );
  glass.position.set(0.85, 0.15, 0);
  root.add(glass);
  for (const sz of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), mat);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(-0.3, -0.05, sz * 0.5);
    root.add(pod);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), makeToon({ color: 0x1a2129 }));
  fin.position.set(-0.8, 0.3, 0);
  root.add(fin);
}

/** Silhouette 2: police interceptor (angled wings + light bar). */
function buildInterceptor(root: THREE.Group, tint: number, canopyColor: number): void {
  const mat = makeToon({ color: tint });
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.7, 6), mat);
  hull.rotation.z = Math.PI / 2;
  root.add(hull);
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    makeEmissiveToon({ color: 0x0a0a12, emissive: canopyColor, emissiveIntensity: 1.7 }),
  );
  canopy.scale.set(1.4, 0.6, 1);
  canopy.position.set(0.35, 0.22, 0);
  root.add(canopy);
  for (const sz of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.8), makeToon({ color: 0x1a2129 }));
    wing.position.set(-0.3, -0.05, sz * 0.7);
    wing.rotation.x = sz * 0.35; // canted
    root.add(wing);
  }
  // Light bar (steady red/blue would need two meshes; use one hot bar).
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.07, 0.5),
    makeEmissiveToon({ color: 0x0a0a12, emissive: 0xff4d6a, emissiveIntensity: 2.4 }),
  );
  bar.position.set(-0.1, 0.32, 0);
  root.add(bar);
}

const SILHOUETTES = [buildSpeeder, buildHauler, buildInterceptor];

export function buildCraft(rng: () => number): { root: THREE.Group; navL: THREE.Mesh; navR: THREE.Mesh } {
  const root = new THREE.Group();
  root.name = 'craft';

  const bodyTint = BODY_TINTS[Math.floor(rng() * BODY_TINTS.length)]!;
  const navColor = NAV_COLORS[Math.floor(rng() * NAV_COLORS.length)]!;
  const canopyColor = CANOPY_COLORS[Math.floor(rng() * CANOPY_COLORS.length)]!;
  const style = SILHOUETTES[Math.floor(rng() * SILHOUETTES.length)]!;
  style(root, bodyTint, canopyColor);

  // Nav lights on the wingtips (these blink). Big enough to read from street.
  const navGeo = new THREE.SphereGeometry(0.16, 6, 6);
  const navMatL = makeEmissiveToon({ color: 0x0a0a12, emissive: navColor, emissiveIntensity: 3.0 });
  const navMatR = makeEmissiveToon({ color: 0x0a0a12, emissive: 0xffffff, emissiveIntensity: 2.2 });
  const navL = new THREE.Mesh(navGeo, navMatL);
  navL.position.set(-0.2, 0, 0.95);
  const navR = new THREE.Mesh(navGeo, navMatR);
  navR.position.set(-0.2, 0, -0.95);
  root.add(navL, navR);

  // Engine glow at the tail.
  const engine = new THREE.Mesh(
    new THREE.CircleGeometry(0.16, 8),
    makeEmissiveToon({ color: 0x0a0a12, emissive: 0xff8a4d, emissiveIntensity: 2.6 }),
  );
  engine.position.set(-0.82, 0, 0);
  engine.rotation.y = -Math.PI / 2;
  root.add(engine);

  return { root, navL, navR };
}

export function buildTraffic(ctx: AlleyContext): BuiltPart {
  const { rng } = ctx;
  const group = new THREE.Group();
  group.name = 'traffic';

  const crafts: Craft[] = [];
  const COUNT = 6; // still sparse, but enough for directional variety
  // Walls are 20 tall; keep every craft at least 6 above the roofline.
  const MIN_ALT = ALLEY.wallHeight + 6; // 26
  for (let i = 0; i < COUNT; i++) {
    const { root, navL, navR } = buildCraft(rng);
    const alt = MIN_ALT + rng() * 14; // 26..40
    const kind = rng();
    let a: THREE.Vector3;
    let b: THREE.Vector3;
    if (kind < 0.4) {
      // Along the alley (down the z-axis corridor), either direction.
      const dir = rng() < 0.5 ? 1 : -1;
      const xBase = (rng() - 0.5) * 8;
      a = new THREE.Vector3(xBase, alt, dir > 0 ? -25 : ALLEY.length + 25);
      b = new THREE.Vector3(xBase + (rng() - 0.5) * 6, alt + (rng() - 0.5) * 6, dir > 0 ? ALLEY.length + 25 : -25);
    } else if (kind < 0.75) {
      // Across the alley (left-right over the rooftops), either direction.
      const dir = rng() < 0.5 ? 1 : -1;
      const zBase = rng() * ALLEY.length;
      a = new THREE.Vector3(dir > 0 ? -30 : 30, alt, zBase);
      b = new THREE.Vector3(dir > 0 ? 30 : -30, alt + (rng() - 0.5) * 6, zBase + (rng() - 0.5) * 14);
    } else {
      // Climbing / diving diagonal across the whole block.
      const sx = rng() < 0.5 ? -1 : 1;
      const sz = rng() < 0.5 ? -1 : 1;
      const low = MIN_ALT + rng() * 4;
      const high = low + 8 + rng() * 10;
      const climb = rng() < 0.5;
      a = new THREE.Vector3(sx * -28, climb ? low : high, sz > 0 ? -20 : ALLEY.length + 20);
      b = new THREE.Vector3(sx * 28, climb ? high : low, sz > 0 ? ALLEY.length + 20 : -20);
    }
    const size = 0.9 + rng() * 1.3;
    root.scale.setScalar(size);
    group.add(root);
    crafts.push({
      root,
      navL,
      navR,
      a,
      b,
      period: 12 + rng() * 18,
      phase: rng(),
      blink: 2 + rng() * 3,
    });
  }

  const pos = new THREE.Vector3();
  const dirV = new THREE.Vector3();
  const update = (_dt: number, t: number) => {
    for (const c of crafts) {
      // Ping-pong 0..1 along the path so craft fly back and forth.
      const u = (t / c.period + c.phase) % 2;
      const k = u < 1 ? u : 2 - u;
      pos.lerpVectors(c.a, c.b, k);
      c.root.position.copy(pos);
      // Face along the direction of travel (pitch follows climb/dive too).
      dirV.subVectors(c.b, c.a).normalize();
      if (u >= 1) dirV.negate();
      c.root.rotation.y = Math.atan2(dirV.x, dirV.z) - Math.PI / 2;
      c.root.rotation.z = Math.asin(THREE.MathUtils.clamp(dirV.y, -1, 1)) * 0.7;
      // Blink the coloured nav light; the white one stays steady.
      const on = Math.sin(t * c.blink * Math.PI) > 0;
      (c.navL.material as THREE.MeshToonMaterial).emissiveIntensity = on ? 3.2 : 0.2;
    }
  };

  return { group, update };
}
