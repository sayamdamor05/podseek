import { loadBackendEnv } from './config/env.js';
import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import pg from 'pg';
import cors from 'cors';

loadBackendEnv();

const app = express();
app.use(express.json());

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function initDb() {
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
      embedding JSONB NOT NULL
    )
  `);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i += 1) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }

  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator ? dot / denominator : 0;
}

function parseEmbedding(rawEmbedding) {
  if (!rawEmbedding) return null;

  if (Array.isArray(rawEmbedding)) return rawEmbedding;

  try {
    const parsed = typeof rawEmbedding === 'string' ? JSON.parse(rawEmbedding) : rawEmbedding;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function computeKeywordMatch(query, text) {
  if (!query || !text) return 0;

  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.trim().toLowerCase();

  if (normalizedText.includes(normalizedQuery)) return 1;

  const queryTokens = normalizedQuery.split(/\W+/).filter(Boolean);
  const textTokens = new Set(normalizedText.split(/\W+/).filter(Boolean));
  if (queryTokens.length === 0) return 0;

  const matches = queryTokens.filter((token) => textTokens.has(token)).length;
  return matches / queryTokens.length;
}

function normalizeCommentFeed(commentFeed) {
  if (!Array.isArray(commentFeed) || commentFeed.length === 0) return [];

  return commentFeed
    .map((item) => {
      if (typeof item === 'string') {
        return { text: item.trim() };
      }

      if (item && typeof item === 'object') {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
        const finalText = text || comment;

        if (!finalText) return null;

        return {
          text: finalText,
          start: Number(item.timestamp ?? item.start ?? 0) || 0,
          end: Number(item.end ?? item.timestamp ?? 0) || 0,
        };
      }

      return null;
    })
    .filter(Boolean);
}

// Uses youtube-transcript package — the only reliable server-side method
async function fetchNativeTranscript(videoId) {
  // Dynamically import so the rest of the file loads even if package is missing
  let YoutubeTranscript;
  try {
    const mod = await import('youtube-transcript');
    YoutubeTranscript = mod.YoutubeTranscript || mod.default?.YoutubeTranscript || mod.default;
  } catch (e) {
    throw new Error('youtube-transcript package not installed. Run: npm install youtube-transcript');
  }

  let raw;
  try {
    raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  } catch (e) {
    // Some videos only have auto-generated captions with no lang tag — try without lang
    try {
      raw = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e2) {
      throw new Error(`Could not fetch transcript: ${e2.message}`);
    }
  }

  if (!raw || raw.length === 0) {
    throw new Error('Transcript returned empty. Video may not have captions.');
  }

  // Normalize to { start (seconds), text }
  return raw.map((item) => ({
    start: typeof item.offset === 'number' ? item.offset / 1000 : (item.start ?? 0),
    text: item.text?.trim() ?? '',
  })).filter((item) => item.text.length > 0);
}

export async function processAudioJob(mediaId, videoUrl, options = {}) {
  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) throw new Error('Invalid YouTube URL provided.');

    let segments = [];
    const { commentFeed = [] } = options;
    const normalizedComments = normalizeCommentFeed(commentFeed);

    if (normalizedComments.length > 0) {
      console.log(`🗨️ Processing ${normalizedComments.length} comment feed items.`);
      segments = normalizedComments.map((item) => ({
        start: item.start,
        end: item.end,
        text: item.text,
      }));
    } else {
      console.log(`📡 Fetching captions for Video ID: ${videoId}...`);
      const rawTranscript = await fetchNativeTranscript(videoId);

      if (!rawTranscript || rawTranscript.length === 0) {
        throw new Error('No captions found for this video. Cannot process.');
      }

      console.log(`✅ Got ${rawTranscript.length} caption lines.`);

      const formattedInputText = rawTranscript
        .map((item) => `[${Math.round(item.start)}s] ${item.text}`)
        .join('\n');

      console.log(`🤖 Passing ${rawTranscript.length} lines to Gemini...`);

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            text: `You are given a raw video transcript with timestamps in seconds.
Group consecutive lines into logical topic segments (aim for 30–90 second chunks).
Each segment should cover one clear idea or topic.
Return a JSON array only — no explanation, no markdown.

