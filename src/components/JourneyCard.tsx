import { ArrowRight, Clock, Footprints } from 'lucide-react';
import type { JourneyOption, LiveNextResponse } from '../types/transit.ts';
import { CrowdBadge } from './CrowdBadge.tsx';

interface JourneyCardProps {
  journey: JourneyOption;
  selected: boolean;
  liveNext: LiveNextResponse | null;
  onSelect: () => void;
}

export function JourneyCard({ journey, selected, liveNext, onSelect }: JourneyCardProps) {
  const firstBus = liveNext?.buses[0];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        selected
          ? 'border-blue-600 bg-blue-50/35'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
      }`}
    >
      {/* Top row: Total time + Arrival time + clean metadata */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-xl font-bold text-slate-900 tabular-nums">
            {journey.total_minutes} min
          </span>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {journey.departure_time} → {journey.arrival_time}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap shrink-0">
          <Footprints className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span className="tabular-nums">{journey.walk_total_min} min walk</span>
          <span aria-hidden="true">·</span>
          <span>{journey.kind === 'direct' ? 'Direct' : '1 transfer'}</span>
        </div>
      </div>

      {/* Legs with route number + crowd badge */}
      <div className="mt-3 space-y-2">
        {journey.legs.map((leg, idx) => (
          <div key={`${leg.route}_${leg.dir}_${idx}`} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-xs font-semibold text-slate-900 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0">
                {leg.route}
              </span>
              <span className="text-xs text-slate-600 truncate">
                {leg.boarding_stop.name} <ArrowRight className="inline h-3 w-3 text-slate-400" />{' '}
                {leg.alighting_stop.name}
              </span>
            </div>
            <CrowdBadge level={leg.crowd_level} confidence={leg.confidence} size="sm" />
          </div>
        ))}
      </div>

      {/* First-leg Next Buses live strip + nudge */}
      {liveNext && firstBus && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-600">
            <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              Next {firstBus.route} in <strong className="text-slate-900">{firstBus.minutes_away} min</strong>
            </span>
            <CrowdBadge level={firstBus.predicted_crowd} confidence={firstBus.confidence} size="sm" />
          </div>
          {liveNext.nudge && (
            <span className="font-medium text-blue-700 whitespace-nowrap">
              {liveNext.nudge}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
