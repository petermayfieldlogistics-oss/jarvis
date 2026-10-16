// The quest log behind the HUD's quest bar and the Quests tab: what each active
// quest asks for next, and where to go when a place is known.

import { ELDER_TRIALS, ENEMIES, FIELD, FISHING_SPOTS, LAIRS, NPCS, ORE_NODES, QUESTS, SPAWNS, WEAPON_TRIALS, ZONES, type QuestId } from '../data/world';
import type { WorldState } from './state';
import { zoneAt } from './terrain';

export interface QuestTarget {
  x: number;
  z: number;
  name: string;
}

export interface QuestLine {
  id: QuestId;
  /** Short name for the bar: "Bounty: Bandits". */
  label: string;
  progress: number;
  goal: number;
  /** Goal reached: hand it in. */
  ready: boolean;
  /** What to do next. */
  objective: string;
  target: QuestTarget | null;
}

const LABEL: Record<QuestId, string> = {
  trials: 'The Six Trials',
  ore: 'Ember Ore',
  fish: 'A Good Catch',
  dead: 'Restless Dead',
  bounty: 'Bounty: Bandits',
  tomes: 'Lost Tomes',
  pages: 'Missing Pages',
  elders: 'The Elder Foes',
  hunts: 'Monster Hunts',
  harvest: "Wren's Field",
  legends: 'Beasts of Legend',
};

const OBJECTIVE: Record<QuestId, string> = {
  trials: 'Conquer the next trial',
  ore: 'Mine Ember Ore at Molten Peak',
  fish: 'Fish along the coast',
  dead: 'Defeat dark creatures',
  bounty: 'Defeat bandits on the roads',
  tomes: 'Tomes are hidden across the land',
  pages: 'The pages blew far and wide',
  elders: 'Face the next elder foe',
  hunts: 'Hunt the monster in its lair',
  harvest: 'Plant, water and harvest',
  legends: 'Hunt the nearest beast of legend',
};

// Camps where a quest's monsters live, named after their region.
const camps = (test: (id: string) => boolean): QuestTarget[] =>
  SPAWNS.filter((s) => s.enemies.some(([id]) => test(id))).map((s) => ({ x: s.x, z: s.z, name: ZONES[zoneAt(s.x, s.z)].name }));
const DARK_CAMPS = camps((id) => ENEMIES[id as keyof typeof ENEMIES].dark);
const BANDIT_CAMPS = camps((id) => id.startsWith('bandit'));
const ORE = ORE_NODES.map((o) => ({ ...o, name: 'Ember Ore vein' }));
const FISHING = FISHING_SPOTS.map((f) => ({ ...f, name: 'Fishing spot' }));

function nearest(list: readonly QuestTarget[], x: number, z: number): QuestTarget | null {
  let best: QuestTarget | null = null;
  let bestD = Infinity;
  for (const t of list) {
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < bestD) (bestD = d), (best = t);
  }
  return best;
}

function giver(id: QuestId): QuestTarget | null {
  const n = NPCS.find((x) => x.id === QUESTS[id].giver);
  return n ? { x: n.x, z: n.z, name: n.name } : null;
}

function targetFor(id: QuestId, state: WorldState, x: number, z: number): QuestTarget | null {
  switch (id) {
    case 'trials':
      return nearest(WEAPON_TRIALS.filter((t) => !state.trialsDone.includes(t.id)).map((t) => ({ x: t.x, z: t.z, name: t.name })), x, z);
    case 'elders':
      return nearest(ELDER_TRIALS.filter((t) => !state.trialsDone.includes(t.id)).map((t) => ({ x: t.x, z: t.z, name: t.name })), x, z);
    case 'hunts':
    case 'legends':
      return nearest(LAIRS.filter((l) => !!l.legend === (id === 'legends') && !state.flags[`hunted-${l.boss}`]).map((l) => ({ x: l.x, z: l.z, name: l.name })), x, z);
    case 'ore':
      return nearest(ORE, x, z);
    case 'fish':
      return nearest(FISHING, x, z);
    case 'dead':
      return nearest(DARK_CAMPS, x, z);
    case 'bounty':
      return nearest(BANDIT_CAMPS, x, z);
    case 'harvest':
      return { x: FIELD.x, z: FIELD.z, name: "Wren's field" };
    default:
      return null;
  }
}

/** One line per active quest, in the quest book's order; (x, z) is where the hero stands. */
export function questLines(state: WorldState, x: number, z: number): QuestLine[] {
  const lines: QuestLine[] = [];
  for (const id of Object.keys(QUESTS) as QuestId[]) {
    const st = state.quests[id];
    if (st?.state !== 'active') continue;
    const goal = QUESTS[id].goal;
    const ready = st.progress >= goal;
    const g = giver(id);
    lines.push({
      id,
      label: LABEL[id],
      progress: Math.min(goal, st.progress),
      goal,
      ready,
      objective: ready ? `Return to ${g?.name ?? 'Hearthhold'}` : OBJECTIVE[id],
      target: ready ? g : targetFor(id, state, x, z),
    });
  }
  return lines;
}

/** The quest the bar points to: the one the player tracks while it is active, else the first active one. */
export function trackedId(state: WorldState, lines: QuestLine[]): QuestId | null {
  if (state.tracked && lines.some((l) => l.id === state.tracked)) return state.tracked;
  return lines[0]?.id ?? null;
}

/** With nothing active: who to talk to for the next quest (null when every quest is taken). */
export function nextQuestHint(state: WorldState): QuestLine | null {
  const id = (Object.keys(QUESTS) as QuestId[]).find((q) => state.quests[q]?.state === 'none');
  if (!id) return null;
  const g = giver(id);
  return { id, label: 'Find work', progress: 0, goal: 0, ready: false, objective: `Talk to ${g?.name ?? 'the townsfolk'}`, target: g };
}
