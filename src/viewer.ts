/**
 * Asset viewer.
 *   /viewer            -> index of all assets (links)
 *   /viewer?model=xyz  -> renders exactly ONE asset, large, for visual review
 */
import * as THREE from 'three';
import { mulberry32 } from './core/types';
import {
  makeHotelSignTexture,
  makeKaraokeSignTexture,
  makeLightbox24Texture,
  makeOpenSignTexture,
  makeKanjiTowerTexture,
  makeFlickerSignFrames,
  makePosterTexture,
  makeStickerTexture,
  makeGraffitiTexture,
  makeMenuStripTextures,
  makeGroundTexture,
  makeWallGrimeTexture,
  makeTarpTexture,
  type PosterVariant,
  type StickerVariant,
  type GraffitiVariant,
  type KanjiTowerVariant,
} from './core/textures';
import { makeToon, makeEmissiveToon } from './core/toon';

type Asset =
  | { kind: 'texture'; make: () => THREE.CanvasTexture }
  | { kind: 'prop'; build: () => THREE.Object3D; cam: [number, number, number]; look: [number, number, number] };

const SAMPLE_SMEARS = [
  { x: -0.9, z: 12, color: '#ff2d95', width: 2.2 },
  { x: 0.9, z: 30, color: '#3dff6e', width: 1.6 },
  { x: 0, z: 36, color: '#ffa04a', width: 1.8 },
  { x: 0.8, z: 64, color: '#ff3b30', width: 1.4 },
];

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

function trashBag(): THREE.Object3D {
  const rng = mulberry32(42);
  const geo = new THREE.IcosahedronGeometry(0.4, 1);
  const pos = geo.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const s = 1 + (rng() - 0.5) * 0.35;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.85, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, makeToon({ color: 0x1c2a24, gradientSteps: 3 }));
}

function cat(): THREE.Object3D {
  const g = new THREE.Group();
  const mat = makeToon({ color: 0x14181c, gradientSteps: 2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 4, 10), mat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat);
  head.position.set(0.28, 0.34, 0);
  const earGeo = new THREE.ConeGeometry(0.045, 0.1, 6);
  const e1 = new THREE.Mesh(earGeo, mat); e1.position.set(0.24, 0.46, 0.06);
  const e2 = new THREE.Mesh(earGeo, mat); e2.position.set(0.24, 0.46, -0.06);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 12, Math.PI * 1.2), mat);
  tail.position.set(-0.3, 0.3, 0);
  g.add(body, head, e1, e2, tail);
  return g;
}

function hoverBike(): THREE.Object3D {
  const g = new THREE.Group();
  const hullMat = makeToon({ color: 0x2a343c, gradientSteps: 3 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.5), hullMat);
  hull.position.y = 0.5;
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, 0.5, 8), hullMat);
  nose.rotation.z = Math.PI / 2.3;
  nose.position.set(0.85, 0.56, 0);
  const ringGeo = new THREE.TorusGeometry(0.22, 0.07, 8, 20);
  const r1 = new THREE.Mesh(ringGeo, hullMat); r1.position.set(-0.55, 0.42, 0); r1.rotation.x = Math.PI / 2;
  const r2 = new THREE.Mesh(ringGeo, hullMat); r2.position.set(0.55, 0.42, 0); r2.rotation.x = Math.PI / 2;
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.3),
    makeEmissiveToon({ color: 0x0a0a12, emissive: 0xff2d20, emissiveIntensity: 2.4 }),
  );
  tail.position.set(-0.78, 0.52, 0);
  g.add(hull, nose, r1, r2, tail);
  return g;
}

