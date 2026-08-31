import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallback: ReactNode
  onError?: (error: Error) => void
}

type State = {
  hasError: boolean
}

/** Catches GLB / useGLTF failures (404, corrupt file) and shows a fallback UI. */
export class AssetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TrackScene] asset load failed', error, info.componentStack)
    this.props.onError?.(error)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}
