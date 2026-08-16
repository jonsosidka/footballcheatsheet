import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Create a free Neon project at https://neon.tech and put the pooled connection string in .env.local',
  );
}

/**
 * Neon's HTTP driver rather than a TCP pool: Netlify functions are short-lived
 * and a per-invocation TCP pool exhausts Neon's connection limit fast.
 */
export const db = drizzle(neon(connectionString), { schema });

export { schema };
