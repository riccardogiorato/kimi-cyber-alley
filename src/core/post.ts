import * as THREE from 'three';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * InkPipeline — the alley's whole post chain in three fullscreen passes:
 *
 *   1. Scene  -> supersampled HalfFloat RT with an attached DepthTexture.
 *   2. Ink+grade -> fullscreen shader that inks from the *second difference
 *      of linearised depth* (discrete Laplacian), multiplies the ink over
 *      the scene colour, then split-tones (teal/violet darks, warm
 *      pink-white highlights), lifts blacks and outputs sRGB.
 *   3. FXAA   -> resolve to the canvas.
 *
 * Deliberately NO bloom, NO depth of field, NO motion blur.
 */

export interface InkPipelineOptions {
  /** Supersample factor for the offscreen target, clamped to [1.5, 2]. */
  supersample?: number;
}

/**
 * Ink + grade shader.
 *
 * Ink detection: sample the 4-neighbour stencil of *linearised* view-space
 * depth (via `perspectiveDepthToViewZ`) and take the discrete Laplacian
 * `4*c - (n+s+e+w)`. On a flat wall the second difference is ~0; at a
 * silhouette or hard edge the depth field bends, so |lap| spikes. Positive
 * curvature (surface bulging toward the camera) inks strongly, negative
 * curvature inks faintly, and the whole term fades with distance so far
 * geometry doesn't turn to mush.
 */
const INK_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) }, // supersampled px
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 100 },
    uInkColor: { value: new THREE.Color(0x0d1420) }, // dark teal-indigo, not black
    uInkThreshold: { value: 0.06 }, // min |lap| (view-space metres) that inks
    uInkStrength: { value: 1.0 },
    uInkDistance: { value: 45.0 }, // ink fully faded by this view depth
    uShadowTint: { value: new THREE.Color(0x1c2f4a) }, // teal/violet darks
    uHighlightTint: { value: new THREE.Color(0xffe8f2) }, // warm pink-white highs
    uLift: { value: 0.045 }, // black lift
  },
  vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
  fragmentShader: /* glsl */ `
		#include <packing>

		varying vec2 vUv;
		uniform sampler2D tDiffuse;
		uniform sampler2D tDepth;
		uniform vec2 uResolution;
		uniform float uCameraNear;
		uniform float uCameraFar;
		uniform vec3 uInkColor;
		uniform float uInkThreshold;
		uniform float uInkStrength;
		uniform float uInkDistance;
		uniform vec3 uShadowTint;
		uniform vec3 uHighlightTint;
		uniform float uLift;

		// Linearised view-space depth (negative metres in front of the camera).
		float viewZ( vec2 uv ) {
			float d = texture2D( tDepth, uv ).x;
			return perspectiveDepthToViewZ( d, uCameraNear, uCameraFar );
		}

		void main() {
			vec4 scene = texture2D( tDiffuse, vUv );

			// ---- Ink: second difference of linearised depth ---------------
			vec2 texel = 1.0 / uResolution;
			float c = viewZ( vUv );
			float n = viewZ( vUv + vec2( 0.0,  texel.y ) );
			float s = viewZ( vUv - vec2( 0.0,  texel.y ) );
			float e = viewZ( vUv + vec2( texel.x, 0.0 ) );
			float w = viewZ( vUv - vec2( texel.x, 0.0 ) );

			// Discrete Laplacian. Neighbours across a silhouette sit at the
			// far plane, which would dominate the edge response, so clamp the
			// per-neighbour deviation: depth discontinuities saturate instead
			// of exploding.
			float maxDev = 2.0;
			float lap = 4.0 * c
				- ( c + clamp( n - c, -maxDev, maxDev ) )
				- ( c + clamp( s - c, -maxDev, maxDev ) )
				- ( c + clamp( e - c, -maxDev, maxDev ) )
				- ( c + clamp( w - c, -maxDev, maxDev ) );

			// Positive curvature inks strongly, negative faintly.
			float curvature = lap > 0.0 ? lap : lap * 0.25;
			float edge = smoothstep( uInkThreshold, uInkThreshold * 4.0, curvature );

			// Fade ink with distance (c is negative in front of the camera).
			float dist = -c;
			edge *= 1.0 - smoothstep( uInkDistance * 0.5, uInkDistance, dist );
			edge = clamp( edge * uInkStrength, 0.0, 1.0 );

			// ---- Composite: ink multiplied over the scene colour ----------
			vec3 inked = scene.rgb * mix( vec3( 1.0 ), uInkColor, edge );

			// ---- Grade: split-tone + lifted blacks + sRGB -----------------
			float luma = dot( inked, vec3( 0.2126, 0.7152, 0.0722 ) );

			// Push darks toward teal/violet, highlights toward warm pink-white.
			float shadowMix = 1.0 - smoothstep( 0.0, 0.45, luma );
			float highlightMix = smoothstep( 0.55, 1.0, luma );
			vec3 graded = inked;
			graded = mix( graded, graded * 0.4 + uShadowTint * 0.6, shadowMix * 0.35 );
			graded = mix( graded, graded * uHighlightTint, highlightMix * 0.5 );

			// Lifted blacks: raise the floor, gently compress the top so
			// nothing clips.
			graded = graded * ( 1.0 - uLift ) + uLift;

			// Linear -> sRGB (scene RT holds linear HalfFloat values).
			vec4 outColor = vec4( max( graded, 0.0 ), scene.a );
			#include <colorspace_fragment>

			gl_FragColor = outColor;
		}
	`,
};

