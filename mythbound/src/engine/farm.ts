// Wren's field as this hero sees it: soil (dry, watered or overgrown) and
// crops at their stage in each seed bed, the beds' prompts, and word when a
// crop ripens. Every hero's field is their own (it saves with their world),
// so nothing here goes over the network.
//
// Four instanced meshes draw the whole field (soil, leaves, produce,
// stalks); a bed's instances change only when its stage or soil changes,
// checked twice a second without allocating.

import * as THREE from 'three';
import { CROP_IDS, CROPS, type CropId } from '../data/goods';
import { FIELD, plotCentre } from '../data/world';
import { FARM, isWet, progress, rentPrice, ripeIn, ripeNews, stageOf, type FarmState } from '../rules/farming';
import { mat } from './models';
import { heightAt } from './terrain';
import type { Interactable } from './world';
import type { Game } from './game';

/** Plants in each bed (leaves and produce), and wheat stalks. */
const PLANTS = 6;
const STALKS = 12;
const SOIL_DRY = 0x7a5a3a, SOIL_WET = 0x3e2c1e, SOIL_WILD = 0x56602e;

const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const E = new THREE.Euler();
const C = new THREE.Color();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

/** A fixed scatter of spots in a bed (-1..1), so beds look sown, not stamped. */
const SPOTS: [number, number][] = [[-0.55, -0.5], [0.05, -0.6], [0.6, -0.45], [-0.6, 0.45], [0, 0.55], [0.55, 0.5]];

export class FarmView {
  private soil: THREE.InstancedMesh;
  private leaves: THREE.InstancedMesh;
  private produce: THREE.InstancedMesh;
  private stalks: THREE.InstancedMesh;
  private group = new THREE.Group();
  /** What each bed showed last (stage, wet, owned), to redraw only on change. */
  private shown = new Int16Array(FARM.plots).fill(-1);
  private ripe = new Uint8Array(FARM.plots);
  /** Crops that ripened since the last look (kept, not reallocated). */
  private ripened: CropId[] = [];
  private beds: (Interactable | undefined)[] = [];
  private tick = 0;
  private primed = false;
  /** Beds ripe right now (the minimap marks the field while any are). */
  ripeBeds = 0;

