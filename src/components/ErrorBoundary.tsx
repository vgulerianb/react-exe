import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the error to console
    console.error("Error caught by ErrorBoundary:", error, errorInfo);

    // Call the onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      // Use provided fallback or default error UI
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <div
          style={{
            padding: "16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fee2e2",
            borderRadius: "4px",
            color: "#dc2626",
            margin: "8px 0",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0" }}>Something went wrong</h3>
          <details style={{ whiteSpace: "pre-wrap", fontSize: "14px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 500 }}>
              Error details
            </summary>
            <p style={{ margin: "8px 0 0 0" }}>
              {this.state.error?.message || "Unknown error"}
            </p>
            <pre
              style={{
                margin: "8px 0 0 0",
                backgroundColor: "rgba(0,0,0,0.05)",
                padding: "8px",
                borderRadius: "4px",
                overflow: "auto",
              }}
            >
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
