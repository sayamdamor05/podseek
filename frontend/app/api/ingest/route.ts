import { NextResponse } from 'next/server';
import { dbInsertMediaFile } from '../lib/db';
import { processAudioJob } from '../lib/worker';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { videoUrl, comments, commentFeed } = body;

    if (!videoUrl) {
      return NextResponse.json({ error: 'Missing videoUrl parameter.' }, { status: 400 });
    }

    const mediaId = await dbInsertMediaFile(videoUrl);

    // Fire-and-forget: do NOT await — serverless functions (Netlify/Vercel) have
    // strict timeout limits (~10–26 s) which the full pipeline will always exceed.
    // The client polls /api/media-status to track progress.
    processAudioJob(mediaId, videoUrl, {
      commentFeed: comments || commentFeed || [],
    }).catch((err: any) => console.error('Background processAudioJob error:', err?.message));

    return NextResponse.json({ success: true, mediaId });
  } catch (error: any) {
    console.error('Ingest error:', error.message);
    return NextResponse.json({ error: `Ingest failed: ${error.message}` }, { status: 500 });
  }
}

