import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { resolveAppMode } from './routing.ts'
import { applyRouteMetadata } from './routeMetadata.ts'
import {
  AppLoadingFallback,
  NotFoundPage,
  RootErrorBoundary,
} from './ui/AppFallback.tsx'

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
        : NotFoundPage

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <Suspense fallback={<AppLoadingFallback />}>
        <RootApp />
      </Suspense>
    </RootErrorBoundary>
  </StrictMode>,
)
