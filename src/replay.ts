export type ReplayCarSample = {
  date: string
  t_ms: number
  speed: number
  rpm: number
  n_gear: number
  throttle: number
  brake: number
  drs: number
}

export type ReplayLocationSample = {
  date: string
  t_ms: number
  x: number
  y: number
  z: number
}

export type ReplayFile = {
  schema_version: 1
  source: 'openf1' | 'mock'
  pulled_at: string
  session_key: number
  meeting_key: number | null
  circuit_short_name: string
  session_name: string
  year: number
  driver: {
    driver_number: number
    name_acronym: string
    full_name: string
    team_name: string
  }
  lap: {
    lap_number: number
    lap_duration: number | null
    date_start: string | null
  }
  car_data: ReplayCarSample[]
  location: ReplayLocationSample[]
  notes?: string[]
}

export const REPLAY_URL = '/replays/2024-montreal-q-d63-lap22.json'

export async function loadReplay(): Promise<ReplayFile> {
  const response = await fetch(REPLAY_URL, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Replay cache returned HTTP ${response.status}`)
  }
  return (await response.json()) as ReplayFile
}
