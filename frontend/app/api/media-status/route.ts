import { NextResponse } from 'next/server';
import { dbGetMediaStatus } from '../lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mediaId = searchParams.get('mediaId');

    if (!mediaId) {
      return NextResponse.json({ error: 'Missing mediaId' }, { status: 400 });
    }

    const status = await dbGetMediaStatus(mediaId);
    if (!status) {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({ status });
  } catch (error: any) {
    console.error('Media status lookup error:', error.message);
    return NextResponse.json({ error: 'Failed to get media status' }, { status: 500 });
  }
}
