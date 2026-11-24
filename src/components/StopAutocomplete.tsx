import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { StopIndexEntry } from '../types/transit.ts';

interface StopAutocompleteProps {
  id: string;
  label: string;
  placeholder: string;
  value: StopIndexEntry | null;
  onSelect: (stop: StopIndexEntry) => void;
}

export function StopAutocomplete({
  id,
  label,
  placeholder,
  value,
  onSelect,
}: StopAutocompleteProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [suggestions, setSuggestions] = useState<StopIndexEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchStops = async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stops/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as { stops: StopIndexEntry[] };
        setSuggestions(data.stops);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (nextVal: string) => {
    setQuery(nextVal);
    setOpen(true);
    fetchStops(nextVal);
  };

  const handleFocus = () => {
    setOpen(true);
    if (suggestions.length === 0) {
      fetchStops(query === value?.name ? '' : query);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
        {label}
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          type="text"
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading && suggestions.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-500">Searching Delhi stops...</div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-slate-500">No matching bus stops found.</div>
          ) : (
            <ul role="listbox">
              {suggestions.map((stop) => {
                const uniqueRoutes = Array.from(new Set(stop.routes.map((r) => r.route)));
                return (
                  <li key={stop.stop_id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(stop);
                        setQuery(stop.name);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                    >
                      <span className="text-sm font-medium text-slate-900 truncate">{stop.name}</span>
                      <span className="text-xs font-mono text-slate-500 whitespace-nowrap shrink-0">
                        {uniqueRoutes.join(' · ')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
