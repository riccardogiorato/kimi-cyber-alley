import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeEmissiveToon, makeToon } from '../core/toon';
import { flickerSignFrames, neonSignTexture } from '../core/textures';

/**
 * The signs ARE the lights. There is no sun in this alley: every major sign
 * owns a distance-limited PointLight that paints a coloured pool on the
 * opposite wall and the wet ground. `lightPools` is returned so the ground
 * texture painter can smear matching reflections under each sign.
 */

export interface LightPool {
  x: number;
  z: number;
  color: number;
  /** Smear width (metres) for the ground reflection painter. */
  width: number;
}

export interface SignsPart extends BuiltPart {
  lightPools: LightPool[];
}

type Rng = () => number;

const WALL = ALLEY.halfWidth; // walls at x = +/-1.8

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

/** Dark painted-steel toon for brackets, arms, back panels and housings. */
function steelMat(): THREE.MeshToonMaterial {
  return makeToon({ color: 0x23282e, gradientSteps: 2 });
}

/**
 * Perpendicular sign: double-sided emissive face on a back panel, hung from
 * a steel bracket arm that reaches out of the wall. `side` = wall it mounts
 * on (-1 = left wall, +1 = right wall); the sign protrudes toward x = 0.
 */
function perpendicularSign(opts: {
  side: -1 | 1;
  y: number;
  z: number;
  /** Face size: w = horizontal extent (along X), h = vertical. */
  w: number;
  h: number;
  texture: THREE.Texture;
  emissive: number;
  emissiveIntensity: number;
  /** How far the face centre sits off the wall. */
  standoff: number;
  steel: THREE.MeshToonMaterial;
}): { group: THREE.Group; faceMat: THREE.MeshToonMaterial } {
  const { side, y, z, w, h, texture, emissive, emissiveIntensity, standoff, steel } = opts;
  const g = new THREE.Group();

  const faceMat = makeEmissiveToon({
    color: 0x0a0a12,
    emissive,
    emissiveIntensity,
    map: texture,
  });
  faceMat.side = THREE.DoubleSide;

  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  face.rotation.y = Math.PI / 2; // plane normal -> +/-X, readable walking down the alley
  face.position.set(side * (WALL - standoff), y, z);
  g.add(face);

  // Opaque back panel so the sign has a body from behind.
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, h + 0.08, w + 0.08), steel);
  back.position.set(side * (WALL - standoff) + side * 0.045, y, z);
  g.add(back);

  // Bracket arm: horizontal bar from the wall to the sign top + a diagonal strut.
  const armLen = standoff + 0.1;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.06, 0.06), steel);
  arm.position.set(side * (WALL - armLen / 2), y + h / 2 + 0.12, z);
  g.add(arm);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(armLen * 0.9, 0.045, 0.045), steel);
  strut.position.set(side * (WALL - (armLen * 0.9) / 2), y + h / 2 + 0.42, z);
  strut.rotation.z = side * -0.5;
  g.add(strut);

  return { group: g, faceMat };
}

/** Flat wall-mounted sign (parallel to the wall). */
function wallSign(opts: {
  side: -1 | 1;
  y: number;
  z: number;
  w: number;
  h: number;
  texture: THREE.Texture;
  emissive: number;
  emissiveIntensity: number;
  /** Box depth off the wall. */
  depth?: number;
  steel: THREE.MeshToonMaterial;
}): { group: THREE.Group; faceMat: THREE.MeshToonMaterial } {
  const { side, y, z, w, h, texture, emissive, emissiveIntensity, steel } = opts;
  const depth = opts.depth ?? 0.1;
  const g = new THREE.Group();

  const faceMat = makeEmissiveToon({ color: 0x0a0a12, emissive, emissiveIntensity, map: texture });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  face.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // face into the alley
  face.position.set(side * (WALL - depth - 0.001), y, z);
  g.add(face);

  const housing = new THREE.Mesh(new THREE.BoxGeometry(depth, h + 0.06, w + 0.06), steel);
  housing.position.set(side * (WALL - depth / 2), y, z);
  g.add(housing);

  return { group: g, faceMat };
}

