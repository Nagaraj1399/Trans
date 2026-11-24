import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Download, Pause, Play } from 'lucide-react';
import type { DayType, OperatorCsvRow, RouteStop } from '../types/transit.ts';

interface OperatorRouteMeta {
  route: string;
  route_id: string;
  dir: 'UP' | 'DOWN';
  name: string;
  is_ac: boolean;
  capacity: { seats: number; standing: number };
  stops: RouteStop[];
  segments: Array<{
    index: number;
    from_stop_id: string;
    to_stop_id: string;
    from_name: string;
    to_name: string;
  }>;
}

interface OperatorSummaryResponse {
  routes: OperatorRouteMeta[];
  rows: OperatorCsvRow[];
}

const HOURS = Array.from({ length: 19 }, (_, idx) => idx + 5); // 5..23

function heatmapCellColor(pctCapacity: number): string {
  if (pctCapacity >= 95) return 'bg-red-600 text-white';
  if (pctCapacity >= 75) return 'bg-red-200 text-red-950';
  if (pctCapacity >= 55) return 'bg-amber-200 text-amber-950';
  if (pctCapacity >= 35) return 'bg-emerald-200 text-emerald-950';
  return 'bg-emerald-50 text-emerald-900';
}

function mapStrokeColor(level: OperatorCsvRow['level']): string {
  if (level === 'crowded') return '#dc2626';
  if (level === 'standing') return '#d97706';
  return '#15803d';
}

