// Engineering-only HTTP acceptance. No table resets or direct stock writes.
import request from 'supertest';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { planDisposableRebuild } from './disposable-rebuild.js';
import { getFileStorage } from '../storage/index.js';
import { toBusinessCalendarDate } from '../modules/master-data/financial-year.util.js';
import { assertUnissuedDraft, assertNoUncertainRequest } from './pr8-acceptance-state.js';

type Component = { id: string; type: string; config: Record<string, unknown> };
type Execution = { id: string; version: number; sections: Array<{ components: Component[] }> };
const key = (value: unknown) =>
  typeof value === 'string' ? value : String((value as { key: string }).key);
export function passingQualityPayload(execution: Execution, date: string, quantity: number) {
  const payload = {
    expectedVersion: execution.version,
    checklistResponses: [] as unknown[],
    aqlResults: [] as unknown[],
    defects: [],
    correctiveActions: [],
    testResults: [] as unknown[],
    quantities: [] as unknown[],
    comments: [] as unknown[],
    fieldResponses: [] as unknown[],
    attendees: [] as unknown[],
    actions: [] as unknown[],
    signoffs: [] as unknown[],
    outcome: undefined as unknown,
  };
  const value = (field: Record<string, unknown>) =>
    field.dataType === 'DATE'
      ? date
      : field.dataType === 'NUMBER'
        ? String(quantity)
        : field.dataType === 'BOOLEAN'
          ? 'true'
          : 'Engineering acceptance fixture';
  for (const component of execution.sections.flatMap((section) => section.components)) {
    const config = component.config;
    if (component.type === 'CHECKLIST')
      for (const item of config.items as Array<{ key: string }>)
        payload.checklistResponses.push({
          componentId: component.id,
          itemKey: item.key,
          response:
            (config.responseOptions as string[]).find((option) =>
              ['PASSED', 'YES', 'PASS'].includes(option),
            ) ?? (config.responseOptions as string[])[0],
        });
    if (component.type === 'AQL_RESULT')
      for (const criterion of (config.criteria as Array<{ severity: string }>) ?? [])
        payload.aqlResults.push({
          componentId: component.id,
          severity: criterion.severity,
          maxAllowed: 0,
          found: 0,
        });
    if (component.type === 'TEST_RESULTS')
      for (const test of (config.tests as Array<{ key: string }>) ?? [])
        payload.testResults.push({
          componentId: component.id,
          testKey: test.key,
          response: 'PASSED',
        });
    if (component.type === 'QUANTITY_RECONCILIATION')
      for (const field of (config.fields as Array<Record<string, unknown>>) ?? [])
        if (field.source !== 'SYSTEM')
          payload.quantities.push({
            componentId: component.id,
            fieldKey: field.key,
            value: quantity,
          });
    if (component.type === 'FIELD_GROUP')
      for (const field of (config.fields as Array<Record<string, unknown>>) ?? [])
        if (field.source !== 'SYSTEM')
          payload.fieldResponses.push({
            componentId: component.id,
            fieldKey: field.key,
            value: value(field),
          });
    if (component.type === 'ATTENDEE_LIST')
      for (const role of (config.roles as unknown[]) ?? [])
        payload.attendees.push({
          componentId: component.id,
          roleKey: key(role),
          attendeeName: 'Engineering fixture attendee',
        });
    if (component.type === 'ACTION_LIST')
      payload.actions.push({
        componentId: component.id,
        values: Object.fromEntries(
          ((config.columns as Array<Record<string, unknown>>) ?? []).map((field) => [
            String(field.key),
            value(field),
          ]),
        ),
      });
    if (component.type === 'SIGNATURES')
      for (const role of (config.roles as unknown[]) ?? [])
        payload.signoffs.push({
          componentId: component.id,
          roleKey: key(role),
          signatoryName: 'Engineering fixture inspector',
        });
    if (component.type === 'COMMENTS')
      payload.comments.push({
        componentId: component.id,
        value: 'Disposable engineering acceptance only',
      });
    if (component.type === 'INSPECTION_OUTCOME')
      payload.outcome = {
        componentId: component.id,
        remarks: 'Engineering fixture; outcome must be derived by the server',
      };
  }
  return payload;
}

