import { Component, type ErrorInfo, type ReactNode } from 'react'

type SilentErrorBoundaryProps = {
  children: ReactNode
  label: string
}

type SilentErrorBoundaryState = {
  failed: boolean
}

/** Isolates a failed subtree without introducing replacement UI. */
export class SilentErrorBoundary extends Component<
  SilentErrorBoundaryProps,
  SilentErrorBoundaryState
> {
  state: SilentErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): SilentErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error(`[${this.props.label}] render failed`, error, errorInfo)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
