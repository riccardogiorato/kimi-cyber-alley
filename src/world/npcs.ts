import * as THREE from 'three';
import { ALLEY, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';

/**
 * NPC pedestrians — low-poly figures that stroll up and down the alley.
 *
 * Each NPC is a small jointed rig composed from primitives (tapered coat
 * cylinder, shoulder pads, sphere head on a neck, tube limbs) posed by a
 * procedural walk cycle. Variants carry umbrellas or bags, wear hoods or
 * hats, and have layered clothing (coat over shirt, collar, coat skirt).
 * They wander along the alley spine with a per-agent lateral offset, turn
 * around at the ends, and cast a faint warm rim from a shared "street
 * spill" emissive so they don't read as black cutouts.
 * Deterministic: all seeds come from ctx.rng.
 */

interface NpcAgent {
  root: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  head: THREE.Group;
  /** base head height (for walk bob) */
  headY: number;
  /** right arm is locked raised holding an umbrella */
  umbrella: boolean;
  /** world z position along the alley spine */
  z: number;
  /** +1 walking toward the T, -1 walking back to the entrance */
  dir: 1 | -1;
  /** lateral offset from the alley centre line */
  lane: number;
  /** metres per second */
  speed: number;
  /** walk-cycle phase accumulator */
  phase: number;
  /** seconds until the next idle pause (0 = walking) */
  pauseTimer: number;
  paused: boolean;
}

const COAT_COLORS = [0x3a4a5c, 0x5c3a4a, 0x2e4a3a, 0x4a4a30, 0x38304e, 0x503828];
const SHIRT_COLORS = [0x8a8f96, 0x6e5a4a, 0x4a5e6e, 0x7a6a8a, 0x96503a];
const SKIN_COLORS = [0xc9a184, 0xa87b5e, 0x8a6248, 0xd9b294];
const HAIR_COLORS = [0x14100c, 0x2a1e14, 0x3a2e22, 0x0e1418];
const UMBRELLA_COLORS = [0x8a2a3a, 0x2a4a8a, 0x3a6a4a, 0x6a3a7a, 0xb06a2a];
const BAG_COLORS = [0x4a3421, 0x2a2a30, 0x5c4a2e, 0x3a2e3e];

export function buildFigure(rng: () => number): Omit<NpcAgent, 'z' | 'dir' | 'lane' | 'speed' | 'phase' | 'pauseTimer' | 'paused'> {
  const root = new THREE.Group();
  root.name = 'npc';

  const coat = makeToon({ color: COAT_COLORS[Math.floor(rng() * COAT_COLORS.length)]! });
  const shirt = makeToon({ color: SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)]! });
  const skin = makeToon({ color: SKIN_COLORS[Math.floor(rng() * SKIN_COLORS.length)]! });
  const hair = makeToon({ color: HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)]! });
  const dark = makeToon({ color: 0x14181e });

  // Variant rolls (drawn in a fixed order to stay deterministic).
  const hasUmbrella = rng() < 0.3;
  const hasBag = !hasUmbrella && rng() < 0.45;
  const headgear = rng(); // <0.33 hood, <0.66 hat, else hair
  const longCoat = rng() < 0.5;

  // --- Legs: tapered tubes (thigh->ankle) + shoes, pivot at the hip. ---
  const legGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.72, 6).translate(0, -0.36, 0);
  const shoeGeo = new THREE.BoxGeometry(0.1, 0.07, 0.2).translate(0, -0.735, 0.04);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.09, 0.78, 0);
  legL.add(new THREE.Mesh(shoeGeo, dark));
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.09, 0.78, 0);
  legR.add(new THREE.Mesh(shoeGeo, dark));
  root.add(legL, legR);

  // --- Coat: tapered cylinder, flaring at the hem; long coats get a skirt. ---
  const hipY = 0.78;
  const shoulderY = 1.32;
  const torsoH = shoulderY - hipY;
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.19, torsoH, 8),
    coat,
  );
  torso.position.y = hipY + torsoH / 2;
  root.add(torso);

  if (longCoat) {
    // Coat skirt: open cone flaring over the thighs.
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.26, 0.42, 8, 1, true),
      coat,
    );
    skirt.position.y = hipY - 0.18;
    root.add(skirt);
  }

  // Inner shirt layer: slimmer tube peeking above the coat neckline.
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), shirt);
  chest.position.y = shoulderY + 0.02;
  root.add(chest);

  // Shoulders: two rounded pads wider than the torso.
  const shoulderGeo = new THREE.SphereGeometry(0.085, 8, 6);
  const padL = new THREE.Mesh(shoulderGeo, coat);
  padL.position.set(-0.19, shoulderY, 0);
  const padR = new THREE.Mesh(shoulderGeo, coat);
  padR.position.set(0.19, shoulderY, 0);
  root.add(padL, padR);

  // Collar: short open ring around the neck line.
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.13, 0.07, 8, 1, true),
    coat,
  );
  collar.position.y = shoulderY + 0.1;
  root.add(collar);

  // --- Head group: neck + sphere head + hair/hood/hat. ---
  const head = new THREE.Group();
  const headY = shoulderY + 0.2;
  head.position.y = headY;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 6), skin);
  neck.position.y = -0.08;
  head.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), skin);
  skull.scale.y = 1.15;
  head.add(skull);

  if (headgear < 0.33) {
    // Hood: cone draped over the head, in the coat colour.
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.24, 8), coat);
    hood.position.y = 0.08;
    head.add(hood);
  } else if (headgear < 0.66) {
    // Hat: brim disc + crown cylinder.
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 10), dark);
    brim.position.y = 0.07;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.12, 8), dark);
    crown.position.y = 0.13;
    head.add(brim, crown);
  } else {
    // Hair cap: squashed sphere over the back/top of the skull.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), hair);
    cap.scale.set(1.02, 0.85, 1.02);
    cap.position.set(0, 0.045, -0.015);
    head.add(cap);
  }
  root.add(head);

  // --- Arms: sleeve tubes + mitten hands, pivot at the shoulder. ---
  const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.55, 6).translate(0, -0.275, 0);
  const handGeo = new THREE.SphereGeometry(0.05, 6, 5).translate(0, -0.56, 0);
  const armL = new THREE.Mesh(armGeo, coat);
  armL.position.set(-0.21, shoulderY - 0.02, 0);
  armL.add(new THREE.Mesh(handGeo, skin));
  const armR = new THREE.Mesh(armGeo, coat);
  armR.position.set(0.21, shoulderY - 0.02, 0);
  armR.add(new THREE.Mesh(handGeo, skin));
  root.add(armL, armR);

  // --- Props ---
  if (hasUmbrella) {
    const umb = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.22, 8),
      makeToon({ color: UMBRELLA_COLORS[Math.floor(rng() * UMBRELLA_COLORS.length)]! }),
    );
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), dark);
    tip.position.y = 0.16;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.95, 5), dark);
    shaft.position.y = -0.5;
    umb.add(canopy, tip, shaft);
    // Held above the head by the raised right arm.
    umb.position.set(0.21, headY + 0.62, 0.06);
    root.add(umb);
    armR.rotation.x = -2.35; // bent up, forearm toward the shaft
  } else if (hasBag) {
    // Briefcase/bag hanging from the right hand — child of the arm so it
    // swings naturally with the walk cycle.
    const bagMat = makeToon({ color: BAG_COLORS[Math.floor(rng() * BAG_COLORS.length)]! });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.09), bagMat);
    bag.position.set(0, -0.72, 0);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 8, Math.PI), dark);
    handle.position.set(0, -0.6, 0);
    armR.add(bag, handle);
  }

  // Faint warm rim plate under the feet: grounds the figure in the light pools.
  const rim = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 12),
    makeEmissiveToon({ color: 0x1a1210, emissive: 0xff8a4d, emissiveIntensity: 0.35 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  root.add(rim);

  return { root, legL, legR, armL, armR, head, headY, umbrella: hasUmbrella };
}

export function buildNpcs(ctx: AlleyContext): BuiltPart {
  const { rng } = ctx;
  const group = new THREE.Group();
  group.name = 'npcs';

  const agents: NpcAgent[] = [];
  const COUNT = 5;
  // Distinct, evenly-spread home lanes so NPCs don't converge on the same
  // path. Each gets a fixed lane across the (now wider) alley with jitter.
  const laneSlots = [-0.72, -0.36, 0.0, 0.36, 0.72].map(
    (f) => f * (ALLEY.halfWidth - 1.0),
  );
  // Shuffle the slots deterministically.
  for (let i = laneSlots.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [laneSlots[i], laneSlots[j]] = [laneSlots[j]!, laneSlots[i]!];
  }
  for (let i = 0; i < COUNT; i++) {
    const fig = buildFigure(rng);
    // Per-agent height/build variation so the crowd doesn't look cloned.
    const scale = 0.92 + rng() * 0.2;
    fig.root.scale.setScalar(scale);
    const agent: NpcAgent = {
      ...fig,
      z: 6 + rng() * (ALLEY.length - 14),
      dir: rng() < 0.5 ? 1 : -1,
      lane: laneSlots[i]! + (rng() - 0.5) * 0.3,
      speed: 0.7 + rng() * 0.7,
      phase: rng() * Math.PI * 2,
      pauseTimer: 0,
      paused: false,
    };
    agent.root.position.set(agent.lane, 0, agent.z);
    group.add(agent.root);
    agents.push(agent);
  }

  const update = (dt: number, t: number) => {
    for (const a of agents) {
      // Occasional idle pause (window-shopping).
      if (!a.paused && rng() < dt * 0.02) {
        a.paused = true;
        a.pauseTimer = 1.5 + rng() * 3;
      }
      if (a.paused) {
        a.pauseTimer -= dt;
        if (a.pauseTimer <= 0) a.paused = false;
      }

      if (!a.paused) {
        a.z += a.dir * a.speed * dt;
        a.phase += dt * a.speed * 4.4;
        // Bounce around the ends of the walkable stretch.
        if (a.z > ALLEY.length - 5) { a.z = ALLEY.length - 5; a.dir = -1; }
        if (a.z < 5) { a.z = 5; a.dir = 1; }
        // Very gentle lane drift around the home lane (kept small so the
        // distinct lanes never merge into one overlapping file).
        a.lane += Math.sin(t * 0.1 + a.phase * 0.05) * dt * 0.06;
        a.lane = THREE.MathUtils.clamp(a.lane, -ALLEY.halfWidth + 1.0, ALLEY.halfWidth - 1.0);
      }

      a.root.position.set(a.lane, 0, a.z);
      a.root.rotation.y = a.dir > 0 ? 0 : Math.PI;

      // Walk cycle: legs/arms swing opposite, slight head bob.
      const swing = a.paused ? 0 : Math.sin(a.phase) * 0.55;
      a.legL.rotation.x = swing;
      a.legR.rotation.x = -swing;
      a.armL.rotation.x = -swing * 0.8;
      // Umbrella arm stays raised; otherwise swing the right arm too.
      if (!a.umbrella) a.armR.rotation.x = swing * 0.8;
      a.head.position.y = a.headY + (a.paused ? 0 : Math.abs(Math.sin(a.phase)) * 0.02);
      // Idle sway when paused.
      if (a.paused) {
        a.root.rotation.y += Math.sin(t * 0.6 + a.phase) * 0.15;
        a.armL.rotation.x = Math.sin(t * 0.8 + a.phase) * 0.05;
        if (!a.umbrella) a.armR.rotation.x = -Math.sin(t * 0.8 + a.phase) * 0.05;
      }
    }
  };

  return { group, update };
}
