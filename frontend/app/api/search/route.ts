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

        const start = row.start_time !== undefined && row.start_time !== null ? Number(row.start_time) : null;
        const end = row.end_time !== undefined && row.end_time !== null ? Number(row.end_time) : null;
        const ts = start !== null ? start : end !== null ? end : 0;

        return {
          id: row.id,
          text: row.text,
          timestamp: ts,
          score,
          semanticScore,
          keywordScore,
        };
      })
      .sort((a: any, b: any) => b.score - a.score);

    const threshold = 0.05;

    const withTimestamps = scoredResults.filter((r: any) => r.timestamp && r.timestamp > 0);
    const candidatePool = withTimestamps.length > 0 ? withTimestamps : scoredResults;

    let results = candidatePool.filter((row: any) => row.score >= threshold).slice(0, 7);

    if (results.length === 0) {
      results = candidatePool
        .sort((a: any, b: any) => {
          if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
          return b.semanticScore - a.semanticScore;
        })
        .slice(0, 5);
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
