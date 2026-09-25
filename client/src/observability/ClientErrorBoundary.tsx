import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COPY_LABEL, useCopyAction } from '../hooks/useCopyAction';
import {
  type ClientErrorDescription,
  describeClientError,
  reportClientError,
} from './client-error-reporter';

interface ClientErrorBoundaryProps {
  children: ReactNode;
}

/**
 * A failure carries its description; it is not a boolean. The previous
 * `{ failed: true }` state discarded the error, so the fallback could only say
 * "unexpected error" and the only way to find out WHAT broke was to leave the
 * app and run `pnpm errors:list`.
 */
type ClientErrorBoundaryState =
  | { status: 'ok' }
  | { status: 'failed'; failure: ClientErrorDescription };

export class ClientErrorBoundary extends Component<
  ClientErrorBoundaryProps,
  ClientErrorBoundaryState
> {
  state: ClientErrorBoundaryState = { status: 'ok' };

  static getDerivedStateFromError(error: unknown): ClientErrorBoundaryState {
    return { status: 'failed', failure: describeClientError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    window.__unleashdBoot?.ready();
    // componentDidCatch is the only place the component stack exists, so
    // re-describe here: the panel then shows exactly what the journal stores.
    this.setState({
      status: 'failed',
      failure: describeClientError(error, info.componentStack),
    });
    reportClientError({
      source: 'react-boundary',
      error,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.status === 'ok') return this.props.children;
    return <ClientErrorFallback failure={this.state.failure} />;
  }
}

export function ClientErrorFallback({ failure }: { failure: ClientErrorDescription }): ReactNode {
  // One string for both the expandable panel and the clipboard, so what the
  // user pastes into an issue or an agent is what they were shown.
  const report = [failure.message, failure.stack].filter(Boolean).join('\n\n');
  const { state: copyState, copy } = useCopyAction(report);
  return (
    <main className="client-error-fallback ui-stack" role="alert">
      <h1>Unleashd hit an unexpected error</h1>
      <p className="client-error-fallback-message">{failure.message}</p>
      <p>Reload the page to restore the application.</p>
      <div className="client-error-fallback-actions">
        <button type="button" onClick={() => window.location.reload()}>
          Reload Unleashd
        </button>
        <button type="button" className="client-error-fallback-copy" onClick={copy}>
          {COPY_LABEL[copyState]}
        </button>
      </div>
      <details className="client-error-fallback-details">
        <summary>Full error and stack</summary>
        <pre>{report}</pre>
      </details>
    </main>
  );
}
