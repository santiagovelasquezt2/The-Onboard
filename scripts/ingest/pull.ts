#!/usr/bin/env npx tsx
/**
 * The-Onboard ingest — resolve the golden lap and its sample streams via the
 * OpenF1 historical API, then write a compact replay JSON for the UI cache.
 *
 * Requests use bounded 429 backoff. Keep pulls deliberate and infrequent.
 * The Vite UI must read the generated replay cache only — never call OpenF1 at runtime.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplayFile } from "../../src/features/replay/replay.ts";

const OPENF1 = "https://api.openf1.org/v1";
const GOLDEN = {
  year: 2024,
  circuit_short_name: "Montreal",
  session_name: "Qualifying",
  driver_number: 63,
  /** Expected session_key; confirmed/overridden by /sessions lookup */
  session_key_hint: 9527,
  /** Pole flyer target (seconds); pick closest lap_duration */
  target_lap_duration: 72.0,
} as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT_DIRS = [
  path.join(REPO_ROOT, "data", "replays"),
  // Vite serves public/ at the site root. Keep data/replays as the canonical
  // offline artifact and mirror it here so the browser never calls OpenF1.
  path.join(REPO_ROOT, "public", "replays"),
];

type SessionRow = {
  session_key: number;
  meeting_key: number;
  circuit_short_name: string;
  session_name: string;
  session_type: string;
  year: number;
  location?: string;
};

type DriverRow = {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string;
  session_key: number;
};

type LapRow = {
  lap_number: number;
  lap_duration: number | null;
  date_start: string | null;
  driver_number: number;
  session_key: number;
};

type CarDataRow = {
  date: string;
  speed: number;
  rpm: number;
  n_gear: number;
  throttle: number;
  brake: number;
  drs: number;
};

