/**
 * Asset viewer.
 *   /viewer            -> dense square grid of ALL assets (thumbnails, clickable)
 *   /viewer?model=xyz  -> renders exactly ONE asset, large, for visual review
 */
import * as THREE from 'three';
import { mulberry32, type AlleyContext } from './core/types';
import {
  makeHotelSignTexture,
  makeKaraokeSignTexture,
  makeLightbox24Texture,
  makeOpenSignTexture,
  makeKanjiTowerTexture,
  makeFlickerSignFrames,
  makePosterTexture,
  makeStickerTexture,
  makeStickerSheetTexture,
  makeGraffitiTexture,
  makeMenuStripTexture,
  makeMenuStripTextures,
  makeGroundTexture,
  makeAsphaltTileTexture,
  makeSmearOverlayTexture,
  makeWallGrimeTexture,
  makeBrickTexture,
  makeTileTexture,
  makePaintedMetalTexture,
  makeTarpTexture,
  makeSkyTexture,
  type PosterVariant,
  type StickerVariant,
  type GraffitiVariant,
  type KanjiTowerVariant,
} from './core/textures';
import { makeToon, makeEmissiveToon } from './core/toon';
import { buildVendingMachine, buildCat, buildHoverBike, buildPlasticChair } from './world/props';
import { buildFigure } from './world/npcs';
import { buildCraft } from './world/traffic';
import { buildNoodleStand } from './world/noodleStand';

type Asset =
  | { kind: 'texture'; make: () => THREE.CanvasTexture }
  | { kind: 'prop'; build: () => THREE.Object3D; cam: [number, number, number]; look: [number, number, number] };

const SAMPLE_SMEARS = [
  { x: -0.9, z: 12, color: '#ff2d95', width: 2.2 },
  { x: 0.9, z: 30, color: '#3dff6e', width: 1.6 },
  { x: 0, z: 36, color: '#ffa04a', width: 1.8 },
  { x: 0.8, z: 64, color: '#ff3b30', width: 1.4 },
];

/** Fake context for builders that expect the world's AlleyContext. */
function fakeCtx(seed: number): AlleyContext {
  return { rng: mulberry32(seed), colliders: [] };
}

/* --- prop wrappers around the real world builders ------------------------ */

function vending(variant: 0 | 1 | 2): () => THREE.Object3D {
  const specs = {
    0: { x: 0, z: 0, variant: 0, bodyColor: 0xb81e28, headerColor: 0xff2a35, glowColor: 0xffd9d9, hero: true },
    1: { x: 0, z: 0, variant: 1, bodyColor: 0x9aa4ac, headerColor: 0x2f6fd0, glowColor: 0xd9ecff, hero: false },
    2: { x: 0, z: 0, variant: 2, bodyColor: 0x1a1e24, headerColor: 0xff8c1a, glowColor: 0xffc98a, hero: false },
  } as const;
  return () => {
    const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.115, 10);
    const canMat = makeToon({ color: 0xffffff });
    const canPalette = [0xd23b2e, 0x2e7fd2, 0xf2f2f2, 0x3fae5a, 0xf0a12e, 0x8a4fd0];
    const g = buildVendingMachine(fakeCtx(100 + variant), specs[variant] as never, canGeo, canMat, canPalette as never).group;
    g.position.set(0, 0, 0);
    g.rotation.y = 0; // front is +Z locally
    return g;
  };
}

function npcFigure(seed: number): () => THREE.Object3D {
  return () => buildFigure(mulberry32(seed)).root;
}

function flyingCraft(seed: number): () => THREE.Object3D {
  return () => buildCraft(mulberry32(seed)).root;
}

function noodleStand(): THREE.Object3D {
  const g = buildNoodleStand(fakeCtx(7)).group;
  // The stall root child carries the world placement; move the whole group so
  // the stall sits at the origin facing -X (its natural front).
  g.position.set(-(3.0 - 0.12), 0, -36);
  return g;
}

function strayCat(): THREE.Object3D {
  return buildCat(mulberry32(21)).group;
}

function hoverBikeReal(): THREE.Object3D {
  return buildHoverBike().group;
}

function chair(color: number): () => THREE.Object3D {
  return () => buildPlasticChair(color);
}

function lantern(): THREE.Object3D {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.05 + Math.sin(t * Math.PI) * 0.32, (t - 0.5) * 0.7));
  }
  return new THREE.Mesh(
    new THREE.LatheGeometry(pts, 20),
    makeEmissiveToon({ color: 0x0a0a12, emissive: 0xff7a33, emissiveIntensity: 1.6 }),
  );
}

function toonSpheres(): THREE.Object3D {
  const g = new THREE.Group();
  [2, 3, 4].forEach((steps, i) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 32, 16),
      makeToon({ color: 0x9fb4b8, gradientSteps: steps }),
    );
    m.position.x = (i - 1) * 1.4;
    g.add(m);
  });
  return g;
}

