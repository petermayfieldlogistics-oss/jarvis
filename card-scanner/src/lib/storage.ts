import { get, set } from 'idb-keyval';
import type { CollectionItem } from '../types';

/** IndexedDB read that never throws (private windows and tests may lack it). */
export async function safeGet<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key);
  } catch {
    return undefined;
  }
}

export async function safeSet(key: string, value: unknown): Promise<boolean> {
  try {
    await set(key, value);
    return true;
  } catch {
    return false;
  }
}

const COLLECTION_KEY = 'collection-v1';

export async function loadCollection(): Promise<CollectionItem[]> {
  const items = await safeGet<CollectionItem[]>(COLLECTION_KEY);
  if (Array.isArray(items)) return items;
  // Fallback copy for browsers where IndexedDB is unavailable.
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    return raw ? (JSON.parse(raw) as CollectionItem[]) : [];
  } catch {
    return [];
  }
}

export async function saveCollection(items: CollectionItem[]): Promise<void> {
  if (await safeSet(COLLECTION_KEY, items)) return;
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(items));
  } catch {
    // Nothing else we can do; the UI keeps working from memory.
  }
}
