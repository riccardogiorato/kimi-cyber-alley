import * as THREE from 'three';
import { ALLEY, type AlleyContext, type BuiltPart } from '../core/types';

export interface RainGap {
  x: number;
  z: number;
  width: number;
}

export interface AtmosphereOptions {
  /** World-space steam sources (e.g. the noodle stand). Defaults to one warm emitter at z ≈ 36. */
  steamEmitters?: THREE.Vector3[];
  /** Gaps in the overhead tarps where light rain falls through. Defaults to 3 gaps. */
  rainGaps?: RainGap[];
}

/** Soft radial-gradient sprite, drawn once on an inline canvas — zero external assets. */
function makePuffTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.38)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface SteamEmitter {
  x: number;
  y: number;
  z: number;
  tint: THREE.Color;
  puffCount: number;
  baseScale: number;
  /** Scale grows to baseScale * (1 + grow) over one life. */
  grow: number;
  /** Metres risen over one life. */
  rise: number;
  /** Seconds per puff loop. */
  life: number;
  maxAlpha: number;
  /** Sideways drift amplitude, grows with age. */
  drift: number;
}

const STEAM_VERT = /* glsl */ `
attribute vec3 aOffset;
attribute float aScale;
attribute float aAlpha;
attribute vec3 aTint;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += position.xy * aScale; // camera-facing billboard
  gl_Position = projectionMatrix * mv;
}
`;

