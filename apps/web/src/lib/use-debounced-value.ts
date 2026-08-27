import { useEffect, useState } from 'react';

// Keeps the visible input immediately responsive while delaying the value
// used to trigger a server query — pair with a raw useState for the input
// binding and only feed this debounced value into query params/keys.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
