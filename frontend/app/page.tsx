'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProductDemo from '../components/ProductDemo';


export default function WatchPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);

  // --- NEW TOP SEARCH BAR STATE ---
  const [newUrl, setNewUrl] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);

  // --- NEW TOP SEARCH BAR LOGIC ---
  const handleLoadNewVideo = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (newUrl.trim() !== '') {
      setIsIngesting(true);
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      try {
        const res = await fetch(`${API_BASE}/api/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: newUrl })
        });
        const data = await res.json();
        
        if (data.mediaId) {
          const safeUrl = encodeURIComponent(newUrl);
          // Push to the new video URL and clear the input box
          router.push(`/watch?id=${data.mediaId}&url=${safeUrl}&title=Analyzed%20Media`);
          setNewUrl('');
        } else {
          alert("Failed to start processing. Check backend logs.");
        }
      } catch {
        alert("Server connection failed. Is your backend running?");
      } finally {
        setIsIngesting(false);
      }
    }
  };

  const jumpToSearch = () => {
    const target = document.querySelector('#search');
    if (!target) return;

    const startY = window.scrollY;
    const targetY = Math.max(
      0,
      target.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2 + target.clientHeight / 2
    );
    const duration = 1200;
    const startTime = performance.now();

    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (currentTime: number) => {
      const elapsed = Math.min((currentTime - startTime) / duration, 1);
      const nextY = startY + (targetY - startY) * easeOut(elapsed);
      window.scrollTo(0, nextY);

      if (elapsed < 1) {
        requestAnimationFrame(step);
      } else {
        const searchInput = document.querySelector('#search-query-input') as HTMLInputElement | null;
        searchInput?.focus({ preventScroll: true });
      }
    };

    requestAnimationFrame(step);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const particles: Array<{ x: number; y: number; vx: number; vy: number; color: string; length: number }> = [];
    const colors = ['#1967d2', '#d93025', '#fbbc05', '#34a853'];

    const resize = () => {
      const dpr = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.max(window.innerWidth || 0, 1);
      const height = Math.max(window.innerHeight || 0, 1);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    const initParticles = (width: number, height: number) => {
      particles.length = 0;
      // Density scaled to page area
      const area = Math.max(width + height, 100);
      const count = Math.floor(area / 18);
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          color: colors[Math.floor(Math.random() * colors.length)],
          // reduced particle length for a subtler look
          length: 8 + Math.random() * 6,
        });
      }
    };

    const mouse = { x: -9999, y: -9999 };
    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = event.clientX - rect.left;
      mouse.y = event.clientY - rect.top;
    };
    const onMouseLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    let dims = resize();

    const draw = () => {
      const width = dims.width;
      const height = dims.height;
      ctx.clearRect(0, 0, width, height);
      // crisper thin lines with round caps
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);

      particles.forEach((particle) => {
        const dx = mouse.x - particle.x;
        const dy = mouse.y - particle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 160 && distance > 0) {
          const force = (160 - distance) / 14;
          particle.x -= (dx / distance) * force;
          particle.y -= (dy / distance) * force;
        }

        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.x < -particle.length) particle.x = width + particle.length;
        if (particle.x > width + particle.length) particle.x = -particle.length;
        if (particle.y < -particle.length) particle.y = height + particle.length;
        if (particle.y > height + particle.length) particle.y = -particle.length;

        const parallaxX = (particle.x - mouse.x) * 0.0015;
        const parallaxY = (particle.y - mouse.y) * 0.0015;

        ctx.strokeStyle = particle.color;
        ctx.beginPath();
        ctx.moveTo(particle.x + parallaxX, particle.y + parallaxY);
        ctx.lineTo(
          particle.x + particle.vx * particle.length + parallaxX,
          particle.y + particle.vy * particle.length + parallaxY
        );
        ctx.stroke();
      });

      animationId = requestAnimationFrame(draw);
    };

    // Setup and start
    dims = resize();
    initParticles(dims.width, dims.height);
    draw();

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);
    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8fbff] text-slate-950 pb-28">
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" />
      <div className="relative z-10">
        <section className="min-h-screen flex items-center justify-center px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-6xl font-black tracking-[-0.04em] text-slate-950 sm:text-7xl">
              Podseek
            </h1>
            <h2 className="mx-auto mt-6 max-w-2xl text-2xl font-bold tracking-tight text-slate-805 text-slate-800 sm:text-3xl leading-snug">
              Jump straight to the moments that matter.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-slate-700 sm:text-lg">
              Discover the meaning inside any video. Search by concept or keywords.
            </p>
            <button
              type="button"
              onClick={jumpToSearch}
              className="mt-10 inline-flex rounded-full bg-red-400 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_40px_rgba(239,68,68,0.18)] transition hover:bg-red-200"
            >
              Scroll to analyze
            </button>
          </div>
        </section>

        {/* Product Demo Showcase Section */}
        <section className="px-4 py-16 sm:px-6 relative z-10">
          <div className="mx-auto max-w-5xl text-center space-y-10">
            <div className="space-y-4">
              <h2 className="text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl">
                See it in action
              </h2>
              <p className="max-w-2xl mx-auto text-base text-slate-700 sm:text-lg">
                Watch how Podseek automatically indexes your video transcript, detects key concepts, and lets you seek directly to relevant timestamps.
              </p>
            </div>
            <ProductDemo onTryManually={jumpToSearch} />
          </div>
        </section>

        <section ref={searchRef} id="search" className="px-4 pb-24 pt-16 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-white/90 p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur sm:p-10">
              <div className="absolute -left-10 top-3 h-24 w-24 rounded-full bg-blue-200/80 blur-2xl" />
              <div className="absolute right-[-56px] top-16 h-28 w-28 rounded-full bg-red-200/80 blur-2xl" />

              <div className="relative px-6 py-8 sm:px-10 sm:py-10">
                <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
                  <h2 className="text-4xl font-bold tracking-[-0.03em] text-slate-950 sm:text-5xl">
                    Analyze a YouTube video
                  </h2>
                  <p className="max-w-2xl text-base leading-8 text-slate-700 sm:text-lg">
                    Paste a video URL to run semantic search on the transcript.
                  </p>
                </div>

                <form onSubmit={handleLoadNewVideo} className="mx-auto mt-12 flex w-full max-w-2xl flex-col gap-4 rounded-[28px] border border-slate-200 bg-[#f7fbff] p-5 shadow-[0_20px_60px_rgba(30,64,175,0.08)]">
                  <div className="space-y-4">
                    <label className="block text-xs uppercase tracking-[0.28em] text-slate-800">YouTube video</label>
                    <input
                      type="url"
                      id="search-query-input"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      required
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                    {/* Comments input removed from the front page */}

                  <button
                    type="button"
                    onClick={() => handleLoadNewVideo()}
                    disabled={isIngesting}
                    className="inline-flex w-full items-center justify-center rounded-2xl bg-red-400 px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(239,68,68,0.18)] transition hover:bg-red-200 disabled:cursor-not-allowed disabled:bg-red-200"
                  >
                    {isIngesting ? 'Analyzing…' : 'Analyze'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200 bg-white/95 py-4 px-4 shadow-[0_-16px_40px_rgba(15,23,42,0.08)] backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-900">Podseek</p>
          <div className="flex flex-wrap justify-center gap-4 sm:justify-end">
            <a href="#features" className="text-slate-700 transition hover:text-blue-600">Features</a>
            <a href="#watch" className="text-slate-700 transition hover:text-blue-600">Watch</a>
            <a href="#about" className="text-slate-700 transition hover:text-blue-600">About</a>
            <a href="#contact" className="text-slate-700 transition hover:text-blue-600">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}