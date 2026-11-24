import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type {
  ConfidenceLevel,
  CrowdLevel,
  DayType,
  LiveBusPrediction,
  LiveNextResponse,
  LiveVehicleMarker,
  RouteDirectionData,
} from '../src/types/transit.ts';
import type { LoadedTransitData } from './dataLoader.ts';
import { haversineMeters } from './journeyPlanner.ts';

interface VehicleTrack {
  vehicle_id: string;
  route: string;
  dir: 'UP' | 'DOWN';
  current_stop_idx: number;
  prev_stop_idx: number;
  progress_fraction: number; // 0..1 between current_stop_idx and current_stop_idx + 1
  lat: number;
  lon: number;
  is_bunched: boolean;
  last_seen_ms: number;
}

const CROWD_RANK: Record<CrowdLevel, number> = {
  seats: 0,
  standing: 1,
  crowded: 2,
};

function levelFromLoad(load: number, seats: number, standing: number): CrowdLevel {
  if (load < seats * 0.8) return 'seats';
  if (load <= seats + standing * 0.5) return 'standing';
  return 'crowded';
}

export class LiveFeedService {
  private data: LoadedTransitData;
  private mode: 'live' | 'replay' | 'stale' = 'replay';
  private lastGoodAtMs: number = Date.now();
  private vehicles: Map<string, VehicleTrack> = new Map();
  private prevStopSnapshot: Map<string, { upIdx: number; downIdx: number }> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private replayTick = 0;

  constructor(data: LoadedTransitData) {
    this.data = data;
    this.seedReplayPositions();
  }

