import * as THREE from 'three';

/**
 * Shared contracts for all alley subsystems.
 * Every world module receives an AlleyContext and returns a BuiltPart.
 */

/** Deterministic PRNG (mulberry32) so the alley is identical every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** World layout constants. Alley runs along +Z, width along X, ground at y=0. */
export const ALLEY = {
  /** Half-width of the main alley: walls at x = +/-halfWidth */
  halfWidth: 1.8,
  /** Main alley length along Z, from z=0 (entrance) to z=length (T-junction) */
  length: 70,
  /** Wall height */
  wallHeight: 20,
  /** Cross alley at the T: half-extent along X the player can enter */
  crossHalfWidth: 4.5,
  /** Cross alley width along Z */
  crossWidth: 3.4,
  /** Player eye height */
  eyeHeight: 1.65,
} as const;

export interface AlleyContext {
  /** Deterministic PRNG, seeded per-module. */
  rng: () => number;
  /** World-space solid AABBs. Modules push collision boxes here. */
  colliders: THREE.Box3[];
}

export interface BuiltPart {
  group: THREE.Group;
  /** Per-frame animation hook. dt in seconds, t = elapsed seconds. */
  update?: (dt: number, t: number) => void;
}

/** Helper: push a collider from center + size. */
export function addCollider(
  ctx: AlleyContext,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  ctx.colliders.push(
    new THREE.Box3(
      new THREE.Vector3(cx - sx / 2, cy - sy / 2, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy / 2, cz + sz / 2),
    ),
  );
}
