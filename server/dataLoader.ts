import fs from 'fs';
import path from 'path';
import type {
  DayType,
  OperatorCsvRow,
  RouteDirectionData,
  StopIndexEntry,
  CrowdLevel,
  ConfidenceLevel,
} from '../src/types/transit.ts';

export interface LoadedTransitData {
  stopsIndex: StopIndexEntry[];
  stopsById: Map<string, StopIndexEntry>;
  routeDirections: Map<string, RouteDirectionData>;
  routeDirectionsList: RouteDirectionData[];
  operatorRows: OperatorCsvRow[];
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function loadStaticTransitData(): LoadedTransitData {
  const dataDir = path.resolve(process.cwd(), 'data');
  const stopsPath = path.join(dataDir, 'stops_index.json');
  const routesDir = path.join(dataDir, 'routes');
  const csvPath = path.join(dataDir, 'crowd_summary.csv');

  const stopsIndex: StopIndexEntry[] = JSON.parse(fs.readFileSync(stopsPath, 'utf-8'));
  const stopsById = new Map<string, StopIndexEntry>();
  for (const s of stopsIndex) {
    stopsById.set(s.stop_id, s);
  }

  const routeDirections = new Map<string, RouteDirectionData>();
  const routeDirectionsList: RouteDirectionData[] = [];
  const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const parsed: RouteDirectionData = JSON.parse(
      fs.readFileSync(path.join(routesDir, file), 'utf-8')
    );
    const key = `${parsed.route}_${parsed.dir}`;
    routeDirections.set(key, parsed);
    routeDirectionsList.push(parsed);
  }

  const csvText = fs.readFileSync(csvPath, 'utf-8').trim();
  const lines = csvText.split('\n');
  const operatorRows: OperatorCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 20) continue;
    operatorRows.push({
      route: cols[0],
      dir: cols[1] as 'UP' | 'DOWN',
      segment_idx: Number(cols[2]),
      from_stop_id: cols[3],
      from_stop_name: cols[4],
      to_stop_id: cols[5],
      to_stop_name: cols[6],
      daytype: cols[7] as DayType,
      hour: Number(cols[8]),
      avg_load: Number(cols[9]),
      peak_load: Number(cols[10]),
      seats_capacity: Number(cols[11]),
      standing_capacity: Number(cols[12]),
      load_pct_capacity: Number(cols[13]),
      level: cols[14] as CrowdLevel,
      confidence: cols[15] as ConfidenceLevel,
      ticket_count: Number(cols[16]),
      days_count: Number(cols[17]),
      flow_per_hour: Number(cols[18]),
      buses_per_hour: Number(cols[19]),
    });
  }

  return {
    stopsIndex,
    stopsById,
    routeDirections,
    routeDirectionsList,
    operatorRows,
  };
}
