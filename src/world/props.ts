import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon, makeEmissiveToon } from '../core/toon';

/* ---------------------------------------------------------------------------
 * Inverted-hull outline helper (shared with noodleStand.ts).
 *
 * Renders a BackSide clone of the mesh whose vertices are pushed along their
 * normals in VIEW SPACE, with the push scaled by view depth so the outline
 * keeps a CONSTANT PIXEL WIDTH at any distance:
 *
 *   offset(view units) = 2 * thicknessPx * (-mvPosition.z) / resolution.y
 *
 * (a full-height triangle at depth d spans 2*d view units, so 1px = 2d/resY).
 * `setHullResolution` must be wired to window resize by the integrator.
 * ------------------------------------------------------------------------- */

const hullResolution = new THREE.Vector2(1920, 1080);

/** Wire this to window resize so hull outlines keep constant pixel width. */
export function setHullResolution(w: number, h: number): void {
  hullResolution.set(Math.max(1, w), Math.max(1, h));
}

export interface HullOptions {
  /** Flat outline colour — dark teal/indigo reads best against the toon ramps. */
  color?: number;
  /** Outline width in pixels. */
  thickness?: number;
}

/**
 * Adds an inverted-hull outline to a mesh and returns the hull mesh.
 * The hull is parented alongside the source mesh (same parent if it already
 * has one, otherwise the mesh is wrapped in a Group that is returned via
 * `hull.parent`).
 */
export function addInvertedHull(mesh: THREE.Mesh, opts: HullOptions = {}): THREE.Mesh {
  const { color = 0x0a1a26, thickness = 2.5 } = opts;

  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    fog: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHullThickness = { value: thickness };
    shader.uniforms.uHullResolution = { value: hullResolution };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uHullThickness;\nuniform vec2 uHullResolution;',
      )
      .replace(
        '#include <project_vertex>',
        [
          'vec4 mvPosition = vec4( transformed, 1.0 );',
          '#ifdef USE_INSTANCING',
          '\tmvPosition = instanceMatrix * mvPosition;',
          '#endif',
          '\tvec3 hullViewNormal = normalize( mat3( modelViewMatrix ) * normal );',
          '\tmvPosition = modelViewMatrix * mvPosition;',
          '\tmvPosition.xyz += hullViewNormal * ( 2.0 * uHullThickness * max( -mvPosition.z, 0.001 ) / uHullResolution.y );',
          '\tgl_Position = projectionMatrix * mvPosition;',
        ].join('\n'),
      );
  };
  // Distinct program cache key per thickness so hulls don't collide in the program cache.
  mat.customProgramCacheKey = () => `inverted-hull-${thickness}`;

  const hull = new THREE.Mesh(mesh.geometry, mat);
  hull.name = `${mesh.name || 'mesh'}-hull`;
  hull.position.copy(mesh.position);
  hull.quaternion.copy(mesh.quaternion);
  hull.scale.copy(mesh.scale);
  hull.renderOrder = (mesh.renderOrder ?? 0) - 1;

  if (mesh.parent) {
    mesh.parent.add(hull);
  } else {
    const wrap = new THREE.Group();
    wrap.add(mesh);
    wrap.add(hull);
  }
  return hull;
}

/* ---------------------------------------------------------------------------
 * Small deterministic helpers
 * ------------------------------------------------------------------------- */

const TAU = Math.PI * 2;

function rand(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]!;
}

/** Catenary-ish sag between two points. t in [0,1], sag in metres. */
function wirePoint(a: THREE.Vector3, b: THREE.Vector3, sag: number, t: number, out: THREE.Vector3): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y -= sag * 4 * t * (1 - t);
  return out;
}

/* ---------------------------------------------------------------------------
 * Vending machine brand label — drawn inline (katakana + flat logo mark).
 * ------------------------------------------------------------------------- */

