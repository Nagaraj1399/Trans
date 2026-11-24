import { useCallback, useEffect, useState } from 'react';
import { ArrowUpDown, Search, SlidersHorizontal, X } from 'lucide-react';
import type {
  DayType,
  JourneyOption,
  LiveNextResponse,
  LiveVehicleMarker,
  ParsedPlainQuery,
  StopIndexEntry,
} from './types/transit.ts';
import { StopAutocomplete } from './components/StopAutocomplete.tsx';
import { JourneyCard } from './components/JourneyCard.tsx';
import { TripDetailPanel } from './components/TripDetailPanel.tsx';
import { PlannerMap } from './components/PlannerMap.tsx';
import { OperatorView } from './components/OperatorView.tsx';
import { MethodologyView } from './components/MethodologyView.tsx';

type ActiveTab = 'planner' | 'operator' | 'methodology';

function tabFromPath(pathname: string): ActiveTab {
  if (pathname.startsWith('/operator')) return 'operator';
  if (pathname.startsWith('/methodology')) return 'methodology';
  return 'planner';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => tabFromPath(window.location.pathname));

  // Planner query state
  const [origin, setOrigin] = useState<StopIndexEntry | null>(null);
  const [destination, setDestination] = useState<StopIndexEntry | null>(null);
  const [time, setTime] = useState('18:00');
  const [dayType, setDayType] = useState<DayType>('weekday');
  const [comfort, setComfort] = useState(0.5);

  // Plain-language Gemini search state
  const [plainInput, setPlainInput] = useState('');
  const [parsingPlain, setParsingPlain] = useState(false);
  const [plainError, setPlainError] = useState<string | null>(null);
  const [parsedSummary, setParsedSummary] = useState<string | null>(null);

  // Journey results & selection
  const [journeys, setJourneys] = useState<JourneyOption[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(false);
  const [journeyError, setJourneyError] = useState<string | null>(null);
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Live buses state (refreshed every 15s)
  const [liveNextByJourney, setLiveNextByJourney] = useState<Record<string, LiveNextResponse>>({});
  const [liveVehicles, setLiveVehicles] = useState<LiveVehicleMarker[]>([]);
  const [liveMeta, setLiveMeta] = useState({
    source_label: 'Replaying 28 Oct, 6:00 PM GPS archive',
    updated_at: new Date().toISOString(),
    age_seconds: 0,
  });

  // Sync browser back/forward navigation
  useEffect(() => {
    const onPopState = () => setActiveTab(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    const nextPath = tab === 'operator' ? '/operator' : tab === 'methodology' ? '/methodology' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
  };

  // Load default canonical example (Anand Vihar ISBT -> Connaught Place) on mount
  const loadDemoTrip = useCallback(async (preset: 'peak' | 'offpeak' = 'peak') => {
    try {
      const [origRes, destRes] = await Promise.all([
        fetch('/api/stops/search?q=Anand+Vihar+ISBT'),
        fetch('/api/stops/search?q=Connaught+Place+Palika'),
      ]);
      const origData = (await origRes.json()) as { stops: StopIndexEntry[] };
      const destData = (await destRes.json()) as { stops: StopIndexEntry[] };
      if (origData.stops[0]) setOrigin(origData.stops[0]);
      if (destData.stops[0]) setDestination(destData.stops[0]);
      if (preset === 'peak') {
        setTime('18:00');
        setDayType('weekday');
        setComfort(0.5);
      } else {
        setTime('11:00');
        setDayType('weekday');
        setComfort(0.5);
      }
      setParsedSummary(null);
      setPlainError(null);
      setDetailOpen(false);
    } catch {
      // Ignore transient startup error
    }
  }, []);

  useEffect(() => {
    loadDemoTrip('peak');
  }, [loadDemoTrip]);

  // Query /api/journeys whenever origin, destination, time, dayType, or comfort changes
  useEffect(() => {
    if (!origin || !destination) {
      setJourneys([]);
      return;
    }

    let active = true;
    setLoadingJourneys(true);
    setJourneyError(null);

    const params = new URLSearchParams({
      from: `${origin.lat},${origin.lon}`,
      to: `${destination.lat},${destination.lon}`,
      time,
      day: dayType,
      comfort: String(comfort),
    });

    fetch(`/api/journeys?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || 'Unable to compute journeys');
        }
        return res.json();
      })
      .then((data: { options: JourneyOption[] }) => {
        if (!active) return;
        setJourneys(data.options);
        setSelectedJourneyId((prev) => {
          if (prev && data.options.some((o) => o.id === prev)) return prev;
          return data.options[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (!active) return;
        setJourneyError(err instanceof Error ? err.message : 'Journey search failed.');
      })
      .finally(() => {
        if (active) setLoadingJourneys(false);
      });

    return () => {
      active = false;
    };
  }, [origin, destination, time, dayType, comfort]);

  // Poll live vehicle markers + next buses for each journey's first leg every 15 seconds
  const refreshLive = useCallback(async (currentJourneys: JourneyOption[]) => {
    try {
      const vehiclesRes = await fetch('/api/live/vehicles');
      if (vehiclesRes.ok) {
        const vJson = await vehiclesRes.json();
        setLiveVehicles(vJson.vehicles ?? []);
        setLiveMeta({
          source_label: vJson.source_label,
          updated_at: vJson.updated_at,
          age_seconds: vJson.age_seconds,
        });
      }

      if (currentJourneys.length > 0) {
        const entries = await Promise.all(
          currentJourneys.map(async (j) => {
            const leg = j.legs[0];
            if (!leg) return [j.id, null] as const;
            const q = new URLSearchParams({
              stop: leg.boarding_stop.stop_id,
              route: leg.route,
              dir: leg.dir,
            });
            const res = await fetch(`/api/live/next?${q.toString()}`);
            if (!res.ok) return [j.id, null] as const;
            const data = (await res.json()) as LiveNextResponse;
            return [j.id, data] as const;
          })
        );
        const map: Record<string, LiveNextResponse> = {};
        for (const [id, val] of entries) {
          if (val) map[id] = val;
        }
        setLiveNextByJourney(map);
      }
    } catch {
      // Keep last known live data on transient failure
    }
  }, []);

  useEffect(() => {
    refreshLive(journeys);
    const interval = setInterval(() => {
      refreshLive(journeys);
    }, 15000);
    return () => clearInterval(interval);
  }, [journeys, refreshLive]);

  const handlePlainLanguageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = plainInput.trim();
    if (!trimmed) return;

    setParsingPlain(true);
    setPlainError(null);

    try {
      const res = await fetch('/api/parse-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Could not interpret journey request.');
      }
      const parsed = body as ParsedPlainQuery;
      if (parsed.originStop) setOrigin(parsed.originStop);
      if (parsed.destinationStop) setDestination(parsed.destinationStop);
      setTime(parsed.time);
      setDayType(parsed.dayType);
      setComfort(parsed.comfort);
      setParsedSummary(parsed.understandingSummary);
      setDetailOpen(false);
    } catch (err) {
      setPlainError(err instanceof Error ? err.message : 'Unable to parse plain-language search.');
    } finally {
      setParsingPlain(false);
    }
  };

  const handleSwapStops = () => {
    setOrigin(destination);
    setDestination(origin);
    setDetailOpen(false);
  };

  const selectedJourney = journeys.find((j) => j.id === selectedJourneyId) ?? journeys[0] ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: exactly 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigateTab('planner');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Bheed
          </a>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav aria-label="Primary navigation" className="flex items-center gap-6 text-sm font-medium">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigateTab('planner');
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'planner'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Journey Planner
            </a>
            <a
              href="/operator"
              onClick={(e) => {
                e.preventDefault();
                navigateTab('operator');
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'operator'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Operator View
            </a>
            <a
              href="/methodology"
              onClick={(e) => {
                e.preventDefault();
                navigateTab('methodology');
              }}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'methodology'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Methodology
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                navigateTab('planner');
                loadDemoTrip('peak');
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Anand Vihar → CP (6 PM)
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      {activeTab === 'operator' ? (
        <main className="flex-1">
          <OperatorView />
        </main>
      ) : activeTab === 'methodology' ? (
        <main className="flex-1">
          <MethodologyView />
        </main>
      ) : (
        <main className="flex-1 mx-auto w-full max-w-[1440px] px-4 sm:px-6 py-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:h-[calc(100vh-104px)]">
            {/* Left Planner Column */}
            <aside className="lg:col-span-5 flex flex-col gap-4 overflow-y-auto pr-1">
              {/* Plain-language Gemini search box */}
              <form
                onSubmit={handlePlainLanguageSubmit}
                className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2"
              >
                <label htmlFor="plain-query" className="block text-xs font-medium text-slate-700">
                  Ask in plain words
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="plain-query"
                      type="text"
                      value={plainInput}
                      onChange={(e) => setPlainInput(e.target.value)}
                      placeholder="Anand Vihar to CP at 6, I want a seat"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={parsingPlain || !plainInput.trim()}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    {parsingPlain ? 'Parsing...' : 'Search'}
                  </button>
                </div>

                {parsedSummary && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs text-blue-900">
                    <span>
                      <strong>Understood:</strong> {parsedSummary}
                    </span>
                    <button
                      type="button"
                      onClick={() => setParsedSummary(null)}
                      aria-label="Dismiss parsed summary"
                      className="text-blue-700 hover:text-blue-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {plainError && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs text-red-800">
                    {plainError}
                  </div>
                )}
              </form>

              {/* Structured Journey Controls */}
              <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5">
                <div className="grid grid-cols-1 gap-2.5 relative">
                  <StopAutocomplete
                    id="origin-stop"
                    label="From stop or hub"
                    placeholder="e.g. Anand Vihar ISBT"
                    value={origin}
                    onSelect={(stop) => {
                      setOrigin(stop);
                      setDetailOpen(false);
                    }}
                  />

                  <div className="flex justify-end -my-1">
                    <button
                      type="button"
                      onClick={handleSwapStops}
                      aria-label="Swap origin and destination"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <ArrowUpDown className="h-3 w-3" />
                      <span>Swap</span>
                    </button>
                  </div>

                  <StopAutocomplete
                    id="dest-stop"
                    label="To stop or hub"
                    placeholder="e.g. Connaught Place"
                    value={destination}
                    onSelect={(stop) => {
                      setDestination(stop);
                      setDetailOpen(false);
                    }}
                  />
                </div>

                {/* Time & Weekday/Weekend toggle */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2">
                    <label htmlFor="dep-time" className="text-xs font-medium text-slate-600">
                      Depart
                    </label>
                    <input
                      id="dep-time"
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setDayType('weekday')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        dayType === 'weekday'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Weekday
                    </button>
                    <button
                      type="button"
                      onClick={() => setDayType('weekend')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        dayType === 'weekend'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Weekend
                    </button>
                  </div>
                </div>

                {/* Comfort vs Speed Slider */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
                      <span>Preference</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {comfort <= 0.25
                        ? 'Fastest'
                        : comfort >= 0.75
                          ? 'Most comfortable'
                          : 'Balanced'}{' '}
                      ({comfort.toFixed(1)})
                    </span>
                  </div>
                  <input
                    aria-label="Fastest to Most comfortable slider"
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={comfort}
                    onChange={(e) => setComfort(Number(e.target.value))}
                    className="w-full accent-blue-700"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-0.5">
                    <span>Fastest</span>
                    <span>Most comfortable</span>
                  </div>
                </div>
              </section>

              {/* Results Stack or Expanded Trip Detail */}
              <section className="flex-1 space-y-3">
                {detailOpen && selectedJourney ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <TripDetailPanel
                      journey={selectedJourney}
                      liveNext={liveNextByJourney[selectedJourney.id] ?? null}
                      onBack={() => setDetailOpen(false)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-0.5">
                      <h2 className="font-display text-sm font-semibold text-slate-900">
                        {loadingJourneys
                          ? 'Finding bus options...'
                          : `${journeys.length} journey ${journeys.length === 1 ? 'option' : 'options'}`}
                      </h2>
                      <button
                        type="button"
                        onClick={() => loadDemoTrip(time === '11:00' ? 'peak' : 'offpeak')}
                        className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap"
                      >
                        {time === '11:00' ? 'Try 6 PM peak' : 'Try 11 AM off-peak'}
                      </button>
                    </div>

                    {journeyError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
                        {journeyError}
                      </div>
                    )}

                    {!loadingJourneys && !journeyError && journeys.length === 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-600">
                        Select an origin and destination stop within Delhi to compare direct and
                        1-transfer bus routes by crowding level.
                      </div>
                    )}

                    <div className="space-y-2.5">
                      {journeys.map((j) => (
                        <JourneyCard
                          key={j.id}
                          journey={j}
                          selected={selectedJourney?.id === j.id}
                          liveNext={liveNextByJourney[j.id] ?? null}
                          onSelect={() => {
                            setSelectedJourneyId(j.id);
                            setDetailOpen(true);
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            </aside>

            {/* Right Interactive Map Column */}
            <section className="lg:col-span-7 min-h-[420px] lg:h-full">
              <PlannerMap
                origin={origin}
                destination={destination}
                selectedJourney={selectedJourney}
                liveVehicles={liveVehicles}
                liveSourceLabel={liveMeta.source_label}
                liveUpdatedAt={liveMeta.updated_at}
                liveAgeSeconds={liveMeta.age_seconds}
              />
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
