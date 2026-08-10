import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { dbGetMediaStatus, dbGetSegments } from '../lib/db';
import {
  cosineSimilarity,
  parseEmbedding,
  computeKeywordMatch,
  batchEmbedContents,
} from '../lib/worker';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, mediaId } = body;

    if (!mediaId) {
      return NextResponse.json({ error: 'Missing mediaId' }, { status: 400 });
    }

    const statusObj = await dbGetMediaStatus(mediaId);
    if (!statusObj) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
    }

    const status = statusObj.status;

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
        return NextResponse.json({ results: [], error: statusObj.error || 'Media processing failed. Please retry.' });
      }
      return NextResponse.json({ results: [] });
    }

    // Step 1: Coarse segment-level scoring
    const scoredSegments = rows
      .map((row: any) => {
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
      .sort((a: any, b: any) => b.score - a.score);

    // Step 2: Relative Score Thresholding (keep segments within 30% of top score)
    const topScore = scoredSegments.length > 0 ? Math.max(...scoredSegments.map((r: any) => r.score)) : 0;
    const relativeThreshold = topScore > 0 ? topScore * 0.7 : 0;

    let topSegments = scoredSegments.filter((row: any) => row.score >= relativeThreshold && row.score > 0);

    if (topSegments.length === 0) {
      topSegments = [...scoredSegments]
        .sort((a: any, b: any) => {
          if (b.keywordScore !== a.keywordScore) return b.keywordScore - a.keywordScore;
          return b.score - a.score;
        })
        .slice(0, 5);
    }

    // Step 3: On-the-fly sentence-level embedding re-ranking for top candidate segments only
    const processedResults = await Promise.all(
      topSegments.map(async (seg: any) => {
        let sentencesArr: any[] = [];
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
          let sentenceEmbeddings: (number[] | null)[] = [];
          const sentenceTexts = sentencesArr.map((s: any) => s.text || '').filter(Boolean);

          if (queryVector && sentenceTexts.length > 0 && process.env.GEMINI_API_KEY) {
            try {
              sentenceEmbeddings = await batchEmbedContents(sentenceTexts, ai, 5);
            } catch (e: any) {
              console.warn('⚠️ Sentence re-ranking embedding failed:', e.message);
            }
          }

          let maxSentenceCombScore = -1;
          let bestIdx = 0;

          sentencesArr.forEach((s: any, idx: number) => {
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
          snippet = sentencesArr.slice(contextStart, contextEnd).map((s: any) => s.text).join(' ');
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

    processedResults.sort((a: any, b: any) => b.score - a.score);

    // Step 4: Deduplicate adjacent results within 10 seconds of a higher-scoring result
    const deduplicated: any[] = [];
    for (const candidate of processedResults) {
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
