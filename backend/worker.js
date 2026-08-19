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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : null;

// In-memory fallback storage when DATABASE_URL is not configured or throws error
const memoryDb = {
  mediaFiles: new Map(),
  segments: [],
  nextMediaId: 1,
  nextSegmentId: 1,
};

let dbInitialized = false;

async function ensureDbInit() {
  if (pool && !dbInitialized) {
    try {
      await initDb();
      dbInitialized = true;
    } catch (e) {
      console.warn('⚠️ Dynamic initDb failed:', e.message);
    }
  }
}

async function dbFindCompletedMediaByUrl(videoUrl) {
  await ensureDbInit();
  if (pool) {
    try {
      const dbRes = await pool.query(
        "SELECT id FROM media_files WHERE url = $1 AND status = 'completed' ORDER BY id DESC LIMIT 1",
        [videoUrl]
      );
      if (dbRes.rows.length > 0) return dbRes.rows[0].id;
    } catch (e) {
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

async function dbInsertMediaFile(videoUrl) {
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
    } catch (e) {
      console.warn('⚠️ PostgreSQL insert failed, using in-memory store fallback:', e.message);
    }
  }
  const id = memoryDb.nextMediaId++;
  memoryDb.mediaFiles.set(id, { id, url: videoUrl, status: 'processing', created_at: new Date() });
  return id;
}

async function dbUpdateMediaStatus(mediaId, status, errorMessage = null) {
  if (pool) {
    try {
      await pool.query("UPDATE media_files SET status = $1, error_message = $2 WHERE id = $3", [status, errorMessage || null, Number(mediaId)]);
      return;
    } catch (e) {
      console.warn('⚠️ PostgreSQL status update failed:', e.message);
    }
  }
  const record = memoryDb.mediaFiles.get(Number(mediaId));
  if (record) {
    record.status = status;
    record.error_message = errorMessage || null;
  }
}

async function dbGetMediaStatus(mediaId) {
  await ensureDbInit();
  if (pool) {
    try {
      const mediaRes = await pool.query('SELECT status, error_message FROM media_files WHERE id = $1', [Number(mediaId)]);
      if (mediaRes.rows.length > 0) return { status: mediaRes.rows[0].status, error: mediaRes.rows[0].error_message || null };
    } catch (e) {
      console.warn('⚠️ PostgreSQL status lookup failed:', e.message);
    }
  }
  const record = memoryDb.mediaFiles.get(Number(mediaId));
  return record ? { status: record.status, error: record.error_message || null } : null;
}

async function dbInsertSegment(mediaId, start, end, text, embeddingJson, sentencesJson = null) {
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO transcript_segments (media_id, start_time, end_time, text, embedding, sentences)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [Number(mediaId), start, end, text, embeddingJson, sentencesJson]
      );
      return;
    } catch (e) {
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

async function dbGetSegments(mediaId) {
  if (pool) {
    try {
      const dbResult = await pool.query(
        `SELECT id, text, start_time, end_time, embedding, sentences
         FROM transcript_segments
         WHERE media_id = $1`,
        [Number(mediaId)]
      );
      if (dbResult.rows && dbResult.rows.length > 0) return dbResult.rows;
    } catch (e) {
      console.warn('⚠️ PostgreSQL segment lookup failed:', e.message);
    }
  }
  return memoryDb.segments.filter((s) => s.media_id === Number(mediaId));
}

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

  await pool.query(`
    ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS sentences JSONB;
  `);
  await pool.query(`
    ALTER TABLE media_files ADD COLUMN IF NOT EXISTS error_message TEXT;
  `);
  dbInitialized = true;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function extractVideoId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2] && match[2].length >= 8 && match[2].length <= 16) {
    return match[2];
  }
  return null;
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

