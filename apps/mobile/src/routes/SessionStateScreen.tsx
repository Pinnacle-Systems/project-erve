interface SessionStateScreenProps {
  status: 'loading' | 'unavailable';
  onRetry?: () => void;
}

/** A viewport-contained state used while authentication cannot render a page. */
export function SessionStateScreen({ status, onRetry }: SessionStateScreenProps) {
  if (status === 'loading') {
    return (
      <main
        className="flex h-full min-h-0 items-center justify-center overflow-hidden bg-background px-6 text-center"
        role="status"
        aria-label="Restoring session"
      />
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-hidden bg-background px-6 text-center">
      <h1 className="text-xl font-semibold">Temporarily unavailable</h1>
      <p className="text-sm text-muted-foreground">
        Your session was not ended. Check your connection and try again.
      </p>
      <button
        className="min-h-12 rounded-md bg-primary px-6 text-primary-foreground"
        onClick={onRetry}
      >
        Try again
      </button>
    </main>
  );
}
