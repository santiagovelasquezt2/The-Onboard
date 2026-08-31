import { Fragment, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { resolveAppMode } from './routing.ts'
import { applyRouteMetadata } from './routeMetadata.ts'
import { SilentErrorBoundary } from './ui/SilentErrorBoundary.tsx'

const appMode = resolveAppMode(window.location.pathname, {
  enableDrivingLineLab: import.meta.env.DEV,
})
applyRouteMetadata(appMode)
const RootApp =
  appMode === 'hero'
    ? lazy(() => import('./features/hero/HeroPage.tsx'))
    : appMode === 'replay'
      ? lazy(() => import('./features/replay/ReplayPage.tsx'))
      : appMode === 'driving-line-lab' && import.meta.env.DEV
        ? lazy(
            () =>
              import('./features/replay/calibration/DrivingLineLabPage.tsx'),
          )
        : Fragment

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SilentErrorBoundary label="app">
      <Suspense fallback={null}>
        <RootApp />
      </Suspense>
    </SilentErrorBoundary>
  </StrictMode>,
)
