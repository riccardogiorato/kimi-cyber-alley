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
import { setHullResolution } from './world/props';

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); // supersampling is handled by the ink pipeline
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // grade pass owns the final look
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// No sky, no sun — deep teal void above the rooftops.
scene.background = new THREE.Color(0x04100f);
scene.fog = new THREE.FogExp2(0x06201f, 0.016);

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
collect(
  buildAtmosphere(ctx(0xa710), {
    steamEmitters: stand.steamEmitters,
    rainGaps: overhead.rainGaps,
  }),
);

// Base ambient: deep teal, so unlit shadow never reads as black.
scene.add(new THREE.AmbientLight(0x1a3a3c, 0.85));
// Faint violet counter-fill from above, like spill from the choked sky.
const skySpill = new THREE.HemisphereLight(0x2a2440, 0x0a1414, 0.5);
scene.add(skySpill);

// --- Player ------------------------------------------------------------------
const player = new PlayerController(camera, renderer.domElement, colliders);
player.teleport(0, 2.5, Math.PI); // face down the alley (+Z)

// Debug/screenshot hooks (harmless in production).
(window as unknown as Record<string, unknown>).__camera = camera;
(window as unknown as Record<string, unknown>).__player = player;

const overlay = document.getElementById('overlay')!;
player.onLockChange = (locked) => overlay.classList.toggle('hidden', locked);
overlay.addEventListener('click', () => renderer.domElement.requestPointerLock());

// --- Post pipeline -------------------------------------------------------------
const pipeline = new InkPipeline(renderer, scene, camera, { supersample: 1.75 });

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
onResize();

// --- Loop ----------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  player.update(dt);
  for (const u of updaters) u!(dt, elapsed);
  pipeline.render(dt);
});
