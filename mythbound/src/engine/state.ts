// World progress and saving.

import { QUESTS, type QuestId } from '../data/world';
import type { Character } from '../rules/character';

export type QuestState = 'none' | 'active' | 'done';

export interface WorldState {
  version: 1;
  gameMinutes: number;
  lastShrine: string;
  shrinesFound: string[];
  trialsDone: string[];
  quests: Record<QuestId, { state: QuestState; progress: number }>;
  /** Tomes, pages and loot already picked up. */
  taken: string[];
  loreRead: string[];
  lostEmbers: { x: number; y: number; z: number; amount: number } | null;
  /** Ore vein id -> game minute it grows back. */
  oreRegrow: Record<string, number>;
  flags: Record<string, boolean>;
  /** Legendary weapons lying in a conquered arena, waiting to be picked up. */
  unclaimed: string[];
  pos: [number, number, number] | null;
  playTime: number;
}

export interface SaveData {
  character: Character;
  world: WorldState;
}

export function newWorldState(): WorldState {
  const quests = {} as WorldState['quests'];
  for (const id of Object.keys(QUESTS) as QuestId[]) quests[id] = { state: 'none', progress: 0 };
  return {
    version: 1,
    gameMinutes: 8 * 60,
    lastShrine: 'hearth',
    shrinesFound: ['hearth'],
    trialsDone: [],
    quests,
    taken: [],
    loreRead: [],
    lostEmbers: null,
    oreRegrow: {},
    flags: {},
    unclaimed: [],
    pos: null,
    playTime: 0,
  };
}

const SAVE_KEY = 'mythbound.save.v1';
const UNLOCK_KEY = 'mythbound.unlocks.v1';
const SETTINGS_KEY = 'mythbound.settings.v1';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    // Fill in anything added since the save was written.
    const fresh = newWorldState();
    data.world = { ...fresh, ...data.world, quests: { ...fresh.quests, ...data.world.quests } };
    // JSON turns Infinity into null.
    if (data.character.lightSealedUntil === null) data.character.lightSealedUntil = Infinity;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): boolean {
  try {
    const c = { ...data.character, lightSealedUntil: data.character.lightSealedUntil === Infinity ? null : data.character.lightSealedUntil };
    storage()?.setItem(SAVE_KEY, JSON.stringify({ ...data, character: c }));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave() {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export interface Unlocks {
  ancient: boolean;
}

export function loadUnlocks(): Unlocks {
  try {
    return { ancient: false, ...JSON.parse(storage()?.getItem(UNLOCK_KEY) ?? '{}') };
  } catch {
    return { ancient: false };
  }
}

export function saveUnlocks(u: Unlocks) {
  try {
    storage()?.setItem(UNLOCK_KEY, JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

export interface Settings {
  quality: 'low' | 'medium' | 'high';
  sensitivity: number;
  invertY: boolean;
  volume: number;
  touch: 'auto' | 'on' | 'off';
  /** Co-op: the name friends see, and the relay server's address. */
  coopName: string;
  coopServer: string;
}

export function defaultQuality(): Settings['quality'] {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'medium';
}

export function loadSettings(): Settings {
  const d: Settings = { quality: defaultQuality(), sensitivity: 1, invertY: false, volume: 0.6, touch: 'auto', coopName: '', coopServer: '' };
  try {
    return { ...d, ...JSON.parse(storage()?.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
