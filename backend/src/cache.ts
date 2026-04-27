import crypto from "node:crypto";
import type { AnalyzeRequest, AnalyzeResponse } from "./types.js";

export class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

export function analyzeCacheKey(input: AnalyzeRequest): string {
  return crypto
    .createHash("sha256")
    .update(input.url + "\n" + input.page_text)
    .digest("hex");
}

export const analyzeCache = new LruCache<string, AnalyzeResponse>(50);
