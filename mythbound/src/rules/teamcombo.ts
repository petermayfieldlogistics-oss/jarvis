// Team combos (co-op): two heroes strike the same foe with two different
// elements within a few seconds, and the elements combine. The host's game
// decides (it owns the monsters); everyone sees the banner. Pure rules: the
// engine (game.ts) plays them out.

import { TEAM_COMBOS, type ComboElement, type DamageElement, type TeamComboDef } from '../data/defs';

export const TEAM = {
  /** Seconds between the two heroes' blows. */
  window: 4,
  /** Seconds before the same foe can be caught in another team combo. */
  cooldown: 3,
  /** Share of the bonus that foes around the target take. */
  splash: 0.5,
  /** The least a team combo adds (two light blows still make a combo worth seeing). */
  minBonus: 12,
};

/** A blow a foe remembers: which hero, in what element, when, and how hard. */
export interface TeamMark {
  hero: number;
  el: ComboElement;
  at: number;
  dmg: number;
}

/** What a foe remembers of the blows that could start a team combo. */
export interface TeamMemory {
  marks: TeamMark[];
  readyAt: number;
}

export const newTeamMemory = (): TeamMemory => ({ marks: [], readyAt: 0 });

/** The element a blow brings to a combo (physical and true damage bring none). */
export function comboElement(el: DamageElement): ComboElement | null {
  return el === 'physical' || el === 'true' ? null : el;
}

/** The team combo two elements make (none for the same element twice). */
export function teamComboFor(a: ComboElement, b: ComboElement): TeamComboDef | null {
  if (a === b) return null;
  return TEAM_COMBOS.find((k) => (k.elements[0] === a && k.elements[1] === b) || (k.elements[0] === b && k.elements[1] === a)) ?? null;
}

/**
 * A blow lands: remember it, and if another hero struck this foe with a
 * different element within the window, the two make a team combo (and the
 * foe's memory is spent). One mark per hero: the latest.
 */
export function noteTeamHit(mem: TeamMemory, hit: TeamMark): { def: TeamComboDef; partner: TeamMark } | null {
  mem.marks = mem.marks.filter((m) => hit.at - m.at <= TEAM.window && m.hero !== hit.hero);
  if (hit.at >= mem.readyAt) {
    // The most recent other hero's blow in another element.
    for (let i = mem.marks.length - 1; i >= 0; i--) {
      const m = mem.marks[i];
      const def = teamComboFor(m.el, hit.el);
      if (!def) continue;
      mem.marks.length = 0;
      mem.readyAt = hit.at + TEAM.cooldown;
      return { def, partner: m };
    }
  }
  mem.marks.push(hit);
  return null;
}

/** The bonus damage a team combo deals its target: a share of both blows. */
export const teamBonus = (def: TeamComboDef, a: number, b: number) => Math.max(TEAM.minBonus, (a + b) * def.power);
