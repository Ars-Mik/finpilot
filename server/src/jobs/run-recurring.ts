import 'dotenv/config';
import { z } from 'zod';
import { createPool } from '../db/pool.js';
import { utcToday } from '../modules/recurring/schedule.js';
import { applyRecurringForGuests } from './recurring.js';

const config = z.object({ APP_DATABASE_URL: z.url() }).safeParse(process.env);
if (!config.success) {
  throw new Error('APP_DATABASE_URL is required for the recurring job');
}

// This job needs only the restricted runtime database role. Schedule it outside
// the API process, e.g. with a cron job or a systemd timer.
const pool = createPool(config.data.APP_DATABASE_URL);
try {
  const result = await applyRecurringForGuests(pool, utcToday(new Date()), (error) => {
    console.error('Recurring workspace failed:', error);
  });
  console.log(`Recurring: ${JSON.stringify(result)}`);
  if (result.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error('Recurring job failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
