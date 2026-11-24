import 'dotenv/config';
import express from 'express';
import path from 'path';
import type { DayType } from './src/types/transit.ts';
import { loadStaticTransitData } from './server/dataLoader.ts';
import { findJourneys, searchStops } from './server/journeyPlanner.ts';
import { LiveFeedService } from './server/liveFeed.ts';
import { parsePlainLanguageJourneyQuery } from './server/geminiQuery.ts';

async function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Load static JSON/CSV files from /data once at startup (read-only)
  const transitData = loadStaticTransitData();
  const liveFeed = new LiveFeedService(transitData);
  liveFeed.start();

  // 1. Stop name autocomplete
  app.get('/api/stops/search', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const matches = searchStops(transitData.stopsIndex, q);
    res.json({ stops: matches });
  });

  // 2. Journey planner
  app.get('/api/journeys', (req, res) => {
    const fromRaw = typeof req.query.from === 'string' ? req.query.from : '';
    const toRaw = typeof req.query.to === 'string' ? req.query.to : '';
    const timeRaw = typeof req.query.time === 'string' ? req.query.time : '18:00';
    const dayRaw = typeof req.query.day === 'string' ? req.query.day : 'weekday';
    const comfortRaw = typeof req.query.comfort === 'string' ? Number(req.query.comfort) : 0.5;

    const [fromLatStr, fromLonStr] = fromRaw.split(',');
    const [toLatStr, toLonStr] = toRaw.split(',');
    const fromLat = Number(fromLatStr);
    const fromLon = Number(fromLonStr);
    const toLat = Number(toLatStr);
    const toLon = Number(toLonStr);

    if (
      !Number.isFinite(fromLat) ||
      !Number.isFinite(fromLon) ||
      !Number.isFinite(toLat) ||
      !Number.isFinite(toLon)
    ) {
      res.status(400).json({ error: 'Invalid from/to coordinates. Expected lat,lon pairs.' });
      return;
    }

    const day: DayType = dayRaw === 'weekend' ? 'weekend' : 'weekday';
    const comfort = Number.isFinite(comfortRaw) ? Math.max(0, Math.min(1, comfortRaw)) : 0.5;

    const options = findJourneys(transitData, {
      fromLat,
      fromLon,
      toLat,
      toLon,
      time: timeRaw,
      day,
      comfort,
    });

    res.json({
      query: { from: [fromLat, fromLon], to: [toLat, toLon], time: timeRaw, day, comfort },
      options,
    });
  });

  // 3. Raw crowding lookup for one route-direction-hour
  app.get('/api/crowding', (req, res) => {
    const route = typeof req.query.route === 'string' ? req.query.route.trim() : '';
    const dir = req.query.dir === 'DOWN' ? 'DOWN' : 'UP';
    const day: DayType = req.query.day === 'weekend' ? 'weekend' : 'weekday';
    const hourNum = Number(req.query.hour);
    const hour = Number.isFinite(hourNum) ? Math.max(5, Math.min(23, Math.round(hourNum))) : 18;

    const rd = transitData.routeDirections.get(`${route}_${dir}`);
    if (!rd) {
      res.status(404).json({ error: `Route direction ${route}_${dir} not found.` });
      return;
    }

    const slots = rd.crowding[day][String(hour)] ?? [];
    res.json({
      route: rd.route,
      route_id: rd.route_id,
      dir: rd.dir,
      name: rd.name,
      is_ac: rd.is_ac,
      capacity: rd.capacity,
      day,
      hour,
      headway_min: rd.headways[day][String(hour)] ?? 12,
      segments: rd.segments.map((seg, i) => ({
        ...seg,
        ...(slots[i] ?? {}),
      })),
    });
  });

  // 4. Live next buses arriving at a stop
  app.get('/api/live/next', (req, res) => {
    const stop = typeof req.query.stop === 'string' ? req.query.stop.trim() : '';
    const route = typeof req.query.route === 'string' ? req.query.route.trim() : '';
    const dir = req.query.dir === 'DOWN' ? 'DOWN' : 'UP';

    if (!stop || !route) {
      res.status(400).json({ error: 'Missing required stop and route query parameters.' });
      return;
    }

    const payload = liveFeed.getNextBuses(stop, route, dir);
    res.json(payload);
  });

  // 5. All live/replaying bus markers (for map visualization)
  app.get('/api/live/vehicles', (req, res) => {
    const route = typeof req.query.route === 'string' ? req.query.route.trim() : undefined;
    const dir = req.query.dir === 'UP' || req.query.dir === 'DOWN' ? req.query.dir : undefined;
    res.json(liveFeed.getVehicleMarkers(route, dir));
  });

  // 6. Plain-language Gemini query parser
  app.post('/api/parse-query', async (req, res) => {
    const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
    if (!query || query.length > 300) {
      res.status(400).json({ error: 'Please enter a short journey query (up to 300 characters).' });
      return;
    }

    try {
      const parsed = await parsePlainLanguageJourneyQuery(query, transitData.stopsIndex);
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to parse journey query.';
      res.status(502).json({ error: message });
    }
  });

  // 7. Operator view data (serves crowd_summary.csv + route geometry)
  app.get('/api/operator/summary', (_req, res) => {
    const routesMeta = transitData.routeDirectionsList.map((rd) => ({
      route: rd.route,
      route_id: rd.route_id,
      dir: rd.dir,
      name: rd.name,
      is_ac: rd.is_ac,
      capacity: rd.capacity,
      stops: rd.stops,
      segments: rd.segments,
    }));

    res.json({
      routes: routesMeta,
      rows: transitData.operatorRows,
    });
  });

  // Vite middleware in development, static assets in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Bheed server listening on http://0.0.0.0:${port}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start Bheed server:', err);
  process.exit(1);
});
