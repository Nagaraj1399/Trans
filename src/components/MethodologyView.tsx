import { Armchair, PersonStanding, Users } from 'lucide-react';

export function MethodologyView() {
  return (
    <div className="mx-auto max-w-[980px] px-6 py-8 space-y-8">
      <div className="border-b border-slate-200 pb-6">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Model Assumptions &amp; Validation Architecture
        </h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-2xl">
          Bheed keeps crowding estimation cleanly decoupled from the web planner. All segment loads,
          crowding levels, and reliability flags are precomputed from October ticket records and
          static GTFS schedules, while bus GPS positions update every 15 seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            01. Ticket-to-Load Estimation (Method A &amp; B)
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            <strong>Method A (Average Load):</strong> Maps each ticket&apos;s boarding stop index{' '}
            <span className="font-mono">i</span> and alighting stop index{' '}
            <span className="font-mono">j</span> onto segments{' '}
            <span className="font-mono">i .. j-1</span>, timed via GTFS scheduled offset from
            boarding, and divides hourly segment flow by scheduled GTFS buses per hour.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            <strong>Method B (Rebuilt Bus Trips):</strong> Groups rows with{' '}
            <span className="font-mono">vehicle_number</span> into individual trips to track running
            onboard load and measure headway bunching (<span className="font-mono">peak_load</span>),
            powering live arrival nudges when a lead bus is bunched.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            02. Crowding Thresholds &amp; Fleet Capacity
          </h2>
          <div className="space-y-2 text-xs text-slate-700">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="inline-flex items-center gap-2 font-medium text-emerald-800">
                <Armchair className="h-4 w-4" /> Seats likely
              </span>
              <span className="font-mono text-slate-600">load &lt; 80% of seats</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="inline-flex items-center gap-2 font-medium text-amber-900">
                <PersonStanding className="h-4 w-4" /> Standing room
              </span>
              <span className="font-mono text-slate-600">80% seats to seats + 50% standing</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="inline-flex items-center gap-2 font-medium text-red-800">
                <Users className="h-4 w-4" /> Crowded
              </span>
              <span className="font-mono text-slate-600">&gt; seats + 50% standing</span>
            </div>
          </div>
          <p className="text-xs text-slate-500 pt-1">
            DTC/Cluster capacities: Low-floor AC (35 seats + 30 standing), Non-AC (36 seats + 34 standing).
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            03. Reliability Flags &amp; Explicit Assumptions
          </h2>
          <ul className="space-y-2 text-xs text-slate-600 leading-relaxed list-disc pl-4">
            <li>
              <strong>Low-confidence cells:</strong> Any route-segment-hour with fewer than 30
              recorded tickets or fewer than 3 active days is flagged{' '}
              <span className="font-mono">low</span> and rendered with a dotted border and tooltip{' '}
              <em>&ldquo;Few tickets recorded here&rdquo;</em>.
            </li>
            <li>
              <strong>Unobserved riders:</strong> Pass holders and non-digital tickets are scaled
              via a configurable <span className="font-mono">scale_factor</span> parameter in the
              offline pipeline.
            </li>
            <li>
              <strong>Comfort scoring:</strong>{' '}
              <span className="font-mono">
                score = total_minutes + comfort × penalty
              </span>{' '}
              (Seats: 0 min, Standing: 8 min, Crowded: 20 min).
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900">
            04. What &ldquo;Live&rdquo; Means &amp; Phase 2 Pitch
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Bus GPS positions are live (via Delhi OTD GTFS-RT{' '}
            <span className="font-mono">VehiclePositions.pb</span> every 15 seconds, or 28 Oct
            archive replay when <span className="font-mono">OTD_KEY</span> is absent). Crowding is
            predicted from historical October ticket patterns for the estimated arrival hour and
            segment.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            <strong>Phase 2 Upgrade:</strong> Once Transport Stack streams live ETM ticket-machine
            events, the identical <span className="font-mono">/api/live/next</span> pipeline
            replaces historical lookup slots with real-time onboard passenger counts.
          </p>
        </section>
      </div>
    </div>
  );
}
