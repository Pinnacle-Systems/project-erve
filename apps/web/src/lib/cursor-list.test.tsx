/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from './cursor-list.js';

let container: HTMLDivElement;
let root: Root;
let calls: Array<Record<string, unknown>>;
let failSecondPage: boolean;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  calls = [];
  failSecondPage = false;
  vi.spyOn(apiClient, 'get').mockImplementation(
    async (_url: string, config?: { params?: Record<string, unknown> }) => {
      const params = config?.params ?? {};
      calls.push(params);
      if (params.cursor === 'c1') {
        if (failSecondPage) throw new Error('boom');
        return {
          data: {
            data: { items: ['c', 'd'], pageInfo: { limit: 2, hasMore: false, nextCursor: null } },
          },
        };
      }
      return {
        data: {
          data: { items: ['a', 'b'], pageInfo: { limit: 2, hasMore: true, nextCursor: 'c1' } },
        },
      };
    },
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness() {
  const [status, setStatus] = useState('OPEN');
  const { query, items } = useCursorList<string>({
    queryKey: ['probe'],
    path: '/probe',
    params: { status },
  });
  return (
    <div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button" data-testid="filter" onClick={() => setStatus('CLOSED')}>
        filter
      </button>
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['row', 'rows'])} />
    </div>
  );
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

function render() {
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Harness />
      </QueryClientProvider>,
    ),
  );
}

const rows = () => Array.from(container.querySelectorAll('li')).map((li) => li.textContent);
const loadMore = () =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load more');

describe('useCursorList + LoadMoreFooter', () => {
  it('appends the next page via nextCursor and reports all loaded', async () => {
    render();
    await flush();
    expect(rows()).toEqual(['a', 'b']);
    expect(container.textContent).toContain('Showing 2 rows');
    expect(container.textContent).not.toContain('(all loaded)');

    await act(async () => loadMore()!.click());
    await flush();

    expect(rows()).toEqual(['a', 'b', 'c', 'd']);
    expect(calls.at(-1)).toEqual({ status: 'OPEN', cursor: 'c1' });
    expect(container.textContent).toContain('Showing 4 rows (all loaded)');
    expect(loadMore()).toBeUndefined();
  });

  it('restarts from the first page when params change', async () => {
    render();
    await flush();
    await act(async () => loadMore()!.click());
    await flush();

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="filter"]')!.click(),
    );
    await flush();

    expect(calls.at(-1)).toEqual({ status: 'CLOSED', cursor: undefined });
    expect(rows()).toEqual(['a', 'b']);
  });

  it('shows a load-more error and keeps the rows already loaded', async () => {
    failSecondPage = true;
    render();
    await flush();
    await act(async () => loadMore()!.click());
    await flush();

    expect(rows()).toEqual(['a', 'b']);
    expect(container.textContent).toContain('Unable to load more rows. Try again.');
  });
});
