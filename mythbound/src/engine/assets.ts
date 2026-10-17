// Models made in Blender (see blender/*.py), loaded once before the world is
// built. Each comes out by name as a fresh copy that shares its geometry and
// materials with every other copy. Anything missing (an offline single-file
// copy, a failed download) falls back to the models built in code.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import weaponsUrl from '../assets/weapons.glb?url';

const models = new Map<string, THREE.Object3D>();
let loading: Promise<void> | null = null;

/** Loads every Blender model (at most once). Never rejects: what fails to load is simply left out. */
export function loadAssets(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(weaponsUrl)
    .then((gltf) => {
      for (const o of [...gltf.scene.children]) {
        o.traverse((m) => {
          if ((m as THREE.Mesh).isMesh) {
            m.castShadow = true;
            m.receiveShadow = false;
            // Copies share this geometry: compact() must not merge it, nor disposeObject() free it.
            m.userData.keep = true;
            m.userData.shared = true;
          }
        });
        o.position.set(0, 0, 0);
        models.set(o.name, o);
      }
    })
    .catch((err) => console.warn('Blender models not loaded; using the built-in ones.', err));
  return loading;
}

/** A copy of the Blender model with this name, or null if there is none. */
export function blendModel(name: string): THREE.Object3D | null {
  const m = models.get(name);
  return m ? m.clone() : null;
}
