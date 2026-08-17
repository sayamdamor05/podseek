# Podseek

**Semantic video search** — paste a YouTube URL, and search the transcript by concept or keyword to jump directly to the moments that matter.

[![CI](https://github.com/sayamdamor05/podseek/actions/workflows/ci.yml/badge.svg)](https://github.com/sayamdamor05/podseek/actions/workflows/ci.yml)

---

## Architecture

| Part | Technology | Purpose |
|------|-----------|---------|
| **Frontend** | Next.js 16 (App Router) + TypeScript + Tailwind v4 | UI + serverless API routes |
| **Backend** | Express.js + Node.js | Long-running ingestion worker |
| **AI** | Google Gemini (embedding + segmentation) | Semantic search |
| **Database** | PostgreSQL (optional) | Persistent transcript store |

The frontend handles the UI and exposes `/api/ingest`, `/api/search`, and `/api/media-status` as Next.js Route Handlers. The standalone backend (`backend/worker.js`) duplicates the same endpoints as a plain Express server — useful for deployments where Next.js serverless limits are a concern.

---

## Local Setup

### Prerequisites
- Node.js 20+
- (Optional) Docker for PostgreSQL

### 1. Clone & install

```bash
git clone https://github.com/sayamdamor05/podseek
cd podseek
npm install          # root (concurrently)
npm --prefix frontend install
npm --prefix backend install
```

### 2. Configure environment

**Frontend** (create `frontend/.env.local`):
```env
GEMINI_API_KEY=your_gemini_api_key_here
# Optional — falls back to in-memory if not set
DATABASE_URL=postgresql://user:password@localhost:5432/podseek
```

**Backend** (create `backend/.env`):
```env
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/podseek
FRONTEND_URL=http://localhost:3000
PORT=3001
```

Get a Gemini API key: https://aistudio.google.com/apikey

### 3. (Optional) Start PostgreSQL via Docker

```bash
docker compose up -d db
```

### 4. Run

```bash
npm run dev
# Starts backend on :3001 and frontend on :3000 concurrently
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

### Frontend → Netlify

Set the following environment variables in the Netlify dashboard:
- `GEMINI_API_KEY`
- `DATABASE_URL` (optional)

The `netlify.toml` and `@netlify/plugin-nextjs` handle the rest.

### Backend → Render

The `render.yaml` configures the backend service. Set `GEMINI_API_KEY`, `DATABASE_URL`, and `FRONTEND_URL` as secrets in the Render dashboard.

---

## How it works

1. **Ingest** — User submits a YouTube URL. The backend fetches the video transcript via `youtube-transcript`, merges caption fragments into sentences, then uses Gemini embeddings to adaptively segment the transcript into topic blocks.
2. **Embed** — Each segment is embedded via `gemini-embedding-2` and stored in PostgreSQL (or in-memory).
3. **Search** — A user query is embedded and compared against all segment vectors using cosine similarity. The top matches are re-ranked at sentence granularity for precise timestamp targeting.
4. **Seek** — The frontend loads the result timestamp into the YouTube embed iframe, jumping directly to the relevant moment.