function neonTubes(): THREE.Object3D {
  const g = new THREE.Group();
  [0xff2d95, 0x3dff6e, 0x37e6ff, 0xffa04a, 0xff3b30].forEach((c, i) => {
    const m = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.7, 4, 12),
      makeEmissiveToon({ color: 0x0a0a12, emissive: c, emissiveIntensity: 2.2 }),
    );
    m.position.x = (i - 2) * 0.45;
    g.add(m);
  });
  return g;
}

/* --- the registry --------------------------------------------------------- */

const ASSETS: Record<string, Asset> = {
  /* sign faces */
  'tex-hotel-v': { kind: 'texture', make: () => makeHotelSignTexture({ seed: 1, orientation: 'vertical' }) },
  'tex-hotel-h': { kind: 'texture', make: () => makeHotelSignTexture({ seed: 2, orientation: 'horizontal' }) },
  'tex-karaoke': { kind: 'texture', make: () => makeKaraokeSignTexture({ seed: 3 }) },
  'tex-lightbox24': { kind: 'texture', make: () => makeLightbox24Texture({ seed: 4 }) },
  'tex-open': { kind: 'texture', make: () => makeOpenSignTexture({ seed: 5 }) },
  ...Object.fromEntries(
    (['izakaya', 'ramen', 'sake', 'denki', 'shichiya'] as KanjiTowerVariant[]).map((v) => [
      `tex-tower-${v}`,
      { kind: 'texture', make: () => makeKanjiTowerTexture({ seed: 6, variant: v }) } as Asset,
    ]),
  ),
  'tex-flicker-0': { kind: 'texture', make: () => makeFlickerSignFrames({ seed: 7, text: '酒場', sub: 'SAKABA', color: '#ff3b30' })[0]! },
  'tex-flicker-1': { kind: 'texture', make: () => makeFlickerSignFrames({ seed: 7, text: '酒場', sub: 'SAKABA', color: '#ff3b30' })[1]! },
  'tex-flicker-2': { kind: 'texture', make: () => makeFlickerSignFrames({ seed: 7, text: '酒場', sub: 'SAKABA', color: '#ff3b30' })[2]! },

  /* wall paper */
  ...Object.fromEntries(
    (['band', 'ad', 'cat', 'notice'] as PosterVariant[]).map((v) => [
      `tex-poster-${v}`,
      { kind: 'texture', make: () => makePosterTexture(v, { seed: 8 }) } as Asset,
    ]),
  ),
  ...Object.fromEntries(
    (['arrow', 'barcode', 'mascot', 'bolt', 'logo', 'together'] as StickerVariant[]).map((v) => [
      `tex-sticker-${v}`,
      { kind: 'texture', make: () => makeStickerTexture(v, { seed: 9 }) } as Asset,
    ]),
  ),
  'tex-sticker-sheet': { kind: 'texture', make: () => makeStickerSheetTexture({ seed: 9 }) },
  ...Object.fromEntries(
    (['tag', 'throwie', 'stencil'] as GraffitiVariant[]).map((v) => [
      `tex-graffiti-${v}`,
      { kind: 'texture', make: () => makeGraffitiTexture(v, { seed: 10 }) } as Asset,
    ]),
  ),
  'tex-menu-single': { kind: 'texture', make: () => makeMenuStripTexture({ seed: 11 }) },
  'tex-menu-0': { kind: 'texture', make: () => makeMenuStripTextures({ seed: 11 })[0]! },
  'tex-menu-1': { kind: 'texture', make: () => makeMenuStripTextures({ seed: 11 })[1]! },

  /* surfaces */
  'tex-ground': { kind: 'texture', make: () => makeGroundTexture({ seed: 12, smears: SAMPLE_SMEARS }) },
  'tex-asphalt-tile': { kind: 'texture', make: () => makeAsphaltTileTexture({ seed: 12 }) },
  'tex-smear-overlay': { kind: 'texture', make: () => makeSmearOverlayTexture(mulberry32(12), { lightPools: SAMPLE_SMEARS.map(s => ({ x: s.x, z: s.z, color: parseInt(s.color.slice(1), 16), width: s.width })) }) },
  'tex-wallgrime': { kind: 'texture', make: () => makeWallGrimeTexture({ seed: 13 }) },
  'tex-brick': { kind: 'texture', make: () => makeBrickTexture({ seed: 16 }) },
  'tex-tile': { kind: 'texture', make: () => makeTileTexture({ seed: 17 }) },
  'tex-painted-metal': { kind: 'texture', make: () => makePaintedMetalTexture({ seed: 18 }) },
  'tex-awning': { kind: 'texture', make: () => makeTarpTexture('stripes', { seed: 14 }) },
  'tex-tarp': { kind: 'texture', make: () => makeTarpTexture('patched', { seed: 15 }) },
  'tex-sky': { kind: 'texture', make: () => makeSkyTexture() },

  /* props — the REAL scene builders */
  'prop-noodle-stand': { kind: 'prop', build: noodleStand, cam: [4.6, 2.4, -1.2], look: [-0.4, 1.0, 0.4] },
  'prop-vending-red': { kind: 'prop', build: vending(0), cam: [1.6, 1.5, 3.0], look: [0, 0.9, 0] },
  'prop-vending-white': { kind: 'prop', build: vending(1), cam: [1.6, 1.5, 3.0], look: [0, 0.9, 0] },
  'prop-vending-dark': { kind: 'prop', build: vending(2), cam: [1.6, 1.5, 3.0], look: [0, 0.9, 0] },
  'prop-npc-1': { kind: 'prop', build: npcFigure(31), cam: [0.9, 1.4, 2.4], look: [0, 0.9, 0] },
  'prop-npc-2': { kind: 'prop', build: npcFigure(47), cam: [0.9, 1.4, 2.4], look: [0, 0.9, 0] },
  'prop-npc-3': { kind: 'prop', build: npcFigure(63), cam: [0.9, 1.4, 2.4], look: [0, 0.9, 0] },
  'prop-flying-car-1': { kind: 'prop', build: flyingCraft(3), cam: [2.4, 1.2, 2.8], look: [0, 0.1, 0] },
  'prop-flying-car-2': { kind: 'prop', build: flyingCraft(11), cam: [2.4, 1.2, 2.8], look: [0, 0.1, 0] },
  'prop-cat': { kind: 'prop', build: strayCat, cam: [0.4, 0.5, 1.1], look: [0, 0.2, 0] },
  'prop-hoverbike': { kind: 'prop', build: hoverBikeReal, cam: [1.4, 0.9, 1.6], look: [0, 0.4, 0] },
  'prop-chair-blue': { kind: 'prop', build: chair(0x2e5a8c), cam: [0.7, 0.8, 1.4], look: [0, 0.4, 0] },
  'prop-chair-red': { kind: 'prop', build: chair(0x8c3a3a), cam: [0.7, 0.8, 1.4], look: [0, 0.4, 0] },
  'prop-lantern': { kind: 'prop', build: lantern, cam: [0, 0.2, 1.6], look: [0, 0, 0] },
  'prop-toon-spheres': { kind: 'prop', build: toonSpheres, cam: [0, 0.6, 3.4], look: [0, 0, 0] },
  'prop-neon-tubes': { kind: 'prop', build: neonTubes, cam: [0, 0.3, 2.6], look: [0, 0, 0] },
};

