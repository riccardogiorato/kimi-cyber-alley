import * as THREE from 'three';
import { ALLEY, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon } from '../core/toon';
import { awningTexture } from '../core/textures';

/**
 * Overhead: chokes the sky between 3.5m and 8m with awnings, sagging tarps,
 * catenary cable bundles, ductwork, sign brackets and string-light wire runs.
 * Leaves deliberate gaps (exported as `rainGaps`) where sky/rain come through.
 * Nothing above 8m — the alley stays open to the dark teal sky.
 *
 * Draw-call strategy:
 *  - All awnings merged into ONE mesh (shared striped texture, per-instance
 *    tint via vertex colors), all tarps merged into ONE mesh (patched variant).
 *  - All cables + string-light wires merged into ONE tube mesh.
 *  - Connector boxes + sign brackets instanced into two InstancedMeshes.
 *  - Ductwork merged into one mesh.
 * Total: ~6 draw calls.
 */

export interface OverheadPart extends BuiltPart {
  /** Openings in the overhead clutter where rain/sky come through. */
  rainGaps: { x: number; z: number; width: number }[];
}

interface MergeEntry {
  geo: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

const WHITE = new THREE.Color(0xffffff);

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
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(e.matrix);
      positions.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
      normals.push(v.x, v.y, v.z);
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
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

/** Plane with a gentle low-frequency sag baked into its vertices. */
function saggingPlane(
  w: number, h: number, segW: number, segH: number, sag: number, rng: () => number,
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h, segW, segH);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / w + 0.5;
    const y = pos.getY(i) / h + 0.5;
    // bell-shaped sag: deepest mid-span, zero at the edges
    const belly = Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
    const ripple = Math.sin(x * 9 + phase) * Math.sin(y * 7 + phase * 1.7) * 0.03;
    pos.setZ(i, -belly * sag + ripple);
  }
  geo.computeVertexNormals();
  return geo;
}

const AWNING_TINTS = [0xb8b2a6, 0x9fb4b6, 0xb09a8a, 0x8fa39a].map((c) => new THREE.Color(c));
const TARP_TINTS = [0x6f7d80, 0x7d7468, 0x5f6e72].map((c) => new THREE.Color(c));
const CABLE_COLOR = new THREE.Color(0x14181a);
const DUCT_COLOR = new THREE.Color(0x5a6468);
const BRACKET_COLOR = new THREE.Color(0x2e363a);
const BOX_COLOR = new THREE.Color(0x3c4a48);

