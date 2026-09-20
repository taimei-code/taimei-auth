import { DurableObject } from "cloudflare:workers";

// 1 key = 1 DO。DO 内は input gate で直列化されるため get→delete / incr→expire が追加の lock なしで atomic。
type Entry = { value: string; expiresAt: number | null };

const ENTRY = "e";

export class KvStore extends DurableObject {
  private async live(): Promise<Entry | null> {
    const entry = await this.ctx.storage.get<Entry>(ENTRY);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      await this.clear();
      return null;
    }
    return entry;
  }

  private async clear(): Promise<void> {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
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
    await this.write(value, ttlSec ? Date.now() + ttlSec * 1000 : null);
  }

  async delete(): Promise<void> {
    await this.clear();
  }

  async getAndDelete(): Promise<string | null> {
    const entry = await this.live();
    if (entry) await this.clear();
    return entry?.value ?? null;
  }

  // Redis の MULTI INCR + EXPIRE と同じく呼ぶたびに TTL を延長する。
  async incrementWindow(windowSec: number): Promise<number> {
    const count = Number((await this.live())?.value ?? 0) + 1;
    await this.write(String(count), Date.now() + windowSec * 1000);
    return count;
  }

  async alarm(): Promise<void> {
    await this.clear();
  }
}
