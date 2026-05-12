import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
  /ChunkLoadError/i,
];

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return CHUNK_ERROR_PATTERNS.some((re) => re.test(error.message));
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const chunkError = isChunkLoadError(this.state.error);
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold text-stone-800 mb-2">
            {chunkError ? "A new version was deployed" : "Something went wrong"}
          </h2>
          <p className="text-sm text-stone-500 mb-4 max-w-md">
            {chunkError
              ? "Reload to pick up the latest build. If the issue persists, the new assets may still be propagating — try again in a moment."
              : this.state.error?.message || "An unexpected error occurred while rendering this section."}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 cursor-pointer"
          >
            {chunkError ? "Reload" : "Retry"}
          </button>
        </div>
      );
    }

    return this.props.children;
  }

  private handleRetry = () => {
    if (isChunkLoadError(this.state.error) || this.state.retryCount >= 2) {
      window.location.reload();
      return;
    }
    this.setState((prev) => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }));
  };
}
