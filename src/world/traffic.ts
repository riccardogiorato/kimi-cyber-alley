import * as THREE from 'three';
import { ALLEY, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';

/**
 * Flying traffic — a handful of small craft that cross the sky above the
 * alley. Deliberately sparse (not a swarm): each craft loops on its own
 * straight flight path high overhead, blinking nav lights, so the sky feels
 * alive without stealing focus from the alley.
 *
 * Variation per craft: altitude, speed, direction, size, body tint, and
 * nav-light colour/blink phase. All deterministic from ctx.rng.
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

const BODY_TINTS = [0x2a3340, 0x3a2f42, 0x24363a, 0x40343a, 0x2e3a2e];
const NAV_COLORS = [0xff3b30, 0x51ff7a, 0x38d6ff, 0xffd24d, 0xff2d95];

function buildCraft(rng: () => number): { root: THREE.Group; navL: THREE.Mesh; navR: THREE.Mesh } {
  const root = new THREE.Group();
  root.name = 'craft';

  const bodyTint = BODY_TINTS[Math.floor(rng() * BODY_TINTS.length)]!;
  const navColor = NAV_COLORS[Math.floor(rng() * NAV_COLORS.length)]!;

  // Fuselage: a low sleek box with a tapered nose.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.32, 0.6),
    makeToon({ color: bodyTint }),
  );
  root.add(body);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.7, 4),
    makeToon({ color: bodyTint }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.x = 1.1;
  root.add(nose);

  // Canopy glow strip along the top.
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.08, 0.34),
    makeEmissiveToon({ color: 0x0a0a12, emissive: 0x9fdcff, emissiveIntensity: 1.6 }),
  );
  canopy.position.set(0.2, 0.2, 0);
  root.add(canopy);

  // Wing stubs.
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.06, 1.9),
    makeToon({ color: 0x1a2129 }),
  );
  wing.position.set(-0.2, 0, 0);
  root.add(wing);

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
  const COUNT = 4; // sparse by design
  for (let i = 0; i < COUNT; i++) {
    const { root, navL, navR } = buildCraft(rng);
    // Flight path: a straight line crossing high above the alley, at a
    // diagonal so it isn't parallel to the street. Altitude 18-30 m.
    const alt = 14 + rng() * 10;
    const z0 = -10 + rng() * (ALLEY.length + 20);
    const z1 = z0 + (rng() - 0.5) * 40;
    const dir = rng() < 0.5 ? 1 : -1;
    const a = new THREE.Vector3(-38 * dir, alt, z0);
    const b = new THREE.Vector3(38 * dir, alt + (rng() - 0.5) * 4, z1);
    const size = 1.0 + rng() * 1.0;
    root.scale.setScalar(size);
    group.add(root);
    crafts.push({
      root,
      navL,
      navR,
      a,
      b,
      period: 14 + rng() * 16,
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
      // Face along the direction of travel.
      dirV.subVectors(c.b, c.a).normalize();
      if (u >= 1) dirV.negate();
      c.root.rotation.y = Math.atan2(dirV.x, dirV.z) - Math.PI / 2;
      // Blink the coloured nav light; the white one stays steady.
      const on = Math.sin(t * c.blink * Math.PI) > 0;
      (c.navL.material as THREE.MeshToonMaterial).emissiveIntensity = on ? 3.2 : 0.2;
    }
  };

  return { group, update };
}
