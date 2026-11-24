import type {
  ConfidenceLevel,
  CrowdLevel,
  DayType,
  JourneyLeg,
  JourneyOption,
  JourneySegmentDetail,
  RouteDirectionData,
  StopIndexEntry,
} from '../src/types/transit.ts';
import type { LoadedTransitData } from './dataLoader.ts';

const WALK_SPEED_M_PER_MIN = (4.5 * 1000) / 60; // 75 m/min (4.5 km/h)
const MAX_ORIGIN_DEST_WALK_M = 600;
const MAX_TRANSFER_WALK_M = 200;

const CROWD_RANK: Record<CrowdLevel, number> = {
  seats: 0,
  standing: 1,
  crowded: 2,
};

const CROWD_PENALTY_MIN: Record<CrowdLevel, number> = {
  seats: 0,
  standing: 8,
  crowded: 20,
};

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function clampHour(hour: number): number {
  return Math.max(5, Math.min(23, hour));
}

function parseTimeToMinutes(timeStr: string): { hour: number; minute: number; totalMin: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  const hour = match ? Math.max(0, Math.min(23, Number(match[1]))) : 18;
  const minute = match ? Math.max(0, Math.min(59, Number(match[2]))) : 0;
  return { hour, minute, totalMin: hour * 60 + minute };
}

