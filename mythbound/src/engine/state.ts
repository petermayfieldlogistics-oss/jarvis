// World progress and saving.

import { RUNES } from '../data/defs';
import { LAIRS, QUESTS, TRIALS, type QuestId } from '../data/world';
import { TOP_TIER } from '../rules/boss';
import { normalizeCharacter, type Character } from '../rules/character';
import { newFarm, normalizeFarm, type FarmState } from '../rules/farming';
import { newMarket, normalizeMarket, type Market } from '../rules/food';

export type QuestState = 'none' | 'active' | 'done';

export interface WorldState {
  version: 1;
  gameMinutes: number;
  lastShrine: string;
  shrinesFound: string[];
  trialsDone: string[];
  quests: Record<QuestId, { state: QuestState; progress: number }>;
  /** The quest the HUD's quest bar points the way to. */
  tracked: QuestId | null;
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
  /** The hero's seed beds in Wren's field. */
  farm: FarmState;
  /** Nell's day (from play time) and the fish she has bought from this hero on it. */
  market: Market;
  /** Each great foe's hardest difficulty tier beaten (rules/boss.ts): 0 Normal. Absent: never beaten. */
  bossBest: Record<string, number>;
  /** The tier the hero picked for each great foe's next fight. */
  bossPick: Record<string, number>;
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
    tracked: null,
    taken: [],
    loreRead: [],
    lostEmbers: null,
    oreRegrow: {},
    flags: {},
    unclaimed: [],
    pos: null,
    playTime: 0,
    farm: newFarm(),
    market: newMarket(),
    bossBest: {},
    bossPick: {},
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

/** Makes a save read back from JSON (this device or an account) ready to play. */
export function normalizeSave(data: SaveData): SaveData {
  // Fill in anything added since the save was written.
  const fresh = newWorldState();
  data.world = { ...fresh, ...data.world, quests: { ...fresh.quests, ...data.world.quests } };
  // Wren's field came later (and a damaged one is mended).
  data.world.farm = normalizeFarm(data.world.farm);
  // So did Nell's stall.
  data.world.market = normalizeMarket(data.world.market);
  // And the harder tiers: a foe beaten before them counts as beaten on Normal.
  const w = data.world;
  const tiers = (x: unknown) => Object.fromEntries(Object.entries(x && typeof x === 'object' ? x : {}).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= TOP_TIER).map(([k, v]) => [k, Math.floor(v as number)]));
  w.bossBest = tiers(w.bossBest);
  w.bossPick = tiers(w.bossPick);
  for (const t of TRIALS) if (w.trialsDone.includes(t.id)) w.bossBest[t.boss] ??= 0;
  for (const l of LAIRS) if (w.flags[`hunted-${l.boss}`]) w.bossBest[l.boss] ??= 0;
  // JSON turns Infinity into null.
  if (data.character.lightSealedUntil === null) data.character.lightSealedUntil = Infinity;
  normalizeCharacter(data.character);
  // Heroes from before the zombie race have never cheated death.
  data.character.riseSpent ??= false;
  // Throwing knives and runes came later.
  const c = data.character;
  if (typeof c.knives !== 'number') c.knives = 0;
  for (const w of c.weapons) if (w.rune !== undefined && !Object.hasOwn(RUNES, w.rune)) delete w.rune;
  return data;
}

/** The offline save, or a copy of an account slot kept on this device (`key`). */
export function loadSave(key = SAVE_KEY): SaveData | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    return normalizeSave(JSON.parse(raw) as SaveData);
  } catch {
    return null;
  }
}

/** A save as plain JSON-friendly data (Infinity is written as null). */
export function serializeSave(data: SaveData): SaveData {
  const c = { ...data.character, lightSealedUntil: data.character.lightSealedUntil === Infinity ? (null as unknown as number) : data.character.lightSealedUntil };
  return { ...data, character: c };
}

export function writeSave(data: SaveData, key = SAVE_KEY): boolean {
  try {
    storage()?.setItem(key, JSON.stringify(serializeSave(data)));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave(key = SAVE_KEY) {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Small values kept on this device (the account sign-in). */
export function readLocal<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, JSON.stringify(value));
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
  /** On touch screens, the camera swings in behind a running hero. */
  camFollow: boolean;
  /** Co-op: the name friends see, and the relay server's address. */
  coopName: string;
  coopServer: string;
  /** The HUD quest bar folded to one line; null until the player chooses (folded on phones). */
  questsCollapsed: boolean | null;
}

export function defaultQuality(): Settings['quality'] {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'medium';
}

export function loadSettings(): Settings {
  const d: Settings = { quality: defaultQuality(), sensitivity: 1, invertY: false, volume: 0.6, touch: 'auto', camFollow: true, coopName: '', coopServer: '', questsCollapsed: null };
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