export function buildOverhead(ctx: AlleyContext): OverheadPart {
  const rng = ctx.rng;
  const group = new THREE.Group();
  group.name = 'overhead';

  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

  const awningEntries: MergeEntry[] = [];
  const tarpEntries: MergeEntry[] = [];
  const cableEntries: MergeEntry[] = [];
  const ductEntries: MergeEntry[] = [];
  const boxMats: THREE.Matrix4[] = [];
  const bracketMats: THREE.Matrix4[] = [];

  const rainGaps: OverheadPart['rainGaps'] = [];

  const mat4 = (
    px: number, py: number, pz: number,
    rx: number, ry: number, rz: number,
    sx = 1, sy = 1, sz = 1,
  ): THREE.Matrix4 =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(px, py, pz),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz),
    );

  /* ---------------- awnings + tarps along the main alley ---------------- */
  /* Coverage runs down the alley in chunks; uncovered chunks become rainGaps. */

  let z = 3.5;
  while (z < ALLEY.length - 4) {
    if (rng() < 0.42) {
      // leave a gap for sky/rain
      const gapW = 3.5 + rng() * 4;
      rainGaps.push({ x: (rng() - 0.5) * 1.2, z: z + gapW / 2, width: gapW });
      z += gapW;
      continue;
    }
    const side = rng() < 0.5 ? 1 : -1;
    const wallX = side * ALLEY.halfWidth;
    const runLen = 2.2 + rng() * 2.6;
    const y = 4.6 + rng() * 3.4;

    if (rng() < 0.55) {
      // striped awning: angled plane jutting from the wall toward the alley
      const depth = 1.0 + rng() * 0.5;
      const tilt = 0.5 + rng() * 0.25; // droops away from the wall
      const cx = wallX - side * depth / 2;
      awningEntries.push({
        geo: new THREE.PlaneGeometry(runLen, depth, 1, 1),
        matrix: mat4(cx, y, z + runLen / 2, -Math.PI / 2 + tilt * side, 0, 0),
        color: pick(AWNING_TINTS),
      });
    } else {
      // sagging tarp spanning most of the alley
      const span = ALLEY.halfWidth * 2 - 0.3 - rng() * 0.8;
      const sag = 0.25 + rng() * 0.3;
      const geo = saggingPlane(span, runLen, 8, 6, sag, rng);
      tarpEntries.push({
        geo,
        matrix: mat4((rng() - 0.5) * 0.5, y + 0.4, z + runLen / 2, -Math.PI / 2, 0, 0),
        color: pick(TARP_TINTS),
      });
    }
    z += runLen;
  }

  // a couple of tarps over the cross alley too
  for (let i = 0; i < 2; i++) {
    const span = 2.6 + rng() * 1.4;
    const geo = saggingPlane(span, ALLEY.crossWidth - 0.4, 8, 4, 0.3 + rng() * 0.2, rng);
    const x = (rng() < 0.5 ? -1 : 1) * (1.2 + rng() * 2.2);
    tarpEntries.push({
      geo,
      matrix: mat4(x, 4.2 + rng() * 2, ALLEY.length + ALLEY.crossWidth / 2, -Math.PI / 2, 0, 0),
      color: pick(TARP_TINTS),
    });
  }

  /* ---------------- catenary cable bundles ---------------- */

  const addCable = (
    a: THREE.Vector3, b: THREE.Vector3, sag: number, radius: number,
  ): THREE.Vector3 => {
    const mid = a.clone().lerp(b, 0.5);
    mid.y -= sag;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    cableEntries.push({ geo: new THREE.TubeGeometry(curve, 14, radius, 5), matrix: new THREE.Matrix4(), color: CABLE_COLOR });
    return curve.getPoint(0.5 + (rng() - 0.5) * 0.3); // a point on the wire for hanging boxes
  };

  // cross-alley spans at several heights, some in parallel bundles
  const nSpans = 9 + Math.floor(rng() * 3);
  for (let i = 0; i < nSpans; i++) {
    const cz = 4 + rng() * (ALLEY.length - 8);
    const cy = 4.2 + rng() * 3.4;
    const bundle = 1 + Math.floor(rng() * 3);
    const hang = rng() < 0.45;
    for (let c = 0; c < bundle; c++) {
      const off = c * 0.09;
      const p = addCable(
        new THREE.Vector3(-ALLEY.halfWidth - 0.1, cy - off, cz + off * 0.5),
        new THREE.Vector3(ALLEY.halfWidth + 0.1, cy - off + (rng() - 0.5) * 0.3, cz - off * 0.5),
        0.35 + rng() * 0.5,
        0.016,
      );
      if (hang && c === 0) {
        // connector box dangling from the wire
        boxMats.push(mat4(p.x, p.y - 0.16, p.z, 0, rng() * Math.PI, 0, 0.22, 0.3, 0.14));
        boxMats.push(mat4(p.x, p.y - 0.04, p.z, 0, 0, 0, 0.03, 0.1, 0.03)); // stub to the wire
      }
    }
  }

  // longitudinal runs hugging each wall
  for (const side of [-1, 1] as const) {
    const runs = 2 + Math.floor(rng() * 2);
    for (let r = 0; r < runs; r++) {
      const cy = 5 + rng() * 2.6;
      const cx = side * (ALLEY.halfWidth - 0.12 - r * 0.07);
      addCable(
        new THREE.Vector3(cx, cy, 1),
        new THREE.Vector3(cx + (rng() - 0.5) * 0.2, cy - 0.2, ALLEY.length - 1),
        0.5 + rng() * 0.4,
        0.014,
      );
    }
  }

  // string-light wire runs (wire only — lanterns belong to another module)
  for (let i = 0; i < 3; i++) {
    const cz = 8 + i * 20 + rng() * 6;
    const cy = 3.4 + rng() * 0.6;
    addCable(
      new THREE.Vector3(-ALLEY.halfWidth + 0.05, cy, cz),
      new THREE.Vector3(ALLEY.halfWidth - 0.05, cy + (rng() - 0.5) * 0.2, cz + (rng() - 0.5) * 0.6),
      0.28 + rng() * 0.2,
      0.008,
    );
  }

  /* ---------------- ductwork along the walls ---------------- */

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  for (const side of [-1, 1] as const) {
    const y = 6.2 + rng() * 1.2;
    const x = side * (ALLEY.halfWidth - 0.22);
    let dz = 2 + rng() * 4;
    while (dz < ALLEY.length - 6) {
      const len = 6 + rng() * 6;
      const end = Math.min(dz + len, ALLEY.length - 2);
      ductEntries.push({
        geo: unitBox,
        matrix: mat4(x, y, (dz + end) / 2, 0, 0, 0, 0.34, 0.3, end - dz),
        color: DUCT_COLOR,
      });
      // elbow: drop down and jog toward the wall
      ductEntries.push(
        { geo: unitBox, matrix: mat4(x, y - 0.45, end, 0, 0, 0, 0.3, 0.9, 0.3), color: DUCT_COLOR },
        { geo: unitBox, matrix: mat4(x + side * 0.12, y - 0.9, end, 0, 0, 0, 0.28, 0.28, 0.5), color: DUCT_COLOR },
      );
      dz = end + 3 + rng() * 5;
    }
  }

  /* ---------------- hanging sign brackets (infrastructure only) ---------------- */

  for (let i = 0; i < 6; i++) {
    const side = rng() < 0.5 ? 1 : -1;
    const bz = 6 + rng() * (ALLEY.length - 12);
    const by = 3.2 + rng() * 2.4;
    const wallX = side * ALLEY.halfWidth;
    const armLen = 0.7 + rng() * 0.4;
    // horizontal arm out of the wall + short drop rod for the sign to hang from
    bracketMats.push(mat4(wallX - side * armLen / 2, by, bz, 0, 0, 0, armLen, 0.05, 0.05));
    bracketMats.push(mat4(wallX - side * (armLen - 0.05), by - 0.2, bz, 0, 0, 0, 0.04, 0.4, 0.04));
    // diagonal brace back to the wall
    bracketMats.push(mat4(wallX - side * armLen * 0.35, by - 0.22, bz, 0, 0, side * 0.7, 0.04, armLen * 0.8, 0.04));
  }

  /* ---------------- bake ---------------- */

  const awningMat = makeToon({ color: 0xffffff, map: awningTexture(rng, 0), gradientSteps: 3 });
  awningMat.vertexColors = true;
  awningMat.side = THREE.DoubleSide;
  const awnings = new THREE.Mesh(mergeGeometries(awningEntries), awningMat);
  awnings.name = 'awnings';
  group.add(awnings);

  const tarpMat = makeToon({ color: 0xffffff, map: awningTexture(rng, 1), gradientSteps: 3 });
  tarpMat.vertexColors = true;
  tarpMat.side = THREE.DoubleSide;
  const tarps = new THREE.Mesh(mergeGeometries(tarpEntries), tarpMat);
  tarps.name = 'tarps';
  group.add(tarps);

  const cableMat = makeToon({ color: 0x14181a, gradientSteps: 2 });
  const cables = new THREE.Mesh(mergeGeometries(cableEntries), cableMat);
  cables.name = 'cables';
  group.add(cables);

  const ductMat = makeToon({ color: 0xffffff, gradientSteps: 3 });
  ductMat.vertexColors = true;
  const ducts = new THREE.Mesh(mergeGeometries(ductEntries), ductMat);
  ducts.name = 'ducts';
  group.add(ducts);

  const kitMat = makeToon({ color: 0xffffff, gradientSteps: 2 });
  const boxes = new THREE.InstancedMesh(unitBox, kitMat, Math.max(1, boxMats.length));
  boxes.name = 'connector-boxes';
  boxMats.forEach((m, i) => boxes.setMatrixAt(i, m));
  boxMats.forEach((_, i) => boxes.setColorAt(i, BOX_COLOR));
  boxes.count = boxMats.length;
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  group.add(boxes);

  const brackets = new THREE.InstancedMesh(unitBox, kitMat, Math.max(1, bracketMats.length));
  brackets.name = 'sign-brackets';
  bracketMats.forEach((m, i) => brackets.setMatrixAt(i, m));
  bracketMats.forEach((_, i) => brackets.setColorAt(i, BRACKET_COLOR));
  brackets.count = bracketMats.length;
  brackets.instanceMatrix.needsUpdate = true;
  if (brackets.instanceColor) brackets.instanceColor.needsUpdate = true;
  group.add(brackets);

  /* ---------------- sway animation ---------------- */
  /* Vertex-less: bob/rotate whole merged meshes + hanging boxes slightly. */

  const baseAwningsRot = awnings.rotation.z;
  const baseTarpsY = tarps.position.y;
  const baseBoxesRot = boxes.rotation.x;

  const update = (_dt: number, t: number): void => {
    awnings.rotation.z = baseAwningsRot + Math.sin(t * 0.9) * 0.004;
    tarps.position.y = baseTarpsY + Math.sin(t * 1.3 + 1.7) * 0.02;
    tarps.rotation.x = Math.sin(t * 0.7 + 0.4) * 0.003;
    boxes.rotation.x = baseBoxesRot + Math.sin(t * 1.1 + 2.2) * 0.01;
    boxes.rotation.z = Math.sin(t * 0.8) * 0.008;
  };

  return { group, update, rainGaps };
}