function formatMinutesAsHHMM(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function buildLeg(
  rd: RouteDirectionData,
  boardIdx: number,
  alightIdx: number,
  walkInM: number,
  departureClockMin: number,
  day: DayType
): JourneyLeg {
  const boardStop = rd.stops[boardIdx];
  const alightStop = rd.stops[alightIdx];
  const boardHour = clampHour(Math.floor((departureClockMin + walkInM / WALK_SPEED_M_PER_MIN) / 60));
  const headway = rd.headways[day][String(boardHour)] ?? 12;
  const walkInMin = Math.round(walkInM / WALK_SPEED_M_PER_MIN);
  const waitMin = Math.round(headway / 2);
  const rideMin = Math.max(1, alightStop.scheduled_minutes - boardStop.scheduled_minutes);

  let worstRank = 0;
  let worstCrowd: CrowdLevel = 'seats';
  let lowConfCount = 0;

  const segments: JourneySegmentDetail[] = [];
  for (let s = boardIdx; s < alightIdx; s++) {
    const segMeta = rd.segments[s];
    const fromStop = rd.stops[s];
    const toStop = rd.stops[s + 1];
    const elapsedAtSegStart =
      walkInMin + waitMin + (fromStop.scheduled_minutes - boardStop.scheduled_minutes);
    const segHour = clampHour(Math.floor((departureClockMin + elapsedAtSegStart) / 60));
    const slot = rd.crowding[day][String(segHour)]?.[s];

    const level: CrowdLevel = slot?.level ?? 'seats';
    const confidence: ConfidenceLevel = slot?.confidence ?? 'low';

    if (CROWD_RANK[level] > worstRank) {
      worstRank = CROWD_RANK[level];
      worstCrowd = level;
    }
    if (confidence === 'low') {
      lowConfCount += 1;
    }

    segments.push({
      index: s,
      from_stop_id: segMeta.from_stop_id,
      to_stop_id: segMeta.to_stop_id,
      from_name: segMeta.from_name,
      to_name: segMeta.to_name,
      from_lat: fromStop.lat,
      from_lon: fromStop.lon,
      to_lat: toStop.lat,
      to_lon: toStop.lon,
      load: slot?.load ?? 0,
      peak_load: slot?.peak_load ?? 0,
      seats_capacity: rd.capacity.seats,
      standing_capacity: rd.capacity.standing,
      level,
      confidence,
      ticket_count: slot?.ticket_count ?? 0,
      days_count: slot?.days_count ?? 0,
      hour: segHour,
    });
  }

  return {
    route: rd.route,
    route_id: rd.route_id,
    dir: rd.dir,
    route_name: rd.name,
    is_ac: rd.is_ac,
    boarding_stop: boardStop,
    alighting_stop: alightStop,
    stops: rd.stops.slice(boardIdx, alightIdx + 1),
    walk_in_m: walkInM,
    walk_in_min: walkInMin,
    wait_min: waitMin,
    ride_min: rideMin,
    crowd_level: worstCrowd,
    confidence: lowConfCount > 0 ? 'low' : 'high',
    low_confidence_count: lowConfCount,
    segments,
  };
}

export interface JourneyQuery {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  time: string;
  day: DayType;
  comfort: number;
}

export function findJourneys(data: LoadedTransitData, query: JourneyQuery): JourneyOption[] {
  const { fromLat, fromLon, toLat, toLon, time, day, comfort } = query;
  const clampedComfort = Math.max(0, Math.min(1, Number.isFinite(comfort) ? comfort : 0.5));
  const { totalMin: depClockMin } = parseTimeToMinutes(time);

  // 1. Find stops within 600 m walking of origin and of destination
  const originStops = data.stopsIndex
    .map((s) => ({ stop: s, dist: haversineMeters(fromLat, fromLon, s.lat, s.lon) }))
    .filter((x) => x.dist <= MAX_ORIGIN_DEST_WALK_M)
    .sort((a, b) => a.dist - b.dist);

  const destStops = data.stopsIndex
    .map((s) => ({ stop: s, dist: haversineMeters(toLat, toLon, s.lat, s.lon) }))
    .filter((x) => x.dist <= MAX_ORIGIN_DEST_WALK_M)
    .sort((a, b) => a.dist - b.dist);

  if (originStops.length === 0 || destStops.length === 0) {
    return [];
  }

  const originStopDist = new Map<string, number>();
  for (const o of originStops) originStopDist.set(o.stop.stop_id, o.dist);

  const destStopDist = new Map<string, number>();
  for (const d of destStops) destStopDist.set(d.stop.stop_id, d.dist);

  const candidates: JourneyOption[] = [];

  // 2. Direct options
  for (const rd of data.routeDirectionsList) {
    let bestDirect: { boardIdx: number; alightIdx: number; walkIn: number; walkOut: number; total: number } | null = null;

    for (let i = 0; i < rd.stops.length; i++) {
      const oDist = originStopDist.get(rd.stops[i].stop_id);
      if (oDist === undefined) continue;
      for (let j = i + 1; j < rd.stops.length; j++) {
        const dDist = destStopDist.get(rd.stops[j].stop_id);
        if (dDist === undefined) continue;
        const approxTotal =
          (oDist + dDist) / WALK_SPEED_M_PER_MIN +
          (rd.stops[j].scheduled_minutes - rd.stops[i].scheduled_minutes);
        if (!bestDirect || approxTotal < bestDirect.total) {
          bestDirect = { boardIdx: i, alightIdx: j, walkIn: oDist, walkOut: dDist, total: approxTotal };
        }
      }
    }

    if (bestDirect) {
      const leg = buildLeg(rd, bestDirect.boardIdx, bestDirect.alightIdx, bestDirect.walkIn, depClockMin, day);
      const walkOutMin = Math.round(bestDirect.walkOut / WALK_SPEED_M_PER_MIN);
      const totalMinutes = leg.walk_in_min + leg.wait_min + leg.ride_min + walkOutMin;
      const penalty = CROWD_PENALTY_MIN[leg.crowd_level];
      const score = Math.round((totalMinutes + clampedComfort * penalty) * 10) / 10;

      candidates.push({
        id: `direct_${rd.route}_${rd.dir}`,
        kind: 'direct',
        summary_label: `Direct via Route ${rd.route}`,
        total_minutes: totalMinutes,
        departure_time: formatMinutesAsHHMM(depClockMin),
        arrival_time: formatMinutesAsHHMM(depClockMin + totalMinutes),
        score,
        worst_crowd: leg.crowd_level,
        has_low_confidence: leg.confidence === 'low',
        walk_total_m: bestDirect.walkIn + bestDirect.walkOut,
        walk_total_min: leg.walk_in_min + walkOutMin,
        walk_out_m: bestDirect.walkOut,
        walk_out_min: walkOutMin,
        transfer_walk_m: 0,
        transfer_walk_min: 0,
        legs: [leg],
      });
    }
  }

  // 3. One-transfer options: Route A (origin -> tA), walk <= 200 m to tB, Route B (tB -> dest)
  const directRouteKeys = new Set(candidates.map((c) => `${c.legs[0].route}_${c.legs[0].dir}`));
  const bestTransferBySig = new Map<string, JourneyOption>();

  for (const rdA of data.routeDirectionsList) {
    if (directRouteKeys.has(`${rdA.route}_${rdA.dir}`)) continue;
    // Check if rdA serves any origin stop
    const validBoardIndices: Array<{ idx: number; dist: number }> = [];
    for (let i = 0; i < rdA.stops.length - 1; i++) {
      const dist = originStopDist.get(rdA.stops[i].stop_id);
      if (dist !== undefined) validBoardIndices.push({ idx: i, dist });
    }
    if (validBoardIndices.length === 0) continue;

    for (const rdB of data.routeDirectionsList) {
      if (rdA.route === rdB.route) continue; // avoid same-route transfer

      const validAlightIndices: Array<{ idx: number; dist: number }> = [];
      for (let j = 1; j < rdB.stops.length; j++) {
        const dist = destStopDist.get(rdB.stops[j].stop_id);
        if (dist !== undefined) validAlightIndices.push({ idx: j, dist });
      }
      if (validAlightIndices.length === 0) continue;

      const sig = `${rdA.route}_${rdA.dir}->${rdB.route}_${rdB.dir}`;

      for (const board of validBoardIndices) {
        for (let tA = board.idx + 1; tA < rdA.stops.length; tA++) {
          const stopA = rdA.stops[tA];
          // Avoid transferring at a stop already within destination walk unless needed, though allow if useful
          for (let tB = 0; tB < rdB.stops.length - 1; tB++) {
            const stopB = rdB.stops[tB];
            const transferDist =
              stopA.stop_id === stopB.stop_id
                ? 0
                : haversineMeters(stopA.lat, stopA.lon, stopB.lat, stopB.lon);
            if (transferDist > MAX_TRANSFER_WALK_M) continue;

            for (const alight of validAlightIndices) {
              if (tB >= alight.idx) continue;
              // Do not consider trivial 0-stop or degenerate back-and-forth
              if (stopA.stop_id === rdA.stops[board.idx].stop_id) continue;
              if (stopB.stop_id === rdB.stops[alight.idx].stop_id) continue;

              const legA = buildLeg(rdA, board.idx, tA, board.dist, depClockMin, day);
              const transferWalkMin = Math.round(transferDist / WALK_SPEED_M_PER_MIN);
              const legBStartClock =
                depClockMin + legA.walk_in_min + legA.wait_min + legA.ride_min + transferWalkMin;
              const legB = buildLeg(rdB, tB, alight.idx, 0, legBStartClock, day);
              // For leg B, walk_in is accounted in transfer_walk
              const walkOutMin = Math.round(alight.dist / WALK_SPEED_M_PER_MIN);
              const totalMinutes =
                legA.walk_in_min +
                legA.wait_min +
                legA.ride_min +
                transferWalkMin +
                legB.wait_min +
                legB.ride_min +
                walkOutMin;

              const worstRank = Math.max(CROWD_RANK[legA.crowd_level], CROWD_RANK[legB.crowd_level]);
              const worstCrowd: CrowdLevel =
                worstRank === 2 ? 'crowded' : worstRank === 1 ? 'standing' : 'seats';
              const penalty = CROWD_PENALTY_MIN[worstCrowd];
              const score = Math.round((totalMinutes + clampedComfort * penalty) * 10) / 10;

              const candidate: JourneyOption = {
                id: `transfer_${sig}`,
                kind: 'transfer',
                summary_label: `${rdA.route} → ${rdB.route} via ${stopA.name}`,
                total_minutes: totalMinutes,
                departure_time: formatMinutesAsHHMM(depClockMin),
                arrival_time: formatMinutesAsHHMM(depClockMin + totalMinutes),
                score,
                worst_crowd: worstCrowd,
                has_low_confidence: legA.confidence === 'low' || legB.confidence === 'low',
                walk_total_m: board.dist + transferDist + alight.dist,
                walk_total_min: legA.walk_in_min + transferWalkMin + walkOutMin,
                walk_out_m: alight.dist,
                walk_out_min: walkOutMin,
                transfer_walk_m: transferDist,
                transfer_walk_min: transferWalkMin,
                legs: [legA, legB],
              };

              const existing = bestTransferBySig.get(sig);
              if (!existing || candidate.score < existing.score) {
                bestTransferBySig.set(sig, candidate);
              }
            }
          }
        }
      }
    }
  }

  for (const opt of bestTransferBySig.values()) {
    candidates.push(opt);
  }

  // Sort by score, de-duplicate by primary route set, and return top 3
  candidates.sort((a, b) => a.score - b.score || a.total_minutes - b.total_minutes);

  const selected: JourneyOption[] = [];
  const seenSignatures = new Set<string>();
  for (const opt of candidates) {
    const routeSig = opt.legs.map((l) => l.route).join('->');
    if (seenSignatures.has(routeSig)) continue;
    seenSignatures.add(routeSig);
    selected.push(opt);
    if (selected.length >= 3) break;
  }

  return selected;
}

export function searchStops(stopsIndex: StopIndexEntry[], rawQuery: string): StopIndexEntry[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return stopsIndex.slice(0, 12);

  const scored = stopsIndex
    .map((stop) => {
      const nameLower = stop.name.toLowerCase();
      const aliasLowers = (stop.aliases ?? []).map((a) => a.toLowerCase());
      let score = 0;

      if (nameLower === q || aliasLowers.includes(q)) score = 100;
      else if (nameLower.startsWith(q) || aliasLowers.some((a) => a.startsWith(q))) score = 80;
      else if (nameLower.includes(q) || aliasLowers.some((a) => a.includes(q))) score = 60;
      else {
        const tokens = q.split(/\s+/).filter(Boolean);
        const hay = `${nameLower} ${aliasLowers.join(' ')}`;
        const matched = tokens.filter((t) => hay.includes(t)).length;
        if (matched > 0) score = 20 + matched * 15;
      }

      return { stop, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.stop.name.localeCompare(b.stop.name));

  return scored.slice(0, 12).map((item) => item.stop);
}
