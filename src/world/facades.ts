import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon } from '../core/toon';
import {
  wallGrimeTexture,
  posterTexture,
  stickerTexture,
  graffitiTexture,
} from '../core/textures';

/**
 * Facades: towering walls on both sides of the alley + the T-junction.
 *
 * Draw-call strategy:
 *  - All wall segments (with setbacks) merged into ONE mesh, tinted per segment
 *    via vertex colors over the shared grime texture.
 *  - All density props (balconies, ducts, junction boxes, drip trays, shutter
 *    slats, stair steps...) go into a handful of InstancedMesh "kits"
 *    (unit box / unit cylinder / fan / louver / window frame) with per-instance
 *    matrix + color.
 *  - Posters/stickers/graffiti merged per texture variant (6 meshes total).
 *  - Dark panes + doorway openings merged into one mesh.
 *  - Distant silhouettes merged into one mesh.
 * Total: ~17 draw calls.
 */

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

interface MergeEntry {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
  uvScale?: [number, number];
}

const WHITE = new THREE.Color(0xffffff);

/** Merge transformed geometries into one non-indexed geometry (pos/normal/uv/color). */
function mergeGeometries(entries: MergeEntry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const normalMat = new THREE.Matrix3();
  const v = new THREE.Vector3();

  for (const e of entries) {
    const g = e.geo.index ? e.geo.toNonIndexed() : e.geo;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    normalMat.getNormalMatrix(e.matrix);
    const c = e.color ?? WHITE;
    const [su, sv] = e.uvScale ?? [1, 1];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(e.matrix);
      positions.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
      normals.push(v.x, v.y, v.z);
      if (uv) uvs.push(uv.getX(i) * su, uv.getY(i) * sv);
      else uvs.push(0, 0);
      colors.push(c.r, c.g, c.b);
    }
    if (g !== e.geo) g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return out;
}

/** Collects matrices+colors, then bakes one InstancedMesh. */
class InstanceKit {
  private readonly mats: THREE.Matrix4[] = [];
  private readonly cols: THREE.Color[] = [];

  add(matrix: THREE.Matrix4, color: THREE.Color): void {
    this.mats.push(matrix);
    this.cols.push(color);
  }

  build(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.InstancedMesh | null {
    if (this.mats.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, this.mats.length);
    mesh.name = name;
    this.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    this.cols.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }
}

/** Compose a TRS matrix. Euler order YXZ: yaw first conceptually, then local pitch/roll. */
function composeMat(
  px: number, py: number, pz: number,
  rx: number, ry: number, rz: number,
  sx: number, sy: number, sz: number,
): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    q,
    new THREE.Vector3(sx, sy, sz),
  );
}

/**
 * A flat wall face we can mount things on. Local frame:
 * u runs along the wall, n points out of the wall into walkable space.
 */
interface Face {
  ox: number; oz: number; // world point at u=0, y=0 on the face
  ux: number; uz: number; // unit vector along the wall
  nx: number; nz: number; // outward normal
  len: number;            // face length along u
  h: number;              // face height
  main: boolean;          // main-alley wall (doorways, heavy paper)
}

const yawOf = (f: Face): number => Math.atan2(f.nx, f.nz);

function onFace(f: Face, u: number, y: number, out: number): THREE.Vector3 {
  return new THREE.Vector3(
    f.ox + f.ux * u + f.nx * out,
    y,
    f.oz + f.uz * u + f.nz * out,
  );
}

/* ------------------------------------------------------------------ */
/* palette                                                             */
/* ------------------------------------------------------------------ */

