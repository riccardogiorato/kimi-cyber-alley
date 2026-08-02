import * as THREE from 'three';
import { ALLEY } from './types';

const WALK_SPEED = 2.2; // m/s
const RUN_SPEED = 4.5; // m/s
const ACCEL = 14; // 1/s exponential approach rate
const MOUSE_SENS = 0.0022; // rad per pixel
const PITCH_LIMIT = THREE.MathUtils.degToRad(85);
const HALF_W = 0.25; // player AABB half extents (0.5 x 1.7 x 0.5)
const HEIGHT = 1.7;
const MARGIN = 0.28; // keep-away from walls / alley ends
const BOB_FREQ = 9.5; // rad/s at full stride
const BOB_AMP = 0.022; // metres — deliberately subtle

/**
 * Pointer-lock first-person controller.
 *
 * - Click `dom` to lock, Esc releases (browser default).
 * - Mouse look: yaw on the player, pitch on the camera (clamped ±85°).
 * - WASD relative to yaw, Shift to run, smooth acceleration/damping.
 * - Collision: axis-separated AABB push-out against the collider list,
 *   plus clamps to the playable alley + T-junction cross alley.
 * - Flat ground at y=0, eye at ALLEY.eyeHeight. No gravity/jump.
 */
export class PlayerController {
  /** True while pointer lock is held on `dom`. */
  isLocked = false;
  /** Fired whenever pointer lock is acquired or released. */
  onLockChange?: (locked: boolean) => void;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly colliders: THREE.Box3[];

  private yaw = 0;
  private pitch = 0;
  private readonly pos = new THREE.Vector3(0, 0, 2.5); // feet position
  private readonly vel = new THREE.Vector3();
  private bobPhase = 0;
  private bobOffset = 0;

  private readonly keys = new Set<string>();

  // Scratch objects — reused every frame, zero per-frame allocations.
  private readonly wish = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly playerBox = new THREE.Box3();
  private readonly boxMin = new THREE.Vector3();
  private readonly boxMax = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, colliders: THREE.Box3[]) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;

    this.camera.rotation.order = 'YXZ';
    this.syncCamera();

    dom.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onLockEvent);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Place the player at (x, z) with an optional yaw. */
  teleport(x: number, z: number, yaw?: number): void {
    this.pos.set(x, 0, z);
    if (yaw !== undefined) this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.bobPhase = 0;
    this.bobOffset = 0;
    this.syncCamera();
  }

  /** Set view pitch directly (radians). Used by the screenshot harness. */
  setPitch(pitch: number): void {
    this.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.syncCamera();
  }

  /** Advance movement + camera. dt in seconds. */
  update(dt: number): void {
    // --- wish direction from keys, relative to yaw
    const k = this.keys;
    const iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    const wish = this.wish.set(0, 0, 0);
    if (ix !== 0 || iz !== 0) {
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const fwd = this.fwd.set(-sin, 0, -cos);
      const right = this.right.set(cos, 0, -sin);
      wish.addScaledVector(fwd, iz).addScaledVector(right, ix).normalize();
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
      wish.multiplyScalar(speed);
    }

    // --- smooth acceleration / damping
    const blend = 1 - Math.exp(-ACCEL * dt);
    this.vel.x += (wish.x - this.vel.x) * blend;
    this.vel.z += (wish.z - this.vel.z) * blend;

    // --- axis-separated movement + collision
    this.pos.x += this.vel.x * dt;
    this.resolveAxis(0);
    this.pos.z += this.vel.z * dt;
    this.resolveAxis(2);
    this.clampToAlley();

    // --- subtle head-bob, scaled by actual speed
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const speedNorm = Math.min(speed / RUN_SPEED, 1);
    this.bobPhase += dt * BOB_FREQ * speedNorm;
    const target = Math.sin(this.bobPhase) * BOB_AMP * speedNorm;
    this.bobOffset += (target - this.bobOffset) * Math.min(1, dt * 12);

    this.syncCamera();
  }

  /** Remove listeners (not needed for this app, but keeps the class tidy). */
  dispose(): void {
    this.dom.removeEventListener('click', this.onClick);
    document.removeEventListener('pointerlockchange', this.onLockEvent);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  // ---------------------------------------------------------------- private

  private syncCamera(): void {
    this.camera.position.set(this.pos.x, this.pos.y + ALLEY.eyeHeight + this.bobOffset, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Push the player AABB out of any collider along one axis. */
  private resolveAxis(axis: 0 | 2): void {
    const min = this.boxMin.set(this.pos.x - HALF_W, this.pos.y, this.pos.z - HALF_W);
    const max = this.boxMax.set(this.pos.x + HALF_W, this.pos.y + HEIGHT, this.pos.z + HALF_W);
    const box = this.playerBox;
    box.min.copy(min);
    box.max.copy(max);
    for (const c of this.colliders) {
      if (!box.intersectsBox(c)) continue;
      if (axis === 0) {
        const cMid = (c.min.x + c.max.x) * 0.5;
        this.pos.x = this.pos.x < cMid ? c.min.x - HALF_W : c.max.x + HALF_W;
        this.vel.x = 0;
        box.min.x = this.pos.x - HALF_W;
        box.max.x = this.pos.x + HALF_W;
      } else {
        const cMid = (c.min.z + c.max.z) * 0.5;
        this.pos.z = this.pos.z < cMid ? c.min.z - HALF_W : c.max.z + HALF_W;
        this.vel.z = 0;
        box.min.z = this.pos.z - HALF_W;
        box.max.z = this.pos.z + HALF_W;
      }
    }
  }

  /** Clamp to the playable space: main alley + the T-junction cross alley. */
  private clampToAlley(): void {
    const mainMaxX = ALLEY.halfWidth - MARGIN;
    const crossMaxX = ALLEY.crossHalfWidth - MARGIN;
    const crossZ0 = ALLEY.length;
    const crossZ1 = ALLEY.length + ALLEY.crossWidth;

    if (this.pos.z < crossZ0) {
      // Main alley: walls at +/-halfWidth, entrance behind spawn.
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -mainMaxX, mainMaxX);
      if (this.pos.z < 0.3) this.pos.z = 0.3;
    } else {
      // Cross alley: wider in X, but block the deep ends of the T.
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -crossMaxX, crossMaxX);
      if (this.pos.z > crossZ1 - MARGIN) this.pos.z = crossZ1 - MARGIN;
    }
  }

  private onClick = (): void => {
    if (!this.isLocked) this.dom.requestPointerLock();
  };

  private onLockEvent = (): void => {
    const locked = document.pointerLockElement === this.dom;
    if (locked === this.isLocked) return;
    this.isLocked = locked;
    if (!locked) this.keys.clear();
    this.onLockChange?.(locked);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isLocked) return;
    this.yaw -= e.movementX * MOUSE_SENS;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * MOUSE_SENS, -PITCH_LIMIT, PITCH_LIMIT);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isLocked) return;
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };
}