export function OperatorView() {
  const [data, setData] = useState<OperatorSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRouteKey, setSelectedRouteKey] = useState('740_UP');
  const [dayType, setDayType] = useState<DayType>('weekday');
  const [mapHour, setMapHour] = useState(18);
  const [isPlaying, setIsPlaying] = useState(false);
  const [targetLoad, setTargetLoad] = useState(45);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const mapLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/operator/summary')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load crowd_summary.csv');
        return res.json();
      })
      .then((json: OperatorSummaryResponse) => {
        if (!active) return;
        setData(json);
        if (json.routes.length > 0 && !json.routes.some((r) => `${r.route}_${r.dir}` === selectedRouteKey)) {
          setSelectedRouteKey(`${json.routes[0].route}_${json.routes[0].dir}`);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load operator analytics.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // 10-second full weekday animation (~526ms per hour across 19 hours)
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setMapHour((prev) => (prev >= 23 ? 5 : prev + 1));
    }, 520);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Initialize Leaflet map for Operator View
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !data) return;
    const map = L.map(mapContainerRef.current, {
      center: [28.618, 77.245],
      zoom: 12,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    mapLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  // Update map segments whenever mapHour or dayType changes
  useEffect(() => {
    const layer = mapLayerRef.current;
    if (!layer || !data) return;
    layer.clearLayers();

    const rowsAtHour = data.rows.filter((r) => r.daytype === dayType && r.hour === mapHour);
    const lookup = new Map<string, OperatorCsvRow>();
    rowsAtHour.forEach((r) => lookup.set(`${r.route}_${r.dir}_${r.segment_idx}`, r));

    data.routes.forEach((rd) => {
      rd.segments.forEach((seg) => {
        const s0 = rd.stops[seg.index];
        const s1 = rd.stops[seg.index + 1];
        if (!s0 || !s1) return;
        const row = lookup.get(`${rd.route}_${rd.dir}_${seg.index}`);
        if (!row) return;

        const color = mapStrokeColor(row.level);
        L.polyline(
          [
            [s0.lat, s0.lon],
            [s1.lat, s1.lon],
          ],
          {
            color,
            weight: row.level === 'crowded' ? 5 : 3.5,
            opacity: 0.85,
            dashArray: row.confidence === 'low' ? '5 5' : undefined,
          }
        )
          .bindTooltip(
            `Route ${rd.route} (${rd.dir}) · ${seg.from_name} → ${seg.to_name}: ${row.avg_load} pax (${row.load_pct_capacity}% cap)`
          )
          .addTo(layer);
      });
    });
  }, [data, dayType, mapHour]);

  const selectedRoute = useMemo(() => {
    if (!data) return null;
    return data.routes.find((r) => `${r.route}_${r.dir}` === selectedRouteKey) ?? data.routes[0] ?? null;
  }, [data, selectedRouteKey]);

  const heatmapGrid = useMemo(() => {
    if (!data || !selectedRoute) return [];
    const filtered = data.rows.filter(
      (r) =>
        r.route === selectedRoute.route &&
        r.dir === selectedRoute.dir &&
        r.daytype === dayType
    );
    const bySegHour = new Map<string, OperatorCsvRow>();
    filtered.forEach((r) => bySegHour.set(`${r.segment_idx}_${r.hour}`, r));

    return selectedRoute.segments.map((seg) => ({
      segment: seg,
      cells: HOURS.map((h) => bySegHour.get(`${seg.index}_${h}`) ?? null),
    }));
  }, [data, selectedRoute, dayType]);

  const topOverloaded = useMemo(() => {
    if (!data) return [];
    const safeTarget = Math.max(10, targetLoad || 45);
    return data.rows
      .filter((r) => r.daytype === dayType)
      .sort((a, b) => b.load_pct_capacity - a.load_pct_capacity || b.peak_load - a.peak_load)
      .slice(0, 20)
      .map((row) => {
        const extraBuses = Math.max(
          0,
          Math.ceil(row.flow_per_hour / safeTarget) - Math.round(row.buses_per_hour)
        );
        return { ...row, extraBuses };
      });
  }, [data, dayType, targetLoad]);

  const handleDownloadCsv = () => {
    if (topOverloaded.length === 0) return;
    const header = [
      'route',
      'dir',
      'from_stop',
      'to_stop',
      'daytype',
      'hour',
      'avg_load',
      'peak_load',
      'load_pct_capacity',
      'confidence',
      'flow_per_hour',
      'current_buses_per_hour',
      'target_load_per_bus',
      'extra_buses_needed',
    ];
    const lines = [
      header.join(','),
      ...topOverloaded.map((r) =>
        [
          r.route,
          r.dir,
          `"${r.from_stop_name}"`,
          `"${r.to_stop_name}"`,
          r.daytype,
          r.hour,
          r.avg_load,
          r.peak_load,
          r.load_pct_capacity,
          r.confidence,
          r.flow_per_hour,
          r.buses_per_hour,
          targetLoad,
          r.extraBuses,
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bheed_overloaded_${dayType}_target${targetLoad}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1360px] px-6 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-96 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-96 animate-pulse rounded-xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1360px] px-6 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          {error ?? 'Operator data unavailable.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-6">
      {/* Page heading & daytype switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Operator Corridor Load &amp; Dispatch Planner
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Source: <span className="font-mono text-xs">data/crowd_summary.csv</span> · October ticket demand across 12 route-directions
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setDayType('weekday')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              dayType === 'weekday' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Weekday
          </button>
          <button
            type="button"
            onClick={() => setDayType('weekend')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              dayType === 'weekend' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Weekend
          </button>
        </div>
      </div>

      {/* Top Row: Corridor Heatmap + Animated Network Map */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* 1. Heatmap */}
        <section className="xl:col-span-7 rounded-xl border border-slate-200 bg-white p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Segment × Hour Load Heatmap
              </h2>
              <p className="text-xs text-slate-500">
                Cell value = load as % of total bus capacity · dotted outline = low ticket confidence
              </p>
            </div>
            <select
              aria-label="Select route direction"
              value={selectedRouteKey}
              onChange={(e) => setSelectedRouteKey(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
            >
              {data.routes.map((r) => (
                <option key={`${r.route}_${r.dir}`} value={`${r.route}_${r.dir}`}>
                  Route {r.route} ({r.dir}) — {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-3 text-left font-medium text-slate-600 min-w-[180px]">
                    Corridor Segment
                  </th>
                  {HOURS.map((h) => (
                    <th key={h} className="px-1 py-2 text-center font-mono font-medium text-slate-500 tabular-nums">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {heatmapGrid.map(({ segment, cells }) => (
                  <tr key={segment.index}>
                    <td className="py-1.5 pr-3 text-slate-800 font-medium whitespace-nowrap">
                      {segment.from_name} → {segment.to_name}
                    </td>
                    {cells.map((cell, cIdx) => {
                      const hour = HOURS[cIdx];
                      if (!cell) {
                        return (
                          <td key={hour} className="p-0.5 text-center text-slate-300">
                            –
                          </td>
                        );
                      }
                      const pct = Math.round(cell.load_pct_capacity);
                      return (
                        <td key={hour} className="p-0.5">
                          <div
                            title={`${segment.from_name} → ${segment.to_name} @ ${hour}:00\nAvg load: ${cell.avg_load} pax (${pct}% cap)\nPeak bunching: ${cell.peak_load} pax\nTickets: ${cell.ticket_count} (${cell.confidence})`}
                            className={`h-7 min-w-[28px] rounded flex items-center justify-center font-mono tabular-nums ${heatmapCellColor(
                              pct
                            )} ${cell.confidence === 'low' ? 'border border-dashed border-slate-700' : ''}`}
                          >
                            {pct}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. Network Map with Time Slider */}
        <section className="xl:col-span-5 rounded-xl border border-slate-200 bg-white p-5 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Network Load Map
              </h2>
              <p className="text-xs text-slate-500">
                All corridors at <span className="font-mono font-semibold text-slate-900">{String(mapHour).padStart(2, '0')}:00</span> ({dayType})
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{isPlaying ? 'Pause day' : 'Animate day (10s)'}</span>
            </button>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-xs text-slate-500 tabular-nums">05:00</span>
            <input
              type="range"
              aria-label="Hour of day"
              min={5}
              max={23}
              step={1}
              value={mapHour}
              onChange={(e) => {
                setIsPlaying(false);
                setMapHour(Number(e.target.value));
              }}
              className="w-full accent-blue-700"
            />
            <span className="font-mono text-xs text-slate-500 tabular-nums">23:00</span>
          </div>

          <div className="min-h-[340px] flex-1 overflow-hidden rounded-lg border border-slate-200">
            <div ref={mapContainerRef} className="h-full w-full min-h-[340px]" />
          </div>
        </section>
      </div>

      {/* Bottom Row: Top 20 Overloaded Route-Hours Table + Target Load + CSV Download */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Top 20 Overloaded Route-Hours ({dayType})
            </h2>
            <p className="text-xs text-slate-500">
              Extra buses needed = ceil(flow per hour / target load per bus) − current buses per hour
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <span>Target load / bus:</span>
              <input
                type="number"
                min={15}
                max={80}
                value={targetLoad}
                onChange={(e) => setTargetLoad(Math.max(15, Math.min(80, Number(e.target.value) || 45)))}
                className="w-16 rounded-md border border-slate-200 px-2 py-1 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
              />
            </label>

            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download CSV</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="py-2.5 pr-4 font-medium">Route</th>
                <th className="py-2.5 pr-4 font-medium">Segment</th>
                <th className="py-2.5 pr-4 font-medium">Hour</th>
                <th className="py-2.5 pr-4 font-medium text-right">Avg Load</th>
                <th className="py-2.5 pr-4 font-medium text-right">Peak Load</th>
                <th className="py-2.5 pr-4 font-medium text-right">% Capacity</th>
                <th className="py-2.5 pr-4 font-medium">Confidence</th>
                <th className="py-2.5 pr-4 font-medium text-right">Buses / hr</th>
                <th className="py-2.5 font-medium text-right">Extra Buses Needed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topOverloaded.map((row, idx) => (
                <tr
                  key={`${row.route}_${row.dir}_${row.segment_idx}_${row.hour}_${idx}`}
                  className="hover:bg-slate-50/80"
                >
                  <td className="py-2.5 pr-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {row.route} ({row.dir})
                  </td>
                  <td className="py-2.5 pr-4 text-slate-700">
                    {row.from_stop_name} → {row.to_stop_name}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                    {String(row.hour).padStart(2, '0')}:00
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-slate-900 text-right tabular-nums">
                    {row.avg_load.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-red-700 font-medium text-right tabular-nums">
                    {row.peak_load.toFixed(1)}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-slate-900 text-right tabular-nums">
                    {row.load_pct_capacity.toFixed(1)}%
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600 capitalize">{row.confidence}</td>
                  <td className="py-2.5 pr-4 font-mono text-slate-700 text-right tabular-nums">
                    {row.buses_per_hour.toFixed(1)}
                  </td>
                  <td className="py-2.5 font-mono font-semibold text-right tabular-nums text-blue-700">
                    +{row.extraBuses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
