import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = createClient({ url: redisUrl });

redis.on("error", (err) => console.error("Redis error:", err));

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}

export const redisStorage = {
  get: async (key: string) => {
    return await redis.get(key);
  },
  set: async (key: string, value: string, ttl?: number) => {
    if (ttl) await redis.set(key, value, { EX: ttl });
    else await redis.set(key, value);
  },
  delete: async (key: string) => {
    await redis.del(key);
  },
};
