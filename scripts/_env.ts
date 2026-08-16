/**
 * Side-effect module that loads .env.local.
 *
 * Must be imported BEFORE anything that reads process.env at module scope
 * (notably src/db, which throws on a missing DATABASE_URL). Import statements
 * are evaluated in order, so `import './_env'` on the first line does the job —
 * calling config() inside the script body runs too late.
 */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
