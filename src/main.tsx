import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { resolveAppMode } from './appMode.ts'

const RootApp =
  resolveAppMode(window.location.pathname) === 'driving-line-lab'
    ? lazy(() => import('./DrivingLineLab.tsx'))
    : lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <RootApp />
    </Suspense>
  </StrictMode>,
)