  public start(): void {
    this.poll();
    this.timer = setInterval(() => {
      this.poll();
    }, 15000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getCurrentClockContext(): { dayType: DayType; hour: number; minute: number; label: string } {
    if (this.mode === 'replay') {
      // Deterministic replay of 28 Oct, 18:00 (Monday weekday peak)
      const simMin = (this.replayTick * 0.25) % 45;
      return {
        dayType: 'weekday',
        hour: 18,
        minute: Math.floor(simMin),
        label: 'Replaying 28 Oct, 6:00 PM GPS archive',
      };
    }
    // Real IST time for live OTD feed
    const now = new Date();
    const istOffsetMin = 330;
    const istMs = now.getTime() + (istOffsetMin + now.getTimezoneOffset()) * 60000;
    const ist = new Date(istMs);
    const dayOfWeek = ist.getDay();
    const dayType: DayType = dayOfWeek === 0 || dayOfWeek === 6 ? 'weekend' : 'weekday';
    const hour = Math.max(5, Math.min(23, ist.getHours()));
    return {
      dayType,
      hour,
      minute: ist.getMinutes(),
      label: this.mode === 'live' ? 'Live OTD GPS positions' : 'Cached OTD GPS snapshot',
    };
  }

  private seedReplayPositions(): void {
    const now = Date.now();
    this.vehicles.clear();

    // Place 4 buses along each route-direction with realistic headway spacing
    for (const rd of this.data.routeDirectionsList) {
      const totalStops = rd.stops.length;
      const numBuses = 4;
      for (let b = 0; b < numBuses; b++) {
        // Bus 3 is approaching stop 0 (~1 min away, bunched lead bus); Bus 2 wraps ~7 min behind it
        const offsets = [0.42, 0.65, 0.97, 0.0];
        const positiveFrac = offsets[b] ?? b / numBuses;
        const floatIdx = positiveFrac * (totalStops - 1.15);
        const stopIdx = Math.min(totalStops - 2, Math.floor(floatIdx));
        const prog = floatIdx - stopIdx;

        const s0 = rd.stops[stopIdx];
        const s1 = rd.stops[stopIdx + 1];
        const lat = s0.lat + (s1.lat - s0.lat) * prog;
        const lon = s0.lon + (s1.lon - s0.lon) * prog;

        const vid = `DL1PC_${rd.route}${rd.dir[0]}_${b + 1}`;
        this.vehicles.set(vid, {
          vehicle_id: vid,
          route: rd.route,
          dir: rd.dir,
          current_stop_idx: stopIdx,
          prev_stop_idx: Math.max(0, stopIdx - 1),
          progress_fraction: prog,
          lat,
          lon,
          is_bunched: b === 3 && (rd.route === '740' || rd.route === '405' || rd.route === '534A'),
          last_seen_ms: now,
        });
      }
    }
  }

  private advanceReplayPositions(): void {
    this.replayTick += 1;
    const now = Date.now();
    for (const track of this.vehicles.values()) {
      const rd = this.data.routeDirections.get(`${track.route}_${track.dir}`);
      if (!rd) continue;

      const nextProg = track.progress_fraction + 0.12;
      let stopIdx = track.current_stop_idx;
      let prog = nextProg;
      if (prog >= 1) {
        stopIdx += 1;
        prog -= 1;
        if (stopIdx >= rd.stops.length - 1) {
          stopIdx = 0;
          prog = 0;
        }
      }

      const s0 = rd.stops[stopIdx];
      const s1 = rd.stops[Math.min(rd.stops.length - 1, stopIdx + 1)];
      track.prev_stop_idx = track.current_stop_idx;
      track.current_stop_idx = stopIdx;
      track.progress_fraction = prog;
      track.lat = s0.lat + (s1.lat - s0.lat) * prog;
      track.lon = s0.lon + (s1.lon - s0.lon) * prog;
      track.last_seen_ms = now;
    }
    this.lastGoodAtMs = now;
  }

  private snapNearestStopIdx(rd: RouteDirectionData, lat: number, lon: number): number {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < rd.stops.length; i++) {
      const d = haversineMeters(lat, lon, rd.stops[i].lat, rd.stops[i].lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private async poll(): Promise<void> {
    const otdKey = process.env.OTD_KEY?.trim();
    if (!otdKey) {
      this.mode = 'replay';
      this.advanceReplayPositions();
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const url = `https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key=${encodeURIComponent(otdKey)}`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`OTD HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
      const now = Date.now();
      const updatedTracks = new Map<string, VehicleTrack>();

      for (const entity of feed.entity) {
        const v = entity.vehicle;
        if (!v?.position?.latitude || !v?.position?.longitude || !v?.trip?.routeId) continue;

        const rawRouteId = v.trip.routeId.trim();
        const matchingRoutes = this.data.routeDirectionsList.filter(
          (rd) =>
            rd.route_id === rawRouteId ||
            rd.route === rawRouteId ||
            rd.route.toLowerCase() === rawRouteId.toLowerCase()
        );
        if (matchingRoutes.length === 0) continue;

        const upRd = matchingRoutes.find((r) => r.dir === 'UP') ?? matchingRoutes[0];
        const downRd = matchingRoutes.find((r) => r.dir === 'DOWN') ?? matchingRoutes[0];
        const vid = v.vehicle?.id || entity.id || `${rawRouteId}_${Math.random()}`;
        const lat = v.position.latitude;
        const lon = v.position.longitude;

        const upIdx = this.snapNearestStopIdx(upRd, lat, lon);
        const downIdx = this.snapNearestStopIdx(downRd, lat, lon);
        const prev = this.prevStopSnapshot.get(vid);

        // Determine direction by matching movement over last two pings
        let chosenRd = upRd;
        let chosenIdx = upIdx;
        if (prev) {
          const upDelta = upIdx - prev.upIdx;
          const downDelta = downIdx - prev.downIdx;
          if (downDelta > 0 && upDelta <= 0) {
            chosenRd = downRd;
            chosenIdx = downIdx;
          } else if (upDelta > 0 && downDelta <= 0) {
            chosenRd = upRd;
            chosenIdx = upIdx;
          } else {
            const existing = this.vehicles.get(vid);
            if (existing?.dir === 'DOWN') {
              chosenRd = downRd;
              chosenIdx = downIdx;
            }
          }
        }
        this.prevStopSnapshot.set(vid, { upIdx, downIdx });

        updatedTracks.set(vid, {
          vehicle_id: vid,
          route: chosenRd.route,
          dir: chosenRd.dir,
          current_stop_idx: chosenIdx,
          prev_stop_idx: prev ? (chosenRd.dir === 'UP' ? prev.upIdx : prev.downIdx) : chosenIdx,
          progress_fraction: 0,
          lat,
          lon,
          is_bunched: false,
          last_seen_ms: now,
        });
      }

      if (updatedTracks.size > 0) {
        this.vehicles = updatedTracks;
        this.mode = 'live';
        this.lastGoodAtMs = now;
      } else {
        throw new Error('OTD feed returned zero matched vehicles for configured routes');
      }
    } catch {
      // If we previously had live vehicles, mark stale with snapshot age; otherwise stay in replay
      if (this.mode === 'live') {
        this.mode = 'stale';
      } else {
        this.mode = 'replay';
        this.advanceReplayPositions();
      }
    }
  }

  public getNextBuses(stopId: string, route: string, dir: 'UP' | 'DOWN'): LiveNextResponse {
    const rd = this.data.routeDirections.get(`${route}_${dir}`);
    const ctx = this.getCurrentClockContext();
    const ageSeconds = Math.max(0, Math.round((Date.now() - this.lastGoodAtMs) / 1000));

    if (!rd) {
      return {
        mode: this.mode,
        source_label: ctx.label,
        updated_at: new Date(this.lastGoodAtMs).toISOString(),
        age_seconds: ageSeconds,
        stop_id: stopId,
        route,
        dir,
        buses: [],
        nudge: null,
      };
    }

    const targetIdx = rd.stops.findIndex((s) => s.stop_id === stopId);
    if (targetIdx === -1) {
      return {
        mode: this.mode,
        source_label: ctx.label,
        updated_at: new Date(this.lastGoodAtMs).toISOString(),
        age_seconds: ageSeconds,
        stop_id: stopId,
        route,
        dir,
        buses: [],
        nudge: null,
      };
    }

    const totalTripMin = rd.stops[rd.stops.length - 1].scheduled_minutes;
    const targetMin = rd.stops[targetIdx].scheduled_minutes;
    const predictions: LiveBusPrediction[] = [];

    for (const track of this.vehicles.values()) {
      if (track.route !== route || track.dir !== dir) continue;
      if (track.current_stop_idx > targetIdx) continue; // Already passed this stop

      const s0 = rd.stops[track.current_stop_idx];
      const s1 = rd.stops[Math.min(rd.stops.length - 1, track.current_stop_idx + 1)];
      const currentSchedMin =
        s0.scheduled_minutes + (s1.scheduled_minutes - s0.scheduled_minutes) * track.progress_fraction;
      const minutesAway = Math.max(1, Math.round(targetMin - currentSchedMin));
      const arrivalHour = Math.max(5, Math.min(23, ctx.hour + Math.floor((ctx.minute + minutesAway) / 60)));

      // Evaluate crowding on the upcoming segment at the stop (or final segment before stop)
      const segIdx = Math.min(rd.segments.length - 1, Math.max(0, targetIdx));
      const slot = rd.crowding[ctx.dayType][String(arrivalHour)]?.[segIdx];
      const baseLoad = slot?.load ?? 20;
      const peakLoad = slot?.peak_load ?? baseLoad;
      // Bunched lead bus uses peak_load from Method B; following bus uses normal average load
      const effectiveLoad = track.is_bunched ? peakLoad : baseLoad;
      const predictedCrowd = levelFromLoad(effectiveLoad, rd.capacity.seats, rd.capacity.standing);

      predictions.push({
        vehicle_id: track.vehicle_id,
        route: rd.route,
        dir: rd.dir,
        is_ac: rd.is_ac,
        current_stop_idx: track.current_stop_idx,
        current_stop_name: s0.name,
        lat: track.lat,
        lon: track.lon,
        minutes_away: minutesAway,
        arrival_hour: arrivalHour,
        predicted_crowd: predictedCrowd,
        confidence: slot?.confidence ?? 'high',
        predicted_load: effectiveLoad,
      });
    }

    // Also include wraparound bus if fewer than 3 heading upstream
    if (predictions.length < 3) {
      for (const track of this.vehicles.values()) {
        if (track.route !== route || track.dir !== dir) continue;
        if (track.current_stop_idx <= targetIdx) continue;
        const s0 = rd.stops[track.current_stop_idx];
        const s1 = rd.stops[Math.min(rd.stops.length - 1, track.current_stop_idx + 1)];
        const currentSchedMin =
          s0.scheduled_minutes + (s1.scheduled_minutes - s0.scheduled_minutes) * track.progress_fraction;
        const minutesAway = Math.max(2, Math.round(totalTripMin - currentSchedMin + 6 + targetMin));
        const arrivalHour = Math.max(5, Math.min(23, ctx.hour + Math.floor((ctx.minute + minutesAway) / 60)));
        const segIdx = Math.min(rd.segments.length - 1, Math.max(0, targetIdx));
        const slot = rd.crowding[ctx.dayType][String(arrivalHour)]?.[segIdx];
        const effectiveLoad = slot?.load ?? 20;
        predictions.push({
          vehicle_id: track.vehicle_id,
          route: rd.route,
          dir: rd.dir,
          is_ac: rd.is_ac,
          current_stop_idx: track.current_stop_idx,
          current_stop_name: s0.name,
          lat: track.lat,
          lon: track.lon,
          minutes_away: minutesAway,
          arrival_hour: arrivalHour,
          predicted_crowd: slot?.level ?? 'seats',
          confidence: slot?.confidence ?? 'high',
          predicted_load: effectiveLoad,
        });
      }
    }

    predictions.sort((a, b) => a.minutes_away - b.minutes_away);
    const nextThree = predictions.slice(0, 3);

    // Nudge: if a later bus has a better crowd level and is less than 10 minutes behind
    let nudge: string | null = null;
    if (nextThree.length >= 2) {
      const first = nextThree[0];
      for (let k = 1; k < nextThree.length; k++) {
        const later = nextThree[k];
        const waitDiff = later.minutes_away - first.minutes_away;
        if (waitDiff > 0 && waitDiff < 10 && CROWD_RANK[later.predicted_crowd] < CROWD_RANK[first.predicted_crowd]) {
          const targetDesc =
            later.predicted_crowd === 'seats' ? 'a seat' : 'standing room';
          nudge = `Wait ${waitDiff} min for ${targetDesc}?`;
          break;
        }
      }
    }

    return {
      mode: this.mode,
      source_label: ctx.label,
      updated_at: new Date(this.lastGoodAtMs).toISOString(),
      age_seconds: ageSeconds,
      stop_id: stopId,
      route,
      dir,
      buses: nextThree,
      nudge,
    };
  }

  public getVehicleMarkers(routeFilter?: string, dirFilter?: string): {
    mode: 'live' | 'replay' | 'stale';
    source_label: string;
    updated_at: string;
    age_seconds: number;
    vehicles: LiveVehicleMarker[];
  } {
    const ctx = this.getCurrentClockContext();
    const ageSeconds = Math.max(0, Math.round((Date.now() - this.lastGoodAtMs) / 1000));
    const markers: LiveVehicleMarker[] = [];

    for (const track of this.vehicles.values()) {
      if (routeFilter && track.route !== routeFilter) continue;
      if (dirFilter && track.dir !== dirFilter) continue;

      const rd = this.data.routeDirections.get(`${track.route}_${track.dir}`);
      if (!rd) continue;

      const segIdx = Math.min(rd.segments.length - 1, track.current_stop_idx);
      const slot = rd.crowding[ctx.dayType][String(ctx.hour)]?.[segIdx];
      const effectiveLoad = track.is_bunched ? (slot?.peak_load ?? 30) : (slot?.load ?? 20);
      const predictedCrowd = levelFromLoad(effectiveLoad, rd.capacity.seats, rd.capacity.standing);

      markers.push({
        vehicle_id: track.vehicle_id,
        route: track.route,
        dir: track.dir,
        is_ac: rd.is_ac,
        lat: track.lat,
        lon: track.lon,
        current_stop_idx: track.current_stop_idx,
        current_stop_name: rd.stops[track.current_stop_idx]?.name ?? '',
        predicted_crowd: predictedCrowd,
        confidence: slot?.confidence ?? 'high',
        load: effectiveLoad,
      });
    }

    return {
      mode: this.mode,
      source_label: ctx.label,
      updated_at: new Date(this.lastGoodAtMs).toISOString(),
      age_seconds: ageSeconds,
      vehicles: markers,
    };
  }
}