function vendingLabelTexture(variant: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;

  const schemes = [
    { bg: '#c81623', fg: '#ffffff', accent: '#ffd23f', text: 'ドリンク' },
    { bg: '#f2f4f6', fg: '#1c4e9c', accent: '#e23b3b', text: 'のみもの' },
    { bg: '#15181d', fg: '#ff8c1a', accent: '#ffd23f', text: 'カンセン' },
  ];
  const s = schemes[variant % schemes.length]!;

  g.fillStyle = s.bg;
  g.fillRect(0, 0, c.width, c.height);

  // Flat logo mark: circle + diagonal slash.
  g.fillStyle = s.accent;
  g.beginPath();
  g.arc(40, 48, 26, 0, TAU);
  g.fill();
  g.strokeStyle = s.bg;
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(22, 66);
  g.lineTo(58, 30);
  g.stroke();

  // Katakana brand text.
  g.fillStyle = s.fg;
  g.font = 'bold 44px "Hiragino Sans", "Yu Gothic", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(s.text, 82, 44);
  g.font = 'bold 15px "Hiragino Sans", sans-serif';
  g.globalAlpha = 0.75;
  g.fillText('つめた〜い', 84, 76);
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---------------------------------------------------------------------------
 * Vending machines
 * ------------------------------------------------------------------------- */

interface VendingSpec {
  x: number;
  z: number;
  variant: number; // 0 red, 1 white/blue, 2 dark/orange
  bodyColor: number;
  headerColor: number;
  glowColor: number;
  hero: boolean;
}

function buildVendingMachine(
  ctx: AlleyContext,
  spec: VendingSpec,
  canGeo: THREE.CylinderGeometry,
  canMat: THREE.MeshToonMaterial,
  canPalette: number[],
): { group: THREE.Group; body: THREE.Mesh } {
  const { rng } = ctx;
  const g = new THREE.Group();
  g.name = `vending-${spec.variant}`;

  const W = 1.0;
  const H = 1.9;
  const D = 0.62;
  const frontZ = D / 2;

  // Body — recessed against the wall, front flush-ish with the alley face.
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    makeToon({ color: spec.bodyColor }),
  );
  body.name = 'vending-body';
  body.position.set(0, H / 2, 0);
  g.add(body);

  // Glowing header band.
  const header = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.96, 0.22, 0.05),
    makeEmissiveToon({
      color: spec.headerColor,
      emissive: spec.headerColor,
      emissiveIntensity: 2.7,
    }),
  );
  header.position.set(0, H - 0.2, frontZ + 0.01);
  g.add(header);

  // Brand label (inline canvas).
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.7, 0.26),
    new THREE.MeshBasicMaterial({ map: vendingLabelTexture(spec.variant), fog: true }),
  );
  label.position.set(0, H - 0.2, frontZ + 0.04);
  g.add(label);

  // Real instanced cans behind the glass: 4 rows x 5 cols.
  const ROWS = 4;
  const COLS = 5;
  const cans = new THREE.InstancedMesh(canGeo, canMat, ROWS * COLS);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let cIdx = 0; cIdx < COLS; cIdx++) {
      const cx = -W / 2 + 0.16 + cIdx * ((W - 0.32) / (COLS - 1));
      const cy = 0.42 + r * 0.3;
      m.makeRotationY(rand(rng, -0.25, 0.25));
      m.setPosition(cx, cy, frontZ - 0.12);
      cans.setMatrixAt(i, m);
      cans.setColorAt(i, col.setHex(pick(rng, canPalette)));
      i++;
    }
  }
  cans.instanceMatrix.needsUpdate = true;
  if (cans.instanceColor) cans.instanceColor.needsUpdate = true;
  g.add(cans);

  // Interior light plate behind the cans so they read through the glass.
  const backGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.14, 1.34),
    makeEmissiveToon({ color: 0xdfefff, emissive: 0xbfe4ff, emissiveIntensity: 1.5 }),
  );
  backGlow.position.set(0, 0.95, frontZ - 0.2);
  g.add(backGlow);

  // Slightly transparent glossy front glass.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.1, 1.4),
    new THREE.MeshStandardMaterial({
      color: 0x9fc8d8,
      transparent: true,
      opacity: 0.18,
      roughness: 0.12,
      metalness: 0.35,
      depthWrite: false,
    }),
  );
  glass.position.set(0, 0.95, frontZ + 0.02);
  g.add(glass);

  // Dispense slot + side trim.
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.6, 0.22, 0.04),
    makeToon({ color: 0x10161a }),
  );
  slot.position.set(0, 0.16, frontZ + 0.01);
  g.add(slot);

  // Cold white light in front of the machine.
  const light = new THREE.PointLight(spec.glowColor, 14, 5, 1.8);
  light.position.set(0, 1.3, frontZ + 0.55);
  g.add(light);

  g.position.set(spec.x, 0, spec.z);
  // Face into the alley (front is +Z locally; rotate so +Z points to alley centre).
  g.rotation.y = spec.x < 0 ? Math.PI / 2 : -Math.PI / 2;

  addCollider(ctx, spec.x, H / 2, spec.z, D, H, W);
  return { group: g, body };
}

