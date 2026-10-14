// packages/db/src/client.ts - Prisma ORM 7 requires a driver adapter
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const url = process.env.DATABASE_URL;
const isRemote = Boolean(url && (url.includes("supabase") || url.includes("sslmode=")));

const pool = new pg.Pool({
  connectionString: url,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
export * from "../generated/prisma/client.js";
