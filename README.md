# MSport Aviator Statistical Engine

A read-only research dashboard for verified Aviator round history, observed threshold frequencies, confidence intervals and data-quality alerts.

## Truth and limitations
- No 90% accuracy claim is made. Any future predictive claim must be earned with a prospective, chronological holdout test and reported calibration/error metrics.
- Historical frequency is descriptive, not a forecast of the next round. A recent streak does not make a particular multiplier due.
- No authorised MSport/Scribe live feed has been verified. The app does not scrape hidden endpoints, bypass access controls, or fabricate results.
- No automated betting, account credential collection, or bet placement.
- Records count as verified only when an authorised operator marks a batch verified. Confirm provenance independently; the flag is not cryptographic proof.

## Stack
- Node.js 20+, built-in HTTP server, no runtime dependencies
- Supabase Postgres for round history and provenance metadata
- Render web service

## Run and test
```bash
npm install
npm test
npm start
```
Open http://localhost:10000.

## Server-only environment
Set these in Render's environment settings, never in browser JavaScript or a committed file:
- `PORT`: supplied by Render; defaults to 10000 locally
- `DATA_SOURCE_MODE`: defaults to `demo`
- `SUPABASE_URL`: project API URL
- `SUPABASE_SERVICE_ROLE_KEY`: secret service-role key; keep it private and rotate it if exposed
- `INGESTION_API_KEY`: long random secret required by the protected ingestion endpoint

Do not use the Supabase publishable/anon key for ingestion. Do not paste secrets into GitHub or chat. The API returns no sample results when no verified history is available.

## API
- `GET /health` — service and database readiness (database status is not a provider-feed check)
- `GET /api/status` — source/model status and explicit limitations
- `GET /api/overview` — verified sample size
- `GET /api/rounds?limit=50` — verified round history only
- `GET /api/probabilities` — observed sample frequencies with 95% Wilson intervals after 30 verified records; not forecasts
- `GET /api/alerts` — data source, freshness and database warnings
- `POST /api/ingest/rounds` — protected operator ingestion using the `x-ingestion-key` header; batches limited to 500 records

Example request shape (use only results you are authorised to collect):
```json
{
  "source": "authorised-history-export",
  "source_verified": false,
  "rounds": [
    { "round_id": "provider-round-id", "multiplier": 1.42, "ended_at": "2026-10-14T10:00:00Z" }
  ]
}
```
Start with `source_verified: false`; only mark true after independently checking the source and import integrity. Duplicate provider/game/round IDs are upserted rather than duplicated.

## Research standard before calling anything a prediction
1. Obtain a permitted, reproducible feed or export and preserve source/provenance.
2. Deduplicate rounds and audit missingness, timestamp ordering and outliers.
3. Compare a baseline against candidate models on chronological, untouched holdout data.
4. Report calibration, Brier score/log loss, confidence intervals and performance by time period.
5. Paper-test prospectively. Disable alerts that fail to beat a simple baseline after costs and drift.
