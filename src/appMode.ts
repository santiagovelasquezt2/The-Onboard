export type AppMode = 'replay' | 'driving-line-lab'

export function resolveAppMode(pathname: string): AppMode {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return normalized === '/driving-line-lab' ? 'driving-line-lab' : 'replay'
}
