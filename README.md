# MSport Aviator Statistical Engine

A read-only probability, data-quality, and alert dashboard for Aviator round history.

## Important limitations
- This project does not claim 90% predictive accuracy.
- Historical results alone do not establish a predictive edge.
- The live MSport/Scribe data source is **not yet verified**. No scraper or unofficial endpoint is assumed.
- Until an authorised connector is configured, the dashboard runs in demo mode with clearly labelled illustrative data.
- No automated betting or account credential collection.

## Stack
- Node.js + TypeScript-ready modular API (initial server is plain Node for simple deployment)
- PostgreSQL/Supabase planned for persistent round history
- Render Web Service for hosting

## Run locally
```bash
npm install
npm start
```
Open http://localhost:10000.

## Environment
Copy `.env.example` to `.env`. Never commit secrets.
- `PORT`: server port (defaults to 10000)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: reserved for server-only database integration; not required for demo mode
- `DATA_SOURCE_MODE`: `demo` until an authorised source is verified
- `INGEST_API_TOKEN`: optional secret for a future authorised ingestion endpoint

## API
- `GET /health`
- `GET /api/status`
- `GET /api/overview`
- `GET /api/rounds?limit=50`
- `GET /api/probabilities`
- `GET /api/alerts`

This is a research and monitoring tool, not betting advice.