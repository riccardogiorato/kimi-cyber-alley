import * as THREE from 'three';

/**
 * Toon shading with hue-shifted shadow bands.
 *
 * Instead of letting unlit bands collapse toward black, the toon shader is
 * patched so shadowed regions drift toward a cool teal/violet tint. The
 * amount of tint is driven by the same toon ramp value that darkens the
 * band, so the hue shift is quantised into the same discrete bands as the
 * brightness steps — shadows read as *coloured*, never black.
 */

export interface ToonOptions {
  color: number | string;
  emissive?: number | string;
  emissiveIntensity?: number;
  map?: THREE.Texture;
  /** Number of discrete brightness bands in the gradient ramp (2–4). */
  gradientSteps?: number;
}

/** Cool shadow tint (linear-ish teal/violet) injected into unlit bands. */
const SHADOW_TINT = new THREE.Color(0x2a3f66);

/**
 * Cache of hand-authored gradient ramps, keyed by band count, so every
 * material with the same step count shares one tiny DataTexture.
 */
const rampCache = new Map<number, THREE.DataTexture>();

/**
 * Build a `steps x 1` luminance ramp. Bands are biased upward (never 0) so
 * the darkest band still carries enough light for the hue shift to be
 * visible — a pure-black band would swallow the shadow tint.
 */
function getGradientRamp(steps: number): THREE.DataTexture {
  const cached = rampCache.get(steps);
  if (cached) return cached;

  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    // Bands lifted well off zero and clustered high: steps=3 -> ~[0.62, 0.81, 1.0]
    // Keeps shadow bands readable (not crushed) so the grade, not the ramp,
    // owns the dark end — much closer to a photographic response.
    const t = steps === 1 ? 1 : i / (steps - 1);
    const v = Math.round((0.62 + 0.38 * t) * 255);
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
    data[o + 3] = 255;
  }

  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace; // ramp is raw irradiance, not a colour
  tex.minFilter = THREE.NearestFilter; // hard band edges, no interpolation
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(steps, tex);
  return tex;
}

/**
 * GLSL injected into the toon fragment shader.
 *
 * `getGradientIrradiance` returns a grey ramp value in [0,1] per light.
 * `1.0 - irradiance.r` is therefore "how much light is NOT received" for
 * that light, already quantised into bands by the NearestFilter ramp. We
 * blend the light's colour toward the shadow tint by that amount, so fully
 * lit bands keep the light's hue and dark bands go teal/violet.
 */
const HUE_SHIFT_PARS = /* glsl */ `
	uniform vec3 uShadowTint;

	vec3 hueShiftedIrradiance( vec3 normal, vec3 lightDirection, vec3 lightColor ) {
		vec3 irradiance = getGradientIrradiance( normal, lightDirection );
		float shadowAmount = 1.0 - irradiance.r;
		// Cap the blend so even the darkest band keeps a whisper of the
		// original light colour — the tint dominates but never fully replaces.
		vec3 shifted = mix( lightColor, uShadowTint, shadowAmount * 0.85 );
		return irradiance * shifted;
	}
`;

/**
 * Patch a MeshToonMaterial so its shadow bands hue-shift toward
 * SHADOW_TINT. Done via onBeforeCompile string surgery on the stock
 * `RE_Direct_Toon` chunk: the only change is routing the light colour
 * through `hueShiftedIrradiance` before it is multiplied by the ramp.
 */
function applyHueShift(material: THREE.MeshToonMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = { value: SHADOW_TINT };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <gradientmap_pars_fragment>',
        `#include <gradientmap_pars_fragment>\n${HUE_SHIFT_PARS}`,
      )
      .replace(
        'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;',
        'vec3 irradiance = hueShiftedIrradiance( geometryNormal, directLight.direction, directLight.color );',
      );
  };
  // Distinct program cache key so patched and unpatched toon materials
  // never share a compiled program.
  material.customProgramCacheKey = () => 'kimi-toon-hueshift-v1';
}

/**
 * Standard toon material with hue-shifted (teal/violet) shadow bands.
 * Supports `map` and `emissive` exactly like a stock MeshToonMaterial.
 */
export function makeToon(opts: ToonOptions): THREE.MeshToonMaterial {
  const steps = Math.min(4, Math.max(2, Math.round(opts.gradientSteps ?? 3)));

  const material = new THREE.MeshToonMaterial({
    color: new THREE.Color(opts.color),
    gradientMap: getGradientRamp(steps),
  });

  if (opts.map) material.map = opts.map;
  if (opts.emissive !== undefined) {
    material.emissive = new THREE.Color(opts.emissive);
    material.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }

  applyHueShift(material);
  return material;
}

/**
 * Emissive-driven toon for neon tubes, sign faces and lit windows.
 *
 * The trick: `color` is set near-black so the *lit* response contributes
 * almost nothing, and the surface is carried entirely by `emissive`. That
 * makes it read as a self-glowing source that pops without any bloom pass,
 * while the hue-shift patch still keeps any residual shading consistent
 * with the rest of the scene.
 */
export function makeEmissiveToon(opts: ToonOptions): THREE.MeshToonMaterial {
  const glow = new THREE.Color(opts.emissive ?? opts.color);
  const material = makeToon({
    ...opts,
    color: 0x0a0a12, // kill the diffuse response; emissive carries the look
    emissive: glow.getHex(),
    emissiveIntensity: opts.emissiveIntensity ?? 1.6,
  });
  // The texture must drive the GLOW, not just the (near-dead) diffuse term —
  // otherwise neon sign faces render as flat colour instead of lit artwork.
  if (opts.map) material.emissiveMap = opts.map;
  return material;
}
