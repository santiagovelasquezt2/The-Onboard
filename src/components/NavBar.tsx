import styles from './NavBar.module.css'

export type MainReplayViewMode = 'current' | 'proposal-1' | 'proposal-2'

type NavBarProps = {
  mainReplayView?: MainReplayViewMode
  proposedPointCount?: number
  onMainReplayViewChange?: (view: MainReplayViewMode) => void
}

export function NavBar({
  mainReplayView,
  proposedPointCount = 0,
  onMainReplayViewChange,
}: NavBarProps) {
  const showReplaySwitcher = Boolean(mainReplayView && onMainReplayViewChange)

  return (
    <header className={styles.nav}>
      <div className={styles.brand}>TheOnboard</div>
      {showReplaySwitcher ? (
        <div className={styles.viewSwitcher}>
          <span className={styles.viewSwitcherLabel}>Main 3D view</span>
          <div
            className={styles.viewSwitcherButtons}
            role="group"
            aria-label="Choose main 3D replay view"
          >
            <button
              type="button"
              className={styles.viewButton}
              data-active={mainReplayView === 'current' || undefined}
              aria-pressed={mainReplayView === 'current'}
              onClick={() => onMainReplayViewChange?.('current')}
            >
              Current line
            </button>
            <button
              type="button"
              className={styles.viewButton}
              data-view="proposal"
              data-active={mainReplayView === 'proposal-1' || undefined}
              aria-pressed={mainReplayView === 'proposal-1'}
              onClick={() => onMainReplayViewChange?.('proposal-1')}
            >
              Proposed onboard 1
              <span className={styles.pointCount}>{proposedPointCount}</span>
            </button>
            <button
              type="button"
              className={styles.viewButton}
              data-view="proposal"
              data-active={mainReplayView === 'proposal-2' || undefined}
              aria-pressed={mainReplayView === 'proposal-2'}
              onClick={() => onMainReplayViewChange?.('proposal-2')}
            >
              Proposed onboard 2
              <span className={styles.pointCount}>{proposedPointCount}</span>
            </button>
          </div>
        </div>
      ) : null}
      <div className={styles.meta}>Russell · Montréal Q3 · 1:12.000</div>
    </header>
  )
}