const STEAM_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vTint, a);
}
`;

/**
 * Volumetric light shaft: a tall quad, billboarded around Y only, so it keeps
 * its slant from any view direction. Alpha is a soft vertical beam profile
 * (bright up top where the light enters, dissolving toward the floor) with
 * slow procedural shimmer — cheap fake god-ray, no raymarching.
 */
const BEAM_VERT = /* glsl */ `
attribute float aPhase;
varying vec2 vUv;
varying float vPhase;
void main() {
  vUv = uv;
  vPhase = aPhase;
  // Cylindrical billboard that preserves the instance's slant: keep the
  // instance's Y axis (the beam direction), face the camera around it.
  vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 up = normalize((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float sx = length((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  float sy = length((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 toCam = normalize(cameraPosition - center);
  vec3 right = normalize(cross(up, toCam));
  vec3 world = center + right * position.x * sx + up * position.y * sy;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying float vPhase;
void main() {
  // Horizontal beam profile: soft edges, dense core.
  float x = abs(vUv.x - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 1.0, x);
  core *= core;
  // Vertical falloff: strong at the gap (top), fading out near the floor.
  float vert = smoothstep(0.0, 0.35, vUv.y) * (0.35 + 0.65 * vUv.y);
  // Slow drifting shimmer so the shaft feels like moving haze, not a plane.
  float shimmer = 0.75 + 0.25 * sin(uTime * 0.35 + vPhase * 6.2832 + vUv.y * 4.0);
  float a = core * vert * shimmer * uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uTint, a);
}
`;

const DUST_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aTint;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vAlpha = aAlpha;
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (180.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float a = (1.0 - smoothstep(0.4, 1.0, r)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint, a);
}
`;

/**
 * Particles & weather: steam/haze billboards, dripping pipes, light rain through tarp gaps.
 *
 * Draw-call budget (default options): 6 total
 *   1 — all steam/haze puffs (one instanced billboard mesh, custom shader)
 *   1 — all drip streaks (one LineSegments)
 *   1 — wet decals under drips (one InstancedMesh, static)
 *   3 — rain streaks (one LineSegments per tarp gap)
 *
 * update() performs zero per-frame allocations: all state lives in preallocated
 * typed arrays that are written straight into the GPU buffers.
 */
export function buildAtmosphere(ctx: AlleyContext, opts: AtmosphereOptions = {}): BuiltPart {
  const rng = ctx.rng;
  const group = new THREE.Group();
  group.name = 'atmosphere';

  // ------------------------------------------------------------------ steam
  const emitters: SteamEmitter[] = [];

  // Wall vents: 5 spots along the alley, alternating sides, low teal steam.
  const ventZ = [7, 19, 30, 46, 58];
  for (let i = 0; i < ventZ.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    emitters.push({
      x: side * (ALLEY.halfWidth - 0.25) + (rng() - 0.5) * 0.2,
      y: 0.3 + rng() * 2.4,
      z: (ventZ[i] ?? 10) + (rng() - 0.5) * 3,
      tint: new THREE.Color(0x9fe8dc), // teal, matches vent/ambient light
      puffCount: 4,
      baseScale: 0.45,
      grow: 2.2,
      rise: 1.7,
      life: 6 + rng() * 2,
      maxAlpha: 0.13,
      drift: 0.35,
    });
  }

  // Noodle stand: warm steam from the warmers.
  const standEmitters = opts.steamEmitters ?? [new THREE.Vector3(0.55, 1.15, 36)];
  for (const p of standEmitters) {
    emitters.push({
      x: p.x,
      y: p.y,
      z: p.z,
      tint: new THREE.Color(0xffd2a0), // warm lantern light
      puffCount: 5,
      baseScale: 0.28,
      grow: 2.6,
      rise: 1.9,
      life: 3.6 + rng() * 1.2,
      maxAlpha: 0.2,
      drift: 0.22,
    });
  }

  // T-junction haze bank: big, slow, pink-ish from the neon beyond.
  emitters.push({
    x: 0,
    y: 1.1,
    z: ALLEY.length + 0.9,
    tint: new THREE.Color(0xf0a8c8),
    puffCount: 8,
    baseScale: 2.2,
    grow: 1.6,
    rise: 1.3,
    life: 15,
    maxAlpha: 0.11,
    drift: 0.9,
  });

  // Drifting smog banks down the alley spine: alternate warm amber (near
  // lantern rows / stand) and cool teal (open stretches) so the fog itself
  // carries the warm/cool split. Very low alpha, very large, slow — reads
  // as volumetric smog catching the lights, not smoke.
  const smogBanks: { z: number; warm: boolean }[] = [
    { z: 14, warm: false },
    { z: 26, warm: true },
    { z: 38, warm: true },
    { z: 50, warm: false },
    { z: 62, warm: true },
  ];
  for (const b of smogBanks) {
    emitters.push({
      x: (rng() - 0.5) * 1.2,
      y: 1.6 + rng() * 1.6,
      z: b.z + (rng() - 0.5) * 3,
      tint: b.warm ? new THREE.Color(0xff9a58) : new THREE.Color(0x5ec8d8),
      puffCount: 6,
      baseScale: 2.6 + rng() * 1.4,
      grow: 1.5,
      rise: 0.5,
      life: 18 + rng() * 8,
      maxAlpha: 0.05 + rng() * 0.03,
      drift: 1.4,
    });
  }

  let puffCount = 0;
  for (const e of emitters) puffCount += e.puffCount;

  // Per-puff static state (structure of arrays).
  const puffEmitter = new Uint8Array(puffCount);
  const puffPhase = new Float32Array(puffCount);
  const puffJitterX = new Float32Array(puffCount);
  const puffJitterZ = new Float32Array(puffCount);

  const steamGeo = new THREE.InstancedBufferGeometry();
  {
    const quad = new THREE.PlaneGeometry(1, 1);
    steamGeo.setIndex(quad.getIndex());
    steamGeo.setAttribute('position', quad.getAttribute('position'));
    steamGeo.setAttribute('uv', quad.getAttribute('uv'));
  }
  steamGeo.instanceCount = puffCount;

  const aOffset = new THREE.InstancedBufferAttribute(new Float32Array(puffCount * 3), 3);
  const aScale = new THREE.InstancedBufferAttribute(new Float32Array(puffCount), 1);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(puffCount), 1);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(puffCount * 3), 3);
  aOffset.setUsage(THREE.DynamicDrawUsage);
  aScale.setUsage(THREE.DynamicDrawUsage);
  aAlpha.setUsage(THREE.DynamicDrawUsage);

  {
    let i = 0;
    for (let e = 0; e < emitters.length; e++) {
      const em = emitters[e];
      if (!em) continue;
      for (let p = 0; p < em.puffCount; p++, i++) {
        puffEmitter[i] = e;
        puffPhase[i] = rng();
        puffJitterX[i] = (rng() - 0.5) * 0.5;
        puffJitterZ[i] = (rng() - 0.5) * 0.5;
        aTint.setXYZ(i, em.tint.r, em.tint.g, em.tint.b);
      }
    }
  }
  steamGeo.setAttribute('aOffset', aOffset);
  steamGeo.setAttribute('aScale', aScale);
  steamGeo.setAttribute('aAlpha', aAlpha);
  steamGeo.setAttribute('aTint', aTint);

  const steamMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: makePuffTexture() } },
    vertexShader: STEAM_VERT,
    fragmentShader: STEAM_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending, // low alpha — humid haze, not smoke bombs
  });
  const steamMesh = new THREE.Mesh(steamGeo, steamMat);
  steamMesh.frustumCulled = false;
  steamMesh.renderOrder = 20;
  group.add(steamMesh);

  const offsetArr = aOffset.array as Float32Array;
  const scaleArr = aScale.array as Float32Array;
  const alphaArr = aAlpha.array as Float32Array;

  // ------------------------------------------------------------------ drips
  const DRIP_POINTS = 4;
  const DROPS_PER_POINT = 3;
  const dropCount = DRIP_POINTS * DROPS_PER_POINT;

  const dripX = new Float32Array(DRIP_POINTS);
  const dripY = new Float32Array(DRIP_POINTS);
  const dripZ = new Float32Array(DRIP_POINTS);
  for (let d = 0; d < DRIP_POINTS; d++) {
    const side = d % 2 === 0 ? 1 : -1;
    dripX[d] = side * (ALLEY.halfWidth - 0.15 - rng() * 0.35);
    dripY[d] = 2.2 + rng() * 1.6; // under pipes / AC units
    dripZ[d] = 6 + rng() * 56;
  }

  const dropPoint = new Uint8Array(dropCount);
  const dropSpeed = new Float32Array(dropCount);
  const dropFallTime = new Float32Array(dropCount);
  const dropPeriod = new Float32Array(dropCount);
  const dropPhase = new Float32Array(dropCount);
  for (let i = 0; i < dropCount; i++) {
    const p = Math.floor(i / DROPS_PER_POINT);
    dropPoint[i] = p;
    const y0 = dripY[p] ?? 3;
    const speed = 3.5 + rng() * 1.5;
    dropSpeed[i] = speed;
    dropFallTime[i] = y0 / speed;
    dropPeriod[i] = y0 / speed + 0.4 + rng() * 2.4; // seeded respawn pause
    dropPhase[i] = rng() * dropPeriod[i]!;
  }

  const dripGeo = new THREE.BufferGeometry();
  const dripPos = new THREE.BufferAttribute(new Float32Array(dropCount * 2 * 3), 3);
  const dripCol = new THREE.BufferAttribute(new Float32Array(dropCount * 2 * 3), 3);
  dripPos.setUsage(THREE.DynamicDrawUsage);
  dripCol.setUsage(THREE.DynamicDrawUsage);
  dripGeo.setAttribute('position', dripPos);
  dripGeo.setAttribute('color', dripCol);
  const dripMat = new THREE.LineBasicMaterial({
    vertexColors: true, // fade encoded as colour -> black under additive blending
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dripLines = new THREE.LineSegments(dripGeo, dripMat);
  dripLines.frustumCulled = false;
  dripLines.renderOrder = 21;
  group.add(dripLines);
  const dripPosArr = dripPos.array as Float32Array;
  const dripColArr = dripCol.array as Float32Array;

  // Wet decals: tiny dark circles on the ground under each drip point (static).
  const decalGeo = new THREE.CircleGeometry(1, 20);
  const decalMat = new THREE.MeshBasicMaterial({
    color: 0x060b0c,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const decals = new THREE.InstancedMesh(decalGeo, decalMat, DRIP_POINTS);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let d = 0; d < DRIP_POINTS; d++) {
      const r = 0.07 + rng() * 0.06;
      p.set(dripX[d] ?? 0, 0.006, dripZ[d] ?? 0);
      s.set(r, r, r);
      m.compose(p, q, s);
      decals.setMatrixAt(d, m);
    }
  }
  decals.renderOrder = 2;
  group.add(decals);

  // ------------------------------------------------------------------ rain
  const gaps: RainGap[] = opts.rainGaps ?? [
    { x: 0.4, z: 13, width: 1.8 },
    { x: -0.5, z: 32, width: 1.3 },
    { x: 0.1, z: 51, width: 2.0 },
  ];
  const SLANT = 0.16; // x drift per metre fallen
  const STREAKS_PER_GAP = 34;

  interface RainSystem {
    count: number;
    height: number;
    baseX: Float32Array;
    baseZ: Float32Array;
    speed: Float32Array;
    phase: Float32Array;
    len: Float32Array;
    bright: Float32Array;
    pos: Float32Array;
    col: Float32Array;
    posAttr: THREE.BufferAttribute;
    colAttr: THREE.BufferAttribute;
  }

  const rainSystems: RainSystem[] = [];
  for (const gap of gaps) {
    const count = STREAKS_PER_GAP;
    const height = 4.5 + rng() * 1.5; // 4–6m tall fall volume
    const sys: RainSystem = {
      count,
      height,
      baseX: new Float32Array(count),
      baseZ: new Float32Array(count),
      speed: new Float32Array(count),
      phase: new Float32Array(count),
      len: new Float32Array(count),
      bright: new Float32Array(count),
      pos: new Float32Array(count * 2 * 3),
      col: new Float32Array(count * 2 * 3),
      posAttr: null as unknown as THREE.BufferAttribute,
      colAttr: null as unknown as THREE.BufferAttribute,
    };
    for (let i = 0; i < count; i++) {
      sys.baseX[i] = gap.x + (rng() - 0.5) * gap.width;
      sys.baseZ[i] = gap.z + (rng() - 0.5) * 0.9;
      sys.speed[i] = 6 + rng() * 2.5;
      sys.phase[i] = rng() * height;
      sys.len[i] = 0.3 + rng() * 0.25;
      sys.bright[i] = 0.5 + rng() * 0.5;
    }
    const geo = new THREE.BufferGeometry();
    sys.posAttr = new THREE.BufferAttribute(sys.pos, 3).setUsage(THREE.DynamicDrawUsage);
    sys.colAttr = new THREE.BufferAttribute(sys.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', sys.posAttr);
    geo.setAttribute('color', sys.colAttr);
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending, // only reads against light
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 22;
    group.add(lines);
    rainSystems.push(sys);
  }

  // ------------------------------------------------------------------ beams
  // Volumetric god-ray shafts slanting down through the overhead gaps: one
  // wide soft additive shaft per rain gap (they're where the sky/lights open
  // up), plus a couple of accent shafts from the neon side signs. Tinted per
  // shaft so the warm/cool split of the alley carries into the air itself.
  interface BeamDef {
    x: number;
    z: number;
    topY: number;
    height: number;
    width: number;
    lean: number; // metres of x drift from top to bottom
    tint: THREE.Color;
    intensity: number;
  }
  const beamDefs: BeamDef[] = [];
  for (const gap of gaps) {
    beamDefs.push({
      x: gap.x,
      z: gap.z,
      topY: 6.2 + rng() * 0.8,
      height: 6.2 + rng() * 0.8,
      width: gap.width * (1.6 + rng() * 0.5),
      lean: 0.9 + rng() * 0.7,
      tint: new THREE.Color(0xbfe8e2), // cool skylight through the tarps
      intensity: 0.075 + rng() * 0.03,
    });
  }
  // Warm accent shafts: lantern row near the stand, pink neon near the T.
  beamDefs.push(
    {
      x: 0.9, z: 35.5, topY: 4.6, height: 4.6, width: 1.5,
      lean: 0.7, tint: new THREE.Color(0xffc27a), intensity: 0.085,
    },
    {
      x: -1.1, z: 62, topY: 5.4, height: 5.4, width: 2.2,
      lean: 1.1, tint: new THREE.Color(0xf08ac0), intensity: 0.07,
    },
  );

  // Bucket beams by tint so each bucket is one draw call with one uTint.
  const beamBuckets = new Map<number, BeamDef[]>();
  for (const b of beamDefs) {
    const key = b.tint.getHex();
    const arr = beamBuckets.get(key) ?? [];
    arr.push(b);
    beamBuckets.set(key, arr);
  }
  const beamMeshes: { mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial }[] = [];
  {
    // Rebuild geometry per bucket (instanceCount differs); cheap — few beams.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const defs of beamBuckets.values()) {
      const geo = new THREE.InstancedBufferGeometry();
      const quad = new THREE.PlaneGeometry(1, 1);
      quad.translate(0, 0.5, 0);
      geo.setIndex(quad.getIndex());
      geo.setAttribute('position', quad.getAttribute('position'));
      geo.setAttribute('uv', quad.getAttribute('uv'));
      const phases = new THREE.InstancedBufferAttribute(new Float32Array(defs.length), 1);
      for (let i = 0; i < defs.length; i++) phases.setX(i, rng());
      geo.setAttribute('aPhase', phases);
      geo.instanceCount = defs.length;
      const first = defs[0];
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTint: { value: first ? first.tint : new THREE.Color(0xffffff) },
          uTime: { value: 0 },
          uIntensity: { value: first ? first.intensity : 0.08 },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, defs.length);
      for (let i = 0; i < defs.length; i++) {
        const d = defs[i];
        if (!d) continue;
        // Slant the beam by leaning its top toward -x (matches rain SLANT).
        e.set(0, 0, Math.atan2(d.lean, d.height));
        q.setFromEuler(e);
        p.set(d.x + d.lean / 2, d.topY - d.height, d.z);
        s.set(d.width, Math.hypot(d.height, d.lean), 1);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.frustumCulled = false;
      mesh.renderOrder = 19; // under steam so haze softens the shafts
      group.add(mesh);
      beamMeshes.push({ mesh, mat });
    }
  }

  // ------------------------------------------------------------------ dust
  // Floating dust motes: tiny slow points drifting inside the light pools
  // under each beam. Deterministic drift: position is a pure function of t.
  const MOTES_PER_BEAM = 26;
  const moteCount = beamDefs.length * MOTES_PER_BEAM;
  const moteBase = new Float32Array(moteCount * 3);
  const moteSeed = new Float32Array(moteCount * 4); // phase, speed, radius, wobble
  const moteTint = new Float32Array(moteCount * 3);
  {
    let i = 0;
    for (const b of beamDefs) {
      for (let k = 0; k < MOTES_PER_BEAM; k++, i++) {
        const o = i * 3;
        moteBase[o] = b.x + (rng() - 0.5) * b.width * 0.9;
        moteBase[o + 1] = 0.25 + rng() * (b.topY - 1.0);
        moteBase[o + 2] = b.z + (rng() - 0.5) * 1.4;
        const so = i * 4;
        moteSeed[so] = rng() * Math.PI * 2;
        moteSeed[so + 1] = 0.05 + rng() * 0.12; // slow fall speed (m/s)
        moteSeed[so + 2] = 0.08 + rng() * 0.22; // horizontal drift radius
        moteSeed[so + 3] = 0.4 + rng() * 0.8; // wobble frequency
        moteTint[o] = b.tint.r;
        moteTint[o + 1] = b.tint.g;
        moteTint[o + 2] = b.tint.b;
      }
    }
  }
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new THREE.BufferAttribute(new Float32Array(moteCount * 3), 3);
  const dustSize = new THREE.BufferAttribute(new Float32Array(moteCount), 1);
  const dustAlpha = new THREE.BufferAttribute(new Float32Array(moteCount), 1);
  const dustTintAttr = new THREE.BufferAttribute(moteTint, 3);
  dustPos.setUsage(THREE.DynamicDrawUsage);
  dustAlpha.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < moteCount; i++) dustSize.setX(i, 0.008 + rng() * 0.014);
  dustGeo.setAttribute('position', dustPos);
  dustGeo.setAttribute('aSize', dustSize);
  dustGeo.setAttribute('aAlpha', dustAlpha);
  dustGeo.setAttribute('aTint', dustTintAttr);
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 23;
  group.add(dust);
  const dustPosArr = dustPos.array as Float32Array;
  const dustAlphaArr = dustAlpha.array as Float32Array;

  // ------------------------------------------------------------------ update
  const update = (dt: number, t: number): void => {
    void dt; // all motion is a deterministic function of elapsed t

    // Steam: slow rise, expand, fade loop — phase-offset per puff.
    for (let i = 0; i < puffCount; i++) {
      const em = emitters[puffEmitter[i] ?? 0];
      if (!em) continue;
      const phase = puffPhase[i] ?? 0;
      const age = (t / em.life + phase) % 1;
      const sway = Math.sin(t * 0.45 + phase * 6.2832) * em.drift * age;
      const o = i * 3;
      offsetArr[o] = em.x + (puffJitterX[i] ?? 0) + sway;
      offsetArr[o + 1] = em.y + age * em.rise;
      offsetArr[o + 2] = em.z + (puffJitterZ[i] ?? 0) + sway * 0.4;
      scaleArr[i] = em.baseScale * (1 + age * em.grow);
      alphaArr[i] = Math.sin(age * Math.PI) * em.maxAlpha;
    }
    aOffset.needsUpdate = true;
    aScale.needsUpdate = true;
    aAlpha.needsUpdate = true;

    // Drips: fall, splash-fade at the ground, respawn on a seeded period.
    for (let i = 0; i < dropCount; i++) {
      const p = dropPoint[i] ?? 0;
      const x = dripX[p] ?? 0;
      const y0 = dripY[p] ?? 3;
      const z = dripZ[p] ?? 0;
      const period = dropPeriod[i] ?? 1;
      const fallTime = dropFallTime[i] ?? 1;
      const age = (t + (dropPhase[i] ?? 0)) % period;
      const v = i * 6;
      let alpha = 0;
      let y = 0;
      let len = 0;
      if (age < fallTime) {
        const speed = dropSpeed[i] ?? 4;
        y = y0 - speed * age;
        len = Math.min(Math.max(speed * 0.035, 0.05), 0.16);
        alpha = y < 0.18 ? y / 0.18 : 1; // splash-fade
      }
      dripPosArr[v] = x;
      dripPosArr[v + 1] = Math.max(y, 0.01);
      dripPosArr[v + 2] = z;
      dripPosArr[v + 3] = x;
      dripPosArr[v + 4] = Math.max(y + len, 0.02);
      dripPosArr[v + 5] = z;
      const r = 0.45 * alpha;
      const g = 0.62 * alpha;
      const b = 0.66 * alpha;
      dripColArr[v] = r;
      dripColArr[v + 1] = g;
      dripColArr[v + 2] = b;
      dripColArr[v + 3] = r * 0.4;
      dripColArr[v + 4] = g * 0.4;
      dripColArr[v + 5] = b * 0.4;
    }
    dripPos.needsUpdate = true;
    dripCol.needsUpdate = true;

    // Rain: fast slanted streaks looping inside each gap's fall volume.
    for (const sys of rainSystems) {
      for (let i = 0; i < sys.count; i++) {
        const fall = (t * (sys.speed[i] ?? 7) + (sys.phase[i] ?? 0)) % sys.height;
        const y = sys.height - fall;
        const x = (sys.baseX[i] ?? 0) + SLANT * fall;
        const z = sys.baseZ[i] ?? 0;
        const len = sys.len[i] ?? 0.35;
        const fade = Math.sin((y / sys.height) * Math.PI) * 0.32 * (sys.bright[i] ?? 1);
        const v = i * 6;
        sys.pos[v] = x;
        sys.pos[v + 1] = y;
        sys.pos[v + 2] = z;
        sys.pos[v + 3] = x - SLANT * len;
        sys.pos[v + 4] = y + len;
        sys.pos[v + 5] = z;
        sys.col[v] = 0.55 * fade;
        sys.col[v + 1] = 0.75 * fade;
        sys.col[v + 2] = 0.78 * fade;
        sys.col[v + 3] = 0.55 * fade * 0.35;
        sys.col[v + 4] = 0.75 * fade * 0.35;
        sys.col[v + 5] = 0.78 * fade * 0.35;
      }
      sys.posAttr.needsUpdate = true;
      sys.colAttr.needsUpdate = true;
    }

    // Beams: only the shimmer clock animates (geometry is static).
    for (const b of beamMeshes) b.mat.uniforms.uTime!.value = t;

    // Dust: slow sink + gentle horizontal wobble, twinkling alpha. Pure
    // function of t and per-mote seeds — deterministic, no allocations.
    for (let i = 0; i < moteCount; i++) {
      const o = i * 3;
      const so = i * 4;
      const phase = moteSeed[so] ?? 0;
      const fall = moteSeed[so + 1] ?? 0.1;
      const radius = moteSeed[so + 2] ?? 0.1;
      const wobble = moteSeed[so + 3] ?? 0.6;
      const baseY = moteBase[o + 1] ?? 1;
      // Sink and wrap within a 3m band below the mote's base height.
      const span = 3.0;
      const f = (t * fall + phase) % span; // 0..span
      const y = baseY - f;
      dustPosArr[o] = (moteBase[o] ?? 0) + Math.sin(t * wobble + phase) * radius;
      dustPosArr[o + 1] = y;
      dustPosArr[o + 2] = (moteBase[o + 2] ?? 0) + Math.cos(t * wobble * 0.7 + phase * 1.7) * radius;
      // Twinkle + fade near the wrap seam so motes never pop.
      const seam = Math.sin((f / span) * Math.PI);
      const twinkle = 0.55 + 0.45 * Math.sin(t * (wobble * 2.2) + phase * 3.1);
      dustAlphaArr[i] = 0.5 * seam * twinkle;
    }
    dustPos.needsUpdate = true;
    dustAlpha.needsUpdate = true;
  };

  return { group, update };
}
