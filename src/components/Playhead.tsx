import type { CSSProperties } from 'react'
import styles from './Playhead.module.css'

type PlayheadProps = {
  playing: boolean
  disabled?: boolean
  scrubDisabled?: boolean
  playheadSeconds: number
  startSeconds: number
  durationSeconds: number
  playbackRate: number
  onPlayPause: () => void
  onScrub: (seconds: number) => void
  onPlaybackRateChange: (rate: number) => void
}

const PLAYBACK_RATES = [0.1, 0.2, 0.25, 0.33, 0.5, 0.75, 1, 1.25, 1.5, 2]

function formatTime(seconds: number) {
  const absolute = Math.abs(seconds)
  const m = Math.floor(absolute / 60)
  const s = Math.floor(absolute % 60)
  const ms = Math.floor((absolute % 1) * 1000)
  const sign = seconds < 0 ? '-' : ''
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export function Playhead({
  playing,
  disabled = false,
  scrubDisabled = false,
  playheadSeconds,
  startSeconds,
  durationSeconds,
  playbackRate,
  onPlayPause,
  onScrub,
  onPlaybackRateChange,
}: PlayheadProps) {
  const min = Math.min(startSeconds, durationSeconds)
  const max = Math.max(durationSeconds, min + 0.001)
  const progress = `${Math.min(
    100,
    Math.max(0, ((playheadSeconds - min) / (max - min)) * 100),
  )}%`

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.play}
        onClick={onPlayPause}
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={disabled}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {playing ? (
            <path d="M4 3h3v10H4zm5 0h3v10H9z" />
          ) : (
            <path d="M5 2.75 13 8l-8 5.25z" />
          )}
        </svg>
      </button>

      <input
        className={styles.scrubber}
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={Math.min(max, Math.max(min, playheadSeconds))}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="Scrub playhead"
        style={{ '--progress': progress } as CSSProperties}
        disabled={disabled || scrubDisabled}
      />

      <div className={styles.time} aria-live="polite">
        <span className={styles.current}>{formatTime(playheadSeconds)}</span>
        <span className={styles.sep}>/</span>
        <span>{formatTime(durationSeconds)}</span>
      </div>

      <label className={styles.speed}>
        <span className={styles.srOnly}>Playback speed</span>
        <select
          value={playbackRate}
          onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
          aria-label="Playback speed"
          disabled={disabled}
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