type LocationRow = {
  date: string;
  x: number;
  y: number;
  z: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) {
      if (attempt === 3) {
        throw new Error(`OpenF1 rate limited (429) for ${url}`);
      }
      const retryAfterSeconds = Number(res.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfterSeconds)
        ? Math.max(250, retryAfterSeconds * 1000)
        : 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 8_000)));
      continue;
    }
    if (!res.ok) {
      throw new Error(`OpenF1 ${res.status} for ${url}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`OpenF1 request failed after retries for ${url}`);
}

function sampleWindowUrl(
  endpoint: "car_data" | "location",
  sessionKey: number,
  driverNumber: number,
  start: string,
  end: string,
): string {
  const params = new URLSearchParams({
    session_key: String(sessionKey),
    driver_number: String(driverNumber),
    "date>": start,
    "date<": end,
  });
  return `${OPENF1}/${endpoint}?${params.toString()}`;
}

function millisecondsFromLapStart(date: string, lapStart: string): number {
  return Date.parse(date) - Date.parse(lapStart);
}

function pullLapSamples(
  sessionKey: number,
  driverNumber: number,
  lap: LapRow,
): Promise<{ carData: CarDataRow[]; location: LocationRow[] }> {
  if (!lap.date_start || typeof lap.lap_duration !== "number") {
    throw new Error(`Lap ${lap.lap_number} has no usable start time or duration`);
  }

  const lapStart = lap.date_start;
  const lapDuration = lap.lap_duration;
  const lapEnd = new Date(
    Date.parse(lapStart) + lapDuration * 1000,
  ).toISOString();
  const locationUrl = sampleWindowUrl(
    "location",
    sessionKey,
    driverNumber,
    lapStart,
    lapEnd,
  );
  const carDataUrl = sampleWindowUrl(
    "car_data",
    sessionKey,
    driverNumber,
    lapStart,
    lapEnd,
  );

  // Keep the two larger requests sequential. This is friendlier to the free
  // historical API than issuing both streams in a burst.
  return fetchJson<LocationRow[]>(locationUrl)
    .then((locationRows) =>
      fetchJson<CarDataRow[]>(carDataUrl).then((carDataRows) => ({
        locationRows,
        carDataRows,
      })),
    )
    .then(({ locationRows, carDataRows }) => {
      const durationMs = lapDuration * 1000;
      const clip = <T extends { date: string }>(rows: T[]): T[] =>
        rows
          .filter((row) => {
            const timeMs = millisecondsFromLapStart(row.date, lapStart);
            return timeMs >= 0 && timeMs <= durationMs;
          })
          .sort(
            (a, b) =>
              millisecondsFromLapStart(a.date, lapStart) -
              millisecondsFromLapStart(b.date, lapStart),
          );

      return {
        carData: clip(carDataRows),
        location: clip(locationRows),
      };
    });
}

function closestLap(laps: LapRow[], target: number): LapRow | null {
  const withDuration = laps.filter(
    (l): l is LapRow & { lap_duration: number } =>
      typeof l.lap_duration === "number" && Number.isFinite(l.lap_duration),
  );
  if (withDuration.length === 0) return null;
  return withDuration.reduce((best, lap) =>
    Math.abs(lap.lap_duration - target) < Math.abs(best.lap_duration - target)
      ? lap
      : best,
  );
}

function mockReplay(): ReplayFile {
  const dateStart = "2024-06-08T20:00:00.000Z";
  return {
    schema_version: 1,
    source: "mock",
    pulled_at: new Date().toISOString(),
    session_key: GOLDEN.session_key_hint,
    meeting_key: null,
    circuit_short_name: GOLDEN.circuit_short_name,
    session_name: GOLDEN.session_name,
    year: GOLDEN.year,
    driver: {
      driver_number: GOLDEN.driver_number,
      name_acronym: "RUS",
      full_name: "George Russell",
      team_name: "Mercedes",
    },
    lap: {
      lap_number: 22,
      lap_duration: GOLDEN.target_lap_duration,
      date_start: dateStart,
    },
    car_data: [
      {
        date: dateStart,
        t_ms: 0,
        speed: 280,
        rpm: 11000,
        n_gear: 7,
        throttle: 100,
        brake: 0,
        drs: 10,
      },
    ],
    location: [
      {
        date: dateStart,
        t_ms: 0,
        x: 0,
        y: 0,
        z: 0,
      },
    ],
    notes: [
      "Mock fallback — live OpenF1 fetch failed or was unavailable.",
      "Samples are placeholders; run the ingest again when OpenF1 is available.",
    ],
  };
}

async function pullLive(): Promise<ReplayFile> {
  const sessionsUrl =
    `${OPENF1}/sessions?year=${GOLDEN.year}` +
    `&circuit_short_name=${encodeURIComponent(GOLDEN.circuit_short_name)}` +
    `&session_name=${encodeURIComponent(GOLDEN.session_name)}`;

  const sessions = await fetchJson<SessionRow[]>(sessionsUrl);
  const session =
    sessions.find((s) => s.session_key === GOLDEN.session_key_hint) ??
    sessions[0];

  if (!session) {
    throw new Error(
      `No Qualifying session found for ${GOLDEN.year} ${GOLDEN.circuit_short_name}`,
    );
  }

  const drivers = await fetchJson<DriverRow[]>(
    `${OPENF1}/drivers?session_key=${session.session_key}&driver_number=${GOLDEN.driver_number}`,
  );
  const driver = drivers[0];
  if (!driver) {
    throw new Error(
      `Driver ${GOLDEN.driver_number} not found in session ${session.session_key}`,
    );
  }

  const laps = await fetchJson<LapRow[]>(
    `${OPENF1}/laps?session_key=${session.session_key}&driver_number=${GOLDEN.driver_number}`,
  );
  const lap = closestLap(laps, GOLDEN.target_lap_duration);
  if (!lap) {
    throw new Error(
      `No timed laps for driver ${GOLDEN.driver_number} in session ${session.session_key}`,
    );
  }

  const samples = await pullLapSamples(
    session.session_key,
    driver.driver_number,
    lap,
  );

  return {
    schema_version: 1,
    source: "openf1",
    pulled_at: new Date().toISOString(),
    session_key: session.session_key,
    meeting_key: session.meeting_key ?? null,
    circuit_short_name: session.circuit_short_name,
    session_name: session.session_name,
    year: session.year,
    driver: {
      driver_number: driver.driver_number,
      name_acronym: driver.name_acronym,
      full_name: driver.full_name,
      team_name: driver.team_name,
    },
    lap: {
      lap_number: lap.lap_number,
      lap_duration: lap.lap_duration,
      date_start: lap.date_start,
    },
    car_data: samples.carData.map((sample) => ({
      date: sample.date,
      t_ms: millisecondsFromLapStart(sample.date, lap.date_start!),
      speed: sample.speed,
      rpm: sample.rpm,
      n_gear: sample.n_gear,
      throttle: sample.throttle,
      brake: sample.brake,
      drs: sample.drs,
    })),
    location: samples.location.map((sample) => ({
      date: sample.date,
      t_ms: millisecondsFromLapStart(sample.date, lap.date_start!),
      x: sample.x,
      y: sample.y,
      z: sample.z,
    })),
    notes: [
      "OpenF1 samples are clipped to the selected lap window and time-stamped from lap.date_start.",
      "UI must not call OpenF1 at runtime — load the replay cache from public/replays/.",
      "Requests use bounded Retry-After / exponential backoff; keep pulls infrequent.",
    ],
  };
}

function outPath(directory: string, replay: ReplayFile): string {
  const slug = [
    replay.year,
    replay.circuit_short_name.toLowerCase().replace(/\s+/g, "-"),
    "q",
    `d${replay.driver.driver_number}`,
    `lap${replay.lap.lap_number}`,
  ].join("-");
  return path.join(directory, `${slug}.json`);
}

async function main(): Promise<void> {
  await Promise.all(OUT_DIRS.map((directory) => mkdir(directory, { recursive: true })));

  let replay: ReplayFile;
  let mode: "openf1" | "mock" | "preserved";

  try {
    replay = await pullLive();
    mode = "openf1";
    console.log(
      `Resolved session_key=${replay.session_key} driver=${replay.driver.name_acronym} (#${replay.driver.driver_number}) lap=${replay.lap.lap_number} duration=${replay.lap.lap_duration}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const previousPath = outPath(OUT_DIRS[0], mockReplay());
    try {
      const previous = JSON.parse(
        await readFile(previousPath, "utf8"),
      ) as ReplayFile;
      if (previous.source === "openf1") {
        console.warn(
          `Live OpenF1 fetch failed (${message}); preserving the previous live replay.`,
        );
        replay = previous;
        mode = "preserved";
      } else {
        throw new Error("previous replay is not live data");
      }
    } catch {
      console.warn(`Live OpenF1 fetch failed (${message}); writing mock replay.`);
      replay = mockReplay();
      mode = "mock";
    }
  }

  const contents = `${JSON.stringify(replay, null, 2)}\n`;
  await Promise.all(
    OUT_DIRS.map(async (directory) => {
      const file = outPath(directory, replay);
      await writeFile(file, contents, "utf8");
      console.log(`Wrote ${path.relative(REPO_ROOT, file)} (source=${mode})`);
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
