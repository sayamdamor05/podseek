import pg from 'pg';

const globalRef = global as unknown as { pool: pg.Pool | null; dbInitialized: boolean; memoryDb: any };

if (!globalRef.pool) {
  globalRef.pool = process.env.DATABASE_URL
    ? new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
      })
    : null;
}

if (!globalRef.memoryDb) {
  globalRef.memoryDb = {
    mediaFiles: new Map(),
    segments: [],
    nextMediaId: 1,
    nextSegmentId: 1,
  };
}

const pool = globalRef.pool;
const memoryDb = globalRef.memoryDb;

async function initDb() {
  if (!pool) {
    console.warn('⚠️ DATABASE_URL is not configured. Running in high-availability in-memory mode.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_files (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transcript_segments (
      id SERIAL PRIMARY KEY,
      media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      embedding JSONB NOT NULL,
      sentences JSONB
    )
  `);
  // Ensure schema migration for existing tables
  await pool.query(`
    ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS sentences JSONB;
  `);
  await pool.query(`
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS error_message TEXT;
  `);
  globalRef.dbInitialized = true;
}

async function ensureDbInit() {
  if (pool && !globalRef.dbInitialized) {
    try {
      await initDb();
    } catch (e: any) {
      console.warn('⚠️ Dynamic initDb failed:', e.message);
    }
  }
}

export async function dbFindCompletedMediaByUrl(videoUrl: string): Promise<number | null> {
  await ensureDbInit();
  if (pool) {
    try {
      const dbRes = await pool.query(
        "SELECT id FROM media_files WHERE url = $1 AND status = 'completed' ORDER BY id DESC LIMIT 1",
        [videoUrl]
      );
      if (dbRes.rows.length > 0) return dbRes.rows[0].id;
    } catch (e: any) {
      console.warn('⚠️ PostgreSQL cache lookup failed:', e.message);
    }
  }

  for (const media of memoryDb.mediaFiles.values()) {
    if (media.url === videoUrl && media.status === 'completed') {
      return media.id;
    }
  }
  return null;
}

export async function dbInsertMediaFile(videoUrl: string): Promise<number> {
  await ensureDbInit();
  const cachedId = await dbFindCompletedMediaByUrl(videoUrl);
  if (cachedId) {
    console.log(`⚡ Reusing cached completed media file ID: ${cachedId} for URL: ${videoUrl}`);
    return cachedId;
  }

  if (pool) {
    try {
      const dbRes = await pool.query(
        "INSERT INTO media_files (url, status) VALUES ($1, 'processing') RETURNING id",
        [videoUrl]
      );
      return dbRes.rows[0].id;
    } catch (e: any) {
      console.warn('⚠️ PostgreSQL insert failed, using in-memory store fallback:', e.message);
    }
  }
  const id = memoryDb.nextMediaId++;
  memoryDb.mediaFiles.set(id, { id, url: videoUrl, status: 'processing', created_at: new Date() });
  return id;
}

export async function dbUpdateMediaStatus(mediaId: number | string, status: string, errorMessage?: string | null): Promise<void> {
  if (pool) {
    try {
      await pool.query("UPDATE media_files SET status = $1, error_message = $2 WHERE id = $3", [status, errorMessage || null, Number(mediaId)]);
      return;
    } catch (e: any) {
      console.warn('⚠️ PostgreSQL status update failed:', e.message);
    }
  }
  const record = memoryDb.mediaFiles.get(Number(mediaId));
  if (record) {
    record.status = status;
    record.error_message = errorMessage || null;
  }
}

export async function dbGetMediaStatus(mediaId: number | string): Promise<{ status: string; error?: string | null } | null> {
  await ensureDbInit();
  if (pool) {
    try {
      const mediaRes = await pool.query('SELECT status, error_message FROM media_files WHERE id = $1', [Number(mediaId)]);
      if (mediaRes.rows.length > 0) {
        return { status: mediaRes.rows[0].status, error: mediaRes.rows[0].error_message };
      }
    } catch (e: any) {
      console.warn('⚠️ PostgreSQL status lookup failed:', e.message);
    }
  }
  const record = memoryDb.mediaFiles.get(Number(mediaId));
  return record ? { status: record.status, error: record.error_message || null } : null;
}

export async function dbInsertSegment(
  mediaId: number | string,
  start: number,
  end: number,
  text: string,
  embeddingJson: string,
  sentencesJson?: string | null
): Promise<void> {
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO transcript_segments (media_id, start_time, end_time, text, embedding, sentences)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [Number(mediaId), start, end, text, embeddingJson, sentencesJson || null]
      );
      return;
    } catch (e: any) {
      console.warn('⚠️ PostgreSQL segment insert failed:', e.message);
    }
  }
  memoryDb.segments.push({
    id: memoryDb.nextSegmentId++,
    media_id: Number(mediaId),
    start_time: start,
    end_time: end,
    text,
    embedding: embeddingJson,
    sentences: sentencesJson,
  });
}

export async function dbGetSegments(mediaId: number | string): Promise<any[]> {
  if (pool) {
    try {
      const dbResult = await pool.query(
        `SELECT id, text, start_time, end_time, embedding, sentences
         FROM transcript_segments
         WHERE media_id = $1`,
        [Number(mediaId)]
      );
      if (dbResult.rows && dbResult.rows.length > 0) return dbResult.rows;
    } catch (e: any) {
      console.warn('⚠️ PostgreSQL segment lookup failed:', e.message);
    }
  }
  return memoryDb.segments.filter((s: any) => s.media_id === Number(mediaId));
}