const params = new URLSearchParams(location.search);
const model = params.get('model');
const app = document.getElementById('app')!;

function renderTextureInto(container: HTMLElement, tex: THREE.CanvasTexture, maxW: number, maxH: number): void {
  const img = tex.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#181c22';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  container.appendChild(c);
}

function renderPropInto(container: HTMLElement, asset: Extract<Asset, { kind: 'prop' }>, W: number, H: number): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  scene.add(new THREE.AmbientLight(0x4a7a7c, 30));
  const key = new THREE.PointLight(0xffe0c0, 60, 30, 1.8);
  key.position.set(3, 4, 3);
  scene.add(key);
  const rim = new THREE.PointLight(0x37e6ff, 30, 30, 1.8);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 100);
  camera.position.set(...asset.cam);
  camera.lookAt(...asset.look);
  scene.add(asset.build());
  renderer.render(scene, camera);
  renderer.dispose();
}

if (!model || !ASSETS[model]) {
  // Index page: every asset rendered as a square thumbnail in a dense grid.
  const grid = document.createElement('div');
  grid.id = 'grid';
  for (const key of Object.keys(ASSETS)) {
    const asset = ASSETS[key]!;
    const cell = document.createElement('a');
    cell.className = 'cell';
    cell.href = `/viewer?model=${key}`;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (asset.kind === 'texture') {
      renderTextureInto(thumb, asset.make(), 260, 260);
    } else {
      renderPropInto(thumb, asset, 260, 260);
    }
    cell.appendChild(thumb);
    const label = document.createElement('span');
    label.textContent = key;
    cell.appendChild(label);
    grid.appendChild(cell);
  }
  app.appendChild(grid);
} else {
  const asset = ASSETS[model];
  const title = document.createElement('div');
  title.id = 'title';
  const back = document.createElement('a');
  back.href = '/viewer';
  back.textContent = '← all assets';
  title.appendChild(back);
  title.appendChild(document.createTextNode(' / ' + model));
  app.appendChild(title);

  if (asset.kind === 'texture') {
    renderTextureInto(app, asset.make(), 900, 620);
  } else {
    renderPropInto(app, asset, 900, 620);
  }
  (window as unknown as Record<string, unknown>).__viewerReady = true;
}