/** Minimal fullscreen triangle/quad rig (avoids pulling in examples' Pass classes). */
class FullscreenPass {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(shader: {
    uniforms: Record<string, THREE.IUniform>;
    vertexShader: string;
    fragmentShader: string;
  }) {
    this.material = new THREE.ShaderMaterial({
      uniforms: shader.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}

export class InkPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly supersample: number;

  private sceneRT: THREE.WebGLRenderTarget;
  private depthTexture: THREE.DepthTexture;
  private readonly inkPass: FullscreenPass;
  private readonly fxaaPass: FullscreenPass;

  private width = 1;
  private height = 1;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    opts: InkPipelineOptions = {},
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.supersample = THREE.MathUtils.clamp(opts.supersample ?? 1.75, 1.5, 2);

    this.depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, // linear HDR-ish scene colour
      depthTexture: this.depthTexture,
    });

    this.inkPass = new FullscreenPass(INK_GRADE_SHADER);
    this.fxaaPass = new FullscreenPass(FXAAShader);

    const size = new THREE.Vector2();
    renderer.getSize(size);
    this.setSize(size.x, size.y);
  }

  /** Logical (CSS) size — pixel ratio and supersample are applied internally. */
  setSize(w: number, h: number): void {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));

    const pr = this.renderer.getPixelRatio();
    const rw = Math.max(1, Math.floor(this.width * pr));
    const rh = Math.max(1, Math.floor(this.height * pr));

    // Offscreen scene target at supersample x device pixel ratio.
    const sw = Math.max(1, Math.floor(rw * this.supersample));
    const sh = Math.max(1, Math.floor(rh * this.supersample));
    this.sceneRT.setSize(sw, sh);

    const inkU = this.inkPass.material.uniforms;
    inkU.uResolution?.value.set(sw, sh);
    inkU.uCameraNear?.value && (inkU.uCameraNear.value = this.camera.near);
    inkU.uCameraFar?.value && (inkU.uCameraFar.value = this.camera.far);

    // FXAA resolves at device resolution (its `resolution` uniform is 1/px).
    this.fxaaPass.material.uniforms.resolution?.value.set(1 / rw, 1 / rh);
  }

  /** Render the full frame: scene -> ink+grade -> FXAA to screen. */
  render(_dt: number): void {
    // 1. Scene into the supersampled RT (colour + depth).
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.render(this.scene, this.camera);

    // 2. Ink (from depth) + composite + grade, straight to the canvas.
    const inkU = this.inkPass.material.uniforms;
    if (inkU.tDiffuse) inkU.tDiffuse.value = this.sceneRT.texture;
    if (inkU.tDepth) inkU.tDepth.value = this.depthTexture;
    this.inkPass.render(this.renderer, null);

    // 3. FXAA resolve to screen.
    const fxaaU = this.fxaaPass.material.uniforms;
    if (fxaaU.tDiffuse) fxaaU.tDiffuse.value = this.sceneRT.texture;
    this.fxaaPass.render(this.renderer, null);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.depthTexture.dispose();
    this.inkPass.dispose();
    this.fxaaPass.dispose();
  }
}
