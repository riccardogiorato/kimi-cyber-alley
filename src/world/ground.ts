import * as THREE from 'three';
import { ALLEY, addCollider, type AlleyContext, type BuiltPart } from '../core/types';
import { makeToon } from '../core/toon';
import { groundTexture } from '../core/textures';

export interface GroundOptions {
  /** Where sign light pools hit the ground — reflection smears get painted here. */
  lightPools: { x: number; z: number; color: number; width: number }[];
}

/**
 * Wet asphalt ground for the main alley + T-junction cross alley.
 * Wetness is faked: darker glossier toon ramp + neon smears painted into the texture.
 */
export function buildGround(ctx: AlleyContext, opts: GroundOptions): BuiltPart {
  const group = new THREE.Group();
  group.name = 'ground';

  const tex = groundTexture(ctx.rng, { lightPools: opts.lightPools });

  const mat = makeToon({
    color: 0xffffff,
    map: tex,
    gradientSteps: 3,
  });

  // Main alley floor: texture v runs along the alley length.
  const mainW = ALLEY.halfWidth * 2 + 0.4;
  const mainGeo = new THREE.PlaneGeometry(mainW, ALLEY.length + 0.4);
  const main = new THREE.Mesh(mainGeo, mat);
  main.rotation.x = -Math.PI / 2;
  main.position.set(0, 0, ALLEY.length / 2);
  group.add(main);

  // Cross alley floor strip at the T.
  const crossGeo = new THREE.PlaneGeometry(ALLEY.crossHalfWidth * 2 + 2, ALLEY.crossWidth + 0.4);
  const cross = new THREE.Mesh(crossGeo, mat);
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
