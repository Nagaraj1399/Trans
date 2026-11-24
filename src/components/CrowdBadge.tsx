import { Armchair, PersonStanding, Users } from 'lucide-react';
import type { ConfidenceLevel, CrowdLevel } from '../types/transit.ts';

interface CrowdBadgeProps {
  level: CrowdLevel;
  confidence?: ConfidenceLevel;
  size?: 'sm' | 'md';
}

const CONFIG: Record<
  CrowdLevel,
  {
    label: string;
    bg: string;
    text: string;
    border: string;
    Icon: typeof Armchair;
  }
> = {
  seats: {
    label: 'Seats likely',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-300',
    Icon: Armchair,
  },
  standing: {
    label: 'Standing room',
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-300',
    Icon: PersonStanding,
  },
  crowded: {
    label: 'Crowded',
    bg: 'bg-red-50',
    text: 'text-red-800',
    border: 'border-red-300',
    Icon: Users,
  },
};

export function CrowdBadge({ level, confidence = 'high', size = 'md' }: CrowdBadgeProps) {
  const { label, bg, text, border, Icon } = CONFIG[level];
  const isLow = confidence === 'low';

  return (
    <span
      title={isLow ? 'Few tickets recorded here' : label}
      className={`group relative inline-flex items-center gap-1.5 rounded-md whitespace-nowrap shrink-0 font-medium ${bg} ${text} ${border} ${
        isLow ? 'border-2 border-dotted' : 'border'
      } ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'}`}
    >
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5 shrink-0' : 'h-3.5 w-3.5 shrink-0'} aria-hidden="true" />
      <span>{label}</span>
      {isLow && (
        <span className="text-[11px] font-normal opacity-80" aria-label="Few tickets recorded here">
          (low data)
        </span>
      )}
      {isLow && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-[11px] font-normal text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 whitespace-nowrap"
        >
          Few tickets recorded here
        </span>
      )}
    </span>
  );
}
