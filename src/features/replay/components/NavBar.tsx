import { useId } from 'react'
import { Icon, type IconName } from '../../../ui/Icon'
import styles from './NavBar.module.css'

export type MainCameraMode = 'third-person' | 'onboard'
export type ReplayWorkbookMode = 'data' | 'physics'

type NavBarProps = {
  mainCameraMode?: MainCameraMode
  onMainCameraModeChange?: (mode: MainCameraMode) => void
  onResetThirdPerson?: () => void
  replayWorkbookMode?: ReplayWorkbookMode
  onReplayWorkbookModeChange?: (mode: ReplayWorkbookMode) => void
  replayWorkbookOpen?: boolean
  replayWorkbookCollapsible?: boolean
}

const mainCameraModes: ReadonlyArray<{
  value: MainCameraMode
  label: string
  icon: IconName
}> = [
  {
    value: 'third-person',
    label: 'Third person',
    icon: 'third-person',
  },
  { value: 'onboard', label: 'TV Pod', icon: 'tv-pod' },
]

export function NavBar({
  mainCameraMode,
  onMainCameraModeChange,
  onResetThirdPerson,
  replayWorkbookMode,
  onReplayWorkbookModeChange,
  replayWorkbookOpen = true,
  replayWorkbookCollapsible = false,
}: NavBarProps) {
  const cameraGroupName = useId()
  const showCameraControls =
    mainCameraMode !== undefined && onMainCameraModeChange !== undefined
  const showWorkbookControls =
    replayWorkbookMode !== undefined &&
    onReplayWorkbookModeChange !== undefined

  return (
    <header className={styles.nav}>
      <nav className={styles.pageControls} aria-label="Replay pages">
        <a className={styles.pageButton} href="/">
          <Icon className={styles.pageIcon} name="home" />
          <span className={styles.pageButtonLabel}>Home</span>
        </a>
        {showWorkbookControls ? (
          <>
            <button
              aria-controls={
                replayWorkbookOpen ? 'replay-workbook' : undefined
              }
              aria-expanded={
                replayWorkbookCollapsible
                  ? replayWorkbookOpen && replayWorkbookMode === 'data'
                  : undefined
              }
              aria-label={
                replayWorkbookCollapsible
                  ? `${
                      replayWorkbookOpen && replayWorkbookMode === 'data'
                        ? 'Hide'
                        : 'Show'
                    } data workbook`
                  : undefined
              }
              aria-pressed={
                replayWorkbookOpen && replayWorkbookMode === 'data'
              }
              className={styles.pageButton}
              onClick={() => onReplayWorkbookModeChange('data')}
              type="button"
            >
              <Icon className={styles.pageIcon} name="data" />
              <span className={styles.pageButtonLabel}>Data</span>
            </button>
            <button
              aria-controls={
                replayWorkbookOpen ? 'replay-workbook' : undefined
              }
              aria-expanded={
                replayWorkbookCollapsible
                  ? replayWorkbookOpen && replayWorkbookMode === 'physics'
                  : undefined
              }
              aria-label={
                replayWorkbookCollapsible
                  ? `${
                      replayWorkbookOpen && replayWorkbookMode === 'physics'
                        ? 'Hide'
                        : 'Show'
                    } physics workbook`
                  : undefined
              }
              aria-pressed={
                replayWorkbookOpen && replayWorkbookMode === 'physics'
              }
              className={styles.pageButton}
              onClick={() => onReplayWorkbookModeChange('physics')}
              type="button"
            >
              <Icon className={styles.pageIcon} name="atom" />
              <span className={styles.pageButtonLabel}>Physics</span>
            </button>
          </>
        ) : null}
      </nav>
      {showCameraControls ? (
        <fieldset className={styles.cameraControls} aria-label="3D camera view">
          <div className={styles.cameraButtons}>
            {mainCameraModes.map(({ value, label, icon }) => (
              <label className={styles.cameraOption} key={value}>
                <input
                  checked={mainCameraMode === value}
                  className={styles.cameraInput}
                  name={cameraGroupName}
                  onChange={() => onMainCameraModeChange(value)}
                  type="radio"
                  value={value}
                />
                <span className={styles.cameraButton}>
                  <Icon className={styles.cameraIcon} name={icon} />
                  <span className={styles.cameraButtonLabel}>{label}</span>
                </span>
              </label>
            ))}
          </div>
          {mainCameraMode === 'third-person' && onResetThirdPerson ? (
            <button
              aria-label="Reset third-person camera"
              className={styles.resetButton}
              onClick={onResetThirdPerson}
              type="button"
            >
              <Icon className={styles.resetIcon} name="reset" />
              <span className={styles.resetButtonLabel}>Reset view</span>
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </header>
  )
}
