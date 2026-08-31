export type AppMode =
  | 'hero'
  | 'replay'
  | 'driving-line-lab'
  | 'not-found'

type ResolveAppModeOptions = {
  enableDrivingLineLab?: boolean
}

export function resolveAppMode(
  pathname: string,
  { enableDrivingLineLab = false }: ResolveAppModeOptions = {},
): AppMode {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/' || normalized === '/hero') return 'hero'
  if (normalized === '/replay') return 'replay'
  if (normalized === '/driving-line-lab' && enableDrivingLineLab) {
    return 'driving-line-lab'
  }
  return 'not-found'
}
