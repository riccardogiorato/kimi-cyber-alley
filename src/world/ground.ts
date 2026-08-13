import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon } from '../core/toon';
import { makeAsphaltTileTexture, makeSmearOverlayTexture } from '../core/textures';

export interface GroundOptions {
  /** Where sign light pools hit the ground — reflection smears get painted here. */
  lightPools: { x: number; z: number; color: number; width: number }[];
}

/** hex color + alpha -> rgba() string for canvas gradients. */
function hexA(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Sharp "mirror" streak texture: one elongated vertical reflection per light
 * pool, with a hot narrow core — the puddle-gloss layer that sits on top of
 * the soft wide smears. Painted here (not in textures.ts) so the puddle look
 * stays owned by the ground module.
 */
function makePuddleStreakTexture(
  rng: () => number,
  lightPools: GroundOptions['lightPools'],
): THREE.CanvasTexture {
  const W = 1024;
  const H = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ground.ts: 2D canvas context unavailable');
  const u = (x: number) => ((x + ALLEY.halfWidth) / (ALLEY.halfWidth * 2)) * W;
  const v = (z: number) => (z / ALLEY.length) * H;
  const sx = W / (ALLEY.halfWidth * 2);
  const sz = H / ALLEY.length;

  ctx.globalCompositeOperation = 'lighter';
  for (const p of lightPools) {
    const color = `#${p.color.toString(16).padStart(6, '0')}`;
    const cx = u(p.x);
    const cy = v(p.z);
    const wPx = Math.max(6, p.width * 0.5 * sx);
    const lPx = Math.max(40, p.width * 6 * sz);

    // Long, tight vertical streak — mirror-like column of color.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, lPx / wPx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, wPx * 0.5);
    g.addColorStop(0, hexA(color, 0.42));
    g.addColorStop(0.3, hexA(color, 0.2));
    g.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, wPx * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // White-hot core line so the reflection reads as a sharp mirrored tube.
    ctx.save();
    const core = ctx.createLinearGradient(0, cy - lPx * 0.5, 0, cy + lPx * 0.5);
    core.addColorStop(0, hexA('#ffffff', 0));
    core.addColorStop(0.35, hexA('#ffffff', 0.32));
    core.addColorStop(0.5, hexA(color, 0.45));
    core.addColorStop(0.65, hexA('#ffffff', 0.32));
    core.addColorStop(1, hexA('#ffffff', 0));
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(2, wPx * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + (rng() - 0.5) * 3, cy - lPx * 0.5);
    ctx.lineTo(cx + (rng() - 0.5) * 3, cy + lPx * 0.5);
    ctx.stroke();
    ctx.restore();

    // A few broken horizontal ripple gaps so the streak feels wet, not solid.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      const ry = cy - lPx * 0.45 + rng() * lPx * 0.9;
      ctx.globalAlpha = 0.25 + rng() * 0.3;
      ctx.fillRect(cx - wPx * 0.6, ry, wPx * 1.2, 1 + rng() * 3);
    }
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Irregular puddle blob: dark glossy patch with a deterministic wobbled rim.
 * Sits just above the asphalt; the sharp streak overlay lands on top of it.
 */
function makePuddleMesh(rng: () => number, radius: number): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = radius * (0.65 + rng() * 0.45);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const shape = new THREE.Shape(pts);
  const geo = new THREE.ShapeGeometry(shape);
  const mat = makeToon({ color: 0x0a0f14, gradientSteps: 2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/**
 * Wet asphalt ground for the main alley + T-junction cross alley.
 * Wetness is faked: darker glossier toon ramp + neon smears painted into the texture.
 */
export function buildGround(ctx: AlleyContext, opts: GroundOptions): BuiltPart {
  const group = new THREE.Group();
  group.name = 'ground';

  // Base asphalt: a small SEAMLESS tile repeated down the alley so the
  // texture never stretches. One tile covers ~TILE_WORLD metres of ground.
  const TILE_WORLD = 2.5;
  const mainW = ALLEY.halfWidth * 2 + 0.4;
  const mainLen = ALLEY.length + 0.4;
  const tex = makeAsphaltTileTexture({ rng: ctx.rng });
  tex.anisotropy = 16;
  tex.repeat.set(mainW / TILE_WORLD, mainLen / TILE_WORLD);

  const mat = makeToon({
    color: 0xffffff,
    map: tex,
    gradientSteps: 3,
  });

  // Main alley floor: texture v runs along the alley length.
  const mainGeo = new THREE.PlaneGeometry(mainW, mainLen);
  const main = new THREE.Mesh(mainGeo, mat);
  main.rotation.x = -Math.PI / 2;
  main.position.set(0, 0, ALLEY.length / 2);
  group.add(main);

  // Neon reflection smears: a separate transparent overlay so the base tile
  // can repeat freely while smears stay pinned to their sign positions.
  const smearTex = makeSmearOverlayTexture(ctx.rng, { lightPools: opts.lightPools });
  const smearMat = new THREE.MeshBasicMaterial({
    map: smearTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const smear = new THREE.Mesh(new THREE.PlaneGeometry(mainW, mainLen), smearMat);
  smear.rotation.x = -Math.PI / 2;
  smear.position.set(0, 0.012, ALLEY.length / 2);
  smear.renderOrder = 4;
  group.add(smear);

  // Puddles: dark glossy blobs under/near each sign light pool, carrying a
  // sharper mirror-like streak overlay so colored light paths run across the
  // asphalt. Deterministic placement from ctx.rng.
  for (const p of opts.lightPools) {
    const puddle = makePuddleMesh(ctx.rng, p.width * (0.55 + ctx.rng() * 0.3));
    // Stretch along the alley so puddles read as rain-film channels.
    puddle.scale.set(1, 1.6 + ctx.rng() * 0.9, 1);
    puddle.position.set(
      p.x + (ctx.rng() - 0.5) * 0.3,
      0.006,
      p.z + (ctx.rng() - 0.5) * 0.6,
    );
    group.add(puddle);
  }

  // Sharp mirror streaks on top of the puddles.
  const streakTex = makePuddleStreakTexture(ctx.rng, opts.lightPools);
  const streakMat = new THREE.MeshBasicMaterial({
    map: streakTex,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const streaks = new THREE.Mesh(new THREE.PlaneGeometry(mainW, mainLen), streakMat);
  streaks.rotation.x = -Math.PI / 2;
  streaks.position.set(0, 0.02, ALLEY.length / 2);
  streaks.renderOrder = 5;
  group.add(streaks);

  // Cross alley floor strip at the T (own tiled copy so repeat fits its size).
  const crossW = ALLEY.crossHalfWidth * 2 + 2;
  const crossL = ALLEY.crossWidth + 0.4;
  const crossTex = makeAsphaltTileTexture({ rng: ctx.rng });
  crossTex.repeat.set(crossW / TILE_WORLD, crossL / TILE_WORLD);
  const crossMat = makeToon({ color: 0xffffff, map: crossTex, gradientSteps: 3 });
  const crossGeo = new THREE.PlaneGeometry(crossW, crossL);
  const cross = new THREE.Mesh(crossGeo, crossMat);
  cross.rotation.x = -Math.PI / 2;
  cross.position.set(0, 0.001, ALLEY.length + ALLEY.crossWidth / 2);
  group.add(cross);

  // Curb lips along both walls — small bevel boxes, catches the light pools nicely.
  const curbMat = makeToon({ color: 0x2a3438, gradientSteps: 3 });
  const curbGeo = new THREE.BoxGeometry(0.12, 0.07, ALLEY.length);
  for (const side of [-1, 1]) {
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.position.set(side * (ALLEY.halfWidth - 0.06), 0.035, ALLEY.length / 2);
    group.add(curb);
  }

  // Drain channel down one side — a recessed dark strip with grate slots painted in the texture.
  const drainMat = makeToon({ color: 0x141c20, gradientSteps: 2 });
  const drain = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, ALLEY.length), drainMat);
  drain.position.set(-ALLEY.halfWidth + 0.32, 0.005, ALLEY.length / 2);
  group.add(drain);

  // The ground itself is walkable — no collider needed, but block the entrance behind spawn.
  addCollider(ctx, 0, 1, -0.2, ALLEY.halfWidth * 2 + 1, 2.4, 0.3);

  return { group };
}
