import { useEffect, useState } from 'react';
import { apiClient } from './api-client.js';

interface AuthedImageState {
  url: string | null;
  loading: boolean;
  error: boolean;
}

// Image content is served by an authenticated API endpoint, so a plain
// <img src> (which cannot carry the Bearer token) won't work — the bytes
// are fetched through the shared axios client (token + refresh handling)
// and exposed as a revocable object URL instead.
//
// `version` should change whenever the underlying content changes (e.g.
// the image's updatedAt) so a replaced image is re-fetched.
export function useAuthedImage(path: string | null, version?: string): AuthedImageState {
  const requestKey = path ? `${path}|${version ?? ''}` : null;

  const [state, setState] = useState<AuthedImageState>({
    url: null,
    loading: requestKey !== null,
    error: false,
  });
  const [loadedKey, setLoadedKey] = useState(requestKey);

  // Render-time reset when the request changes — keeps state transitions out
  // of the effect (only the async fetch callbacks set state there).
  if (loadedKey !== requestKey) {
    setLoadedKey(requestKey);
    setState({ url: null, loading: requestKey !== null, error: false });
  }

  useEffect(() => {
    if (!path || !requestKey) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    apiClient
      .get<Blob>(path, { responseType: 'blob' })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        if (!cancelled) {
          setState({ url: objectUrl, loading: false, error: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ url: null, loading: false, error: true });
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return state;
}
