import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './AppFallback.module.css'

type AppStatusPageProps = {
  eyebrow: string
  title: string
  message: string
  busy?: boolean
  actions?: ReactNode
}

function AppStatusPage({
  eyebrow,
  title,
  message,
  busy = false,
  actions,
}: AppStatusPageProps) {
  return (
    <main className={styles.page}>
      <section
        className={styles.card}
        role={busy ? 'status' : undefined}
        aria-live={busy ? 'polite' : undefined}
        aria-busy={busy || undefined}
      >
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.message}>{message}</p>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </section>
    </main>
  )
}

export function AppLoadingFallback() {
  return (
    <AppStatusPage
      eyebrow="The Onboard"
      title="Loading"
      message="Preparing the experience…"
      busy
    />
  )
}

export function NotFoundPage() {
  return (
    <AppStatusPage
      eyebrow="404"
      title="Page not found"
      message="That route is not part of this replay experience."
      actions={
        <>
          <a className={styles.primaryAction} href="/">
            Home
          </a>
          <a className={styles.secondaryAction} href="/replay">
            Open replay
          </a>
        </>
      }
    />
  )
}

type RootErrorBoundaryProps = {
  children: ReactNode
}

type RootErrorBoundaryState = {
  failed: boolean
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error('[app] uncaught render error', error, errorInfo)
  }

  private retry = () => {
    window.location.reload()
  }

  render() {
    if (this.state.failed) {
      return (
        <AppStatusPage
          eyebrow="The Onboard"
          title="Something went wrong"
          message="The experience could not finish loading. Retry the page, or return home."
          actions={
            <>
              <button
                className={styles.primaryAction}
                type="button"
                onClick={this.retry}
              >
                Retry
              </button>
              <a className={styles.secondaryAction} href="/">
                Home
              </a>
            </>
          }
        />
      )
    }

    return this.props.children
  }
}
