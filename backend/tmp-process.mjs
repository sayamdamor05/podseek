import 'dotenv/config';
import pg from 'pg';
import { processAudioJob } from './worker.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const res = await pool.query("INSERT INTO media_files (url, status) VALUES ($1, $2) RETURNING id", ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'processing']);
  const mediaId = res.rows[0].id;
  console.log('mediaId', mediaId);
  await processAudioJob(mediaId, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const statusRes = await pool.query('SELECT status FROM media_files WHERE id = $1', [mediaId]);
  console.log('final-status', statusRes.rows[0].status);
  const segCount = await pool.query('SELECT COUNT(*)::int as count FROM transcript_segments WHERE media_id = $1', [mediaId]);
  console.log('segment-count', segCount.rows[0].count);
} catch (e) {
  console.error('err', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await pool.end();
}