/* ---------------------------------------------------------------------------
 * Litter builders
 * ------------------------------------------------------------------------- */

/** Lumpy trash-bag geometry: icosahedron with deterministic vertex jitter. */
function trashBagGeo(rng: () => number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const j = 0.78 + rng() * 0.5;
    v.multiplyScalar(j);
    v.y *= 0.82; // squat, sitting on the ground
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Newspaper: plane bent into a gentle curl. */
function curledPaperGeo(rng: () => number, w: number, h: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 6, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const curl = rand(rng, 0.5, 1.1);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const t = x / w + 0.5;
    pos.setZ(i, Math.sin(t * Math.PI) * 0.03 * curl + t * t * 0.05 * curl);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ---------------------------------------------------------------------------
 * Stray cat
 * ------------------------------------------------------------------------- */

interface CatRig {
  group: THREE.Group;
  tailTip: THREE.Object3D;
  earL: THREE.Object3D;
  earR: THREE.Object3D;
  twitchSeed: number;
}

function buildCat(rng: () => number): CatRig {
  const g = new THREE.Group();
  g.name = 'stray-cat';

  const fur = makeToon({
    color: 0x14181d,
    emissive: 0x1d3540, // faint teal rim so the silhouette reads in the dark
    emissiveIntensity: 0.6,
  });

  // Sitting body: capsule tipped upright-ish.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.12, 4, 10), fur);
  body.rotation.x = -0.5;
  body.position.set(0, 0.15, 0);
  g.add(body);

  // Haunches.
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), fur);
  haunch.scale.set(1, 0.72, 1.05);
  haunch.position.set(0, 0.075, -0.05);
  g.add(haunch);

  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 10), fur);
  head.scale.set(1, 0.92, 0.95);
  head.position.set(0, 0.3, 0.06);
  g.add(head);

  // Ear cones.
  const earGeo = new THREE.ConeGeometry(0.026, 0.055, 6);
  const earL = new THREE.Mesh(earGeo, fur);
  earL.position.set(-0.038, 0.36, 0.05);
  earL.rotation.z = 0.22;
  g.add(earL);
  const earR = new THREE.Mesh(earGeo, fur);
  earR.position.set(0.038, 0.36, 0.05);
  earR.rotation.z = -0.22;
  g.add(earR);

  // Tail: curved tube wrapping around the body, tip animated.
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.05, -0.14),
    new THREE.Vector3(0.1, 0.03, -0.16),
    new THREE.Vector3(0.15, 0.03, -0.05),
    new THREE.Vector3(0.14, 0.04, 0.07),
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.02, 6), fur);
  g.add(tail);
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), fur);
  tailTip.position.set(0.14, 0.045, 0.07);
  g.add(tailTip);

  // Eyes: two tiny warm slits.
  const eyeMat = makeEmissiveToon({ color: 0xffc86e, emissive: 0xffb84d, emissiveIntensity: 2.4 });
  const eyeGeo = new THREE.SphereGeometry(0.008, 6, 5);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(1, 0.6, 0.5);
    eye.position.set(s * 0.027, 0.305, 0.122);
    g.add(eye);
  }

  return { group: g, tailTip, earL, earR, twitchSeed: rng() * 100 };
}

/* ---------------------------------------------------------------------------
 * Hover-bike (hero prop)
 * ------------------------------------------------------------------------- */