/** Coloured point light + its ground pool record. */
function signLight(
  group: THREE.Group,
  pools: LightPool[],
  opts: {
    x: number;
    y: number;
    z: number;
    color: number;
    intensity: number;
    distance: number;
    poolWidth: number;
    /** Ground projection of the pool (defaults to straight below the light). */
    poolX?: number;
    poolZ?: number;
  },
): THREE.PointLight {
  // Global dimmer: keeps neon pools moody (pool-of-light look) instead of
  // washing the whole alley in saturated color.
  const light = new THREE.PointLight(opts.color, opts.intensity * 0.62, opts.distance, 2);
  light.position.set(opts.x, opts.y, opts.z);
  group.add(light);
  pools.push({
    x: opts.poolX ?? opts.x,
    z: opts.poolZ ?? opts.z,
    color: opts.color,
    width: opts.poolWidth,
  });
  return light;
}

// ---------------------------------------------------------------------------
// Flicker / buzz animation state (all schedules precomputed from ctx.rng)
// ---------------------------------------------------------------------------

interface FlickerSign {
  kind: 'flicker';
  mat: THREE.MeshToonMaterial;
  frames: THREE.CanvasTexture[];
  light: THREE.PointLight;
  baseIntensity: number;
  baseEmissive: number;
  /** Precomputed timeline: [time, frameIndex, brightness] triples. */
  schedule: Float32Array;
  scheduleLen: number;
  period: number;
}

interface BuzzSign {
  kind: 'buzz';
  mat: THREE.MeshToonMaterial;
  light: THREE.PointLight;
  baseIntensity: number;
  baseEmissive: number;
  phase: number;
  speed: number;
}

type AnimatedSign = FlickerSign | BuzzSign;

/**
 * Build a deterministic dropout timeline for one flickering sign.
 * Each entry: start time (s), frame index, brightness multiplier.
 * Pattern: mostly full brightness, occasional dropouts / dim stutters.
 */
function buildFlickerSchedule(rng: Rng, frameCount: number): { schedule: Float32Array; len: number; period: number } {
  const entries: number[] = [];
  let t = 0;
  const period = 6 + rng() * 5; // loop every 6-11 s
  while (t < period) {
    // Long stable stretch on frame 0.
    const stable = 0.6 + rng() * 2.2;
    entries.push(t, 0, 1);
    t += stable;
    if (t >= period) break;
    // Dropout burst: 1-4 quick stutters across frames 1..n with dim brightness.
    const stutters = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < stutters && t < period; i++) {
      const dur = 0.04 + rng() * 0.14;
      const frame = 1 + Math.floor(rng() * (frameCount - 1));
      const bright = 0.15 + rng() * 0.45;
      entries.push(t, frame, bright);
      t += dur;
    }
  }
  return { schedule: Float32Array.from(entries), len: entries.length / 3, period };
}

// ---------------------------------------------------------------------------
// Main build
// ---------------------------------------------------------------------------

