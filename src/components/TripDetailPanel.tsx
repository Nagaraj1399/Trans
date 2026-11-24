import { useState } from 'react';
import { ArrowLeft, Bus, ChevronDown, ChevronUp, Clock, Footprints } from 'lucide-react';
import type { CrowdLevel, JourneyOption, JourneySegmentDetail, LiveNextResponse } from '../types/transit.ts';
import { CrowdBadge } from './CrowdBadge.tsx';

interface TripDetailPanelProps {
  journey: JourneyOption;
  liveNext: LiveNextResponse | null;
  onBack: () => void;
}

const STRIP_BG: Record<CrowdLevel, string> = {
  seats: 'bg-emerald-600 hover:bg-emerald-700',
  standing: 'bg-amber-500 hover:bg-amber-600',
  crowded: 'bg-red-600 hover:bg-red-700',
};

export function TripDetailPanel({ journey, liveNext, onBack }: TripDetailPanelProps) {
  const [inspectedSeg, setInspectedSeg] = useState<JourneySegmentDetail | null>(
    journey.legs[0]?.segments[0] ?? null
  );
  const [showAllStops, setShowAllStops] = useState(false);

  const formattedUpdated = liveNext?.updated_at
    ? new Date(liveNext.updated_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>All 3 options</span>
        </button>
        <div className="text-xs font-mono text-slate-500 tabular-nums">
          {journey.departure_time} → {journey.arrival_time} ({journey.total_minutes} min)
        </div>
      </div>

      {/* Horizontal Crowd Strip across all legs */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Segment-by-segment crowd strip
          </h3>
          <span className="text-[11px] text-slate-500">Click a stretch to inspect load</span>
        </div>

        <div className="space-y-2.5">
          {journey.legs.map((leg, legIdx) => (
            <div key={`${leg.route}_${leg.dir}_${legIdx}`}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-800">
                  Route <span className="font-mono font-semibold">{leg.route}</span>{' '}
                  <span className="text-slate-500 font-normal">
                    ({leg.is_ac ? 'AC' : 'Non-AC'} · {leg.ride_min} min ride)
                  </span>
                </span>
                <CrowdBadge level={leg.crowd_level} confidence={leg.confidence} size="sm" />
              </div>

              <div
                className="flex gap-1 h-4 w-full overflow-hidden rounded-md bg-slate-100 p-0.5 border border-slate-200"
                role="list"
                aria-label={`Route ${leg.route} crowd segments`}
              >
                {leg.segments.map((seg) => {
                  const isActive =
                    inspectedSeg?.from_stop_id === seg.from_stop_id &&
                    inspectedSeg?.to_stop_id === seg.to_stop_id;
                  return (
                    <button
                      key={`${seg.from_stop_id}_${seg.to_stop_id}`}
                      type="button"
                      onClick={() => setInspectedSeg(seg)}
                      title={`${seg.from_name} → ${seg.to_name}: ${seg.load} pax (${seg.level})`}
                      className={`h-full flex-1 rounded-sm transition-opacity ${STRIP_BG[seg.level]} ${
                        seg.confidence === 'low' ? 'opacity-65 border border-dashed border-white' : ''
                      } ${isActive ? 'ring-2 ring-slate-900 ring-offset-1' : ''}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Inspected segment callout */}
        {inspectedSeg && (
          <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 truncate">
                {inspectedSeg.from_name} → {inspectedSeg.to_name}
              </div>
              <div className="text-slate-500 mt-0.5 tabular-nums">
                Est. {inspectedSeg.load} pax / {inspectedSeg.seats_capacity} seats · Peak bunching:{' '}
                {inspectedSeg.peak_load} pax · {inspectedSeg.hour}:00
              </div>
            </div>
            <CrowdBadge level={inspectedSeg.level} confidence={inspectedSeg.confidence} size="sm" />
          </div>
        )}
      </div>

      {/* Next Buses (Live / Replay) */}
      <div className="pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Next buses at {journey.legs[0]?.boarding_stop.name}
          </h3>
          {liveNext && (
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {liveNext.mode === 'live' ? 'Live OTD' : liveNext.mode === 'stale' ? 'Cached OTD' : 'Replay 28 Oct'}
              {formattedUpdated ? ` · ${formattedUpdated}` : ''}
            </span>
          )}
        </div>

        {liveNext?.nudge && (
          <div className="mb-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900">
            {liveNext.nudge} A bus shortly behind is predicted to have lower crowding.
          </div>
        )}

        {liveNext && liveNext.buses.length > 0 ? (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {liveNext.buses.map((bus) => (
              <div
                key={bus.vehicle_id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Bus className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">
                      <span className="font-mono font-semibold">{bus.route}</span>{' '}
                      <span className="text-slate-500 font-normal">
                        ({bus.is_ac ? 'AC' : 'Non-AC'}) · now near {bus.current_stop_name}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Vehicle {bus.vehicle_id} · est. {bus.predicted_load} pax on arrival
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {bus.minutes_away} min
                  </span>
                  <CrowdBadge
                    level={bus.predicted_crowd}
                    confidence={bus.confidence}
                    size="sm"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
            Fetching approaching buses...
          </div>
        )}

        <p className="mt-1.5 text-[11px] text-slate-500">
          Predicted from October ticket patterns · {liveNext?.source_label ?? 'Checking feed'}
        </p>
      </div>

      {/* Step-by-step Itinerary */}
      <div className="pt-3 border-t border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-sm font-semibold text-slate-900">Step-by-step legs</h3>
          <button
            type="button"
            onClick={() => setShowAllStops((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
          >
            <span>{showAllStops ? 'Hide intermediate stops' : 'Show intermediate stops'}</span>
            {showAllStops ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        <ol className="space-y-3 text-xs">
          {journey.legs.map((leg, idx) => (
            <li key={`${leg.route}_${idx}`} className="space-y-2">
              {idx === 0 && leg.walk_in_min > 0 && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Footprints className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>
                    Walk {leg.walk_in_m} m ({leg.walk_in_min} min) to{' '}
                    <strong className="text-slate-900">{leg.boarding_stop.name}</strong>
                  </span>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-slate-900">
                    Board Route <span className="font-mono font-semibold">{leg.route}</span> at{' '}
                    {leg.boarding_stop.name}
                  </div>
                  <span className="inline-flex items-center gap-1 text-slate-500 font-mono tabular-nums">
                    <Clock className="h-3 w-3" /> ~{leg.wait_min} min wait
                  </span>
                </div>
                <div className="text-slate-600">
                  Ride {leg.stops.length - 1} stops ({leg.ride_min} min) → Alight at{' '}
                  <strong className="text-slate-900">{leg.alighting_stop.name}</strong>
                </div>

                {showAllStops && (
                  <ul className="mt-2 pt-2 border-t border-slate-100 space-y-1 text-[11px] text-slate-600">
                    {leg.stops.map((s, sIdx) => (
                      <li key={s.stop_id} className="flex items-center justify-between">
                        <span>
                          {sIdx + 1}. {s.name}
                        </span>
                        <span className="font-mono text-slate-400 tabular-nums">
                          +{s.scheduled_minutes - leg.boarding_stop.scheduled_minutes} min
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {idx === 0 && journey.legs.length > 1 && (
                <div className="flex items-center gap-2 text-blue-800 bg-blue-50/70 border border-blue-100 rounded-md px-2.5 py-1.5">
                  <Footprints className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Transfer walk: {journey.transfer_walk_m} m ({journey.transfer_walk_min} min) to{' '}
                    <strong>{journey.legs[1].boarding_stop.name}</strong>
                  </span>
                </div>
              )}
            </li>
          ))}

          {journey.walk_out_min > 0 && (
            <li className="flex items-center gap-2 text-slate-600">
              <Footprints className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                Walk {journey.walk_out_m} m ({journey.walk_out_min} min) to final destination
              </span>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
