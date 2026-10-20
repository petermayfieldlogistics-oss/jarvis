import type { Plugin } from 'vite';

export function regions(buf: Uint8Array): { at: number; count: number; w: 2 | 4; stride: number }[];
export function pack(raw: Uint8Array): Uint8Array | null;
export function packFile(file: string | URL): Uint8Array;
export function readBytes(file: string | URL): Uint8Array;
export function gunzip(file: string | URL): Uint8Array;
export function packModels(): Plugin;
