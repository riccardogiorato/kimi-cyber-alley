import * as THREE from 'three';
import { ALLEY, mulberry32, type AlleyContext, type BuiltPart } from './core/types';
import { InkPipeline } from './core/post';
import { PlayerController } from './core/player';
import { buildGround } from './world/ground';
import { buildFacades } from './world/facades';
import { buildOverhead } from './world/overhead';
import { buildSigns } from './world/signs';
import { buildNoodleStand } from './world/noodleStand';
import { buildProps } from './world/props';
import { buildAtmosphere } from './world/atmosphere';
import { buildNpcs } from './world/npcs';
import { buildTraffic } from './world/traffic';
import { setHullResolution } from './world/props';
import { makeSkyTexture } from './core/textures';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); // supersampling is handled by the ink pipeline
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // grade pass owns the final look
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Late-night sky: gradient dome texture + a real starfield so stars stay crisp.
scene.background = makeSkyTexture();
scene.fog = new THREE.FogExp2(0x141f2e, 0.032);

// Starfield + milky way as geometry (Points) — a background texture alone
// blurs 1px stars away; point sprites keep them sharp at any resolution.
{
  const starRng = mulberry32(0x57a2);
  const N = 900;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const R = 90;
  for (let i = 0; i < N; i++) {
    // upper hemisphere dome
    const t = starRng() * Math.PI * 2;
    const elev = Math.asin(0.06 + starRng() * 0.94); // mostly above the roofline
    const r = R * (0.9 + starRng() * 0.1);
    let x = Math.cos(t) * Math.cos(elev) * r;
    let y = Math.sin(elev) * r;
    let z = Math.sin(t) * Math.cos(elev) * r;
    // milky way: pull a third of the stars toward a tilted band
    let brightness = 0.35 + starRng() * 0.65;
    if (i % 3 === 0) {
      const along = (starRng() * 2 - 1) * R;
      const off = (starRng() + starRng() - 1) * 22;
      x = along * 0.8 - off * 0.3;
      y = 18 + Math.abs(along) * 0.35 + off * 0.5;
      z = along * 0.45 + off * 0.6;
      brightness *= 0.75;
    }
    pos.set([x, y, z], i * 3);
    const warm = starRng() < 0.18;
    const c: [number, number, number] = warm ? [1.0, 0.85, 0.7] : [0.82, 0.9, 1.0];
    col.set([c[0] * brightness, c[1] * brightness, c[2] * brightness], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({
    size: 0.55,
    vertexColors: true,
    sizeAttenuation: true,
    fog: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const stars = new THREE.Points(g, m);
  stars.frustumCulled = false;
  scene.add(stars);
}

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 120);

// --- Assemble the alley -----------------------------------------------------
const colliders: THREE.Box3[] = [];
const ctx = (seed: number): AlleyContext => ({ rng: mulberry32(seed), colliders });

const updaters: BuiltPart['update'][] = [];
const collect = (part: BuiltPart) => {
  scene.add(part.group);
  if (part.update) updaters.push(part.update);
};

// Signs first: their light pools decide where the ground paints reflections.
const signs = buildSigns(ctx(0x51a6));
collect(signs);

collect(buildGround(ctx(0x6a0d), { lightPools: signs.lightPools }));
collect(buildFacades(ctx(0xfaca)));
const overhead = buildOverhead(ctx(0x0e4d));
collect(overhead);
const stand = buildNoodleStand(ctx(0x00d1e));
collect(stand);
collect(buildProps(ctx(0x9a09)));
collect(buildNpcs(ctx(0x9c05)));
collect(buildTraffic(ctx(0x7caf)));
collect(
  buildAtmosphere(ctx(0xa710), {
    steamEmitters: stand.steamEmitters,
    rainGaps: overhead.rainGaps,
  }),
);

// Base ambient: deep teal, so unlit shadow never reads as black.
scene.add(new THREE.AmbientLight(0x33455a, 100.0));
// Faint violet counter-fill from above, like spill from the choked sky.
const skySpill = new THREE.HemisphereLight(0x5a5488, 0x201f14, 210.0);
scene.add(skySpill);

// Warm sodium spill at the alley entrance (behind the spawn view) so the
// first frame has a warm/cool contrast instead of a black void.
const entranceGlow = new THREE.PointLight(0xff9a4d, 900, 30, 2);
entranceGlow.position.set(0, 4.5, -4);
scene.add(entranceGlow);

// --- Player ------------------------------------------------------------------
const player = new PlayerController(camera, renderer.domElement, colliders);
player.teleport(0, 2.5, Math.PI); // face down the alley (+Z)

// Debug/screenshot hooks (harmless in production).
(window as unknown as Record<string, unknown>).__camera = camera;
(window as unknown as Record<string, unknown>).__player = player;
(window as unknown as Record<string, unknown>).__scene = scene;

const overlay = document.getElementById('overlay')!;
const fpsEl = document.getElementById('fps')!;

if (player.isTouch) {
  // Touch: no pointer lock. Tap to dismiss the overlay; joystick + look-drag
  // take over. Update the copy so it doesn't mention a keyboard.
  overlay.innerHTML =
    'TAP TO ENTER THE ALLEY<br /><span class="hint">left thumb move &middot; right thumb look &middot; push far to run</span>';
  overlay.addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('touchend', () => overlay.classList.add('hidden'), { once: true });
} else {
  player.onLockChange = (locked) => overlay.classList.toggle('hidden', locked);
  overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());
}

// --- Post pipeline -------------------------------------------------------------
// Lower supersample on touch devices — mobile GPUs can't afford 1.75x.
const pipeline = new InkPipeline(renderer, scene, camera, {
  supersample: player.isTouch ? 1.0 : 1.75,
});

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  pipeline.setSize(w, h);
  setHullResolution(w, h);
}
window.addEventListener('resize', onResize);
// iOS fires visualViewport resize (not always window resize) on toolbar
// show/hide and orientation change — listen to both so the canvas tracks it.
window.visualViewport?.addEventListener('resize', onResize);
onResize();

// --- Loop ----------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;
let fpsAccum = 0;
let fpsFrames = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  player.update(dt);
  for (const u of updaters) u!(dt, elapsed);
  pipeline.render(dt);

  // FPS: exponential moving average, updated a few times a second.
  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 0.25) {
    const fps = fpsFrames / fpsAccum;
    fpsEl.textContent = `${Math.round(fps)} FPS`;
    fpsAccum = 0;
    fpsFrames = 0;
  }
});
