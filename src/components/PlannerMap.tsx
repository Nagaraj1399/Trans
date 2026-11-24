import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { CrowdLevel, JourneyOption, LiveVehicleMarker, StopIndexEntry } from '../types/transit.ts';

interface PlannerMapProps {
  origin: StopIndexEntry | null;
  destination: StopIndexEntry | null;
  selectedJourney: JourneyOption | null;
  liveVehicles: LiveVehicleMarker[];
  liveSourceLabel: string;
  liveUpdatedAt: string;
  liveAgeSeconds: number;
}

const CROWD_COLOR: Record<CrowdLevel, string> = {
  seats: '#15803d',
  standing: '#d97706',
  crowded: '#dc2626',
};

const CROWD_LABEL: Record<CrowdLevel, string> = {
  seats: 'Seats likely',
  standing: 'Standing room',
  crowded: 'Crowded',
};

export function PlannerMap({
  origin,
  destination,
  selectedJourney,
  liveVehicles,
  liveSourceLabel,
  liveUpdatedAt,
  liveAgeSeconds,
}: PlannerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const vehicleLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFittedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [28.625, 77.245],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);
    vehicleLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw selected journey segments + stops
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [];

    if (selectedJourney) {
      selectedJourney.legs.forEach((leg, legIdx) => {
        // Walk from origin to first boarding stop
        if (legIdx === 0 && origin) {
          L.polyline(
            [
              [origin.lat, origin.lon],
              [leg.boarding_stop.lat, leg.boarding_stop.lon],
            ],
            { color: '#475569', weight: 3, dashArray: '4 6', opacity: 0.75 }
          ).addTo(layer);
        }

        // Bus segments coloured by crowd level
        leg.segments.forEach((seg) => {
          const segColor = CROWD_COLOR[seg.level];
          const line = L.polyline(
            [
              [seg.from_lat, seg.from_lon],
              [seg.to_lat, seg.to_lon],
            ],
            {
              color: segColor,
              weight: 6,
              opacity: 0.92,
              dashArray: seg.confidence === 'low' ? '7 6' : undefined,
            }
          ).addTo(layer);

          line.bindPopup(
            `<div style="min-width:180px">
              <div style="font-weight:600;color:#0f172a;margin-bottom:2px">Route ${leg.route} · ${seg.from_name} → ${seg.to_name}</div>
              <div style="color:${segColor};font-weight:600">${CROWD_LABEL[seg.level]}${seg.confidence === 'low' ? ' (Few tickets recorded here)' : ''}</div>
              <div style="color:#475569;font-size:12px;margin-top:4px">Est. load: ${seg.load} / ${seg.seats_capacity} seats (${seg.hour}:00)</div>
            </div>`
          );

          boundsPoints.push([seg.from_lat, seg.from_lon], [seg.to_lat, seg.to_lon]);
        });

        // Intermediate and terminal stops on leg
        leg.stops.forEach((stop, sIdx) => {
          const isTerminal = sIdx === 0 || sIdx === leg.stops.length - 1;
          L.circleMarker([stop.lat, stop.lon], {
            radius: isTerminal ? 7 : 4,
            fillColor: isTerminal ? '#0f172a' : '#ffffff',
            color: '#0f172a',
            weight: isTerminal ? 2.5 : 1.5,
            fillOpacity: 1,
          })
            .bindTooltip(stop.name, { direction: 'top', offset: [0, -6] })
            .addTo(layer);
        });

        // Transfer walk dotted connector between leg 0 alighting and leg 1 boarding
        if (legIdx === 0 && selectedJourney.legs.length > 1) {
          const nextLeg = selectedJourney.legs[1];
          L.polyline(
            [
              [leg.alighting_stop.lat, leg.alighting_stop.lon],
              [nextLeg.boarding_stop.lat, nextLeg.boarding_stop.lon],
            ],
            { color: '#1d4ed8', weight: 3, dashArray: '3 5', opacity: 0.85 }
          )
            .bindTooltip(`Transfer walk (${selectedJourney.transfer_walk_m} m)`)
            .addTo(layer);
        }
      });

      const lastLeg = selectedJourney.legs[selectedJourney.legs.length - 1];
      if (destination && lastLeg) {
        L.polyline(
          [
            [lastLeg.alighting_stop.lat, lastLeg.alighting_stop.lon],
            [destination.lat, destination.lon],
          ],
          { color: '#475569', weight: 3, dashArray: '4 6', opacity: 0.75 }
        ).addTo(layer);
      }
    }

    if (origin) {
      L.circleMarker([origin.lat, origin.lon], {
        radius: 8,
        fillColor: '#1d4ed8',
        color: '#ffffff',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip(`Origin: ${origin.name}`, { permanent: false, direction: 'top' })
        .addTo(layer);
      boundsPoints.push([origin.lat, origin.lon]);
    }

    if (destination) {
      L.circleMarker([destination.lat, destination.lon], {
        radius: 8,
        fillColor: '#0f172a',
        color: '#ffffff',
        weight: 2.5,
        fillOpacity: 1,
      })
        .bindTooltip(`Destination: ${destination.name}`, { permanent: false, direction: 'top' })
        .addTo(layer);
      boundsPoints.push([destination.lat, destination.lon]);
    }

    const fitKey = `${selectedJourney?.id ?? 'none'}_${origin?.stop_id ?? ''}_${destination?.stop_id ?? ''}`;
    if (boundsPoints.length >= 2 && lastFittedIdRef.current !== fitKey) {
      lastFittedIdRef.current = fitKey;
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [52, 52], maxZoom: 14 });
    }
  }, [origin, destination, selectedJourney]);

  // Draw live / replaying bus markers
  useEffect(() => {
    const layer = vehicleLayerRef.current;
    if (!layer) return;

    layer.clearLayers();
    const activeRoutes = new Set(selectedJourney?.legs.map((l) => `${l.route}_${l.dir}`) ?? []);

    liveVehicles.forEach((bus) => {
      const isRelevant = activeRoutes.size === 0 || activeRoutes.has(`${bus.route}_${bus.dir}`);
      const color = CROWD_COLOR[bus.predicted_crowd];

      const icon = L.divIcon({
        className: 'bheed-bus-marker',
        html: `<div style="display:flex;align-items:center;justify-content:center;padding:2px 6px;border-radius:6px;background:${color};color:#ffffff;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(15,23,42,0.28);opacity:${
          isRelevant ? 1 : 0.45
        };white-space:nowrap;">${bus.route}</div>`,
        iconSize: [38, 22],
        iconAnchor: [19, 11],
      });

      L.marker([bus.lat, bus.lon], { icon })
        .bindPopup(
          `<div style="min-width:170px">
            <div style="font-weight:600;color:#0f172a">Bus ${bus.route} (${bus.dir}) · ${bus.is_ac ? 'AC' : 'Non-AC'}</div>
            <div style="color:#475569;font-size:12px;margin-top:2px">Near: ${bus.current_stop_name}</div>
            <div style="color:${color};font-weight:600;margin-top:4px">${CROWD_LABEL[bus.predicted_crowd]} (Est. ${bus.load} pax)</div>
            <div style="color:#64748b;font-size:11px;margin-top:2px">Vehicle ${bus.vehicle_id}</div>
          </div>`
        )
        .addTo(layer);
    });
  }, [liveVehicles, selectedJourney]);

  const formattedTime = liveUpdatedAt
    ? new Date(liveUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      <div ref={containerRef} className="h-full w-full" />

      {/* Map legend & honest live-feed attribution */}
      <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[400] flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-emerald-700" aria-hidden="true" />
            <span>Seats likely</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-amber-600" aria-hidden="true" />
            <span>Standing room</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-red-600" aria-hidden="true" />
            <span>Crowded</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <span className="w-4 border-t-2 border-dashed border-slate-500" aria-hidden="true" />
            <span>Low ticket data</span>
          </span>
        </div>

        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
          {liveSourceLabel} · Predicted from Oct tickets · Updated {liveAgeSeconds}s ago ({formattedTime})
        </div>
      </div>
    </div>
  );
}
