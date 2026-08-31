# Ingest CLI

Pulls OpenF1 **historical** data for TheOnboard’s golden lap and writes a
compact replay JSON under `data/replays/`, plus a browser-served mirror under
`public/replays/`. The Vite UI reads that cache only — it never calls OpenF1 at
runtime.

## Run

```bash
npm install
npm run ingest:pull
```

## What this does

1. Queries `/sessions` for 2024 Montreal Qualifying (`session_key` hint **9527**).
2. Resolves George Russell (`driver_number` **63**) via `/drivers`.
3. Picks the lap closest to **72.000s** from `/laps`.
4. Queries `/location` and `/car_data` for the lap's UTC window.
5. Clips both streams to the lap and writes `t_ms` from `lap.date_start`.

If the network/API fails, it writes a **mock** replay with the same shape.

## Notes

- Requests use bounded `Retry-After` / exponential backoff; keep pulls infrequent.
- Live/paid OpenF1 is out of scope for v1.
