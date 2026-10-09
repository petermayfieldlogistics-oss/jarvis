// Monster population: the fixed spawn groups and the night-time watchers.

import { SPAWNS } from '../data/world';
import { Boss } from './entities';
import { heightAt } from './terrain';
import type { Game } from './game';

export class Spawner {
  private nightTimer = 30;

  constructor(private g: Game) {}

  /** Clears ordinary monsters and fills every spawn group again (resting, dying, starting). */
  spawnAll() {
    const g = this.g;
    for (const e of [...g.enemies]) if (!(e instanceof Boss)) g.removeEnemy(e);
    SPAWNS.forEach((s, gi) => {
      for (const [id, count] of s.enemies) {
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * s.radius;
          const e = g.spawnEnemy(id, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r);
          e.spawnGroup = gi;
        }
      }
    });
  }

  update(dt: number) {
    const g = this.g;
    if (!g.isNight || g.activeTrial) return;
    this.nightTimer -= dt;
    if (this.nightTimer > 0) return;
    this.nightTimer = 45;
    if (!['swamp', 'crossroads', 'badlands', 'volcano'].includes(g.zone)) return;
    if (g.enemies.filter((e) => e.def.id === 'eye-watcher' && e.alive).length > 6) return;
    const a = Math.random() * Math.PI * 2;
    const x = g.player.pos.x + Math.cos(a) * 40;
    const z = g.player.pos.z + Math.sin(a) * 40;
    if (heightAt(x, z) < 0) return;
    g.spawnEnemy('eye-watcher', x, z);
  }
}