function mergeCaptionsIntoSentences(rawTranscript) {
  if (!rawTranscript || rawTranscript.length === 0) return [];

  const sentences = [];
  let currentTexts = [];
  let currentStart = rawTranscript[0].start;
  let currentEnd = rawTranscript[0].start + 2;

  for (let i = 0; i < rawTranscript.length; i++) {
    const item = rawTranscript[i];
    const text = item.text.trim();
    if (!text) continue;

    if (currentTexts.length === 0) {
      currentStart = item.start;
    }

    currentTexts.push(text);
    const estimatedDuration = Math.max(1, text.length * 0.06);
    currentEnd = item.start + estimatedDuration;

    const nextItem = rawTranscript[i + 1];
    const pauseGap = nextItem ? nextItem.start - item.start : 999;
    const isTerminalPunctuation = /[.?!]$/.test(text);
    const isLongPause = pauseGap > 1.5;
    const isTooLong = currentTexts.join(' ').length > 250;

    if (isTerminalPunctuation || isLongPause || isTooLong || !nextItem) {
      const fullText = currentTexts.join(' ').replace(/\s+/g, ' ').trim();
      if (fullText.length > 0) {
        sentences.push({
          start: Math.round(currentStart * 10) / 10,
          end: Math.round(currentEnd * 10) / 10,
          text: fullText,
        });
      }
      currentTexts = [];
    }
  }

  return sentences;
}

async function batchEmbedContents(texts, aiClient, concurrency = 5) {
  if (!texts || texts.length === 0 || !process.env.GEMINI_API_KEY) {
    return texts ? texts.map(() => null) : [];
  }

  const results = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += concurrency) {
    const chunk = texts.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (text, chunkIdx) => {
      const globalIdx = i + chunkIdx;
      if (!text || !text.trim()) return;
      try {
        const response = await aiClient.models.embedContent({
          model: 'gemini-embedding-2',
          contents: text,
        });
        const vector = response.embeddings?.[0]?.values || response.embedding?.values || null;
        results[globalIdx] = vector;
      } catch (e) {
        console.warn(`⚠️ Embedding failed for item ${globalIdx}:`, e.message);
      }
    });

    await Promise.all(chunkPromises);
  }

  return results;
}

function adaptiveSegmentation(sentences, sentenceEmbeddings) {
  if (sentences.length === 0) return null;
  if (sentences.length === 1) {
    return [{
      start: sentences[0].start,
      end: sentences[0].end,
      text: sentences[0].text,
      sentences: sentences,
    }];
  }

  const sims = [];
  for (let i = 0; i < sentences.length - 1; i++) {
    const embA = sentenceEmbeddings[i];
    const embB = sentenceEmbeddings[i + 1];
    if (embA && embB) {
      sims.push(cosineSimilarity(embA, embB));
    } else {
      sims.push(0.5);
    }
  }

  const mean = sims.reduce((acc, val) => acc + val, 0) / sims.length;
  const variance = sims.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / sims.length;
  const stdDev = Math.sqrt(variance);

  const cutoff = mean - 1.0 * stdDev;
  console.log(`📊 Adaptive Segmentation stats: Mean=${mean.toFixed(3)}, StdDev=${stdDev.toFixed(3)}, Cutoff=${cutoff.toFixed(3)}`);

  const segments = [];
  let currentGroup = [sentences[0]];
  let currentStart = sentences[0].start;

  for (let i = 0; i < sentences.length - 1; i++) {
    const sim = sims[i];
    const nextSentence = sentences[i + 1];
    const duration = nextSentence.end - currentStart;

    const isBoundaryDrop = sim < cutoff && duration >= 20;
    const isMaxDuration = duration >= 120;

    if (isBoundaryDrop || isMaxDuration) {
      const segText = currentGroup.map((s) => s.text).join(' ');
      segments.push({
        start: currentStart,
        end: sentences[i].end,
        text: segText,
        sentences: [...currentGroup],
      });
      currentGroup = [nextSentence];
      currentStart = nextSentence.start;
    } else {
      currentGroup.push(nextSentence);
    }
  }

  if (currentGroup.length > 0) {
    const segText = currentGroup.map((s) => s.text).join(' ');
    segments.push({
      start: currentStart,
      end: currentGroup[currentGroup.length - 1].end,
      text: segText,
      sentences: [...currentGroup],
    });
  }

  return segments.length > 0 ? segments : null;
}

