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

    // Await processing in serverless to ensure it completes before container freezes
    await processAudioJob(mediaId, videoUrl, {
      commentFeed: comments || commentFeed || [],
    });

    return NextResponse.json({ success: true, mediaId });
  } catch (error: any) {
    console.error('Ingest error:', error.message);
    return NextResponse.json({ error: `Ingest failed: ${error.message}` }, { status: 500 });
  }
}
