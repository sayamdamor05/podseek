'use client';

import React, { useState, useEffect, useRef } from 'react';

// Interfaces for coordinates
interface Point {
  x: number;
  y: number;
}

// Simulated Chapters for the video
interface Chapter {
  id: number;
  timestamp: string;
  seconds: number;
  title: string;
  description: string;
}

const chaptersData: Chapter[] = [
  { id: 1, timestamp: '00:15', seconds: 15, title: 'Concept Search Intro', description: 'Understanding how semantic query vector spaces work.' },
  { id: 2, timestamp: '01:45', seconds: 105, title: 'Vector Embeddings', description: 'Converting words and transcripts into mathematical arrays.' },
  { id: 3, timestamp: '03:40', seconds: 220, title: 'Semantic vs Keywords', description: 'Why synonyms and concepts yield better results than string matches.' },
  { id: 4, timestamp: '06:12', seconds: 372, title: 'Real-time Video Seeking', description: 'Retrieving precise time stamps and jumping direct to context.' },
  { id: 5, timestamp: '09:05', seconds: 545, title: 'Large Scale Indexing', description: 'Performance scaling across multi-hour podcast databases.' },
];

interface ProductDemoProps {
  onTryManually?: () => void;
}

export default function ProductDemo({ onTryManually }: ProductDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Autoplay states
  const [isPlayingDemo, setIsPlayingDemo] = useState<boolean>(true);
  
  // Demo states: 'home' | 'loading' | 'workspace'
  const [demoState, setDemoState] = useState<'home' | 'loading' | 'workspace'>('home');
  
  // Inputs
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  
  // Loading simulation state
  const [loadingStep, setLoadingStep] = useState<number>(0);
  
  // Video player simulator states
  const [isPlayingVideo, setIsPlayingVideo] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [totalTime] = useState<number>(600); // 10 minutes total (600 seconds)
  const [activeChapterId, setActiveChapterId] = useState<number>(1);
  const [isSeekingFlash, setIsSeekingFlash] = useState<boolean>(false);

  // Simulated Mouse Cursor States
  const [cursorPos, setCursorPos] = useState<Point>({ x: 95, y: 95 }); // percentage inside container
  const [cursorVisible, setCursorVisible] = useState<boolean>(true);
  const [isCursorClicking, setIsCursorClicking] = useState<boolean>(false);
  const [isInputFocused, setIsInputFocused] = useState<boolean>(false);

  // Autoplay animation timeline tracker
  const [timelineMs, setTimelineMs] = useState<number>(0);

  // Reset function to clear states
  const resetDemo = () => {
    setDemoState('home');
    setYoutubeUrl('');
    setLoadingStep(0);
    setCurrentTime(0);
    setActiveChapterId(1);
    setIsPlayingVideo(true);
    setCursorPos({ x: 95, y: 95 });
    setCursorVisible(true);
    setIsCursorClicking(false);
    setIsInputFocused(false);
    setTimelineMs(0);
  };

  // Toggle autoplay playback
  const handleToggleDemo = () => {
    if (isPlayingDemo) {
      setIsPlayingDemo(false);
      setCursorVisible(false);
    } else {
      setIsPlayingDemo(true);
      setCursorVisible(true);
      resetDemo();
    }
  };

  // Custom loader text steps
  const loaderTexts = [
    'Connecting to video ingestion agent...',
    'Downloading audio & generating transcripts...',
    'Analyzing semantic topics with Gemini...',
    'Generating vector embeddings & seeking index...',
    'Finalizing interactive seek map...'
  ];

  // Simulated timeline loops in Auto Mode
  useEffect(() => {
    if (!isPlayingDemo) return;

    let animFrame: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      setTimelineMs((prev) => {
        const next = prev + delta;
        // Reset timeline at 14 seconds (14000ms)
        if (next >= 14000) {
          resetDemo();
          return 0;
        }
        return next;
      });

      animFrame = requestAnimationFrame(loop);
    };

    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [isPlayingDemo]);

  // Update states based on Autoplay timeline
  useEffect(() => {
    if (!isPlayingDemo) return;

    const t = timelineMs;

    // --- CURSOR PATH & INPUT ANIMATION ---
    if (t < 1500) {
      // 0s - 1.5s: Cursor moves from (95, 95) to the Search Bar (50, 48)
      const ratio = t / 1500;
      setCursorPos({
        x: 95 + (50 - 95) * easeInOutQuad(ratio),
        y: 95 + (48 - 95) * easeInOutQuad(ratio)
      });
      setDemoState('home');
      setYoutubeUrl('');
      setIsInputFocused(false);
    } 
    else if (t >= 1500 && t < 3800) {
      // 1.5s - 3.8s: Cursor is hovering search bar. Simulate typing URL letter by letter.
      setCursorPos({ x: 50, y: 48 });
      setIsInputFocused(true);
      
      const fullUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const typingTime = t - 1500;
      const charsCount = Math.min(
        Math.floor((typingTime / 1800) * fullUrl.length),
        fullUrl.length
      );
      setYoutubeUrl(fullUrl.slice(0, charsCount));
    } 
    else if (t >= 3800 && t < 4500) {
      // 3.8s - 4.5s: Cursor moves to the "Analyze Video" Button (50, 68)
      setIsInputFocused(false);
      const ratio = (t - 3800) / 700;
      setCursorPos({
        x: 50,
        y: 48 + (68 - 48) * easeInOutQuad(ratio)
      });
    } 
    else if (t >= 4500 && t < 4800) {
      // 4.5s - 4.8s: Click the button!
      setCursorPos({ x: 50, y: 68 });
      setIsCursorClicking(true);
    } 
    else if (t >= 4800 && t < 7200) {
      // 4.8s - 7.2s: Loading state occurs. Cursor goes out of scope.
      setIsCursorClicking(false);
      setCursorVisible(false);
      setDemoState('loading');
      
      // Step loading message
      const loadProgress = t - 4800; // max 2400
      const currentStep = Math.min(
        Math.floor((loadProgress / 2400) * loaderTexts.length),
        loaderTexts.length - 1
      );
      setLoadingStep(currentStep);
    } 
    else if (t >= 7200 && t < 8500) {
      // 7.2s - 8.5s: Show Workspace. Cursor emerges at bottom right and moves to 3rd timestamp row (80, 52)
      setDemoState('workspace');
      setCursorVisible(true);
      
      const ratio = (t - 7200) / 1300;
      setCursorPos({
        x: 95 + (80 - 95) * easeInOutQuad(ratio),
        y: 95 + (52 - 95) * easeInOutQuad(ratio)
      });
      // Video is playing at default timeline
      const elapsedVideoTime = Math.floor((t - 7200) * 0.005); // slowly advance from 0
      setCurrentTime(elapsedVideoTime);
    } 
    else if (t >= 8500 && t < 8800) {
      // 8.5s - 8.8s: Hover timestamp, click.
      setCursorPos({ x: 80, y: 52 });
      setIsCursorClicking(true);
    } 
    else if (t >= 8800 && t < 12500) {
      // 8.8s - 12.5s: Jump progress bar to 220s (timestamp 3). Pulse seek bar. Move cursor away.
      if (isCursorClicking) {
        setIsCursorClicking(false);
        setIsSeekingFlash(true);
        setTimeout(() => setIsSeekingFlash(false), 800);
        setActiveChapterId(3);
      }
      
      // Progress time forward from 220s
      const videoElapsed = t - 8800;
      setCurrentTime(220 + Math.floor(videoElapsed * 0.003));
      
      // Move cursor slowly off-screen
      const ratio = Math.min((t - 8800) / 2500, 1);
      setCursorPos({
        x: 80 + (95 - 80) * easeInOutQuad(ratio),
        y: 52 + (95 - 52) * easeInOutQuad(ratio)
      });
    }
    else if (t >= 12500) {
      // 12.5s+: Fade out cursor preparing for reset
      setCursorVisible(false);
    }
  }, [timelineMs, isPlayingDemo]);

  // Easing helper
  const easeInOutQuad = (x: number): number => {
    return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  };

  // Video progress calculations
  const progressPercent = (currentTime / totalTime) * 100;

  // Format time (seconds to mm:ss)
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Mode Controls - Styled to match current site theme */}
      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex items-center space-x-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse"></span>
          <span className="text-sm font-semibold text-slate-700">
            Interactive Product Demo
          </span>
        </div>
        <div className="inline-flex rounded-lg p-0.5 bg-slate-100 border border-slate-200">
          <button
            onClick={handleToggleDemo}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              isPlayingDemo
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isPlayingDemo ? '⏸️ Pause Demo' : '▶️ Play Demo'}
          </button>
          <button
            onClick={onTryManually}
            className="px-3 py-1 text-xs font-semibold rounded-md text-slate-600 hover:text-slate-900 transition-all flex items-center gap-1"
          >
            🎮 Try Manually
          </button>
        </div>
      </div>

      {/* Main 16:9 Showcase Frame - Light Themed to match website */}
      <div
        ref={containerRef}
        className="relative w-full aspect-video rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.06)] overflow-hidden select-none"
      >
        {/* Top Native-Style Bar */}
        <div className="absolute top-0 left-0 right-0 h-10 bg-slate-50/95 border-b border-slate-200/80 px-4 flex items-center justify-between z-30 backdrop-blur-sm">
          {/* OS Window dots */}
          <div className="flex space-x-1.5 items-center">
            <span className="w-3 h-3 rounded-full bg-[#d93025]/80"></span>
            <span className="w-3 h-3 rounded-full bg-[#fbbc05]/80"></span>
            <span className="w-3 h-3 rounded-full bg-[#34a853]/80"></span>
          </div>
          {/* App title */}
          <div className="text-[11px] font-mono tracking-widest text-slate-400 flex items-center space-x-1">
            <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
            </svg>
            <span>PODSEEK DEMO</span>
          </div>
          {/* Current Mode Badge */}
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-200">
              Demo Mode
            </span>
          </div>
        </div>

        {/* Content Container (shifted down to account for top bar) */}
        <div className="w-full h-full pt-10 relative text-slate-900 font-sans">
          {/* ======================================================== */}
          {/* STATE: HOME / INPUT FORM */}
          {/* ======================================================== */}
          {demoState === 'home' && (
            <div className="absolute inset-0 flex flex-col justify-center items-center px-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-50 via-white to-white transition-opacity duration-300">
              
              {/* Backgrid graphic */}
              <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-35"></div>

              <div className="relative text-center max-w-lg z-10 space-y-2 md:space-y-5">
                {/* Logo & Headline */}
                <div className="space-y-1.5">
                  <h3 className="text-xl md:text-3xl lg:text-4xl font-black tracking-[-0.03em] text-slate-950 flex items-center justify-center gap-2">
                    Podseek <span className="text-red-400">Search</span>
                  </h3>
                  <p className="text-slate-600 text-[10px] md:text-xs lg:text-sm max-w-sm mx-auto font-medium leading-relaxed font-sans">
                    Map concept transcripts instantly. Seek visually to matching video milestones.
                  </p>
                </div>

                {/* Form Input Container */}
                <div className="w-full space-y-1.5 md:space-y-3">
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-3 md:left-4 flex items-center pointer-events-none text-slate-400">
                      <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                      </svg>
                    </div>
                    <input
                      type="url"
                      readOnly
                      placeholder="Paste YouTube Link (e.g. youtube.com/watch?v=...)"
                      value={youtubeUrl}
                      className={`w-full bg-slate-50 border text-[9px] md:text-xs lg:text-sm rounded-lg md:rounded-xl pl-8 md:pl-11 pr-3 md:pr-4 py-1.5 md:py-2.5 outline-none transition-all duration-300 font-mono ${
                        isInputFocused 
                          ? 'border-red-400/80 ring-2 ring-red-400/20 text-slate-900 bg-white' 
                          : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    />
                  </div>

                  <button
                    type="button"
                    className="w-full py-1.5 md:py-2.5 rounded-lg md:rounded-xl text-[9px] md:text-xs font-bold tracking-wider flex items-center justify-center space-x-2 border transition-all duration-300 bg-red-400 text-white hover:bg-red-300 border-transparent shadow-[0_14px_40px_rgba(239,68,68,0.12)]"
                  >
                    <span>START SEMANTIC ANALYSIS</span>
                    <svg className="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STATE: LOADING PIPELINE */}
          {/* ======================================================== */}
          {demoState === 'loading' && (
            <div className="absolute inset-0 flex flex-col justify-center items-center bg-white transition-opacity duration-300">
              <div className="max-w-md w-full px-8 space-y-3 md:space-y-6 text-center">
                {/* Micro spinner */}
                <div className="relative w-8 h-8 md:w-14 md:h-14 mx-auto flex items-center justify-center">
                  <span className="absolute inset-0 border-2 border-slate-100 rounded-full"></span>
                  <span className="absolute inset-0 border-2 border-red-400 rounded-full border-t-transparent animate-spin"></span>
                  <svg className="w-3.5 h-3.5 md:w-5 md:h-5 text-red-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707-.707" />
                  </svg>
                </div>

                <div className="space-y-1 md:space-y-2">
                  <h4 className="text-[8px] md:text-xs uppercase tracking-[0.25em] text-slate-400 font-mono">Pipeline Ingesting</h4>
                  
                  {/* Stepper details */}
                  <div className="h-6 overflow-hidden relative">
                    <div className="text-[10px] md:text-sm font-semibold text-red-400 font-mono transition-transform duration-300">
                      {loaderTexts[loadingStep]}
                    </div>
                  </div>
                </div>

                {/* Simulated Progress Bar */}
                <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden border border-slate-200">
                  <div 
                    className="bg-red-400 h-full transition-all duration-300 ease-out rounded-full shadow-[0_0_12px_rgba(239,68,68,0.5)]"
                    style={{ width: `${((loadingStep + 1) / loaderTexts.length) * 100}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[7px] md:text-[10px] text-slate-400 font-mono">
                  <span>SHARDS: 4/4 READY</span>
                  <span>COMPUTING VECTORS...</span>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STATE: WORKSPACE / RESULTS LIST */}
          {/* ======================================================== */}
          {demoState === 'workspace' && (
            <div className="absolute inset-0 grid grid-cols-5 bg-white divide-x divide-slate-100 transition-opacity duration-300">
              
              {/* Left Column (60% width): Video Mockup */}
              <div className="col-span-3 flex flex-col h-full bg-slate-50/50">
                {/* Main Video Panel */}
                <div className="relative flex-1 flex items-center justify-center bg-slate-100/30 overflow-hidden">
                  
                  {/* Interactive Jump visual flash */}
                  <div className={`absolute inset-0 bg-red-500/10 z-10 transition-opacity duration-300 pointer-events-none flex items-center justify-center ${
                    isSeekingFlash ? 'opacity-100' : 'opacity-0'
                  }`}>
                    <div className="bg-white px-4 py-2 rounded-lg border border-red-200 shadow-lg text-red-500 text-xs font-mono font-bold tracking-wider animate-bounce">
                      ⚡ SEEKED TO {formatTime(currentTime)}
                    </div>
                  </div>

                  {/* Simulated video playback graphic */}
                  <div className="w-full h-full flex flex-col items-center justify-center p-4">
                    
                    {/* Visualizer bars that wiggle */}
                    <div className="flex items-end justify-center space-x-1.5 h-16 w-full mb-4">
                      {[...Array(14)].map((_, i) => {
                        const randomHeight = isPlayingVideo 
                          ? Math.sin((currentTime * 1.5) + i) * 24 + 32 
                          : 12;
                        return (
                          <div 
                            key={i} 
                            style={{ height: `${Math.max(8, randomHeight)}px` }}
                            className="w-1.5 bg-gradient-to-t from-[#d93025] to-red-400 rounded-t-sm transition-all duration-300 ease-out opacity-85"
                          />
                        );
                      })}
                    </div>

                    <div className="text-center space-y-1">
                      <span className="text-[7px] md:text-[10px] font-mono tracking-wider text-slate-400">
                        SIMULATED VIDEO PLAYER
                      </span>
                      <p className="text-[9px] md:text-xs font-semibold text-slate-800 max-w-xs truncate px-2 md:px-4">
                        Episode 42: Next-Gen Vector DBs and Neural Indexes
                      </p>
                    </div>
                  </div>

                  {/* Absolute Badge showing seeking is working */}
                  <div className="absolute top-2 md:top-3 left-2 md:left-3 bg-white border border-slate-200 text-[7px] md:text-[10px] px-1.5 md:px-2.5 py-0.5 md:py-1 rounded-md font-mono text-slate-500 flex items-center space-x-1.5 shadow-sm">
                    <span className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${isPlayingVideo ? 'bg-red-500 animate-ping' : 'bg-amber-500'}`}></span>
                    <span>{isPlayingVideo ? 'PLAYING' : 'PAUSED'}</span>
                  </div>
                </div>

                {/* Video controls bottom bar */}
                <div className="bg-white border-t border-slate-100 px-3 md:px-4 py-1.5 md:py-3 flex flex-col space-y-1 md:space-y-2">
                  
                  {/* Custom progress bar scrubber */}
                  <div className="h-1.5 w-full bg-slate-200 rounded-full relative group">
                    {/* Active timeline bar */}
                    <div 
                      className="bg-red-400 h-full rounded-full relative shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                      style={{ width: `${progressPercent}%` }}
                    >
                      {/* Active seeking point */}
                      <span className="absolute -right-1.5 -top-1 w-3.5 h-3.5 rounded-full bg-white shadow-md border-2 border-red-400 scale-0 group-hover:scale-100 transition-transform"></span>
                    </div>

                    {/* Chapter Tick Marks */}
                    {chaptersData.map((ch) => {
                      const tickPos = (ch.seconds / totalTime) * 100;
                      return (
                        <div
                          key={ch.id}
                          style={{ left: `${tickPos}%` }}
                          className={`absolute top-0 bottom-0 w-0.5 ${
                            activeChapterId === ch.id ? 'bg-red-400 h-3 -top-0.5' : 'bg-slate-300'
                          } transition-all`}
                          title={ch.title}
                        />
                      );
                    })}
                  </div>

                  {/* Controls Actions */}
                  <div className="flex items-center justify-between text-slate-500 text-[8px] md:text-xs">
                    <div className="flex items-center space-x-3">
                      <span className="font-mono text-[7px] md:text-[10px] text-slate-500">
                        {formatTime(currentTime)} / {formatTime(totalTime)}
                      </span>
                    </div>

                    <div className="text-[7px] md:text-[10px] font-mono text-red-500 font-semibold">
                      ⚡ CONCEPT SEEK ACTIVE
                    </div>
                  </div>
                </div>

              </div>

              {/* Right Column (40% width): Interactive transcript / chapters */}
              <div className="col-span-2 flex flex-col h-full bg-white overflow-y-auto">
                <div className="p-1.5 md:p-3 border-b border-slate-100 flex justify-between items-center">
                  <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Concepts Identified
                  </span>
                  <span className="text-[7px] md:text-[9px] bg-slate-100 text-slate-600 font-mono px-1 md:px-1.5 py-0.2 md:py-0.5 rounded border border-slate-200">
                    5 Clips
                  </span>
                </div>

                {/* Chapter list */}
                <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
                  {chaptersData.map((ch) => {
                    const isActive = activeChapterId === ch.id;
                    return (
                      <div
                        key={ch.id}
                        className={`p-1.5 md:p-3 text-left transition-all duration-300 flex flex-col space-y-0.5 md:space-y-1 ${
                          isActive 
                            ? 'bg-slate-50 border-l-2 border-red-400' 
                            : 'hover:bg-slate-50/50'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className={`text-[7px] md:text-[10px] font-mono font-bold px-1 md:px-1.5 py-0.2 md:py-0.5 rounded ${
                            isActive ? 'bg-red-500/10 text-red-500' : 'bg-slate-100 text-slate-400'
                          }`}>
                            {ch.timestamp}
                          </span>
                          <span className="text-[7px] md:text-[9px] text-slate-400 font-mono uppercase">
                            Clip {ch.id}
                          </span>
                        </div>
                        <h5 className={`text-[9px] md:text-xs font-bold ${isActive ? 'text-red-500' : 'text-slate-800'}`}>
                          {ch.title}
                        </h5>
                        <p className="hidden md:block text-[10px] text-slate-500 leading-normal line-clamp-2">
                          {ch.description}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Footer instructions */}
                <div className="p-1 md:p-2.5 bg-slate-50 border-t border-slate-150 text-center">
                  <p className="text-[7px] md:text-[9px] font-mono text-red-400 animate-pulse">
                    &gt; Walkthrough simulating seek jumps...
                  </p>
                </div>

              </div>

            </div>
          )}

        </div>

        {/* SIMULATED MOUSE CURSOR */}
        {cursorVisible && (
          <div
            className={`absolute pointer-events-none transition-transform duration-100 z-50 transform -translate-x-1.5 -translate-y-1.5 ${
              isCursorClicking ? 'scale-90 opacity-90' : 'scale-100 opacity-100'
            }`}
            style={{
              left: `${cursorPos.x}%`,
              top: `${cursorPos.y}%`,
            }}
          >
            {/* Click Ripple wave */}
            {isCursorClicking && (
              <span className="absolute -left-3 -top-3 w-8 h-8 rounded-full border-2 border-red-400 animate-ping opacity-60"></span>
            )}
            
            {/* Sleek Cursor SVG */}
            <svg 
              className="w-5 h-5 text-red-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" 
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M4.326 2.012a.75.75 0 0 0-1.127.81l2.42 12.805a.75.75 0 0 0 1.258.468l3.189-3.188 4.22 4.221a.75.75 0 0 0 1.06 0l1.83-1.83a.75.75 0 0 0 0-1.06l-4.22-4.221 3.188-3.189a.75.75 0 0 0-.468-1.258L2.83 1.2a.75.75 0 0 0-.504.812Z" />
            </svg>
          </div>
        )}

      </div>
    </div>
  );
}