const WALL_TINTS = [0x9fb4b8, 0xb8a894, 0xa89484].map((c) => new THREE.Color(c)); // teal / warm / brown grey
const PIPE_COLORS = [0x7a4a38, 0x6b7074, 0x3f5a5c].map((c) => new THREE.Color(c)); // rust / steel / verdigris
const AC_COLORS = [0x9aa0a2, 0x7d8587, 0x8b8f84].map((c) => new THREE.Color(c));
const KIT_DARK = new THREE.Color(0x2c3236);
const TRAY_COLOR = new THREE.Color(0x555c5e);
const VENT_COLOR = new THREE.Color(0x46525a);
const JBOX_COLOR = new THREE.Color(0x4a5a54);
const BALCONY_COLOR = new THREE.Color(0x3a4448);
const DOOR_FRAME_COLOR = new THREE.Color(0x33393d);
const SHUTTER_COLOR = new THREE.Color(0x4a5054);
const STAIR_COLOR = new THREE.Color(0x2e363a);
const SILHOUETTE_COLOR = new THREE.Color(0x0a1517);

/* ------------------------------------------------------------------ */
/* buildFacades                                                        */
/* ------------------------------------------------------------------ */

export function buildFacades(ctx: AlleyContext): BuiltPart {
  const rng = ctx.rng;
  const group = new THREE.Group();
  group.name = 'facades';

  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPlane = new THREE.PlaneGeometry(1, 1);

  // instanced kits
  const boxKit = new InstanceKit();    // balconies, ducts, junction boxes, trays, slats, steps
  const pipeKit = new InstanceKit();   // all pipes/conduit (unit cylinder)
  const acFanKit = new InstanceKit();  // AC fan discs
  const ventKit = new InstanceKit();   // louvered vents
  const frameKit = new InstanceKit();  // window frames
  const litWarmKit = new InstanceKit();// lit windows, warm
  const litCoolKit = new InstanceKit();// lit windows, cool

  // merged-geometry buckets
  const wallEntries: MergeEntry[] = [];
  const darkEntries: MergeEntry[] = []; // doorway openings + dark window panes
  const silEntries: MergeEntry[] = [];  // distant silhouettes
  const posterEntries: MergeEntry[][] = [[], [], [], []];
  const stickerEntries: MergeEntry[][] = [[], [], [], [], []];
  const graffitiEntries: MergeEntry[][] = [[], [], []];

  const faces: Face[] = [];
  const mainFaces: Face[] = [];

  /* ---------------- main alley walls: segmented with setbacks ---------------- */

  for (const side of [1, -1] as const) {
    let z = 0;
    while (z < ALLEY.length - 0.01) {
      const segLen = Math.min(6 + rng() * 4, ALLEY.length - z);
      // facade rhythm: step the wall face in/out so the silhouette isn't a flat corridor
      const step = rng() < 0.45 ? 0 : (0.15 + rng() * 0.25) * (rng() < 0.65 ? 1 : -0.6);
      const faceX = side * (ALLEY.halfWidth + step);
      const h = ALLEY.wallHeight - 1 + rng() * 2;
      const tint = pick(WALL_TINTS);
      wallEntries.push({
        geo: unitBox,
        matrix: composeMat(faceX + side * 0.175, h / 2, z + segLen / 2, 0, 0, 0, 0.35, h, segLen),
        color: tint,
        uvScale: [segLen / 4, h / 4],
      });
      addCollider(ctx, faceX + side * 0.3, h / 2, z + segLen / 2, 0.6, h, segLen);
      const f: Face = { ox: faceX, oz: z, ux: 0, uz: 1, nx: -side, nz: 0, len: segLen, h, main: true };
      faces.push(f);
      mainFaces.push(f);
      z += segLen;
    }
  }

  /* ---------------- T-junction walls ---------------- */

  const crossZ0 = ALLEY.length;
  const crossZ1 = ALLEY.length + ALLEY.crossWidth;
  const crossSpan = ALLEY.crossHalfWidth + 1.6; // walls continue past the walkable opening

  // far wall of the cross alley (faces back down the main alley)
  {
    let x = -crossSpan;
    while (x < crossSpan - 0.01) {
      const segLen = Math.min(5 + rng() * 3, crossSpan - x);
      const step = rng() < 0.5 ? 0 : 0.15 + rng() * 0.3;
      const faceZ = crossZ1 + step;
      const h = ALLEY.wallHeight - 2 + rng() * 3;
      wallEntries.push({
        geo: unitBox,
        matrix: composeMat(x + segLen / 2, h / 2, faceZ + 0.175, 0, 0, 0, segLen, h, 0.35),
        color: pick(WALL_TINTS),
        uvScale: [segLen / 4, h / 4],
      });
      faces.push({ ox: x, oz: faceZ, ux: 1, uz: 0, nx: 0, nz: -1, len: segLen, h, main: false });
      x += segLen;
    }
    addCollider(ctx, 0, ALLEY.wallHeight / 2, crossZ1 + 0.35, crossSpan * 2 + 1, ALLEY.wallHeight, 0.7);
  }

  // near flanks at z = length, filling |x| in [halfWidth, crossSpan]
  for (const side of [1, -1] as const) {
    const x0 = side * ALLEY.halfWidth;
    const x1 = side * crossSpan;
    const len = Math.abs(x1 - x0);
    const cx = (x0 + x1) / 2;
    const h = ALLEY.wallHeight - 1.5 + rng() * 2;
    wallEntries.push({
      geo: unitBox,
      matrix: composeMat(cx, h / 2, crossZ0 - 0.175, 0, 0, 0, len, h, 0.35),
      color: pick(WALL_TINTS),
      uvScale: [len / 4, h / 4],
    });
    addCollider(ctx, cx, h / 2, crossZ0 - 0.35, len, h, 0.7);
    faces.push({ ox: Math.min(x0, x1), oz: crossZ0, ux: 1, uz: 0, nx: 0, nz: 1, len, h, main: false });
  }

  /* ---------------- cross-alley end caps: silhouettes, not walls ---------------- */

  for (const side of [1, -1] as const) {
    // dark building mass a few meters past the walkable edge -> reads as depth
    silEntries.push({
      geo: unitBox,
      matrix: composeMat(
        side * (ALLEY.crossHalfWidth + 3.5), 13, (crossZ0 + crossZ1) / 2,
        0, 0, 0, 7, 26, ALLEY.crossWidth + 6,
      ),
      color: SILHOUETTE_COLOR,
    });
    // invisible collider at the walkable edge of the cross alley
    addCollider(ctx, side * (ALLEY.crossHalfWidth + 0.15), 10, (crossZ0 + crossZ1) / 2, 0.3, 20, ALLEY.crossWidth + 0.4);
  }
  // taller distant towers behind the T, visible above 8m against the sky
  silEntries.push(
    { geo: unitBox, matrix: composeMat(-9, 17, crossZ1 + 6, 0, 0.2, 0, 9, 34, 9), color: SILHOUETTE_COLOR },
    { geo: unitBox, matrix: composeMat(7, 21, crossZ1 + 10, 0, -0.15, 0, 10, 42, 10), color: SILHOUETTE_COLOR },
    { geo: unitBox, matrix: composeMat(1, 24, crossZ1 + 18, 0, 0.1, 0, 12, 48, 12), color: SILHOUETTE_COLOR },
  );

  /* ---------------- per-face decoration ---------------- */

  function addBalcony(f: Face, u: number, y: number): void {
    const yaw = yawOf(f);
    const slab = onFace(f, u, y, 0.42);
    boxKit.add(composeMat(slab.x, slab.y, slab.z, 0, yaw, 0, 1.7, 0.09, 0.84), BALCONY_COLOR);
    const bar = onFace(f, u, y + 1.0, 0.8);
    boxKit.add(composeMat(bar.x, bar.y, bar.z, 0, yaw, 0, 1.7, 0.05, 0.05), BALCONY_COLOR);
    for (const du of [-0.8, -0.27, 0.27, 0.8]) {
      const v = onFace(f, u + du, y + 0.52, 0.8);
      boxKit.add(composeMat(v.x, v.y, v.z, 0, yaw, 0, 0.04, 0.96, 0.04), BALCONY_COLOR);
    }
    for (const du of [-0.85, 0.85]) {
      const s = onFace(f, u + du, y + 1.0, 0.42);
      boxKit.add(composeMat(s.x, s.y, s.z, 0, yaw, 0, 0.05, 0.05, 0.8), BALCONY_COLOR);
    }
    // diagonal support struts back to the wall
    for (const du of [-0.6, 0.6]) {
      const s = onFace(f, u + du, y - 0.35, 0.3);
      boxKit.add(composeMat(s.x, s.y, s.z, -0.7, yaw, 0, 0.05, 0.9, 0.05), BALCONY_COLOR);
    }
  }

  function scatterPaper(f: Face): void {
    const yaw = yawOf(f);
    const n = Math.floor(f.len * (f.main ? 1.4 : 0.6));
    for (let i = 0; i < n; i++) {
      const u = 0.4 + rng() * Math.max(0.1, f.len - 0.8);
      const out = 0.02 + rng() * 0.025;
      const p = onFace(f, u, 0, out);
      let tilt = (rng() - 0.5) * 0.24;
      if (rng() < 0.25) tilt += Math.PI; // torn / haphazardly pasted
      const kind = rng();
      if (kind < 0.45) {
        const w = 0.55 + rng() * 0.25;
        const h = 0.8 + rng() * 0.3;
        posterEntries[Math.floor(rng() * 4)]!.push({
          geo: unitPlane,
          matrix: composeMat(p.x, 0.5 + rng() * 1.7, p.z, 0, yaw, tilt, w, h, 1),
        });
      } else if (kind < 0.78) {
        const nStickers = 1 + Math.floor(rng() * 3);
        for (let s = 0; s < nStickers; s++) {
          const q = onFace(f, Math.min(f.len - 0.2, Math.max(0.2, u + (rng() - 0.5) * 0.5)), 0, out + 0.005 * s);
          stickerEntries[Math.floor(rng() * 5)]!.push({
            geo: unitPlane,
            matrix: composeMat(q.x, 0.4 + rng() * 2.2, q.z, 0, yaw, (rng() - 0.5) * 0.6, 0.18 + rng() * 0.16, 0.2 + rng() * 0.18, 1),
          });
        }
      } else {
        const w = 1.2 + rng() * 0.7;
        const h = 0.8 + rng() * 0.35;
        graffitiEntries[Math.floor(rng() * 3)]!.push({
          geo: unitPlane,
          matrix: composeMat(p.x, 0.9 + rng() * 0.9, p.z, 0, yaw, (rng() - 0.5) * 0.08, w, h, 1),
        });
      }
    }
  }

  function decorateFace(f: Face): void {
    const yaw = yawOf(f);

    // windows: frame + dark pane, some lit warm/cool
    for (let y = 4.1; y < f.h - 1.6; y += 3.1) {
      for (let u = 1.1; u < f.len - 1.0; u += 1.9) {
        if (rng() < 0.45) continue;
        const p = onFace(f, u, y, 0.05);
        frameKit.add(composeMat(p.x, p.y, p.z, 0, yaw, 0, 1, 1, 1), KIT_DARK);
        if (rng() < 0.15) {
          const pp = onFace(f, u, y, 0.045);
          (rng() < 0.7 ? litWarmKit : litCoolKit).add(
            composeMat(pp.x, pp.y, pp.z, 0, yaw, 0, 1, 1, 1), WHITE,
          );
        } else {
          const pp = onFace(f, u, y, 0.03);
          darkEntries.push({ geo: unitPlane, matrix: composeMat(pp.x, pp.y, pp.z, 0, yaw, 0, 0.82, 1.08, 1) });
        }
      }
    }

    // vertical pipes
    const nPipes = Math.max(1, Math.floor(f.len / 7));
    for (let i = 0; i < nPipes; i++) {
      const u = 0.8 + rng() * Math.max(0.1, f.len - 1.6);
      const len = 5 + rng() * 7;
      const r = 0.05 + rng() * 0.04;
      const p = onFace(f, u, len / 2, 0.1 + r);
      pipeKit.add(composeMat(p.x, p.y, p.z, 0, yaw, 0, r, len, r), pick(PIPE_COLORS));
    }

    // horizontal pipe run
    if (rng() < 0.4 && f.len > 4) {
      const y = 2.9 + rng() * 0.7;
      const len = Math.min(f.len - 1, 4 + rng() * 4);
      const u = 0.5 + rng() * Math.max(0.1, f.len - len - 0.5);
      const r = 0.04 + rng() * 0.03;
      const p = onFace(f, u + len / 2, y, 0.08 + r);
      pipeKit.add(composeMat(p.x, p.y, p.z, Math.PI / 2, yaw + Math.PI / 2, 0, r, len, r), pick(PIPE_COLORS));
    }

    // AC outdoor units (+ fan disc + drip tray)
    if (f.len > 4 && rng() < 0.6) {
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const u = 1 + rng() * (f.len - 2);
        const y = 2.6 + rng() * 4.5;
        const col = pick(AC_COLORS);
        const p = onFace(f, u, y, 0.16);
        boxKit.add(composeMat(p.x, p.y, p.z, 0, yaw, 0, 0.78, 0.56, 0.3), col);
        const pf = onFace(f, u, y, 0.32);
        acFanKit.add(composeMat(pf.x, pf.y, pf.z, 0, yaw, 0, 1, 1, 1), KIT_DARK);
        const pt = onFace(f, u, y - 0.36, 0.18);
        boxKit.add(composeMat(pt.x, pt.y, pt.z, 0, yaw, 0, 0.7, 0.03, 0.34), TRAY_COLOR);
      }
    }

    // louvered vent
    if (rng() < 0.5 && f.len > 3) {
      const u = 1 + rng() * (f.len - 2);
      const p = onFace(f, u, 1.6 + rng() * 3, 0.07);
      ventKit.add(composeMat(p.x, p.y, p.z, 0, yaw, 0, 1, 1, 1), VENT_COLOR);
    }

    // junction box + conduit run upward
    if (f.main && rng() < 0.5) {
      const u = 0.8 + rng() * Math.max(0.1, f.len - 1.6);
      const y = 1.3 + rng() * 0.5;
      const p = onFace(f, u, y, 0.07);
      boxKit.add(composeMat(p.x, p.y, p.z, 0, yaw, 0, 0.26, 0.36, 0.13), JBOX_COLOR);
      const pc = onFace(f, u, y + 1.4, 0.05);
      pipeKit.add(composeMat(pc.x, pc.y, pc.z, 0, yaw, 0, 0.02, 2.4, 0.02), JBOX_COLOR);
    }

    // small balcony
    if (f.main && f.len > 5 && rng() < 0.35) {
      addBalcony(f, 1.2 + rng() * (f.len - 2.4), 3.4 + rng() * 2.2);
    }

    scatterPaper(f);
  }

  for (const f of faces) decorateFace(f);

  /* ---------------- recessed doorways (one shuttered) ---------------- */

  const doorFaces: { f: Face; u: number }[] = [];
  for (const f of mainFaces) {
    if (doorFaces.length < 3 && f.len > 6 && rng() < 0.3) {
      doorFaces.push({ f, u: f.len / 2 });
    }
  }
  while (doorFaces.length < 2 && mainFaces.length > 0) {
    doorFaces.push({ f: pick(mainFaces), u: 2 + rng() * 3 });
  }
  doorFaces.forEach(({ f, u }, idx) => {
    const yaw = yawOf(f);
    const p = onFace(f, u, 1.15, 0.02);
    darkEntries.push({ geo: unitPlane, matrix: composeMat(p.x, p.y, p.z, 0, yaw, 0, 1.2, 2.3, 1) });
    const lintel = onFace(f, u, 2.38, 0.05);
    boxKit.add(composeMat(lintel.x, lintel.y, lintel.z, 0, yaw, 0, 1.44, 0.16, 0.1), DOOR_FRAME_COLOR);
    for (const du of [-0.68, 0.68]) {
      const j = onFace(f, u + du, 1.15, 0.05);
      boxKit.add(composeMat(j.x, j.y, j.z, 0, yaw, 0, 0.12, 2.3, 0.1), DOOR_FRAME_COLOR);
    }
    if (idx === 0) {
      // shutter door drawn with instanced slats
      for (let sy = 0.15; sy < 2.25; sy += 0.115) {
        const s = onFace(f, u, sy, 0.045);
        boxKit.add(composeMat(s.x, s.y, s.z, 0, yaw, 0, 1.14, 0.09, 0.03), SHUTTER_COLOR);
      }
    }
  });

  /* ---------------- external zig-zag staircase (right wall) ---------------- */

  {
    // use the shallowest face across z 33..41 so steps never sink into a setback
    let faceX = ALLEY.halfWidth + 0.45;
    for (const f of mainFaces) {
      if (f.nx !== -1) continue;
      if (f.oz < 41 && f.oz + f.len > 33) faceX = Math.min(faceX, f.ox);
    }
    const x = faceX - 0.5; // stair centerline 0.5m off the wall
    let y = 2.6;
    let z = 33.5;
    let dir = 1;
    for (let flight = 0; flight < 3; flight++) {
      for (let i = 0; i < 8; i++) {
        boxKit.add(composeMat(x, y + i * 0.19, z + dir * i * 0.26, 0, 0, 0, 0.95, 0.06, 0.27), STAIR_COLOR);
      }
      const run = 7 * 0.26;
      const rise = 7 * 0.19;
      const railLen = Math.hypot(run, rise);
      const ang = Math.atan2(rise, run) * dir;
      boxKit.add(composeMat(x - 0.42, y + rise / 2 + 1.0, z + dir * run / 2, -ang, 0, 0, 0.05, 0.05, railLen), STAIR_COLOR);
      y += rise + 0.19;
      z += dir * (run + 0.26);
      boxKit.add(composeMat(x, y, z + dir * 0.45, 0, 0, 0, 0.95, 0.07, 0.95), STAIR_COLOR); // landing
      z += dir * 0.95;
      dir *= -1;
    }
    // support column down to the ground at the first landing -> collider
    const colZ = 33.5 + 7 * 0.26 + 0.26 + 0.45;
    const colH = 2.6 + 7 * 0.19 + 0.19;
    boxKit.add(composeMat(x, colH / 2, colZ, 0, 0, 0, 0.14, colH, 0.14), STAIR_COLOR);
    addCollider(ctx, x, colH / 2, colZ, 0.2, colH, 0.2);
  }

  /* ---------------- ground-level protrusions (colliders) ---------------- */

  const faceXAt = (side: number, z: number): number => {
    for (const f of mainFaces) {
      if (f.nx === -side && z >= f.oz && z <= f.oz + f.len) return f.ox;
    }
    return side * ALLEY.halfWidth;
  };

  // low AC condensers on stands
  for (const { side, z } of [{ side: -1, z: 18 }, { side: 1, z: 52 }] as const) {
    const faceX = faceXAt(side, z);
    const n = -side;
    const yaw = Math.atan2(n, 0);
    const cx = faceX + n * 0.2;
    boxKit.add(composeMat(cx, 0.42, z, 0, yaw, 0, 0.85, 0.62, 0.36), pick(AC_COLORS));
    acFanKit.add(composeMat(faceX + n * 0.39, 0.42, z, 0, yaw, 0, 1, 1, 1), KIT_DARK);
    boxKit.add(composeMat(cx, 0.08, z, 0, yaw, 0, 0.7, 0.05, 0.3), TRAY_COLOR); // drip tray
    addCollider(ctx, cx, 0.45, z, 0.42, 0.9, 0.9);
  }

  // fat ground-level pipe run along the left wall
  {
    const z = 43;
    const faceX = faceXAt(-1, z);
    const cx = faceX + 0.24;
    pipeKit.add(composeMat(cx, 0.18, z, Math.PI / 2, Math.PI / 2, 0, 0.16, 6, 0.16), pick(PIPE_COLORS));
    addCollider(ctx, cx, 0.18, z, 0.36, 0.36, 6);
  }

  /* ---------------- bake everything ---------------- */

  const wallMat = makeToon({ color: 0xffffff, map: wallGrimeTexture(rng), gradientSteps: 3 });
  wallMat.vertexColors = true; // per-segment tint lives in the color attribute
  const walls = new THREE.Mesh(mergeGeometries(wallEntries), wallMat);
  walls.name = 'walls';
  group.add(walls);

  const darkMat = makeToon({ color: 0x0b1114, gradientSteps: 2 });
  const darkMesh = new THREE.Mesh(mergeGeometries(darkEntries), darkMat);
  darkMesh.name = 'dark-openings';
  group.add(darkMesh);

  const silMat = makeToon({ color: 0x0a1517, gradientSteps: 2 });
  const silMesh = new THREE.Mesh(mergeGeometries(silEntries), silMat);
  silMesh.name = 'silhouettes';
  group.add(silMesh);

  // paper layer: one mesh per texture variant
  const paperBuckets: { entries: MergeEntry[][]; make: (v: number) => THREE.Texture; name: string }[] = [
    { entries: posterEntries, make: (v) => posterTexture(rng, v), name: 'posters' },
    { entries: stickerEntries, make: (v) => stickerTexture(rng, v), name: 'stickers' },
    { entries: graffitiEntries, make: (v) => graffitiTexture(rng, v), name: 'graffiti' },
  ];
  for (const { entries, make, name } of paperBuckets) {
    entries.forEach((list, v) => {
      if (list.length === 0) return;
      const mesh = new THREE.Mesh(
        mergeGeometries(list),
        makeToon({ color: 0xffffff, map: make(v), gradientSteps: 2 }),
      );
      mesh.name = `${name}-${v}`;
      group.add(mesh);
    });
  }

  // instanced kits
  const kitMat = makeToon({ color: 0xffffff, gradientSteps: 3 }); // instanceColor does the tinting
  const addKit = (kit: InstanceKit, geo: THREE.BufferGeometry, mat: THREE.Material, name: string): void => {
    const mesh = kit.build(geo, mat, name);
    if (mesh) group.add(mesh);
  };

  addKit(boxKit, unitBox, kitMat, 'box-kit');
  addKit(pipeKit, new THREE.CylinderGeometry(1, 1, 1, 10), kitMat, 'pipe-kit');

  const fanGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.03, 14);
  fanGeo.rotateX(Math.PI / 2); // disc faces out of the wall
  addKit(acFanKit, fanGeo, makeToon({ color: 0x2c3236, gradientSteps: 2 }), 'ac-fans');

  const ventGeo = mergeGeometries([
    { geo: unitBox, matrix: composeMat(0, 0, 0, 0, 0, 0, 0.62, 0.5, 0.1) },
    ...[-0.15, -0.05, 0.05, 0.15].map((y) => ({
      geo: unitBox,
      matrix: composeMat(0, y, 0.06, 0.6, 0, 0, 0.56, 0.05, 0.02),
    })),
  ]);
  addKit(ventKit, ventGeo, kitMat, 'vents');

  const frameGeo = mergeGeometries([
    { geo: unitBox, matrix: composeMat(0, 0.615, 0, 0, 0, 0, 1.0, 0.07, 0.09) },
    { geo: unitBox, matrix: composeMat(0, -0.615, 0, 0, 0, 0, 1.0, 0.07, 0.09) },
    { geo: unitBox, matrix: composeMat(-0.465, 0, 0, 0, 0, 0, 0.07, 1.16, 0.09) },
    { geo: unitBox, matrix: composeMat(0.465, 0, 0, 0, 0, 0, 0.07, 1.16, 0.09) },
    { geo: unitBox, matrix: composeMat(0, 0, 0, 0, 0, 0, 0.93, 0.04, 0.05) }, // cross mullion
  ]);
  addKit(frameKit, frameGeo, makeToon({ color: 0x39424a, gradientSteps: 2 }), 'window-frames');

  const litGeo = new THREE.PlaneGeometry(0.82, 1.08);
  addKit(litWarmKit, litGeo, makeToon({ color: 0x1a0f08, emissive: 0xff9a4d, emissiveIntensity: 1.6 }), 'lit-warm');
  addKit(litCoolKit, litGeo, makeToon({ color: 0x0a1418, emissive: 0x9fd8ff, emissiveIntensity: 1.4 }), 'lit-cool');

  return { group };
}
