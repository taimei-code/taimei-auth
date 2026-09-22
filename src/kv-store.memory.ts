type Entry = { value: string; expiresAt: number | null };

export class MemoryKvStore {
  private readonly entries = new Map<string, Entry>();

  private live(key: string): Entry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  get(key: string): string | null {
    return this.live(key)?.value ?? null;
  }

  set(key: string, value: string, ttlSec?: number): void {
    const expiresAt = ttlSec === undefined ? null : Date.now() + ttlSec * 1000;
    this.entries.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  getAndDelete(key: string): string | null {
    const value = this.get(key);
    this.entries.delete(key);
    return value;
  }

  incrementWindow(key: string, windowSec: number): number {
    const count = Number(this.live(key)?.value ?? 0) + 1;
    if (!Number.isFinite(count)) throw new Error(`non-numeric count: ${count}`);
    this.set(key, String(count), windowSec);
    return count;
  }

  keys(prefix: string): string[] {
    return [...this.entries.keys()].filter((k) => k.startsWith(prefix) && this.live(k) !== null);
  }

  // Redis の TTL と同じ契約で、残り秒数 (切り上げ) を返し、期限なしは -1、存在しなければ -2 にする。
  ttl(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }
}
