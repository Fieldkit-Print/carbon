import { REDIS_URL } from "@carbon/auth";
import Redis from "ioredis";

let redis: Redis;

declare global {
  var __redis: Redis | undefined;
}

if (!REDIS_URL) {
  throw new Error("REDIS_URL is not defined");
}

// this is needed because in development we don't want to restart
// the server with every change, but we want to make sure we don't
// create a new connection to Redis with every change either.
const redisOptions = {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  connectTimeout: 5000,
  commandTimeout: 3000,
  lazyConnect: true,
  retryStrategy(times: number) {
    if (times > 2) return null; // stop retrying
    return Math.min(times * 100, 1000);
  }
};

if (process.env.VERCEL_ENV === "production") {
  redis = new Redis(REDIS_URL, redisOptions);
} else {
  if (!global.__redis) {
    global.__redis = new Redis(REDIS_URL, redisOptions);
  }
  redis = global.__redis;
}

export default redis;
