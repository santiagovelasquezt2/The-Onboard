import type { AppMode } from './routing'

const SITE_ORIGIN = 'https://the-onboard.vercel.app'

export type RouteMetadata = {
  title: string
  description: string
  canonicalPath: '/' | '/replay'
  indexable: boolean
}

export function routeMetadataFor(mode: AppMode): RouteMetadata {
  if (mode === 'replay') {
    return {
      title: 'Russell’s Montreal pole lap — The-Onboard',
      description:
        'Replay George Russell’s 2024 Montreal pole lap with synchronized OpenF1 telemetry and a 3D twin.',
      canonicalPath: '/replay',
      indexable: true,
    }
  }
  if (mode === 'hero') {
    return {
      title: 'The-Onboard — Synchronized F1 onboard replay',
      description:
        'One pole lap, one honest clock: onboard video, OpenF1 telemetry, and a synchronized 3D twin.',
      canonicalPath: '/',
      indexable: true,
    }
  }

  return {
    title: 'Page not found — The-Onboard',
    description: 'That route is not part of The-Onboard replay experience.',
    canonicalPath: '/',
    indexable: false,
  }
}

function setMeta(selector: string, content: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content)
}

export function applyRouteMetadata(mode: AppMode) {
  const metadata = routeMetadataFor(mode)
  const canonicalUrl = `${SITE_ORIGIN}${metadata.canonicalPath}`

  document.title = metadata.title
  document
    .querySelector<HTMLLinkElement>('link[rel="canonical"]')
    ?.setAttribute('href', canonicalUrl)
  setMeta('meta[name="description"]', metadata.description)
  setMeta('meta[name="robots"]', metadata.indexable ? 'index,follow' : 'noindex,nofollow')
  setMeta('meta[property="og:title"]', metadata.title)
  setMeta('meta[property="og:description"]', metadata.description)
  setMeta('meta[property="og:url"]', canonicalUrl)
  setMeta('meta[name="twitter:title"]', metadata.title)
  setMeta('meta[name="twitter:description"]', metadata.description)
}