function buildHoverBike(): { group: THREE.Group; hull: THREE.Mesh } {
  const g = new THREE.Group();
  g.name = 'hover-bike';

  const hullMat = makeToon({ color: 0x2b3f4d });
  const darkMat = makeToon({ color: 0x161d24 });
  const accentMat = makeEmissiveToon({ color: 0xff3b30, emissive: 0xff2d20, emissiveIntensity: 3.7 });

  // Low sleek main hull.
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.85, 4, 10), hullMat);
  hull.name = 'hover-bike-hull';
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1, 1, 0.62);
  hull.position.set(0, 0.42, 0);
  g.add(hull);

  // Nose cowl.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 10), hullMat);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1, 1, 0.6);
  nose.position.set(0, 0.42, 0.62);
  g.add(nose);

  // Seat + tail spine.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.42), darkMat);
  seat.position.set(0, 0.55, -0.18);
  seat.rotation.x = 0.08;
  g.add(seat);

  // Ducted-fan rings: torus + disc, front and rear.
  const ringGeo = new THREE.TorusGeometry(0.17, 0.045, 8, 20);
  const discGeo = new THREE.CircleGeometry(0.15, 16);
  const discMat = makeToon({ color: 0x0d1216 });
  for (const z of [0.42, -0.42]) {
    const ring = new THREE.Mesh(ringGeo, darkMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.3, z);
    g.add(ring);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, 0.3, z);
    g.add(disc);
    // Struts to the hull.
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.24), darkMat);
    strut.position.set(0, 0.37, z * 0.72);
    g.add(strut);
  }

  // Handlebar.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), darkMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.62, 0.32);
  g.add(bar);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), darkMat);
  stem.rotation.x = 0.5;
  stem.position.set(0, 0.53, 0.36);
  g.add(stem);

  // Tail light.
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.02), accentMat);
  tail.position.set(0, 0.46, -0.6);
  g.add(tail);

  // Kickstand lean: thin stand + whole-bike roll.
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 6), darkMat);
  stand.position.set(-0.16, 0.16, -0.1);
  stand.rotation.z = 0.35;
  g.add(stand);
  g.rotation.z = 0.12;

  return { group: g, hull };
}

/* ---------------------------------------------------------------------------
 * Plastic chair (monobloc-ish)
 * ------------------------------------------------------------------------- */

function buildPlasticChair(color: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'plastic-chair';
  const mat = makeToon({ color });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.38), mat);
  seat.position.y = 0.44;
  g.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.03), mat);
  back.position.set(0, 0.68, -0.185);
  back.rotation.x = -0.1;
  g.add(back);

  const legGeo = new THREE.BoxGeometry(0.04, 0.44, 0.04);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx * 0.165, 0.22, sz * 0.155);
      leg.rotation.z = -sx * 0.06;
      leg.rotation.x = sz * 0.06;
      g.add(leg);
    }
  }
  return g;
}

/* ---------------------------------------------------------------------------
 * Red paper lantern rows
 * ------------------------------------------------------------------------- */

interface LanternRow {
  lanterns: THREE.InstancedMesh;
  anchors: { base: THREE.Matrix4; phase: number; amp: number }[];
}

function buildLanternRows(ctx: AlleyContext, group: THREE.Group): LanternRow[] {
  const { rng } = ctx;
  const rows: LanternRow[] = [];

  // Squashed sphere lantern with top/bottom caps merged into one geometry.
  const bodyGeo = new THREE.SphereGeometry(0.09, 12, 10);
  bodyGeo.scale(1, 0.78, 1);
  const capGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8);
  const capTop = capGeo.clone().translate(0, 0.078, 0);
  const capBot = capGeo.clone().translate(0, -0.078, 0);

  // Manual merge (no BufferGeometryUtils dependency).
  const merged = mergeGeometries([bodyGeo, capTop, capBot]);

  const lanternMat = makeEmissiveToon({
    color: 0xff5a2a,
    emissive: 0xff4a1e,
    emissiveIntensity: 2.5,
  });

  const wireMat = new THREE.MeshBasicMaterial({ color: 0x0c1216, fog: true });

  const rowZs = [16, 30, 46, 58];
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpP = new THREE.Vector3();

  for (let r = 0; r < rowZs.length; r++) {
    const z = rowZs[r]! + rand(rng, -1.5, 1.5);
    const y = rand(rng, 3.1, 4.4);
    const sag = rand(rng, 0.25, 0.5);
    const a = new THREE.Vector3(-ALLEY.halfWidth, y, z);
    const b = new THREE.Vector3(ALLEY.halfWidth, y + rand(rng, -0.3, 0.3), z + rand(rng, -0.4, 0.4));

    // Wire: thin tube along the catenary.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) pts.push(wirePoint(a, b, sag, i / 16, new THREE.Vector3()).clone());
    const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.006, 4), wireMat);
    group.add(wire);

    // Lanterns instanced along the wire.
    const count = 5 + Math.floor(rng() * 4); // 5-8
    const inst = new THREE.InstancedMesh(merged, lanternMat, count);
    const anchors: LanternRow['anchors'] = [];
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      wirePoint(a, b, sag, t, tmpP);
      tmpP.y -= 0.12; // hang below the wire
      const m = new THREE.Matrix4().setPosition(tmpP);
      anchors.push({
        base: m,
        phase: rng() * TAU,
        amp: rand(rng, 0.04, 0.1),
      });
    }
    group.add(inst);
    rows.push({ lanterns: inst, anchors });

    // One shared warm light per row (budget: 4 total).
    wirePoint(a, b, sag, 0.5, tmpA);
    const light = new THREE.PointLight(0xff7a33, 12, 7, 1.9);
    light.position.copy(tmpA).y -= 0.4;
    group.add(light);
  }

  // Silence unused warning for tmpB (kept for symmetry with tmpA).
  void tmpB;

  return rows;
}

