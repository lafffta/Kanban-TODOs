import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { Pool as NodePool } from "pg";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema";

// Neon's session Pool talks over a WebSocket. Node only exposes a global
// WebSocket from v22+, so provide the `ws` polyfill when one isn't already
// present — otherwise the pooled endpoint fails on older Node runtimes (Vercel).
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

/**
 * Single DB seam for the whole app. Which driver we use is chosen by env so the
 * same code runs against Docker Postgres locally and Neon's **pooled** endpoint
 * in production (required by D4 — every serverless poll opens a connection, so
 * prod must go through PgBouncer via `@neondatabase/serverless`).
 *
 *   DATABASE_DRIVER=pg    → node-postgres  (local Docker Postgres) [default]
 *   DATABASE_DRIVER=neon  → neon-serverless (Neon pooled endpoint)
 *
 * The query surface is identical, so both are exposed as the same `Database` type.
 */
export type Database = NodePgDatabase<typeof schema>;

let pool: NodePool | NeonPool;

function buildDb(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — copy .env.example to .env and fill it in.",
    );
  }

  if ((process.env.DATABASE_DRIVER ?? "pg") === "neon") {
    const neonPool = new NeonPool({ connectionString });
    pool = neonPool;
    return drizzleNeon(neonPool, { schema }) as unknown as Database;
  }

  const nodePool = new NodePool({ connectionString });
  pool = nodePool;
  return drizzleNode(nodePool, { schema });
}

export const db = buildDb();

/** Close the underlying pool. Used by tests / scripts so the process can exit. */
export async function closeDb(): Promise<void> {
  await pool.end();
}