  constructor(scene: THREE.Scene, interactables: Interactable[]) {
    const white = mat(0xffffff, { rough: 0.9 });
    this.soil = new THREE.InstancedMesh(new THREE.BoxGeometry(FIELD.bed - 0.15, 0.12, FIELD.bed - 0.15), white, FARM.plots);
    this.leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.55, 5), white, FARM.plots * PLANTS);
    this.produce = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 0), white, FARM.plots * PLANTS);
    this.stalks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 1, 0.05), white, FARM.plots * STALKS);
    for (const m of [this.soil, this.leaves, this.produce, this.stalks]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.receiveShadow = true;
      // Paint every instance once so instanceColor exists before the first draw.
      for (let i = 0; i < m.count; i++) {
        m.setMatrixAt(i, HIDE);
        m.setColorAt(i, C.setHex(0xffffff));
      }
      this.group.add(m);
    }
    this.soil.castShadow = false;
    scene.add(this.group);
    for (let i = 0; i < FARM.plots; i++) this.beds.push(interactables.find((it) => it.id === `plot-${i}`));
  }

  /** Twice a second: redraw beds whose crop moved on, refresh prompts, say when something ripens. */
  update(dt: number, g: Game) {
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.5;
    const p = g.player.pos;
    this.group.visible = Math.abs(p.x - FIELD.x) + Math.abs(p.z - FIELD.z) < 160;
    this.refresh(g);
  }

  /** Redraws now (after planting, watering or a harvest). */
  refresh(g: Game) {
    const farm = g.state.farm;
    const rent = rentPrice(g.player.c, farm);
    let dirty = false;
    let ripeBeds = 0;
    const ripened = this.ripened;
    ripened.length = 0;
    for (let i = 0; i < FARM.plots; i++) {
      const plot = farm.plots[i];
      const owned = i < farm.owned;
      const stage = stageOf(plot, farm.clock);
      const wet = !!plot && isWet(plot, farm.clock);
      const code = (owned ? 100 : 0) + stage * 10 + (wet ? 1 : 0) + (plot ? 1 + CROP_IDS.indexOf(plot.crop) : 0) * 1000;
      this.updateLabel(i, farm, owned, rent);
      if (stage === 4) ripeBeds++;
      if (code === this.shown[i]) continue;
      this.shown[i] = code;
      dirty = true;
      this.drawBed(i, farm, owned, stage, wet);
      // Ripe since last look: say so (not for crops found ripe on loading).
      const ripe = stage === 4 ? 1 : 0;
      if (ripe && !this.ripe[i] && this.primed && plot && !ripened.includes(plot.crop)) ripened.push(plot.crop);
      this.ripe[i] = ripe;
    }
    this.primed = true;
    this.ripeBeds = ripeBeds;
    // One word for everything that ripened together.
    if (ripened.length) g.hud.toast(ripeNews(ripened), 'quest');
    if (dirty) {
      for (const m of [this.soil, this.leaves, this.produce, this.stalks]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  /** The bed's prompt says what a tap will do (set here twice a second, never built per frame). */
  private updateLabel(i: number, farm: FarmState, owned: boolean, rent: number | null) {
    const it = this.beds[i];
    if (!it) return;
    const plot = farm.plots[i];
    let label: string;
    if (!owned) label = i === farm.owned && rent !== null ? `Rent this bed (${rent})` : 'Overgrown bed';
    else if (!plot) label = 'Plant a seed';
    else {
      const crop = CROPS[plot.crop];
      const stage = stageOf(plot, farm.clock);
      if (stage === 4) label = `Harvest the ${crop.plural}`;
      else if (!isWet(plot, farm.clock)) label = `Water the ${crop.plural}`;
      else label = `${crop.name} ${Math.round(progress(plot, farm.clock) * 100)}% · ripe in ${hours(ripeIn(plot, farm.clock))}`;
    }
    if (it.label !== label) it.label = label;
  }

  private drawBed(i: number, farm: FarmState, owned: boolean, stage: number, wet: boolean) {
    const { x, z } = plotCentre(i);
    const y = heightAt(x, z);
    M.compose(P.set(x, y + 0.06, z), Q.identity(), S.set(1, 1, 1));
    this.soil.setMatrixAt(i, M);
    this.soil.setColorAt(i, C.setHex(!owned ? SOIL_WILD : wet ? SOIL_WET : SOIL_DRY));
    const plot = farm.plots[i];
    const crop = plot ? CROPS[plot.crop] : null;
    const reach = (FIELD.bed / 2) * 0.72;
    for (let k = 0; k < PLANTS; k++) {
      const n = i * PLANTS + k;
      const [sx, sz] = SPOTS[k];
      const px = x + sx * reach, pz = z + sz * reach;
      const turn = (i * 7 + k * 3) % 6;
      // Leaves: an unrented bed is weeds; a crop's grow with its stage.
      if (!owned) {
        M.compose(P.set(px, y + 0.2, pz), Q.setFromEuler(E.set(0, turn, 0.2)), S.set(1.2, 0.8, 1.2));
        this.leaves.setMatrixAt(n, M);
        this.leaves.setColorAt(n, C.setHex(0x6a7a32));
      } else if (crop && stage > 0) {
        const grow = [0, 0.25, 0.55, 0.85, 1][stage];
        const tall = crop.shape === 'caps' ? 0.35 : crop.shape === 'stalks' ? 0.5 : 1;
        M.compose(P.set(px, y + 0.12 + 0.25 * grow * tall, pz), Q.setFromEuler(E.set(0, turn, 0)), S.set(grow * 1.1, grow * tall, grow * 1.1));
        this.leaves.setMatrixAt(n, M);
        this.leaves.setColorAt(n, C.setHex(crop.shape === 'caps' ? crop.leaf : stage === 4 && crop.shape === 'stalks' ? crop.fruit : crop.leaf));
      } else this.leaves.setMatrixAt(n, HIDE);
      // Produce shows as it ripens: a carrot's top, a mushroom's cap, a pumpkin (one big one to a bed).
      const show = crop && stage >= 3 && crop.shape !== 'stalks' && (crop.shape !== 'gourd' || k === 1 || k === 4);
      if (show && crop) {
        const ripe = stage === 4 ? 1 : 0.6;
        let sy = 0.5, s = 0.6, h = 0.05;
        if (crop.shape === 'caps') (s = 1.2 * ripe), (sy = 0.45 * ripe), (h = 0.32 * ripe);
        else if (crop.shape === 'gourd') (s = 2.6 * ripe), (sy = 2 * ripe), (h = 0.35 * ripe);
        else (s = 0.75 * ripe), (sy = 0.55), (h = 0.1);
        M.compose(P.set(px, y + 0.12 + h, pz), Q.setFromEuler(E.set(0, turn, 0)), S.set(s, sy, s));
        this.produce.setMatrixAt(n, M);
        this.produce.setColorAt(n, C.setHex(crop.fruit));
      } else this.produce.setMatrixAt(n, HIDE);
    }
    // Wheat grows as a stand of stalks, golden when ripe.
    for (let k = 0; k < STALKS; k++) {
      const n = i * STALKS + k;
      if (crop?.shape === 'stalks' && stage > 0) {
        const grow = [0, 0.3, 0.6, 0.85, 1][stage];
        const gx = ((k % 4) - 1.5) / 1.5, gz = (Math.floor(k / 4) - 1) / 1;
        const px = x + gx * reach + ((k * 37) % 10) * 0.02, pz = z + gz * reach * 0.9;
        M.compose(P.set(px, y + 0.12 + 0.5 * grow, pz), Q.setFromEuler(E.set(((k % 3) - 1) * 0.08, 0, ((k % 5) - 2) * 0.05)), S.set(1.4, grow, 1.4));
        this.stalks.setMatrixAt(n, M);
        this.stalks.setColorAt(n, C.setHex(stage === 4 ? crop.fruit : crop.leaf));
      } else this.stalks.setMatrixAt(n, HIDE);
    }
  }
}

/** Game minutes as a short time: "40 m", "3 h". */
export function hours(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} m`;
  return `${Math.round(minutes / 60)} h`;
}
