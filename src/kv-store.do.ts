import { DurableObject } from "cloudflare:workers";

type Entry = { value: string; expiresAt: number | null };

const ENTRY = "e";

export class KvStore<Env = unknown> extends DurableObject<Env> {
  private async live(): Promise<Entry | null> {
    const entry = await this.ctx.storage.get<Entry>(ENTRY);
    if (!entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) return null;
    return entry;
  }

  private async write(value: string, expiresAt: number | null): Promise<void> {
    await this.ctx.storage.put<Entry>(ENTRY, { value, expiresAt });
    if (expiresAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(expiresAt);
  }

  async get(): Promise<string | null> {
    return (await this.live())?.value ?? null;
  }

  async set(value: string, ttlSec?: number): Promise<void> {
    await this.write(value, ttlSec === undefined ? null : Date.now() + ttlSec * 1000);
  }

  async delete(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  // DO の input gate が直列化するため、get→delete と incr→expire は lock なしで atomic。
  async getAndDelete(): Promise<string | null> {
    const value = await this.get();
    if (value !== null) await this.delete();
    return value;
  }

  async incrementWindow(windowSec: number): Promise<number> {
    const count = Number((await this.live())?.value ?? 0) + 1;
    if (!Number.isFinite(count)) throw new Error(`non-numeric count: ${count}`);
    await this.write(String(count), Date.now() + windowSec * 1000);
    return count;
  }

  async alarm(): Promise<void> {
    const entry = await this.live();
    if (!entry) return this.delete();
    if (entry.expiresAt !== null) await this.ctx.storage.setAlarm(entry.expiresAt);
  }
}
