/**
 * Compact replay file shape written under data/replays/ and mirrored to
 * public/replays/ for the browser.
 */
export type ReplayCarSample = {
  /** ISO 8601 UTC from OpenF1 */
  date: string;
  /** Milliseconds from lap start (date_start); filled when joining is implemented */
  t_ms: number;
  speed: number;
  rpm: number;
  n_gear: number;
  throttle: number;
  brake: number;
  drs: number;
};

export type ReplayLocationSample = {
  date: string;
  t_ms: number;
  x: number;
  y: number;
  z: number;
};

export type ReplayFile = {
  schema_version: 1;
  source: "openf1" | "mock";
  pulled_at: string;
  session_key: number;
  meeting_key: number | null;
  circuit_short_name: string;
  session_name: string;
  year: number;
  driver: {
    driver_number: number;
    name_acronym: string;
    full_name: string;
    team_name: string;
  };
  lap: {
    lap_number: number;
    lap_duration: number | null;
    date_start: string | null;
  };
  /** ~3.7 Hz car_data samples clipped to the lap window */
  car_data: ReplayCarSample[];
  /** ~3.7 Hz location samples on the session-local plane (no lateral placement) */
  location: ReplayLocationSample[];
  notes?: string[];
};
