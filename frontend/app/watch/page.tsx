"use client";
import { useEffect, useState, useRef, Suspense, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

interface SearchResult {
  id: number;
  text: string;
  timestamp: number;
  score: number;
}

function WatchWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mediaId = searchParams.get('id') || '1';
  const videoUrl = decodeURIComponent(searchParams.get('url') || '');
  const videoTitle = searchParams.get('title') || 'Untitled Video';

  const [query, setQuery] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState('');
  const [seekSeconds, setSeekSeconds] = useState<number | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [processingProgress, setProcessingProgress] = useState(12);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Extract YouTube video ID from URL
  function extractVideoId(url: string): string | null {
    const match = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    return match && match[2].length === 11 ? match[2] : null;
  }

  const videoId = extractVideoId(videoUrl);
  const isMediaReady = iframeLoaded && processingStatus === 'completed';

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const pollProcessingStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/media-status?mediaId=${mediaId}`);
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) {
              setProcessingStatus('failed');
              setProcessingProgress(0);
            }
            return;
          }
          throw new Error('Status check failed');
        }

        const data = await res.json();
        if (cancelled) return;

        const nextStatus = data.status === 'completed'
          ? 'completed'
          : data.status === 'failed'
            ? 'failed'
            : 'processing';

        setProcessingStatus(nextStatus);

        if (nextStatus === 'processing') {
          setProcessingProgress((prev) => Math.min(90, prev + 8));
        } else if (nextStatus === 'completed') {
          setProcessingProgress(100);
          if (intervalId) clearInterval(intervalId);
        } else {
          setProcessingProgress(0);
          if (intervalId) clearInterval(intervalId);
        }
      } catch {
        if (!cancelled) {
          setProcessingStatus('failed');
          setProcessingProgress(0);
        }
      }
    };

    if (!mediaId) return undefined;

    const startupTimer = window.setTimeout(() => {
      if (!cancelled) {
        setProcessingStatus('processing');
        setProcessingProgress(18);
      }
    }, 0);

    pollProcessingStatus();
    intervalId = window.setInterval(pollProcessingStatus, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      if (intervalId) clearInterval(intervalId);
    };
  }, [mediaId]);

  // Build embed src — when seekSeconds changes, update the iframe src to seek + autoplay
  const embedSrc = videoId
    ? seekSeconds !== null
      ? `https://www.youtube.com/embed/${videoId}?start=${Math.floor(seekSeconds)}&autoplay=1&rel=0`
      : `https://www.youtube.com/embed/${videoId}?rel=0`
    : null;

  const jumpToTimestamp = (seconds: number) => {
    setSeekSeconds(seconds);
  };

  const handleIframeLoaded = () => {
    setIframeLoaded(true);
  };

  const formatTime = (seconds: number) => {
    if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '00:00';
    const sec = Math.max(0, Math.floor(seconds));
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mediaId }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (data.processing) {
        setResults([]);
        setError('Media is still processing. Please try again in a moment.');
        return;
      }

      if (data.error) {
        setResults([]);
        setError(data.error);
        return;
      }

      setResults(data.results || []);
      if ((data.results?.length ?? 0) === 0) {
        setError('No results found. Try a different query.');
      }
    } catch {
      setError('Search failed. Make sure your backend is running.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadNewVideo = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newUrl.trim()) return;

    setIsIngesting(true);
    try {
      const res = await fetch(`${API_BASE}/api/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: newUrl }),
      });
      const data = await res.json();

      if (data.mediaId) {
        const safeUrl = encodeURIComponent(newUrl);
        router.push(`/watch?id=${data.mediaId}&url=${safeUrl}&title=Analyzed%20Media`);
        setNewUrl('');
      } else {
        setError('Failed to start processing. Check backend logs.');
      }
    } catch {
      setError('Server connection failed. Is your backend running?');
    } finally {
      setIsIngesting(false);
    }
  };

  if (!videoUrl || !videoId) {
    return (
      <div className="flex h-screen w-full bg-[#f8fbff] text-slate-950 items-center justify-center flex-col gap-4 px-4">
        <p className="text-xl text-slate-600">No valid YouTube URL provided.</p>
        <Link
          href="/"
          className="rounded-full border border-blue-500 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-[0_10px_30px_rgba(59,130,246,0.15)] transition hover:bg-blue-50"
        >
          ← Go back
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-[#f8fbff] text-slate-950 overflow-hidden">
      <div className="border-b border-slate-200 bg-white/95 px-4 py-4 shadow-sm shadow-slate-200/50 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <button
              type="button"
              onClick={() => router.push('/')}
              className="rounded-3xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 shadow-[0_10px_20px_rgba(239,68,68,0.12)] transition hover:bg-red-100"
            >
              PODSEEK
            </button>
          </div>
          <form onSubmit={handleLoadNewVideo} className="flex w-full flex-col gap-3 sm:w-[520px] sm:flex-row">
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="New YouTube video link"
              required
              className="flex-1 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={isIngesting}
              className="rounded-3xl bg-red-400 px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(239,68,68,0.22)] transition hover:bg-red-200 disabled:cursor-not-allowed disabled:bg-red-200"
            >
              {isIngesting ? 'Analyzing…' : 'Analyze'}
            </button>
          </form>
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row min-h-0 p-4 sm:p-6 gap-6 lg:gap-0 overflow-y-auto lg:overflow-hidden">
      <div className="flex flex-col w-full aspect-video lg:aspect-auto lg:flex-1 min-w-0 rounded-[32px] border border-slate-200 bg-white shadow-[0_32px_110px_rgba(59,130,246,0.12)] transition-transform duration-300 hover:-translate-y-1 overflow-hidden shrink-0 lg:shrink">
        {/* Video fills available space */}
        <div className="relative w-full flex-1 bg-black">
          {embedSrc && (
            <iframe
              ref={iframeRef}
              key={embedSrc}   /* key change forces re-mount = seek + autoplay */
              src={embedSrc}
              className="absolute inset-0 w-full h-full"
              onLoad={handleIframeLoaded}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={videoTitle}
            />
          )}
        </div>

        {/* Title bar below player */}
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-t border-slate-200">
          <div className="h-2.5 w-2.5 rounded-full bg-blue-500 shadow-[0_0_0_6px_rgba(59,130,246,0.12)]" />
          <span className="text-sm font-medium text-slate-700 truncate">{videoTitle}</span>
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs font-semibold text-slate-600 transition hover:text-blue-600 shrink-0"
          >
            Open on YouTube ↗
          </a>
        </div>
      </div>

      {/* ── RIGHT: Semantic search panel ── */}
      <div className="w-full lg:max-w-[420px] shrink-0 flex flex-col rounded-[32px] border border-slate-200 bg-[#f6f9ff] p-4 shadow-[0_32px_90px_rgba(37,99,235,0.15)] lg:ml-6 h-[550px] lg:h-auto min-h-0">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-950">Semantic Search</h2>
          <p className="text-xs text-slate-500 mt-0.5">Find the moment inside the video.</p>
        </div>

        {/* Search input */}
        <div className="px-4 py-3 border-b border-slate-200">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-slate-600">
                {processingStatus === 'processing'
                  ? 'Analyzing video and preparing search...'
                  : processingStatus === 'failed'
                    ? 'Processing failed. Please try again.'
                    : iframeLoaded
                      ? 'Semantic search is ready.'
                      : 'Loading video environment...'}
              </div>
              <div className="h-2.5 w-full max-w-[180px] overflow-hidden rounded-full bg-slate-200 shadow-inner sm:max-w-[220px]">
                <div
                  className={`h-2.5 rounded-full bg-gradient-to-r from-blue-500 via-sky-500 to-cyan-400 transition-all duration-500 ${processingStatus === 'processing' ? 'animate-pulse' : ''}`}
                  style={{ width: `${processingProgress}%` }}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search by meaning in the video..."
                disabled={!isMediaReady}
                className="flex-1 rounded-[28px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 placeholder:text-slate-400 outline-none transition duration-300 hover:shadow-[0_10px_40px_rgba(59,130,246,0.12)] focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              />
              <button
                onClick={handleSearch}
                disabled={isSearching || !isMediaReady}
                className="rounded-[28px] bg-red-400 px-4 py-2.5 text-white text-sm font-semibold shadow-[0_16px_40px_rgba(239,68,68,0.22)] transition duration-300 hover:bg-red-200 disabled:opacity-50 shrink-0"
              >
                {isSearching ? '...' : 'Search'}
              </button>
            </div>
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

          {error && (
            <p className="text-sm text-slate-500 text-center py-8">{error}</p>
          )}

          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => jumpToTimestamp(result.timestamp)}
              className="w-full text-left p-4 rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.08)] transition duration-300 hover:-translate-y-0.5 hover:border-red-200 hover:shadow-[0_24px_50px_rgba(239,68,68,0.12)] group"
            >
              {/* Timestamp + score row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* Play triangle */}
                  <span className="text-blue-600 group-hover:text-blue-500 transition">
                    ▶
                  </span>
                  <span className="text-blue-600 font-mono text-sm font-bold group-hover:text-blue-500 transition">
                    {formatTime(result.timestamp)}
                  </span>
                </div>
                <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                  {Math.round(result.score * 100)}% match
                </span>
              </div>

              {/* Segment text */}
              <p className="text-sm text-slate-600 leading-relaxed line-clamp-3 group-hover:text-slate-900 transition">
                {result.text}
              </p>
            </button>
          ))}

          {results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="text-4xl text-blue-500/30">🔍</div>
              <p className="text-sm text-slate-500">
                Search by meaning and jump directly to the moments that matter.
              </p>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-full bg-slate-900 text-white items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <WatchWorkspace />
    </Suspense>
  );
}
