import * as THREE from 'three';
import { ALLEY, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';

/**
 * NPC pedestrians — low-poly figures that stroll up and down the alley.
 *
 * Each NPC is a small jointed rig (torso, head, two arms, two legs) posed
 * by a procedural walk cycle. They wander along the alley spine with a
 * per-agent lateral offset, turn around at the ends, and cast a faint
 * warm rim from a shared "street spill" emissive so they don't read as
 * black cutouts. Deterministic: all seeds come from ctx.rng.
 */

interface NpcAgent {
  root: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  head: THREE.Mesh;
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
const SKIN_COLORS = [0xc9a184, 0xa87b5e, 0x8a6248, 0xd9b294];
const HAIR_COLORS = [0x14100c, 0x2a1e14, 0x3a2e22, 0x0e1418];

function buildFigure(rng: () => number): Omit<NpcAgent, 'z' | 'dir' | 'lane' | 'speed' | 'phase' | 'pauseTimer' | 'paused'> {
  const root = new THREE.Group();
  root.name = 'npc';

  const coat = makeToon({ color: COAT_COLORS[Math.floor(rng() * COAT_COLORS.length)]! });
  const skin = makeToon({ color: SKIN_COLORS[Math.floor(rng() * SKIN_COLORS.length)]! });
  const hair = makeToon({ color: HAIR_COLORS[Math.floor(rng() * HAIR_COLORS.length)]! });
  const dark = makeToon({ color: 0x14181e });

  // Torso: slightly tapered box.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.2), coat);
  torso.position.y = 1.06;
  root.add(torso);

  // Head + hair cap.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.2), skin);
  head.position.y = 1.46;
  root.add(head);
  const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.09, 0.21), hair);
  hairCap.position.y = 1.56;
  root.add(hairCap);

  // Legs pivot at the hip (geometry translated so origin = pivot).
  const legGeo = new THREE.BoxGeometry(0.13, 0.8, 0.15).translate(0, -0.4, 0);
  const legL = new THREE.Mesh(legGeo, dark);
  legL.position.set(-0.09, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, dark);
  legR.position.set(0.09, 0.8, 0);
  root.add(legL, legR);

  // Arms pivot at the shoulder.
  const armGeo = new THREE.BoxGeometry(0.09, 0.58, 0.1).translate(0, -0.29, 0);
  const armL = new THREE.Mesh(armGeo, coat);
  armL.position.set(-0.22, 1.28, 0);
  const armR = new THREE.Mesh(armGeo, coat);
  armR.position.set(0.22, 1.28, 0);
  root.add(armL, armR);

  // Faint warm rim plate under the feet: grounds the figure in the light pools.
  const rim = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 12),
    makeEmissiveToon({ color: 0x1a1210, emissive: 0xff8a4d, emissiveIntensity: 0.35 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  root.add(rim);

  return { root, legL, legR, armL, armR, head };
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
      a.armR.rotation.x = swing * 0.8;
      a.head.position.y = 1.46 + (a.paused ? 0 : Math.abs(Math.sin(a.phase)) * 0.02);
      // Idle sway when paused.
      if (a.paused) {
        a.root.rotation.y += Math.sin(t * 0.6 + a.phase) * 0.15;
        a.armL.rotation.x = Math.sin(t * 0.8 + a.phase) * 0.05;
        a.armR.rotation.x = -Math.sin(t * 0.8 + a.phase) * 0.05;
      }
    }
  };

  return { group, update };
}
