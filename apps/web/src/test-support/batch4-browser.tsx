// Synthetic browser acceptance entry. Never imported by the production application.
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import { setStoredToken } from '@erve/client';
import { AuthProvider } from '../auth/AuthContext.js';
import { apiClient } from '../lib/api-client.js';
import { QualityExecutionPage } from '../pages/qa/QualityExecutionPage.js';
import { QaDetailPage } from '../pages/qa/QaDetailPage.js';
import { makeQaInspectionDetail } from '../pages/qa/pdf/pp-sample/ppSampleTestFixture.js';
import { contextExecution } from './qa-presentation-fixture.js';
import '../index.css';

const params = new URLSearchParams(location.search);
const workflow = params.get('workflow') ?? 'Inline Inspection';
const role = params.get('role') ?? 'QA_USER';
const finalized = params.get('state') === 'finalized';
const image = {
  id: 'image-1',
  styleId: 'style-1',
  fileId: 'file-1',
  fileName: 'synthetic-style.png',
  mimeType: 'image/png',
  sizeBytes: 68,
  isPrimary: true,
  sortOrder: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
const execution = contextExecution(workflow, finalized ? 'FINALIZED' : 'DRAFT');
execution.qualityForm.name = `${workflow} Report`;
execution.primaryStyle = {
  consistent: true,
  style: { id: 'style-1', styleNumber: 'STY-0001', styleName: 'Basic Tee', primaryImage: image },
};
if (workflow === 'Final Inspection')
  execution.finalBatch = {
    id: 'batch-2',
    batchNumber: 2,
    physicalQuantity: 72,
    disposition: 'DRAFT',
    allocations: [],
    attempts: [],
    release: null,
  };
const pp = makeQaInspectionDetail();
pp.lines = [
  {
    jobOrderLineSizeId: 'size-1',
    styleId: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    colour: 'Navy',
    primaryImage: image,
    sizeCode: 'M',
    sizeLabel: 'Medium',
    orderedQuantity: 72,
    preparedQuantity: 72,
    availableToInspect: 72,
    acceptedQuantity: 0,
    reworkQuantity: 0,
    awaitingReinspectionQuantity: 0,
    permanentlyRejectedQuantity: 0,
  },
];
pp.sessions[0]!.evidence = [];
if (!finalized) {
  pp.sessions[0]!.status = 'DRAFT';
  pp.sessions[0]!.forms[0]!.status = 'DRAFT';
}
const requests: Array<{ path: string; authenticated: boolean; method: string }> = [];
Object.assign(window, { batch4Requests: requests });
setStoredToken('synthetic-batch4-test-token');
// Fail closed: every API call terminates at this fixture adapter, never at a database.
apiClient.defaults.adapter = async (config) => {
  const path = config.url ?? '';
  requests.push({
    path,
    method: config.method ?? 'get',
    authenticated: Boolean(config.headers.Authorization),
  });
  let data: unknown;
  if (path === '/auth/me')
    data = {
      id: 'synthetic-user',
      name: 'Synthetic QA',
      email: 'qa@example.invalid',
      mobile: null,
      roles: [role],
    };
  else if (path.endsWith('/content'))
    return {
      data: new Blob([png], { type: 'image/png' }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  else if (path === '/styles/style-1/images') data = [image];
  else if (path.includes('/audit')) data = [];
  else if (path === '/qa/job-orders/jo-1') data = pp;
  else if (path === '/job-orders/jo-1') data = { id: 'jo-1', factory: { name: 'Approved Factory' }, orderedQuantityTotal: 1800, seasonSnapshots: [{ displayName: 'Recorded Winter 26' }] };
  else if (path === '/quality-executions/execution-1') data = execution;
  else throw new Error(`Unconfigured synthetic API route: ${path}`);
  return { data: { data, success: true }, status: 200, statusText: 'OK', headers: {}, config };
};
const path = workflow === 'PP Sample' ? '/qa/jo-1' : '/quality-executions/execution-1';
createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme="default" density="compact">
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <div className="min-w-0 p-3 sm:p-4">
            <Routes>
              <Route path="/qa/:id" element={<QaDetailPage />} />
              <Route path="/quality-executions/:executionId" element={<QualityExecutionPage />} />
            </Routes>
          </div>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>,
);
