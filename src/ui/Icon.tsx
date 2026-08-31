import type { SVGProps } from 'react'

export type IconName =
  | 'atom'
  | 'code'
  | 'data'
  | 'home'
  | 'reset'
  | 'settings'
  | 'third-person'
  | 'tv-pod'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: IconName
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {name === 'home' ? (
        <>
          <path d="m3.5 10.5 8.5-6.75 8.5 6.75v8.25a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" />
          <path d="M9 20.25v-6h6v6" />
        </>
      ) : null}
      {name === 'data' ? (
        <>
          <rect height="16" rx="2" width="16" x="4" y="4" />
          <path d="M8 16v-3m4 3V8m4 8v-5" />
        </>
      ) : null}
      {name === 'atom' ? (
        <>
          <ellipse cx="12" cy="12" rx="9" ry="3.5" />
          <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)" />
          <circle cx="12" cy="12" fill="currentColor" r="1.4" stroke="none" />
        </>
      ) : null}
      {name === 'third-person' ? (
        <>
          <rect height="11" rx="2" width="13" x="2.5" y="7" />
          <path d="m15.5 10 6-3v10l-6-3" />
          <circle cx="7" cy="5" r="2" />
          <circle cx="12" cy="4" r="2.5" />
        </>
      ) : null}
      {name === 'tv-pod' ? (
        <>
          <rect height="13" rx="2" width="18" x="3" y="8" />
          <path d="m8 3 4 5 4-5M16 8v13" />
          <circle cx="18.5" cy="12" fill="currentColor" r="1" stroke="none" />
          <circle cx="18.5" cy="16" fill="currentColor" r="1" stroke="none" />
        </>
      ) : null}
      {name === 'reset' ? (
        <>
          <path d="M4 8V4m0 0h4" />
          <path d="M4.8 8.25A8 8 0 1 1 4.3 15" />
        </>
      ) : null}
      {name === 'settings' ? (
        <>
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1m0-14.2L17 7M7 17l-2.1 2.1" />
        </>
      ) : null}
      {name === 'code' ? <path d="m9 7-5 5 5 5m6-10 5 5-5 5" /> : null}
    </svg>
  )
}
