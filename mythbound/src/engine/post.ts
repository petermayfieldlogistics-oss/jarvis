// Post-processing. Low: a plain render. Medium: one final pass that grades
// the image (split toning, contrast, saturation, vignette) while it tone maps.
// High: bloom first, then the same pass with a touch of film grain.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from './world';

export interface Post {
  render(dt: number): void;
  setSize(w: number, h: number): void;
}

// OutputShader plus the grade: tone mapping and the sRGB transfer still happen
// exactly once, here, using the renderer's settings (OutputPass sets the defines).
const GRADE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uGrain;
uniform vec2 uRes;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  #ifdef LINEAR_TONE_MAPPING
    c.rgb = LinearToneMapping(c.rgb);
  #elif defined( REINHARD_TONE_MAPPING )
    c.rgb = ReinhardToneMapping(c.rgb);
  #elif defined( CINEON_TONE_MAPPING )
    c.rgb = CineonToneMapping(c.rgb);
  #elif defined( ACES_FILMIC_TONE_MAPPING )
    c.rgb = ACESFilmicToneMapping(c.rgb);
  #elif defined( AGX_TONE_MAPPING )
    c.rgb = AgXToneMapping(c.rgb);
  #elif defined( NEUTRAL_TONE_MAPPING )
    c.rgb = NeutralToneMapping(c.rgb);
  #elif defined( CUSTOM_TONE_MAPPING )
    c.rgb = CustomToneMapping(c.rgb);
  #endif
  // Grade in display-linear space: cool shadows, warm highlights.
  vec3 col = clamp(c.rgb, 0.0, 1.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(vec3(0.93, 0.98, 1.09), vec3(1.07, 1.0, 0.9), smoothstep(0.02, 0.5, l));
  l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, 1.1), 0.0);
  // A gentle S-curve in perceptual space.
  vec3 g = sqrt(col);
  g = g + (g - 0.5) * 0.1 * (1.0 - abs(g - 0.5) * 2.0);
  col = g * g;
  // Vignette.
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  col *= 1.0 - smoothstep(0.35, 1.15, length(q)) * 0.42;
  c.rgb = col;
  #ifdef SRGB_TRANSFER
    c = sRGBTransferOETF(c);
  #endif
  c.rgb += (hash12(vUv * uRes + fract(uTime * 7.31) * 913.0) - 0.5) * uGrain;
  gl_FragColor = c;
}`;

class GradePass extends OutputPass {
  constructor(grain: number) {
    super();
    this.uniforms.uTime = { value: 0 };
    this.uniforms.uGrain = { value: grain };
    this.uniforms.uRes = { value: new THREE.Vector2(1, 1) };
    this.material.fragmentShader = GRADE_FRAG;
    this.material.name = 'GradeOutputShader';
  }
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality): Post {
  if (quality === 'low') {
    return { render: () => renderer.render(scene, camera), setSize: () => {} };
  }
  // Rendering into a target loses the canvas' antialiasing, so multisample it.
  const css = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(css.x, css.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  // The composer takes a given target's size as CSS pixels; size it properly.
  composer.setSize(css.x, css.y);
  composer.addPass(new RenderPass(scene, camera));
  if (quality === 'high') composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.5, 0.85));
  const grade = new GradePass(quality === 'high' ? 0.022 : 0);
  composer.addPass(grade);
  let time = 0;
  const res = renderer.getDrawingBufferSize(grade.uniforms.uRes.value as THREE.Vector2);
  return {
    render: (dt) => {
      time += dt;
      grade.uniforms.uTime.value = time;
      composer.render(dt);
    },
    setSize: (w, h) => {
      composer.setSize(w, h);
      renderer.getDrawingBufferSize(res);
    },
  };
}
