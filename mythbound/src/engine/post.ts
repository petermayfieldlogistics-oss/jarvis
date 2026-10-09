// Post-processing: bloom on high quality.

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

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality): Post {
  if (quality !== 'high') {
    return { render: () => renderer.render(scene, camera), setSize: () => {} };
  }
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.82));
  composer.addPass(new OutputPass());
  return { render: () => composer.render(), setSize: (w, h) => composer.setSize(w, h) };
}
