export type AppMode = 'landing' | 'hero' | 'replay' | 'driving-line-lab'

export function resolveAppMode(pathname: string): AppMode {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/') return 'landing'
  if (normalized === '/hero') return 'hero'
  return normalized === '/driving-line-lab' ? 'driving-line-lab' : 'replay'
}
