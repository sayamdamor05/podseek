import { GoogleGenAI, Type } from '@google/genai';
import { dbInsertSegment, dbUpdateMediaStatus } from './db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export function extractVideoId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2] && match[2].length >= 8 && match[2].length <= 16) {
    return match[2];
  }
  return null;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
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

export function parseEmbedding(rawEmbedding: any): number[] | null {
  if (!rawEmbedding) return null;

  if (Array.isArray(rawEmbedding)) return rawEmbedding;

  try {
    const parsed = typeof rawEmbedding === 'string' ? JSON.parse(rawEmbedding) : rawEmbedding;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function computeKeywordMatch(query: string, text: string): number {
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

export function normalizeCommentFeed(commentFeed: any[]): any[] {
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

// Uses youtube-transcript package
async function fetchNativeTranscript(videoId: string): Promise<any[]> {
  let YoutubeTranscript;
  try {
    const mod = await import('youtube-transcript');
    YoutubeTranscript = (mod as any).YoutubeTranscript || (mod as any).default?.YoutubeTranscript || (mod as any).default;
  } catch (e) {
    throw new Error('youtube-transcript package not installed.');
  }

  let raw: any[];
  try {
    raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  } catch (e: any) {
    try {
      raw = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e2: any) {
      throw new Error(`Could not fetch transcript: ${e2.message}`);
    }
  }

  if (!raw || raw.length === 0) {
    throw new Error('Transcript returned empty. Video may not have captions.');
  }

  return raw
    .map((item: any) => ({
      start: typeof item.offset === 'number' ? item.offset / 1000 : (item.start ?? 0),
      text: item.text?.trim() ?? '',
    }))
    .filter((item: any) => item.text.length > 0);
}

async function fetchVideoTitle(videoUrl: string): Promise<string> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`);
    if (res.ok) {
      const data = await res.json();
      return data.title || 'Untitled Video';
    }
  } catch (e) {
    console.warn('⚠️ oEmbed fetch failed:', e);
  }
  return 'Untitled Video';
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

export function mergeCaptionsIntoSentences(rawTranscript: Array<{ start: number; text: string }>): Sentence[] {
  if (!rawTranscript || rawTranscript.length === 0) return [];

  const sentences: Sentence[] = [];
  let currentTexts: string[] = [];
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

export async function batchEmbedContents(texts: string[], aiClient: any, concurrency = 5): Promise<(number[] | null)[]> {
  if (!texts || texts.length === 0 || !process.env.GEMINI_API_KEY) {
    return texts ? texts.map(() => null) : [];
  }

  const results: (number[] | null)[] = new Array(texts.length).fill(null);

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
      } catch (e: any) {
        console.warn(`⚠️ Embedding failed for item ${globalIdx}:`, e.message);
      }
    });

    await Promise.all(chunkPromises);
  }

  return results;
}

export function adaptiveSegmentation(sentences: Sentence[], sentenceEmbeddings: (number[] | null)[]): any[] | null {
  if (sentences.length === 0) return null;
  if (sentences.length === 1) {
    return [{
      start: sentences[0].start,
      end: sentences[0].end,
      text: sentences[0].text,
      sentences: sentences,
    }];
  }

  const sims: number[] = [];
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

  const segments: any[] = [];
  let currentGroup: Sentence[] = [sentences[0]];
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

export async function processAudioJob(mediaId: number | string, videoUrl: string, options: any = {}): Promise<void> {
  try {
    const videoId = extractVideoId(videoUrl);
    if (!videoId) throw new Error('Invalid YouTube URL provided.');

    let segments: any[] = [];
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

      // Step 1: Sentence-level precision merging
      const sentences = mergeCaptionsIntoSentences(rawTranscript);
      console.log(`📝 Merged ${rawTranscript.length} caption fragments into ${sentences.length} complete sentences.`);

      // Step 2: Adaptive segmentation via sentence embeddings
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
        } catch (e: any) {
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
              segments = geminiSegs.map((seg: any) => ({
                ...seg,
                sentences: sentences.filter((s) => s.start >= seg.start - 2 && s.start <= seg.end + 2),
              }));
            }
          } catch (e: any) {
            console.warn('⚠️ Gemini segmentation failed, using sentence chunking fallback:', e.message);
          }
        }

        if (!segments || segments.length === 0) {
          // Fallback sentence chunker: 6 sentences per segment
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

    const textsToEmbed = segments.map((s: any) => s.text?.trim()).filter(Boolean);
    let vectors: (number[] | null)[] = [];

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
  } catch (error: any) {
    await dbUpdateMediaStatus(mediaId, 'failed');
    console.error('❌ Pipeline Worker Error:', error.message);
  }
}
