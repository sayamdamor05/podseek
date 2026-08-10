import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { dbGetMediaStatus, dbGetSegments } from '../lib/db';
import {
  cosineSimilarity,
  parseEmbedding,
  computeKeywordMatch
} from '../lib/worker';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, mediaId } = body;

    if (!mediaId) {
      return NextResponse.json({ error: 'Missing mediaId' }, { status: 400 });
    }

    const status = await dbGetMediaStatus(mediaId);
    if (!status) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
    }

    let queryVector: number[] | null = null;
    if (process.env.GEMINI_API_KEY && query) {
      try {
        const embeddingResponse = await ai.models.embedContent({
          model: 'gemini-embedding-2',
          contents: query,
        });

        queryVector =
          embeddingResponse.embeddings?.[0]?.values ||
          null;
      } catch (e: any) {
        console.warn('Query embedding fallback:', e.message);
      }
    }

    const rows = await dbGetSegments(mediaId);

    if (rows.length === 0) {
      if (status === 'processing') {
        return NextResponse.json({ results: [], processing: true });
      }
      if (status === 'failed') {
        return NextResponse.json({ results: [], error: 'Media processing failed. Please retry.' });
      }
      return NextResponse.json({ results: [] });
    }

    const scoredResults = rows
      .map((row: any) => {
        const embedding = parseEmbedding(row.embedding);
        const semanticScore = (queryVector && embedding) ? cosineSimilarity(queryVector, embedding) : 0;
        const keywordScore = computeKeywordMatch(query, row.text);
        const score = Math.max(semanticScore, semanticScore * 0.75 + keywordScore * 0.25, keywordScore);

        const rangeStart = row.start_time !== undefined && row.start_time !== null ? Number(row.start_time) : 0;
        const rangeEnd = row.end_time !== undefined && row.end_time !== null ? Number(row.end_time) : 0;

        let sentencesArr: any[] = [];
        if (row.sentences) {
          try {
            sentencesArr = typeof row.sentences === 'string' ? JSON.parse(row.sentences) : row.sentences;
          } catch {
            sentencesArr = [];
          }
        }

        let bestTimestamp = rangeStart;
        let snippet = row.text;

        if (Array.isArray(sentencesArr) && sentencesArr.length > 0) {
          let maxSentenceScore = -1;
          let bestIdx = 0;

          sentencesArr.forEach((s: any, idx: number) => {
            const sKw = computeKeywordMatch(query, s.text || '');
            const sScore = Math.max(sKw, semanticScore * 0.7 + sKw * 0.3);
            if (sScore > maxSentenceScore) {
              maxSentenceScore = sScore;
              bestIdx = idx;
            }
          });

          bestTimestamp = sentencesArr[bestIdx].start ?? rangeStart;
          const contextStart = Math.max(0, bestIdx - 1);
          const contextEnd = Math.min(sentencesArr.length, bestIdx + 2);
          snippet = sentencesArr.slice(contextStart, contextEnd).map((s: any) => s.text).join(' ');
        }

        return {
          id: row.id,
          text: row.text,
          timestamp: bestTimestamp,
          rangeStart,
          rangeEnd,
          snippet,
          score,
          semanticScore,
          keywordScore,
        };
      })
      .sort((a: any, b: any) => b.score - a.score);

    // Relative Score Thresholding (keep results within 30% of top score)
    const topScore = scoredResults.length > 0 ? Math.max(...scoredResults.map((r: any) => r.score)) : 0;
    const relativeThreshold = topScore > 0 ? topScore * 0.7 : 0;

    let candidatePool = scoredResults.filter((row: any) => row.score >= relativeThreshold && row.score > 0);

    if (candidatePool.length === 0) {
      candidatePool = [...scoredResults]
        .sort((a: any, b: any) => {
          if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
          return b.score - a.score;
        })
        .slice(0, 5);
    }

    // Deduplicate adjacent results within 10 seconds of a higher-scoring result
    const deduplicated: any[] = [];
    for (const candidate of candidatePool) {
      const isDuplicate = deduplicated.some(
        (accepted) => Math.abs(accepted.timestamp - candidate.timestamp) < 10
      );
      if (!isDuplicate) {
        deduplicated.push(candidate);
      }
    }

    const results = deduplicated.slice(0, 7);

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