// Uses youtube-transcript package
async function fetchNativeTranscript(videoId) {
  let YoutubeTranscript;
  try {
    const mod = await import('youtube-transcript');
    YoutubeTranscript = mod.YoutubeTranscript || mod.default?.YoutubeTranscript || mod.default;
  } catch (e) {
    throw new Error('youtube-transcript package not installed.');
  }

  let raw;
  try {
    raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  } catch (e) {
    try {
      raw = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e2) {
      throw new Error(`Could not fetch transcript: ${e2.message}`);
    }
  }

  if (!raw || raw.length === 0) {
    throw new Error('Transcript returned empty. Video may not have captions.');
  }

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
        sentences: [{ start: item.start, end: item.end, text: item.text }],
      }));
    } else {
      console.log(`📡 Fetching captions for Video ID: ${videoId}...`);
      const rawTranscript = await fetchNativeTranscript(videoId);
      console.log(`✅ Got ${rawTranscript.length} caption lines.`);

      if (!rawTranscript || rawTranscript.length === 0) {
        throw new Error('Transcript returned empty. Video may not have captions.');
      }

      // Sentence merging
      const sentences = mergeCaptionsIntoSentences(rawTranscript);
      console.log(`📝 Merged ${rawTranscript.length} caption fragments into ${sentences.length} complete sentences.`);

      // Adaptive segmentation via sentence embeddings
      if (process.env.GEMINI_API_KEY && sentences.length > 0) {
        try {
          console.log(`🧠 Computing embeddings for ${sentences.length} sentences...`);
          const sentenceEmbeddings = await batchEmbedContents(
            sentences.map((s) => s.text),
            ai,
            5
          );

          const adaptiveSegs = adaptiveSegmentation(sentences, sentenceEmbeddings);
          if (adaptiveSegs && adaptiveSegs.length > 0) {
            segments = adaptiveSegs;
            console.log(`✅ Adaptive segmentation produced ${segments.length} topic segments based on embedding similarity boundaries.`);
          }
        } catch (e) {
          console.warn('⚠️ Adaptive segmentation failed:', e.message);
        }
      }

      // Gemini Fallback segmentation if adaptive segmentation didn't run or returned empty
      if ((!segments || segments.length === 0) && sentences.length > 0) {
        if (process.env.GEMINI_API_KEY) {
          try {
            const formattedInputText = sentences
              .map((item) => `[${Math.round(item.start)}s] ${item.text}`)
              .join('\n');

            console.log(`🤖 Passing ${sentences.length} sentences to Gemini for topic segmentation...`);

            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [
                {
                  text: `You are given a video transcript split into complete sentences with timestamps in seconds.
Group consecutive sentences into logical topic segments. Each segment should cover one clear idea or topic.
Return a JSON array only.

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

            if (response.text) {
              const geminiSegs = JSON.parse(response.text);
              segments = geminiSegs.map((seg) => ({
                ...seg,
                sentences: sentences.filter((s) => s.start >= seg.start - 2 && s.start <= seg.end + 2),
              }));
            }
          } catch (e) {
            console.warn('⚠️ Gemini segmentation failed, using sentence chunking fallback:', e.message);
          }
        }

        if (!segments || segments.length === 0) {
          const chunkSize = 6;
          for (let i = 0; i < sentences.length; i += chunkSize) {
            const group = sentences.slice(i, i + chunkSize);
            segments.push({
              start: group[0].start,
              end: group[group.length - 1].end,
              text: group.map((s) => s.text).join(' '),
              sentences: group,
            });
          }
        }
      }
    }

    if (!segments || segments.length === 0) {
      throw new Error('No valid transcript segments could be processed.');
    }

    console.log(`✨ Prepared ${segments.length} segments. Fetching batch embeddings...`);

    const textsToEmbed = segments.map((s) => s.text?.trim()).filter(Boolean);
    let vectors = [];

    if (process.env.GEMINI_API_KEY && textsToEmbed.length > 0) {
      vectors = await batchEmbedContents(textsToEmbed, ai, 5);
      console.log(`✅ Successfully generated batch embeddings for ${vectors.filter(Boolean).length}/${textsToEmbed.length} segments.`);
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment?.text?.trim()) continue;

      const vector = vectors[i] || [];
      const sentencesJson = segment.sentences ? JSON.stringify(segment.sentences) : null;

      await dbInsertSegment(
        mediaId,
        segment.start ?? 0,
        segment.end ?? 0,
        segment.text,
        vector && vector.length > 0 ? JSON.stringify(vector) : '[]',
        sentencesJson
      );
    }

    await dbUpdateMediaStatus(mediaId, 'completed');
    console.log(`🎉 Successfully completed processing media ID: ${mediaId}`);
  } catch (error) {
    let errorMsg = error.message || 'Media processing failed.';
    
    // Make youtube-transcript errors more user-friendly
    if (errorMsg.includes('solving a captcha') || errorMsg.includes('too many requests')) {
      errorMsg = 'YouTube blocked the server from fetching the transcript. Please try another video or try again later.';
    } else if (errorMsg.includes('Transcript is disabled')) {
      errorMsg = 'This video does not have closed captions/transcripts enabled.';
    } else if (errorMsg.includes('Could not fetch transcript')) {
      errorMsg = 'Failed to fetch the video transcript. It might be disabled or age-restricted.';
    }

    await dbUpdateMediaStatus(mediaId, 'failed', errorMsg);
    console.error('❌ Pipeline Worker Error:', errorMsg);
  }
}

app.get('/api/media-status', async (req, res) => {
  try {
    const mediaIdParam = req.query.mediaId;
    const mediaId = Array.isArray(mediaIdParam) ? mediaIdParam[0] : mediaIdParam;

    if (!mediaId) {
      return res.status(400).json({ error: 'Missing mediaId' });
    }

    const statusObj = await dbGetMediaStatus(mediaId);
    if (!statusObj) {
      return res.status(404).json({ status: 'not_found' });
    }

    res.json({ status: statusObj.status, error: statusObj.error || null });
  } catch (error) {
    console.error('Media status lookup error:', error.message);
    res.status(500).json({ error: 'Failed to get media status' });
  }
});

app.post('/api/ingest', async (req, res) => {
  try {
    const { videoUrl, comments, commentFeed } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing videoUrl parameter.' });
    }

    const mediaId = await dbInsertMediaFile(videoUrl);

    res.json({ success: true, mediaId });
    processAudioJob(mediaId, videoUrl, {
      commentFeed: comments || commentFeed || [],
    });
  } catch (error) {
    console.error('Ingest error:', error.message);
    res.status(500).json({ error: `Ingest failed: ${error.message}` });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const { query, mediaId } = req.body;

    const statusObj = await dbGetMediaStatus(mediaId);
    if (!statusObj) {
      return res.status(404).json({ error: 'Media not found.' });
    }

    const status = statusObj.status;

    let queryVector = null;
    if (process.env.GEMINI_API_KEY && query) {
      try {
        const embeddingResponse = await ai.models.embedContent({
          model: 'gemini-embedding-2',
          contents: query,
        });

        queryVector =
          embeddingResponse.embeddings?.[0]?.values ||
          embeddingResponse.embedding?.values;
      } catch (e) {
        console.warn('Query embedding fallback:', e.message);
      }
    }

    const rows = await dbGetSegments(mediaId);

    if (rows.length === 0) {
      if (status === 'processing') {
        return res.json({ results: [], processing: true });
      }
      if (status === 'failed') {
        return res.json({ results: [], error: statusObj.error || 'Media processing failed. Please retry.' });
      }
      return res.json({ results: [] });
    }

    // Step 1: Coarse segment-level scoring
    const scoredSegments = rows
      .map((row) => {
        const embedding = parseEmbedding(row.embedding);
        const semanticScore = (queryVector && embedding) ? cosineSimilarity(queryVector, embedding) : 0;
        const keywordScore = computeKeywordMatch(query, row.text);
        const score = Math.max(semanticScore, semanticScore * 0.75 + keywordScore * 0.25, keywordScore);

        const rangeStart = row.start_time !== undefined && row.start_time !== null ? Number(row.start_time) : 0;
        const rangeEnd = row.end_time !== undefined && row.end_time !== null ? Number(row.end_time) : 0;

        return {
          id: row.id,
          row,
          text: row.text,
          rangeStart,
          rangeEnd,
          score,
          semanticScore,
          keywordScore,
        };
      })
      .sort((a, b) => b.score - a.score);

    // Step 2: Relative Score Thresholding (keep segments within 30% of top score)
    const topScore = scoredSegments.length > 0 ? Math.max(...scoredSegments.map((r) => r.score)) : 0;
    const relativeThreshold = topScore > 0 ? topScore * 0.7 : 0;

    let topSegments = scoredSegments.filter((row) => row.score >= relativeThreshold && row.score > 0);

    if (topSegments.length === 0) {
      topSegments = [...scoredSegments]
        .sort((a, b) => {
          if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
          return b.score - a.score;
        })
        .slice(0, 5);
    }

    // Step 3: On-the-fly sentence-level embedding re-ranking for top candidate segments only
    const processedResults = await Promise.all(
      topSegments.map(async (seg) => {
        let sentencesArr = [];
        if (seg.row.sentences) {
          try {
            sentencesArr = typeof seg.row.sentences === 'string' ? JSON.parse(seg.row.sentences) : seg.row.sentences;
          } catch {
            sentencesArr = [];
          }
        }

        let bestTimestamp = seg.rangeStart;
        let snippet = seg.text;
        let bestScore = seg.score;
        let bestSemanticScore = seg.semanticScore;
        let bestKeywordScore = seg.keywordScore;

        if (Array.isArray(sentencesArr) && sentencesArr.length > 0) {
          let sentenceEmbeddings = [];
          const sentenceTexts = sentencesArr.map((s) => s.text || '').filter(Boolean);

          if (queryVector && sentenceTexts.length > 0 && process.env.GEMINI_API_KEY) {
            try {
              sentenceEmbeddings = await batchEmbedContents(sentenceTexts, ai, 5);
            } catch (e) {
              console.warn('⚠️ Sentence re-ranking embedding failed:', e.message);
            }
          }

          let maxSentenceCombScore = -1;
          let bestIdx = 0;

          sentencesArr.forEach((s, idx) => {
            const sentVector = sentenceEmbeddings[idx] || null;
            const sSemScore = (queryVector && sentVector)
              ? cosineSimilarity(queryVector, sentVector)
              : seg.semanticScore;
            const sKwScore = computeKeywordMatch(query, s.text || '');
            const sCombScore = Math.max(sSemScore, sSemScore * 0.75 + sKwScore * 0.25, sKwScore);

            if (sCombScore > maxSentenceCombScore) {
              maxSentenceCombScore = sCombScore;
              bestIdx = idx;
              bestSemanticScore = sSemScore;
              bestKeywordScore = sKwScore;
              bestScore = Math.max(seg.score, sCombScore);
            }
          });

          bestTimestamp = sentencesArr[bestIdx].start ?? seg.rangeStart;
          const contextStart = Math.max(0, bestIdx - 1);
          const contextEnd = Math.min(sentencesArr.length, bestIdx + 2);
          snippet = sentencesArr.slice(contextStart, contextEnd).map((s) => s.text).join(' ');
        }

        return {
          id: seg.id,
          text: seg.text,
          timestamp: bestTimestamp,
          rangeStart: seg.rangeStart,
          rangeEnd: seg.rangeEnd,
          snippet,
          score: bestScore,
          semanticScore: bestSemanticScore,
          keywordScore: bestKeywordScore,
        };
      })
    );

    processedResults.sort((a, b) => b.score - a.score);

    // Step 4: Deduplicate adjacent results within 10 seconds of a higher-scoring result
    const deduplicated = [];
    for (const candidate of processedResults) {
      const isDuplicate = deduplicated.some(
        (accepted) => Math.abs(accepted.timestamp - candidate.timestamp) < 10
      );
      if (!isDuplicate) {
        deduplicated.push(candidate);
      }
    }

    const results = deduplicated.slice(0, 7);

    res.json({ results });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/', (req, res) => res.send('API Alive!'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 PodSeek server running on port ${PORT}`));

initDb()
  .then(() => console.log('✅ Database initialized successfully'))
  .catch((error) => {
    console.warn('⚠️ Database initialization warning (server active for health checks):', error.message);
  });