export async function runMasterOperationalAcceptance(
  configFile: string,
  passwordFile: string,
  repositoryRoot: string,
) {
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  const guarded = await planDisposableRebuild(config, {
    execute: false,
    confirmWrite: false,
    repositoryRoot,
  });
  if (!guarded.target.owned)
    throw new Error('Operational fixture requires an owned PR8 disposable target');
  const reportPath = path.join(guarded.config.reportRoot, 'operational-acceptance.json');
  let previous: Record<string, unknown> | undefined;
  try {
    previous = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (
    previous &&
    ((previous.target as { name: string }).name !== guarded.target.name ||
      !previous.engineeringOnly)
  )
    throw new Error('Prior operational report belongs to another target');
  if (
    !previous &&
    ((await prisma.distributorPurchaseOrder.count()) ||
      (await prisma.jobOrder.count()) ||
      (await prisma.saleOrder.count()) ||
      (await prisma.taxInvoice.count()))
  )
    throw new Error(
      'Operational acceptance requires a fresh operational fixture or its own checkpoint; preserve existing results',
    );
  if (previous?.status === 'PASSED') {
    const invoice = await prisma.taxInvoice.findUnique({
      where: { id: String(previous.taxInvoiceDraftId) },
    });
    const numbered = await prisma.taxInvoice.count({ where: { invoiceNumber: { not: null } } });
    assertUnissuedDraft(invoice, numbered);
    return previous;
  }
  const app = createApp();
  const trace: Array<{ method: string; route: string; status: number }> =
    (previous?.trace as typeof trace) ?? [];
  const completed = (previous?.completedRequests as Record<string, unknown>) ?? {};
  const pendingRequests = (previous?.pendingRequests as Record<string, unknown>) ?? {};
  assertNoUncertainRequest(pendingRequests, completed);
  const report: Record<string, unknown> = previous ?? {
    engineeringOnly: true,
    target: guarded.target,
    trace,
    completedRequests: completed,
    syntheticFacts: [
      'ten simulated production units',
      'simulated QA observations/signatures and source-photo reference',
      '50% MRP test pricing',
      'synthetic Seller registration/bank fields',
      'simulated carton weights/dimensions',
    ],
    status: 'EXECUTING',
  };
  report.completedRequests = completed;
  report.pendingRequests = pendingRequests;
  report.trace = trace;
  report.status = 'EXECUTING';
  delete report.error;
  const checkpoint = async () => {
    const temporary = `${reportPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2), { flag: 'wx' });
    await rename(temporary, reportPath);
  };
  const call = async (
    method: 'get' | 'post' | 'put',
    route: string,
    token?: string,
    body?: unknown,
    expected = 200,
  ) => {
    const operation = createHash('sha256')
      .update(
        JSON.stringify([method, route, body], (key, value) =>
          key.startsWith('expected') ? undefined : value,
        ),
      )
      .digest('hex');
    if (method !== 'get' && !route.startsWith('/auth') && completed[operation])
      return completed[operation];
    const idempotencyKey = createHash('sha256')
      .update(`${guarded.config.disposableId}:${operation}`)
      .digest('hex');
    if (method !== 'get' && !route.startsWith('/auth')) {
      // Store no request bodies: user-creation bodies contain private passwords.
      pendingRequests[operation] = { method, route, idempotencyKey };
      await checkpoint();
    }
    let pending = request(app)[method](route).set('Idempotency-Key', idempotencyKey);
    if (token) pending = pending.set('Authorization', `Bearer ${token}`);
    if (body) pending = pending.send(body);
    const response = await pending;
    trace.push({ method, route, status: response.status });
    if (response.status !== expected)
      throw new Error(
        `${method} ${route}: expected ${expected}, got ${response.status}: ${JSON.stringify(response.body.error)}`,
      );
    if (method !== 'get' && !route.startsWith('/auth')) {
      completed[operation] = response.body.data;
      delete pendingRequests[operation];
      await checkpoint();
    }
    return response.body.data;
  };
  try {
    const admin = await call('post', '/auth/login', undefined, {
      identifier: guarded.config.adminEmail,
      password: (await readFile(passwordFile, 'utf8')).trimEnd(),
    });
    const token = admin.accessToken as string;
    const style = await prisma.style.findFirstOrThrow({
      where: {
        status: 'ACTIVE',
        hsnId: { not: null },
        images: { some: {} },
        styleFactoryMappings: { some: { status: 'ACTIVE', exFactoryPrice: { gt: 0 } } },
      },
      orderBy: { styleNumber: 'asc' },
      include: {
        styleSizes: { where: { status: 'ACTIVE' }, orderBy: { sizeId: 'asc' } },
        styleFactoryMappings: {
          where: { status: 'ACTIVE', exFactoryPrice: { gt: 0 } },
          include: { factory: true },
        },
        images: { include: { file: true } },
      },
    });
    const mapping = style.styleFactoryMappings[0]!;
    const store = await prisma.retailStore.findFirstOrThrow({
      where: { name: 'PR8 ENGINEERING ONLY STORE' },
      include: { distributor: true },
    });
    if (store.distributor.purchaseMode !== 'OUTRIGHT')
      throw new Error('Controlled OUTRIGHT fixture is required');
    const actors: Record<string, string> = {};
    const credentialsFile = path.join(
      guarded.config.reportRoot,
      'operational-fixture-credentials.json',
    );
    let credentials: Record<string, { email: string; password: string }>;
    try {
      credentials = JSON.parse(await readFile(credentialsFile, 'utf8'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      credentials = Object.fromEntries(
        ['FACTORY_USER', 'QA_USER', 'MERCHANDISER', 'ACCOUNTANT'].map((role) => [
          role,
          {
            email: `${role.toLowerCase()}-${randomUUID()}@disposable.invalid`,
            password: randomBytes(24).toString('base64url'),
          },
        ]),
      );
      await writeFile(credentialsFile, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
    }
    for (const role of ['FACTORY_USER', 'QA_USER', 'MERCHANDISER', 'ACCOUNTANT']) {
      const { email, password } = credentials[role]!;
      const created = await call(
        'post',
        '/users',
        token,
        {
          name: `Engineering ${role}`,
          email,
          password,
          roles: [role],
          ...(role === 'FACTORY_USER' ? { factoryId: mapping.factoryId } : {}),
        },
        201,
      );
      const signedIn = await call('post', '/auth/login', undefined, {
        identifier: email,
        password,
      });
      actors[role] = signedIn.accessToken;
      report[`${role.toLowerCase()}UserId`] = created.id;
    }
    const quantityPerSize = 2,
      quantity = quantityPerSize * style.styleSizes.length,
      date = String(
        report.fixtureDate ?? toBusinessCalendarDate(new Date()).toISOString().slice(0, 10),
      );
    report.fixtureDate = date;
    await checkpoint();
    report.syntheticFacts = [
      'two simulated production units per active imported Size',
      'simulated QA observations/signatures and source-photo reference',
      '50% MRP test pricing',
      'synthetic Seller registration/bank fields',
      'simulated carton weights/dimensions',
    ];
    const orderSheet = await call(
      'post',
      '/purchase-orders',
      actors.MERCHANDISER,
      {
        distributorId: store.distributorId,
        poDate: date,
        lines: [
          {
            styleId: style.id,
            sizes: style.styleSizes.map((size) => ({
              sizeId: size.sizeId,
              orderedQuantity: quantityPerSize,
            })),
          },
        ],
      },
      201,
    );
    const flow = await prisma.processFlowVersion.findFirstOrThrow({
      where: { status: 'ACTIVE', processFlow: { code: 'ERVE_PRODUCTION_QUALITY' } },
      orderBy: { versionNumber: 'desc' },
      include: { stages: true },
    });
    let job = await call(
      'post',
      '/job-orders',
      actors.MERCHANDISER,
      {
        orderSheetIds: [orderSheet.id],
        sizes: style.styleSizes.map((size) => ({ sizeId: size.sizeId, quantity: quantityPerSize })),
        factoryId: mapping.factoryId,
        processFlowVersionId: flow.id,
        unitPrice: mapping.exFactoryPrice.toString(),
        disclaimerText: 'Disposable engineering fixture only; no commercial commitments.',
      },
      201,
    );
    job = await call('post', `/job-orders/${job.id}/actions/send-to-factory`, actors.MERCHANDISER, {
      expectedVersion: job.version,
    });
    job = await call('post', `/job-orders/${job.id}/actions/confirm`, actors.FACTORY_USER, {
      expectedVersion: job.version,
      expectedDisclaimerRevision: job.disclaimerRevision ?? 1,
      acknowledgeDisclaimer: true,
    });
    report.orderSheetId = orderSheet.id;
    report.jobOrderId = job.id;
    report.importedStyleId = style.id;
    report.importedFactoryId = mapping.factoryId;
    report.importedDistributorId = store.distributorId;
    report.importedStoreId = store.id;
    await checkpoint();
    const fresh = () => call('get', `/job-orders/${job.id}`, actors.MERCHANDISER);
    const imageBytes = await getFileStorage().read(style.images[0]!.file.storageKey);
    const quality = async (code: string) => {
      job = await fresh();
      const activity = flow.stages.find((activity) => activity.code === code);
      if (!activity) throw new Error(`Canonical quality activity missing: ${code}`);
      const lineSize = job.lines[0].sizes[0];
      const started = await call(
        'post',
        `/job-orders/${job.id}/quality-activities/${activity.id}/executions`,
        actors.QA_USER,
        code === 'PP_SAMPLE'
          ? { sampleJobOrderLineSizeId: lineSize.id, sampleQuantity: quantityPerSize }
          : code === 'FINAL'
            ? {
                allocations: job.lines.flatMap((line: { sizes: Array<{ id: string }> }) =>
                  line.sizes.map((size) => ({
                    jobOrderLineSizeId: size.id,
                    quantity: quantityPerSize,
                  })),
                ),
              }
            : {},
        201,
      );
      const existingExecution = await call(
        'get',
        `/quality-executions/${started.id}`,
        actors.QA_USER,
      );
      if (existingExecution.status === 'FINALIZED') return;
      if (code === 'PP_SAMPLE') {
        const qaDetail = await call('get', `/qa/job-orders/${job.id}`, actors.QA_USER);
        const session = qaDetail.sessions.find(
          (session: { id: string }) => session.id === started.ppSample.sessionId,
        );
        if (!session) throw new Error('PP Sample inspection projection is missing');
        const form = session.forms[0];
        const evidence = await request(app)
          .post(`/qa/inspections/${session.id}/evidence`)
          .set('Authorization', `Bearer ${actors.QA_USER}`)
          .field('inspectionLineId', form.id)
          .attach('image', imageBytes, 'engineering-source-reference.png');
        if (![200, 201].includes(evidence.status))
          throw new Error(`PP evidence rejected: ${JSON.stringify(evidence.body.error)}`);
        await call('put', `/qa/inspections/${session.id}/forms/${form.id}`, actors.QA_USER, {
          expectedVersion: form.version,
          sampleQuantity: quantityPerSize,
          inspectionRemarks: 'Engineering simulation',
          checklist: form.checklist.map((item: { itemCode: string }) => ({
            itemCode: item.itemCode,
            status: 'YES',
            remarks: null,
          })),
        });
        const refreshed = await call('get', `/qa/job-orders/${job.id}`, actors.QA_USER);
        const currentForm = refreshed.sessions
          .find((item: { id: string }) => item.id === session.id)
          .forms.find((item: { id: string }) => item.id === form.id);
        await call(
          'post',
          `/qa/inspections/${session.id}/forms/${form.id}/finalize`,
          actors.QA_USER,
          { expectedVersion: currentForm.version },
        );
      } else {
        const execution = (await call(
          'get',
          `/quality-executions/${started.id}`,
          actors.QA_USER,
        )) as Execution;
        await call(
          'post',
          `/quality-executions/${started.id}/finalize`,
          actors.QA_USER,
          passingQualityPayload(execution, date, quantity),
        );
      }
      await checkpoint();
    };
    await quality('PP_SAMPLE');
    await quality('PPM');
    for (const code of ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING']) {
      job = await fresh();
      const stage = job.stages.find(
        (stage: { processFlowVersionStageId: string }) =>
          stage.processFlowVersionStageId ===
          flow.stages.find((definition) => definition.code === code)!.id,
      );
      if (!stage) throw new Error(`Canonical production stage missing: ${code}`);
      if (stage.status === 'COMPLETED') continue;
      job = await call('post', `/job-orders/${job.id}/actions/start-stage`, actors.FACTORY_USER, {
        expectedVersion: job.version,
        stageStatusId: stage.id,
      });
      if (code === 'SEWING') {
        await quality('INLINE');
      }
      if (code === 'FINISHING') {
        job = await fresh();
        job = await call(
          'post',
          `/job-orders/${job.id}/actions/update-prepared-quantity`,
          actors.FACTORY_USER,
          {
            expectedVersion: job.version,
            sizes: job.lines.flatMap((line: { sizes: Array<{ id: string }> }) =>
              line.sizes.map((size) => ({
                jobOrderLineSizeId: size.id,
                preparedQuantity: quantityPerSize,
              })),
            ),
          },
        );
        await quality('FINAL');
      }
      job = await fresh();
      if (
        job.stages.find((current: { id: string }) => current.id === stage.id)?.status !==
        'COMPLETED'
      )
        await call('post', `/job-orders/${job.id}/actions/complete-stage`, actors.FACTORY_USER, {
          expectedVersion: job.version,
          stageStatusId: stage.id,
        });
    }
    job = await fresh();
    if (job.status !== 'PRODUCTION_COMPLETE')
      await call(
        'post',
        `/job-orders/${job.id}/actions/mark-production-complete`,
        actors.MERCHANDISER,
        { expectedVersion: job.version },
      );
    const released = await prisma.qaReleaseLine.findMany({
      where: { release: { jobOrderId: job.id } },
      include: { release: { include: { sourceQualityExecution: true } } },
    });
    if (
      released.reduce((sum, line) => sum + line.quantity, 0) !== quantity ||
      released.some(
        (line) =>
          line.release.sourceQualityExecution.status !== 'FINALIZED' ||
          line.release.sourceQualityExecution.outcome !== 'PASS',
      )
    )
      throw new Error('All stock must originate from finalized server-derived PASS Final QA');
    report.releasedStockBatches = released;
    await checkpoint();
    const priceList = await call(
      'post',
      '/price-lists',
      token,
      {
        distributorId: store.distributorId,
        name: 'ENGINEERING ONLY 50% MRP',
        percentageOfMrp: 50,
        effectiveFrom: '2000-01-01',
      },
      201,
    );
    await call('post', `/price-lists/${priceList.id}/actions/activate`, token, {});
    const seller = await call(
      'post',
      '/seller-registrations',
      token,
      {
        legalName: 'ENGINEERING ONLY SELLER',
        branchCode: 'ENGINEERING',
        gstin: '33AAAAA0000A1Z5',
        addressLine1: 'Engineering fixture address',
        city: 'Chennai',
        state: 'Tamil Nadu',
        stateCode: '33',
        postalCode: '600001',
        bankName: 'Engineering Bank',
        bankAccountName: 'Engineering fixture',
        bankAccountNumber: '0000000001',
        bankIfsc: 'TEST0000001',
        bankBranchName: 'Engineering',
        status: 'ACTIVE',
      },
      201,
    );
    report.syntheticSellerId = seller.id;
    const dispatch = await call(
      'post',
      '/sale-orders',
      actors.MERCHANDISER,
      {
        distributors: [
          {
            clientKey: 'group1',
            distributorId: store.distributorId,
            destinations: [
              {
                clientKey: 'destination1',
                retailStoreId: store.id,
                addressLine1: store.addressLine1,
                addressLine2: store.addressLine2,
                city: store.city,
                state: store.state,
                country: store.country,
                postalCode: store.postalCode,
              },
            ],
          },
        ],
        factoryId: mapping.factoryId,
        soDate: date,
        lines: [
          { destinationClientKey: 'destination1', styleId: style.id, totalQuantity: quantity },
        ],
      },
      201,
    );
    const destination = dispatch.distributorGroups[0].destinations[0];
    const packed = await call(
      'post',
      `/sale-orders/${dispatch.id}/packing-list/cartons`,
      actors.FACTORY_USER,
      {
        cartonNumber: 'ENGINEERING-C1',
        destinationId: destination.id,
        netWeight: 5,
        grossWeight: 6,
        dimensions: '40 x 30 x 20 cm',
        lines: dispatch.lines.map((line: { id: string; quantity: number }) => ({
          saleOrderLineId: line.id,
          quantity: line.quantity,
        })),
      },
    );
    const cartonId = packed.destinations[0].cartons[0].id;
    const factoryDispatch = packed.factoryDispatch;
    await call(
      'post',
      `/factory-dispatches/${factoryDispatch.id}/cartons/${cartonId}/audit`,
      actors.QA_USER,
      {},
    );
    await call(
      'post',
      `/factory-dispatches/${factoryDispatch.id}/actions/finalize`,
      actors.FACTORY_USER,
      { expectedVersion: factoryDispatch.version },
    );
    const eipl = await call(
      'post',
      '/erve-packing-lists',
      actors.MERCHANDISER,
      { cartonIds: [cartonId] },
      201,
    );
    await call('post', `/erve-packing-lists/${eipl.id}/finalize`, actors.MERCHANDISER, {});
    const draft = await call(
      'post',
      '/tax-invoices',
      actors.ACCOUNTANT,
      { ervePackingListId: eipl.id },
      201,
    );
    if (draft.status !== 'DRAFT' || draft.invoiceNumber !== null)
      throw new Error('Acceptance must stop at an unnumbered Tax Invoice Draft');
    report.dispatchOrderId = dispatch.id;
    report.ervePackingListId = eipl.id;
    report.taxInvoiceDraftId = draft.id;
    report.taxInvoiceStatus = draft.status;
    report.numberedTaxInvoices = await prisma.taxInvoice.count({
      where: { invoiceNumber: { not: null } },
    });
    if (report.numberedTaxInvoices !== 0)
      throw new Error('No Tax Invoice may be finalized by acceptance');
    report.status = 'PASSED';
    await checkpoint();
    return report;
  } catch (error) {
    report.status = 'FAILED';
    report.error = error instanceof Error ? error.message : 'Operational acceptance failed';
    await checkpoint();
    throw error;
  }
}

if (!process.env.PR8_CONFIG || !process.env.ADMIN_PASSWORD_FILE)
  throw new Error('Explicit PR8 configuration is required');
runMasterOperationalAcceptance(
  process.env.PR8_CONFIG,
  process.env.ADMIN_PASSWORD_FILE,
  path.resolve(import.meta.dirname, '../../../..'),
)
  .then((report) =>
    console.log(
      JSON.stringify({
        status: report.status,
        jobOrderId: report.jobOrderId,
        taxInvoiceStatus: report.taxInvoiceStatus,
      }),
    ),
  )
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
