# Bheed — Crowdedness-Aware Bus Journey Planner for Delhi

Bheed combines historical October Delhi bus ticket demand with live GTFS-RT bus positions to help commuters choose less-crowded routes and give transit operators corridor load visibility.

## Architecture

- **`pipeline/`**: Reproducible data pipeline (`build_delhi_data.mjs`) generating hourly segment loads, crowding levels (`seats`, `standing`, `crowded`), and low-confidence flags (`<30` tickets or `<3` active days).
- **`data/`**: Static precomputed transit datasets read-only on server startup:
  - `data/routes/<route>_<dir>.json`
  - `data/stops_index.json`
  - `data/crowd_summary.csv`
- **`server.ts` & `server/`**: Express server serving the React frontend, journey planner, crowding lookups, live OTD GTFS-RT feed (with automatic 28 Oct archive replay fallback when `OTD_KEY` is unset), and Gemini plain-language query parser.
- **`src/`**: React + TypeScript + Tailwind + Leaflet frontend.

## Running Locally

```bash
npm install
npm run dev
```

Set `GEMINI_API_KEY` for plain-language query parsing, and optionally `OTD_KEY` for live Delhi Open Transit Data `VehiclePositions.pb` polling.

## API Endpoints

- `GET /api/stops/search?q=CP` — Autocomplete Delhi bus stops and serving routes.
- `GET /api/journeys?from=28.6469,77.3160&to=28.6315,77.2167&time=18:00&day=weekday&comfort=0.5` — Returns up to 3 direct or 1-transfer journey options ranked by time + comfort penalty.
- `GET /api/crowding?route=740&dir=UP&day=weekday&hour=18` — Raw segment crowding slots for one route-direction-hour.
- `GET /api/live/next?stop=DL_AV_ISBT&route=740&dir=UP` — Next 3 arriving buses with minutes away, predicted crowd, and wait nudges.
- `POST /api/parse-query` — Extracts origin, destination, time, day type, and comfort preference from natural language using Gemini.
- `GET /api/operator/summary` — Serves `crowd_summary.csv` rows and route geometry for `/operator`.

## Licence

MIT
