# Podseek — Frontend

Next.js 16 (App Router) frontend for Podseek. Includes:
- Landing page with animated canvas background and product demo
- `/watch` workspace: YouTube iframe + semantic search panel
- Serverless API routes: `/api/ingest`, `/api/search`, `/api/media-status`

## Setup

See the [root README](../README.md) for full setup instructions.

```bash
# Install
npm install

# Create .env.local from the template
cp .env.example .env.local
# Then fill in GEMINI_API_KEY (and optionally DATABASE_URL)

# Dev server
npm run dev       # http://localhost:3000

# Lint
npm run lint

# Production build
npm run build
npm run start
```

## Project structure

```
app/
  layout.tsx            — Root layout (<html>, <body>, <main>)
  globals.css           — Tailwind v4 + base styles
  page.tsx              — Landing page (hero, product demo, ingest form)
  watch/
    page.tsx            — Workspace: video player + semantic search
  api/
    ingest/route.ts     — POST /api/ingest  — fire-and-forget ingestion
    search/route.ts     — POST /api/search  — semantic + keyword search
    media-status/route.ts — GET /api/media-status — processing status poll
    lib/
      db.ts             — PostgreSQL pool + in-memory fallback
      worker.ts         — Transcript fetch, segmentation, embedding pipeline
components/
  ProductDemo.tsx       — Animated interactive product demo (landing page)
```