Transcript:
${formattedInputText}`,
          },
        ],
        config: {
          systemInstruction:
            'Return ONLY a valid JSON array. Each item must have "start" (number, seconds), "end" (number, seconds), and "text" (string summarizing the segment content in 1-3 sentences). No markdown, no explanation.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                text: { type: Type.STRING },
              },
              required: ['start', 'end', 'text'],
            },
          },
        },
      });

      segments = JSON.parse(response.text);
    }

    if (!segments || segments.length === 0) {
      throw new Error('No segments available to embed. Aborting.');
    }

    console.log(`✨ Prepared ${segments.length} segments. Storing embeddings...`);

    for (const segment of segments) {
      if (!segment?.text?.trim()) continue;

      console.log(`🧠 Embedding: "${segment.text.substring(0, 60)}..."`);

      const embeddingResponse = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: segment.text,
      });

      const vector =
        embeddingResponse.embeddings?.[0]?.values ||
        embeddingResponse.embedding?.values;

      if (!vector) {
        console.warn('⚠️  No vector returned for segment, skipping.');
        continue;
      }

      await pool.query(
        `INSERT INTO transcript_segments (media_id, start_time, end_time, text, embedding)
         VALUES ($1, $2, $3, $4, $5)`,
        [mediaId, segment.start ?? 0, segment.end ?? 0, segment.text, JSON.stringify(vector)]
      );

      await delay(1200);
    }

    await pool.query("UPDATE media_files SET status = 'completed' WHERE id = $1", [mediaId]);
    console.log(`🎉 Successfully completed processing media ID: ${mediaId}`);
  } catch (error) {
    await pool.query("UPDATE media_files SET status = 'failed' WHERE id = $1", [mediaId]);
    console.error('❌ Pipeline Worker Error:', error.message);
  }
}

app.get('/api/media-status', async (req, res) => {
  try {
    const mediaIdParam = req.query.mediaId;
    const mediaId = Array.isArray(mediaIdParam) ? mediaIdParam[0] : mediaIdParam;

    if (!mediaId) {
      return res.status(400).json({ error: 'Missing mediaId' });
    }

    const mediaRes = await pool.query('SELECT status FROM media_files WHERE id = $1', [mediaId]);
    if (mediaRes.rows.length === 0) {
      return res.status(404).json({ status: 'not_found' });
    }

    res.json({ status: mediaRes.rows[0].status });
  } catch (error) {
    console.error('Media status lookup error:', error.message);
    res.status(500).json({ error: 'Failed to get media status' });
  }
});

app.post('/api/ingest', async (req, res) => {
  try {
    const { videoUrl, comments, commentFeed } = req.body;

    const dbRes = await pool.query(
      "INSERT INTO media_files (url, status) VALUES ($1, 'processing') RETURNING id",
      [videoUrl]
    );
    const mediaId = dbRes.rows[0].id;

    res.json({ success: true, mediaId });
    processAudioJob(mediaId, videoUrl, {
      commentFeed: comments || commentFeed || [],
    });
  } catch (error) {
    console.error('Ingest error:', error.message);
    res.status(500).json({ error: 'Failed to ingest video' });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const { query, mediaId } = req.body;

    const mediaRes = await pool.query(
      'SELECT status FROM media_files WHERE id = $1',
      [mediaId]
    );
    const mediaRow = mediaRes.rows[0];

    const embeddingResponse = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: query,
    });

    const queryVector =
      embeddingResponse.embeddings?.[0]?.values ||
      embeddingResponse.embedding?.values;

    if (!queryVector) {
      return res.status(500).json({ error: 'Failed to generate query embedding.' });
    }

    const dbResult = await pool.query(
      `SELECT id, text, start_time, end_time, embedding
       FROM transcript_segments
       WHERE media_id = $1`,
      [mediaId]
    );

    if (!mediaRow) {
      return res.status(404).json({ error: 'Media not found.' });
    }

    const rows = dbResult.rows || [];

    if (rows.length === 0) {
      if (mediaRow.status === 'processing') {
        return res.json({ results: [], processing: true });
      }
      if (mediaRow.status === 'failed') {
        return res.json({ results: [], error: 'Media processing failed. Please retry.' });
      }
      return res.json({ results: [] });
    }

    const scoredResults = (dbResult.rows || [])
      .map((row) => {
        const embedding = parseEmbedding(row.embedding);
        const semanticScore = embedding ? cosineSimilarity(queryVector, embedding) : 0;
        const keywordScore = computeKeywordMatch(query, row.text);
        const score = Math.max(semanticScore, semanticScore * 0.75 + keywordScore * 0.25);

        // prefer a meaningful start time; fall back to end_time when start_time is missing or 0
        const start = Number(row.start_time) || 0;
        const end = Number(row.end_time) || 0;
        const ts = start > 0 ? start : end > 0 ? end : null;

        return {
          id: row.id,
          text: row.text,
          timestamp: ts,
          score,
          semanticScore,
          keywordScore,
        };
      })
      .sort((a, b) => b.score - a.score);

    const threshold = 0.18;

    // Prefer results that have a meaningful timestamp (> 0).
    const withTimestamps = scoredResults.filter((r) => r.timestamp && r.timestamp > 0);

    const candidatePool = withTimestamps.length > 0 ? withTimestamps : scoredResults;

    let results = candidatePool.filter((row) => row.score >= threshold).slice(0, 7);

    if (results.length === 0) {
      results = candidatePool
        .sort((a, b) => {
          if (b.semanticScore !== a.semanticScore) return b.semanticScore - a.semanticScore;
          return b.keywordScore - a.keywordScore;
        })
        .slice(0, 5);
    }

    res.json({ results });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/', (req, res) => res.send('API Alive!'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 PodSeek server running on port ${PORT}`));

initDb().catch((error) => {
  console.error('Database initialization failed:', error.message);
  process.exit(1);
});