export function buildSigns(ctx: AlleyContext): SignsPart {
  const rng = ctx.rng;
  const group = new THREE.Group();
  group.name = 'signs';

  const pools: LightPool[] = [];
  const animated: AnimatedSign[] = [];
  const steel = steelMat();

  // --- 1. HUGE pink hotel sign, high up, perpendicular, double-sided --------
  {
    const tex = neonSignTexture(rng, { kind: 'hotel', variant: 0 });
    const { group: g, faceMat } = perpendicularSign({
      side: -1,
      y: 8.0,
      z: 12,
      w: 1.6,
      h: 4.6,
      texture: tex,
      emissive: 0xff2d95,
      emissiveIntensity: 2.4,
      standoff: 0.95,
      steel,
    });
    group.add(g);
    // Strong pink wash: hung between the sign and the opposite wall so it
    // bathes the right-hand wall and the ground below.
    const light = signLight(group, pools, {
      x: 0.2,
      y: 6.6,
      z: 12,
      color: 0xff2d95,
      intensity: 520,
      distance: 16,
      poolWidth: 2.6,
      poolX: 0.3,
      poolZ: 12,
    });
    // Mostly-stable buzz: tiny emissive/light wobble at mains-hum speed.
    animated.push({
      kind: 'buzz',
      mat: faceMat,
      light,
      baseIntensity: light.intensity,
      baseEmissive: faceMat.emissiveIntensity,
      phase: rng() * Math.PI * 2,
      speed: 46 + rng() * 8,
    });
  }

  // --- 2. Karaoke tube sign, mid-alley, opposite side -----------------------
  {
    const tex = neonSignTexture(rng, { kind: 'karaoke', variant: 0 });
    const { group: g } = perpendicularSign({
      side: 1,
      y: 4.1,
      z: 30,
      w: 1.1,
      h: 2.6,
      texture: tex,
      emissive: 0x51ff7a,
      emissiveIntensity: 2.0,
      standoff: 0.7,
      steel,
    });
    group.add(g);
    signLight(group, pools, {
      x: 0.9,
      y: 3.4,
      z: 30,
      color: 0x3dff6e,
      intensity: 230,
      distance: 10,
      poolWidth: 1.8,
      poolX: 0.5,
      poolZ: 30,
    });
  }

  // --- 3. "24時間営業" backlit lightbox by a recessed doorway ---------------
  {
    const tex = neonSignTexture(rng, { kind: 'lightbox24', variant: 0 });
    const { group: g } = perpendicularSign({
      side: 1,
      y: 2.7,
      z: 22,
      w: 0.85,
      h: 0.6,
      texture: tex,
      emissive: 0xeaf2ff,
      emissiveIntensity: 1.8,
      standoff: 0.55,
      steel,
    });
    group.add(g);
    signLight(group, pools, {
      x: 1.05,
      y: 2.3,
      z: 22,
      color: 0xdfeaff,
      intensity: 120,
      distance: 7,
      poolWidth: 1.3,
      poolX: 0.9,
      poolZ: 22,
    });
    // Protrudes into the walkway below head height -> collider.
    addCollider(ctx, WALL - 0.55, 2.7, 22, 1.1, 0.7, 0.95);
  }

  // --- 4. Round green 営業中 sign at the noodle stand (z ~= 35) -------------
  {
    const tex = neonSignTexture(rng, { kind: 'eigyochu', variant: 0 });
    const faceMat = makeEmissiveToon({ color: 0x0a0a12, emissive: 0x53ff8a, emissiveIntensity: 2.1, map: tex });
    faceMat.side = THREE.DoubleSide;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), faceMat);
    disc.rotation.y = Math.PI / 2;
    disc.position.set(-(WALL - 0.62), 3.1, 35);
    group.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 24), steel);
    rim.rotation.y = Math.PI / 2;
    rim.position.copy(disc.position);
    group.add(rim);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.05), steel);
    arm.position.set(-(WALL - 0.31), 3.52, 35);
    group.add(arm);
    signLight(group, pools, {
      x: -1.05,
      y: 2.7,
      z: 35,
      color: 0x49f27e,
      intensity: 160,
      distance: 8,
      poolWidth: 1.6,
      poolX: -0.9,
      poolZ: 35,
    });
  }

  // --- 5. Two vertical kanji sign towers ------------------------------------
  const towerSpecs = [
    { side: 1 as const, z: 44, yBase: 3.2, panels: 4, tint: 0xffb347 },
    { side: -1 as const, z: 55, yBase: 4.4, panels: 3, tint: 0xff5c5c },
  ];
  for (const spec of towerSpecs) {
    const tex = neonSignTexture(rng, { kind: 'kanjiTower', variant: spec.panels });
    const h = spec.panels * 0.72;
    const { group: g } = wallSign({
      side: spec.side,
      y: spec.yBase + h / 2,
      z: spec.z,
      w: 0.62,
      h,
      texture: tex,
      emissive: spec.tint,
      emissiveIntensity: 1.9,
      depth: 0.14,
      steel,
    });
    group.add(g);
    signLight(group, pools, {
      x: spec.side * (WALL - 0.55),
      y: spec.yBase + h / 2,
      z: spec.z,
      color: spec.tint,
      intensity: 150,
      distance: 8,
      poolWidth: 1.4,
      poolX: spec.side * (WALL - 0.8),
      poolZ: spec.z,
    });
  }

  // --- 6. Flickering animated signs -----------------------------------------
  const flickerSpecs: {
    text: string;
    color: string;
    sub?: string;
    side: -1 | 1;
    y: number;
    z: number;
    w: number;
    h: number;
    lightColor: number;
    lightIntensity: number;
    distance: number;
    poolWidth: number;
    perpendicular: boolean;
  }[] = [
    // Small red sign near the T-junction end.
    {
      text: '酒場',
      color: '#ff3b30',
      sub: 'SAKE BAR',
      side: 1,
      y: 3.4,
      z: 64,
      w: 0.9,
      h: 1.4,
      lightColor: 0xff3524,
      lightIntensity: 80,
      distance: 8,
      poolWidth: 1.5,
      perpendicular: true,
    },
    // Buzzing pink bar sign, low on the left wall.
    {
      text: 'バー',
      color: '#ff5ad0',
      sub: 'BAR',
      side: -1,
      y: 2.6,
      z: 47,
      w: 1.0,
      h: 0.55,
      lightColor: 0xff4fc3,
      lightIntensity: 55,
      distance: 6,
      poolWidth: 1.1,
      perpendicular: false,
    },
    // Cranky old yellow diner sign.
    {
      text: '食堂',
      color: '#ffd23f',
      sub: 'DINER',
      side: -1,
      y: 3.8,
      z: 18,
      w: 0.8,
      h: 1.2,
      lightColor: 0xffc93a,
      lightIntensity: 70,
      distance: 7,
      poolWidth: 1.2,
      perpendicular: true,
    },
    // --- Extra perpendicular neon to build the references' "tunnel of light" ---
    // Cyan pharmacy cross, high on the right.
    {
      text: '薬局',
      color: '#3fe0c8',
      sub: 'PHARMACY',
      side: 1,
      y: 4.6,
      z: 24,
      w: 0.85,
      h: 1.3,
      lightColor: 0x2fd8c0,
      lightIntensity: 75,
      distance: 7.5,
      poolWidth: 1.3,
      perpendicular: true,
    },
    // Orange karaoke box, mid-height on the left.
    {
      text: 'カラオケ',
      color: '#ff8c2a',
      sub: 'KARAOKE',
      side: -1,
      y: 5.2,
      z: 33,
      w: 0.75,
      h: 1.5,
      lightColor: 0xff7a1e,
      lightIntensity: 85,
      distance: 8,
      poolWidth: 1.4,
      perpendicular: true,
    },
    // Green "open 24h" lightbox, low on the right.
    {
      text: '24時',
      color: '#51ff7a',
      sub: 'OPEN',
      side: 1,
      y: 2.4,
      z: 40,
      w: 0.9,
      h: 0.6,
      lightColor: 0x3ff06a,
      lightIntensity: 55,
      distance: 6,
      poolWidth: 1.1,
      perpendicular: true,
    },
    // Violet host club sign, high on the left.
    {
      text: '夜想',
      color: '#b46bff',
      sub: 'CLUB NOCTURNE',
      side: -1,
      y: 6.0,
      z: 52,
      w: 0.8,
      h: 1.4,
      lightColor: 0xa55aff,
      lightIntensity: 80,
      distance: 8,
      poolWidth: 1.4,
      perpendicular: true,
    },
    // Warm red ramen lantern-sign, mid on the right.
    {
      text: 'ラーメン',
      color: '#ff4a3c',
      sub: 'RAMEN',
      side: 1,
      y: 3.0,
      z: 12,
      w: 0.7,
      h: 1.3,
      lightColor: 0xff3826,
      lightIntensity: 70,
      distance: 7,
      poolWidth: 1.2,
      perpendicular: true,
    },
  ];
  for (const spec of flickerSpecs) {
    const frames = flickerSignFrames(rng, { text: spec.text, color: spec.color, sub: spec.sub });
    const first = frames[0];
    if (!first) continue;
    let faceMat: THREE.MeshToonMaterial;
    if (spec.perpendicular) {
      const built = perpendicularSign({
        side: spec.side,
        y: spec.y,
        z: spec.z,
        w: spec.w,
        h: spec.h,
        texture: first,
        emissive: new THREE.Color(spec.color).getHex(),
        emissiveIntensity: 2.0,
        standoff: 0.6,
        steel,
      });
      group.add(built.group);
      faceMat = built.faceMat;
    } else {
      const built = wallSign({
        side: spec.side,
        y: spec.y,
        z: spec.z,
        w: spec.w,
        h: spec.h,
        texture: first,
        emissive: new THREE.Color(spec.color).getHex(),
        emissiveIntensity: 2.0,
        steel,
      });
      group.add(built.group);
      faceMat = built.faceMat;
    }
    const light = signLight(group, pools, {
      x: spec.side * (WALL - 0.75),
      y: spec.y - 0.2,
      z: spec.z,
      color: spec.lightColor,
      intensity: spec.lightIntensity,
      distance: spec.distance,
      poolWidth: spec.poolWidth,
      poolX: spec.side * (WALL - 1.0),
      poolZ: spec.z,
    });
    const { schedule, len, period } = buildFlickerSchedule(rng, frames.length);
    animated.push({
      kind: 'flicker',
      mat: faceMat,
      frames,
      light,
      baseIntensity: light.intensity,
      baseEmissive: faceMat.emissiveIntensity,
      schedule,
      scheduleLen: len,
      period,
    });
    // Low perpendicular flicker signs protrude into the walkway.
    if (spec.perpendicular && spec.y - spec.h / 2 < 2.2) {
      addCollider(ctx, spec.side * (WALL - 0.6), spec.y, spec.z, 1.2, spec.h + 0.1, spec.w + 0.1);
    }
  }

  // --- 7. Distant cyan sign across the T-junction ---------------------------
  {
    const tex = neonSignTexture(rng, { kind: 'hotel', variant: 2 });
    const faceMat = makeEmissiveToon({ color: 0x0a0a12, emissive: 0x38d6ff, emissiveIntensity: 2.2, map: tex });
    const zc = ALLEY.length + ALLEY.crossWidth; // far wall of the cross alley
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.4), faceMat);
    face.rotation.y = Math.PI; // faces back down the alley (-Z)
    face.position.set(2.6, 5.4, zc - 0.15);
    group.add(face);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.5, 0.12), steel);
    housing.position.set(2.6, 5.4, zc - 0.06);
    group.add(housing);
    signLight(group, pools, {
      x: 2.6,
      y: 4.6,
      z: zc - 0.9,
      color: 0x2fc8ff,
      intensity: 190,
      distance: 12,
      poolWidth: 2.0,
      poolX: 2.4,
      poolZ: zc - 1.2,
    });
  }

  // --- 8. Small extras: marker lamps, EXIT plate, doorbell glows ------------
  {
    // Tiny wall marker lamps (emissive only, no dedicated lights).
    const lampMat = makeEmissiveToon({ color: 0x0a0a12, emissive: 0xffa64d, emissiveIntensity: 1.7 });
    const lampGeo = new THREE.BoxGeometry(0.07, 0.16, 0.1);
    const lampSpots: { side: -1 | 1; y: number; z: number }[] = [
      { side: 1, y: 2.1, z: 8 },
      { side: -1, y: 2.1, z: 26 },
      { side: 1, y: 2.1, z: 58 },
    ];
    for (const s of lampSpots) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(s.side * (WALL - 0.06), s.y, s.z);
      group.add(lamp);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.14), steel);
      hood.position.set(s.side * (WALL - 0.06), s.y + 0.1, s.z);
      group.add(hood);
    }

    // EXIT-ish plate over the cross-alley mouth — flat green plate, own small light.
    const exitMat = makeEmissiveToon({ color: 0x0a0a12, emissive: 0x3dff88, emissiveIntensity: 1.9 });
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.22), exitMat);
    exit.position.set(-1.2, 2.6, ALLEY.length - 0.4);
    exit.rotation.y = Math.PI; // readable walking toward the T
    group.add(exit);
    const exitBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.27, 0.06), steel);
    exitBox.position.set(-1.2, 2.6, ALLEY.length - 0.36);
    group.add(exitBox);
    signLight(group, pools, {
      x: -1.2,
      y: 2.4,
      z: ALLEY.length - 0.8,
      color: 0x35e87e,
      intensity: 45,
      distance: 5,
      poolWidth: 0.8,
      poolX: -1.2,
      poolZ: ALLEY.length - 0.9,
    });

    // Doorbell-glow buttons beside doorways — pinprick warm LEDs.
    const bellMat = makeEmissiveToon({ color: 0x0a0a12, emissive: 0xffd9a0, emissiveIntensity: 2.2 });
    const bellGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 10);
    const bellSpots: { side: -1 | 1; z: number }[] = [
      { side: 1, z: 21.4 },
      { side: 1, z: 22.6 },
      { side: -1, z: 46.6 },
    ];
    for (const s of bellSpots) {
      const bell = new THREE.Mesh(bellGeo, bellMat);
      bell.rotation.z = Math.PI / 2;
      bell.position.set(s.side * (WALL - 0.03), 1.45, s.z);
      group.add(bell);
    }
  }

  // --- Animation loop --------------------------------------------------------
  // Zero per-frame allocation: schedules are precomputed Float32Arrays and
  // the flicker state machine only walks an index.
  const cursor = new Int32Array(animated.length);

  const update = (_dt: number, t: number): void => {
    for (let i = 0; i < animated.length; i++) {
      const a = animated[i]!;
      if (a.kind === 'buzz') {
        // Mains-hum wobble: two sines so it never looks metronomic.
        const w =
          1 +
          0.045 * Math.sin(t * a.speed + a.phase) +
          0.02 * Math.sin(t * a.speed * 0.37 + a.phase * 1.7);
        a.mat.emissiveIntensity = a.baseEmissive * w;
        a.light.intensity = a.baseIntensity * w;
      } else {
        const local = t % a.period;
        // Advance the cursor while the next schedule entry is due.
        let c = cursor[i]!;
        // Wrap: if local time went backwards (loop), restart the cursor.
        const prevT = a.schedule[c * 3]!;
        if (local < prevT) c = 0;
        while (c + 1 < a.scheduleLen && a.schedule[(c + 1) * 3]! <= local) c++;
        cursor[i] = c;
        const frame = a.schedule[c * 3 + 1]!;
        const bright = a.schedule[c * 3 + 2]!;
        const tex = a.frames[frame];
        if (tex && a.mat.map !== tex) a.mat.map = tex;
        a.mat.emissiveIntensity = a.baseEmissive * bright;
        a.light.intensity = a.baseIntensity * bright;
      }
    }
  };

  return { group, update, lightPools: pools };
}
