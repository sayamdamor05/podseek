import { readFile } from 'fs/promises';
import { Pool } from 'pg';

(async () => {
  try {
    const args = process.argv.slice(2);
    const mediaId = args[0] || '17';
    const env = await readFile('backend/.env', 'utf8');
    const m = env.match(/DATABASE_URL=(.*)/);
    if (!m) {
      console.error('DATABASE_URL not found in backend/.env');
      process.exit(1);
    }
    const pool = new Pool({ connectionString: m[1].trim() });
    const res = await pool.query('SELECT id, start_time, end_time, text, embedding FROM transcript_segments WHERE media_id=$1 ORDER BY id ASC LIMIT 10', [mediaId]);
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