/** Minimal position/normal/uv merge for identical-attribute geometries. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'uv'] as const;
  for (const name of attrs) {
    const arrays = geos.map((g) => (g.attributes[name] as THREE.BufferAttribute).array as Float32Array);
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const mergedArr = new Float32Array(total);
    let off = 0;
    for (const a of arrays) {
      mergedArr.set(a, off);
      off += a.length;
    }
    const itemSize = (geos[0]!.attributes[name] as THREE.BufferAttribute).itemSize;
    out.setAttribute(name, new THREE.BufferAttribute(mergedArr, itemSize));
  }
  // Merge indices with offsets.
  const indices: number[] = [];
  let vertOff = 0;
  for (const g of geos) {
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vertOff);
    vertOff += (g.attributes.position as THREE.BufferAttribute).count;
  }
  out.setIndex(indices);
  return out;
}

/* ---------------------------------------------------------------------------
 * buildProps
 * ------------------------------------------------------------------------- */

export function buildProps(ctx: AlleyContext): BuiltPart {
  const { rng } = ctx;
  const group = new THREE.Group();
  group.name = 'props';

  /* --- Vending machines -------------------------------------------------- */
  const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.115, 10);
  const canMat = makeToon({ color: 0xffffff }); // per-instance colours
  const canPalette = [0xd23b2e, 0x2e7fd2, 0xf2f2f2, 0x3fae5a, 0xf0a12e, 0x8a4fd0];

  const vendingSpecs: VendingSpec[] = [
    { x: -ALLEY.halfWidth + 0.33, z: 12, variant: 0, bodyColor: 0xb81e28, headerColor: 0xff2a35, glowColor: 0xffd9d9, hero: true },
    { x: ALLEY.halfWidth - 0.33, z: 27, variant: 1, bodyColor: 0xe8ecf0, headerColor: 0x2f6fd0, glowColor: 0xd9ecff, hero: false },
    { x: -ALLEY.halfWidth + 0.33, z: 52, variant: 2, bodyColor: 0x1a1e24, headerColor: 0xff8c1a, glowColor: 0xffc98a, hero: false },
  ];
  for (const spec of vendingSpecs) {
    const { group: vg, body } = buildVendingMachine(ctx, spec, canGeo, canMat, canPalette);
    group.add(vg);
    if (spec.hero) addInvertedHull(body, { thickness: 2.5 });
  }

  /* --- Trash bags (instanced, clustered) ---------------------------------- */
  const bagGeo = trashBagGeo(rng, 0.26);
  const bagMat = makeToon({ color: 0x14201a });
  const bagClusters = [
    { x: ALLEY.halfWidth - 0.5, z: 8 },
    { x: -ALLEY.halfWidth + 0.55, z: 22 },
    { x: ALLEY.halfWidth - 0.45, z: 41 },
    { x: -ALLEY.halfWidth + 0.5, z: 61 },
  ];
  const bagCount = bagClusters.length * 3;
  const bags = new THREE.InstancedMesh(bagGeo, bagMat, bagCount);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let i = 0;
    for (const c of bagClusters) {
      for (let k = 0; k < 3; k++) {
        p.set(c.x + rand(rng, -0.3, 0.3), 0.16, c.z + rand(rng, -0.45, 0.45));
        q.setFromEuler(new THREE.Euler(0, rng() * TAU, 0));
        const sc = rand(rng, 0.7, 1.25);
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        bags.setMatrixAt(i++, m);
      }
      // One merged collider per cluster.
      addCollider(ctx, c.x, 0.3, c.z, 1.0, 0.6, 1.2);
    }
    bags.instanceMatrix.needsUpdate = true;
  }
  group.add(bags);

  /* --- Flattened cardboard ------------------------------------------------- */
  const cardMat = makeToon({ color: 0x8a6a42 });
  const cardGeo = new THREE.BoxGeometry(0.7, 0.012, 0.5);
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(cardGeo, cardMat);
    const lean = rng() < 0.35;
    const side = rng() < 0.5 ? -1 : 1;
    if (lean) {
      c.position.set(side * (ALLEY.halfWidth - 0.09), 0.3, rand(rng, 4, ALLEY.length - 4));
      c.rotation.set(-Math.PI / 2 + side * 0 + 0.9, rng() * TAU, 0);
      c.rotation.order = 'YXZ';
      c.rotation.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      c.rotateX(-1.15);
    } else {
      c.position.set(rand(rng, -1.1, 1.1), 0.008, rand(rng, 3, ALLEY.length - 3));
      c.rotation.y = rng() * TAU;
    }
    const sc = rand(rng, 0.7, 1.3);
    c.scale.set(sc, 1, sc);
    group.add(c);
  }

  /* --- Scattered cans + bottles (instanced) -------------------------------- */
  const litterCanGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.115, 8);
  const litterCanMat = makeToon({ color: 0xffffff });
  const litterCans = new THREE.InstancedMesh(litterCanGeo, litterCanMat, 26);
  const bottleGeo = new THREE.CylinderGeometry(0.03, 0.036, 0.2, 8);
  const bottleMat = makeToon({ color: 0x2a4a34 });
  const bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, 12);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    for (let i = 0; i < 26; i++) {
      const onSide = rng() < 0.6;
      p.set(rand(rng, -1.4, 1.4), onSide ? 0.033 : 0.058, rand(rng, 2, ALLEY.length - 1));
      e.set(onSide ? Math.PI / 2 : 0, rng() * TAU, 0);
      q.setFromEuler(e);
      m.compose(p, q, one);
      litterCans.setMatrixAt(i, m);
      litterCans.setColorAt(i, col.setHex(pick(rng, canPalette)));
    }
    litterCans.instanceMatrix.needsUpdate = true;
    if (litterCans.instanceColor) litterCans.instanceColor.needsUpdate = true;
    for (let i = 0; i < 12; i++) {
      const onSide = rng() < 0.5;
      p.set(rand(rng, -1.4, 1.4), onSide ? 0.036 : 0.1, rand(rng, 2, ALLEY.length - 1));
      e.set(onSide ? Math.PI / 2 : 0, rng() * TAU, 0);
      q.setFromEuler(e);
      m.compose(p, q, one);
      bottles.setMatrixAt(i, m);
    }
    bottles.instanceMatrix.needsUpdate = true;
  }
  group.add(litterCans, bottles);

  /* --- Newspapers (instanced curled planes) -------------------------------- */
  const paperGeo = curledPaperGeo(rng, 0.32, 0.24);
  const paperMat = makeToon({ color: 0xb8b4a6 });
  const papers = new THREE.InstancedMesh(paperGeo, paperMat, 10);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 10; i++) {
      p.set(rand(rng, -1.3, 1.3), 0.012, rand(rng, 2, ALLEY.length - 2));
      e.set(-Math.PI / 2, 0, rng() * TAU);
      q.setFromEuler(e);
      m.compose(p, q, one);
      papers.setMatrixAt(i, m);
    }
    papers.instanceMatrix.needsUpdate = true;
  }
  group.add(papers);

  /* --- Plastic crates ------------------------------------------------------- */
  const cratePositions = [
    { x: ALLEY.halfWidth - 0.42, z: 33.5, stack: 2 },
    { x: -ALLEY.halfWidth + 0.45, z: 44, stack: 1 },
    { x: ALLEY.halfWidth - 0.4, z: 63, stack: 2 },
  ];
  const crateMat = makeToon({ color: 0x2c5f8a });
  const crateMat2 = makeToon({ color: 0x7a3a2a });
  const crateShell = new THREE.BoxGeometry(0.44, 0.3, 0.34);
  const crateInset = new THREE.BoxGeometry(0.4, 0.26, 0.3);
  const crateInnerMat = makeToon({ color: 0x0e1418 });
  for (const cp of cratePositions) {
    for (let s = 0; s < cp.stack; s++) {
      const crate = new THREE.Mesh(crateShell, rng() < 0.5 ? crateMat : crateMat2);
      crate.position.set(cp.x, 0.15 + s * 0.31, cp.z);
      crate.rotation.y = rand(rng, -0.2, 0.2);
      group.add(crate);
      const inset = new THREE.Mesh(crateInset, crateInnerMat);
      inset.position.copy(crate.position);
      inset.rotation.copy(crate.rotation);
      group.add(inset);
    }
    addCollider(ctx, cp.x, 0.3 * cp.stack / 2 + 0.1, cp.z, 0.5, 0.31 * cp.stack, 0.4);
  }

  /* --- Plastic chair (hero outline) ----------------------------------------- */
  const chair = buildPlasticChair(0x9fc4c0);
  chair.position.set(ALLEY.halfWidth - 0.5, 0, 47);
  chair.rotation.y = -Math.PI / 2 + 0.4;
  group.add(chair);
  addCollider(ctx, chair.position.x, 0.45, chair.position.z, 0.45, 0.9, 0.45);
  {
    // Outline the seat as the chair's hero silhouette piece.
    const seatMesh = chair.children[0] as THREE.Mesh;
    addInvertedHull(seatMesh, { thickness: 2 });
  }

  /* --- Hover-bike near the T-junction (hero outline) ------------------------ */
  const bike = buildHoverBike();
  bike.group.position.set(-0.9, 0, ALLEY.length - 3.2);
  bike.group.rotation.y = 0.9;
  group.add(bike.group);
  addCollider(ctx, bike.group.position.x, 0.4, bike.group.position.z, 0.6, 0.8, 1.5);
  addInvertedHull(bike.hull, { thickness: 2.5 });

  /* --- Stray cat ------------------------------------------------------------- */
  const cat = buildCat(rng);
  // Sitting on the crate stack next to the noodle stand side of the alley.
  cat.group.position.set(ALLEY.halfWidth - 0.42, 0.62, 33.5);
  cat.group.rotation.y = -Math.PI / 2 - 0.3;
  group.add(cat.group);

  /* --- Red paper lantern rows ------------------------------------------------ */
  const lanternRows = buildLanternRows(ctx, group);

  /* --- Update: lantern sway + cat life --------------------------------------- */
  const m4 = new THREE.Matrix4();
  const swayQ = new THREE.Quaternion();
  const swayE = new THREE.Euler();
  const one3 = new THREE.Vector3(1, 1, 1);
  const pos3 = new THREE.Vector3();

  const update = (_dt: number, t: number) => {
    // Lanterns: gentle phase-offset pendulum sway.
    for (const row of lanternRows) {
      for (let i = 0; i < row.anchors.length; i++) {
        const a = row.anchors[i]!;
        swayE.set(Math.sin(t * 0.9 + a.phase) * a.amp, 0, Math.cos(t * 0.7 + a.phase) * a.amp * 0.7);
        swayQ.setFromEuler(swayE);
        pos3.setFromMatrixPosition(a.base);
        m4.compose(pos3, swayQ, one3);
        row.lanterns.setMatrixAt(i, m4);
      }
      row.lanterns.instanceMatrix.needsUpdate = true;
    }

    // Cat: tail-tip sway + occasional seeded ear twitch.
    cat.tailTip.position.x = 0.14 + Math.sin(t * 1.7) * 0.02;
    cat.tailTip.position.y = 0.045 + Math.sin(t * 2.3 + 1.2) * 0.012;
    const cycle = (t + cat.twitchSeed) % 5;
    const twitch = cycle < 0.25 ? Math.sin(cycle / 0.25 * Math.PI) : 0;
    cat.earL.rotation.z = 0.22 + twitch * 0.3;
    const cycle2 = (t + cat.twitchSeed * 1.7) % 7;
    const twitch2 = cycle2 < 0.22 ? Math.sin(cycle2 / 0.22 * Math.PI) : 0;
    cat.earR.rotation.z = -0.22 - twitch2 * 0.28;
  };

  return { group, update };
}