function wallKit(): THREE.Object3D {
  const g = new THREE.Group();
  const ac = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.3), makeToon({ color: 0x9aa0a2, gradientSteps: 3 }));
  ac.position.set(-0.5, 0.6, 0);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 20), makeToon({ color: 0x2c3236, gradientSteps: 2 }));
  fan.rotation.x = Math.PI / 2;
  fan.position.set(-0.5, 0.6, 0.18);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), makeToon({ color: 0x46525a, gradientSteps: 3 }));
  vent.position.set(0.5, 0.6, 0);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 10), makeToon({ color: 0x7a4a38, gradientSteps: 3 }));
  pipe.position.set(1.0, 0.8, 0);
  g.add(ac, fan, vent, pipe);
  return g;
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

const ASSETS: Record<string, Asset> = {
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
  ...Object.fromEntries(
    (['band', 'ad', 'cat', 'notice'] as PosterVariant[]).map((v) => [
      `tex-poster-${v}`,
      { kind: 'texture', make: () => makePosterTexture(v, { seed: 8 }) } as Asset,
    ]),
  ),
  ...Object.fromEntries(
    (['arrow', 'barcode', 'mascot', 'bolt', 'logo'] as StickerVariant[]).map((v) => [
      `tex-sticker-${v}`,
      { kind: 'texture', make: () => makeStickerTexture(v, { seed: 9 }) } as Asset,
    ]),
  ),
  ...Object.fromEntries(
    (['tag', 'throwie', 'stencil'] as GraffitiVariant[]).map((v) => [
      `tex-graffiti-${v}`,
      { kind: 'texture', make: () => makeGraffitiTexture(v, { seed: 10 }) } as Asset,
    ]),
  ),
  'tex-menu-0': { kind: 'texture', make: () => makeMenuStripTextures({ seed: 11 })[0]! },
  'tex-menu-1': { kind: 'texture', make: () => makeMenuStripTextures({ seed: 11 })[1]! },
  'tex-ground': { kind: 'texture', make: () => makeGroundTexture({ seed: 12, smears: SAMPLE_SMEARS }) },
  'tex-wallgrime': { kind: 'texture', make: () => makeWallGrimeTexture({ seed: 13 }) },
  'tex-awning': { kind: 'texture', make: () => makeTarpTexture('stripes', { seed: 14 }) },
  'tex-tarp': { kind: 'texture', make: () => makeTarpTexture('patched', { seed: 15 }) },
  'prop-toon-spheres': { kind: 'prop', build: toonSpheres, cam: [0, 0.6, 3.4], look: [0, 0, 0] },
  'prop-neon-tubes': { kind: 'prop', build: neonTubes, cam: [0, 0.3, 2.6], look: [0, 0, 0] },
  'prop-lantern': { kind: 'prop', build: lantern, cam: [0, 0.2, 1.6], look: [0, 0, 0] },
  'prop-trashbag': { kind: 'prop', build: trashBag, cam: [0, 0.3, 1.6], look: [0, 0, 0] },
  'prop-cat': { kind: 'prop', build: cat, cam: [0.2, 0.5, 1.6], look: [0, 0.25, 0] },
  'prop-hoverbike': { kind: 'prop', build: hoverBike, cam: [1.6, 1.0, 1.8], look: [0, 0.5, 0] },
  'prop-wallkit': { kind: 'prop', build: wallKit, cam: [0.4, 1.0, 2.6], look: [0.1, 0.6, 0] },
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
  // Index page: every asset rendered as a thumbnail, clickable to its single view.
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
      renderTextureInto(thumb, asset.make(), 300, 210);
    } else {
      renderPropInto(thumb, asset, 300, 210);
    }
    cell.appendChild(thumb);
    const label = document.createElement('span');
    label.textContent = key;
    cell.appendChild(label);
    grid.appendChild(cell);
  }
  app.appendChild(grid);
  // keep a plain link list too for text-only consumers
  const list = document.createElement('ul');
  list.style.display = 'none';
  for (const key of Object.keys(ASSETS)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/viewer?model=${key}`;
    a.textContent = key;
    li.appendChild(a);
    list.appendChild(li);
  }
  app.appendChild(list);
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
