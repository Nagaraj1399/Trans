export type CrowdLevel = 'seats' | 'standing' | 'crowded';
export type ConfidenceLevel = 'high' | 'low';
export type DayType = 'weekday' | 'weekend';

export interface RouteStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  scheduled_minutes: number;
}

export interface RouteSegmentMeta {
  index: number;
  from_stop_id: string;
  to_stop_id: string;
  from_name: string;
  to_name: string;
}

export interface SegmentCrowdingSlot {
  load: number;
  peak_load: number;
  level: CrowdLevel;
  confidence: ConfidenceLevel;
  ticket_count: number;
  days_count: number;
  flow_per_hour: number;
  buses_per_hour: number;
}

export interface RouteDirectionData {
  route: string;
  route_id: string;
  dir: 'UP' | 'DOWN';
  name: string;
  is_ac: boolean;
  capacity: {
    seats: number;
    standing: number;
  };
  headways: Record<DayType, Record<string, number>>;
  stops: RouteStop[];
  segments: RouteSegmentMeta[];
  crowding: Record<DayType, Record<string, SegmentCrowdingSlot[]>>;
}

export interface StopRouteServing {
  route: string;
  dir: 'UP' | 'DOWN';
  stop_index: number;
  route_name: string;
}

export interface StopIndexEntry {
  stop_id: string;
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
  routes: StopRouteServing[];
}

export interface JourneySegmentDetail {
  index: number;
  from_stop_id: string;
  to_stop_id: string;
  from_name: string;
  to_name: string;
  from_lat: number;
  from_lon: number;
  to_lat: number;
  to_lon: number;
  load: number;
  peak_load: number;
  seats_capacity: number;
  standing_capacity: number;
  level: CrowdLevel;
  confidence: ConfidenceLevel;
  ticket_count: number;
  days_count: number;
  hour: number;
}

export interface JourneyLeg {
  route: string;
  route_id: string;
  dir: 'UP' | 'DOWN';
  route_name: string;
  is_ac: boolean;
  boarding_stop: RouteStop;
  alighting_stop: RouteStop;
  stops: RouteStop[];
  walk_in_m: number;
  walk_in_min: number;
  wait_min: number;
  ride_min: number;
  crowd_level: CrowdLevel;
  confidence: ConfidenceLevel;
  low_confidence_count: number;
  segments: JourneySegmentDetail[];
}

export interface JourneyOption {
  id: string;
  kind: 'direct' | 'transfer';
  summary_label: string;
  total_minutes: number;
  arrival_time: string;
  departure_time: string;
  score: number;
  worst_crowd: CrowdLevel;
  has_low_confidence: boolean;
  walk_total_m: number;
  walk_total_min: number;
  walk_out_m: number;
  walk_out_min: number;
  transfer_walk_m: number;
  transfer_walk_min: number;
  legs: JourneyLeg[];
}

export interface LiveBusPrediction {
  vehicle_id: string;
  route: string;
  dir: 'UP' | 'DOWN';
  is_ac: boolean;
  current_stop_idx: number;
  current_stop_name: string;
  lat: number;
  lon: number;
  minutes_away: number;
  arrival_hour: number;
  predicted_crowd: CrowdLevel;
  confidence: ConfidenceLevel;
  predicted_load: number;
}

export interface LiveNextResponse {
  mode: 'live' | 'replay' | 'stale';
  source_label: string;
  updated_at: string;
  age_seconds: number;
  stop_id: string;
  route: string;
  dir: 'UP' | 'DOWN';
  buses: LiveBusPrediction[];
  nudge: string | null;
}

export interface LiveVehicleMarker {
  vehicle_id: string;
  route: string;
  dir: 'UP' | 'DOWN';
  is_ac: boolean;
  lat: number;
  lon: number;
  current_stop_idx: number;
  current_stop_name: string;
  predicted_crowd: CrowdLevel;
  confidence: ConfidenceLevel;
  load: number;
}

export interface ParsedPlainQuery {
  originQuery: string;
  destinationQuery: string;
  time: string;
  dayType: DayType;
  comfort: number;
  originStop: StopIndexEntry | null;
  destinationStop: StopIndexEntry | null;
  understandingSummary: string;
}

export interface OperatorCsvRow {
  route: string;
  dir: 'UP' | 'DOWN';
  segment_idx: number;
  from_stop_id: string;
  from_stop_name: string;
  to_stop_id: string;
  to_stop_name: string;
  daytype: DayType;
  hour: number;
  avg_load: number;
  peak_load: number;
  seats_capacity: number;
  standing_capacity: number;
  load_pct_capacity: number;
  level: CrowdLevel;
  confidence: ConfidenceLevel;
  ticket_count: number;
  days_count: number;
  flow_per_hour: number;
  buses_per_hour: number;
}
