import { mergeSessionIndex } from "./session-index";
import type { TtlKey } from "./ttl-key";

type Entry = { value: string; expiresAt: number | null };

export class MemoryKvStore {
  private readonly entries = new Map<TtlKey, Entry>();

  private live(key: TtlKey): Entry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  get(key: TtlKey): string | null {
    return this.live(key)?.value ?? null;
  }

  set(key: TtlKey, value: string, ttlSec?: number): void {
    const expiresAt = ttlSec === undefined ? null : Date.now() + ttlSec * 1000;
    this.entries.set(key, { value, expiresAt });
  }

  delete(key: TtlKey): void {
    this.entries.delete(key);
  }

  getAndDelete(key: TtlKey): string | null {
    const value = this.get(key);
    this.entries.delete(key);
    return value;
  }

  mergeSessionIndex(key: TtlKey, value: string): void {
    const merged = mergeSessionIndex(this.get(key), value, Date.now());
    this.set(key, merged.value, merged.ttlSeconds);
  }

  incrementWindow(key: TtlKey, windowSec: number): number {
    const count = Number(this.live(key)?.value ?? 0) + 1;
    if (!Number.isFinite(count)) throw new Error(`non-numeric count: ${count}`);
    this.set(key, String(count), windowSec);
    return count;
  }

  keys(prefix: string): TtlKey[] {
    return [...this.entries.keys()].filter((k) => k.startsWith(prefix) && this.live(k) !== null);
  }

  ttl(key: TtlKey): number {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }
}
