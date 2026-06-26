import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — prevents the entire app from crashing when
 * a component throws during render. Shows a fallback UI with retry.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '40px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#e0e0e0',
          background: '#1e1e1e',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '24px', textAlign: 'center', maxWidth: '400px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: '8px 20px',
                borderRadius: '4px',
                border: 'none',
                background: '#0078d4',
                color: 'white',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 20px',
                borderRadius: '4px',
                border: '1px solid #444',
                background: 'transparent',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
