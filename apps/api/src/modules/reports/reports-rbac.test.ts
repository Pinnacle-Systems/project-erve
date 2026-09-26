import { describe, expect, it } from 'vitest';
import type { Role } from '@erve/types';
import { canViewReportSection, canViewReports, REPORT_VIEW_ROLES } from '@erve/shared';

function user(...roles: Role[]) {
  return { roles };
}

describe('REPORT_VIEW_ROLES / canViewReports', () => {
  it('is exactly ADMIN, MERCHANDISER, SENIOR_MANAGEMENT', () => {
    expect([...REPORT_VIEW_ROLES].sort()).toEqual(
      ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'].sort(),
    );
  });

  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    'grants %s access to reports',
    (role) => {
      expect(canViewReports(user(role))).toBe(true);
    },
  );

  it.each(['FACTORY_USER', 'QA_USER', 'ACCOUNTANT', 'DISTRIBUTOR'] as const)(
    'denies %s access to reports',
    (role) => {
      expect(canViewReports(user(role))).toBe(false);
    },
  );
});

describe('canViewReportSection', () => {
  it('denies every section to a role outside REPORT_VIEW_ROLES, even for a domain it otherwise has access to', () => {
    // QA_USER has QA_OPERATION_ROLES access to the underlying QA domain, but
    // is not a V1 reporting-audience role at all — the reporting gate must
    // reject it before ever consulting the per-section domain role list.
    expect(canViewReportSection(user('QA_USER'), 'qa')).toBe(false);
  });

  it('grants ADMIN every V1 section', () => {
    const sections = [
      'production',
      'qa',
      'packingPending',
      'packingAudit',
      'delivery',
      'saleReturn',
      'factoryInvoice',
    ] as const;
    for (const section of sections) {
      expect(canViewReportSection(user('ADMIN'), section)).toBe(true);
    }
  });

  it('grants SENIOR_MANAGEMENT every V1 section as a read-only aggregate exception, even sections it has no transaction role for', () => {
    const sections = [
      'production',
      'qa',
      'packingPending',
      'packingAudit',
      'delivery',
      'saleReturn',
      'factoryInvoice',
    ] as const;
    for (const section of sections) {
      expect(canViewReportSection(user('SENIOR_MANAGEMENT'), section)).toBe(true);
    }
  });

  it('grants MERCHANDISER only the sections within its existing operational scope', () => {
    expect(canViewReportSection(user('MERCHANDISER'), 'production')).toBe(true);
    expect(canViewReportSection(user('MERCHANDISER'), 'packingPending')).toBe(true);
    expect(canViewReportSection(user('MERCHANDISER'), 'delivery')).toBe(true);
    expect(canViewReportSection(user('MERCHANDISER'), 'saleReturn')).toBe(true);
  });

  it('denies MERCHANDISER the QA-work, Packing-Audit and Factory-Invoice sections it has no operational role for', () => {
    expect(canViewReportSection(user('MERCHANDISER'), 'qa')).toBe(false);
    expect(canViewReportSection(user('MERCHANDISER'), 'packingAudit')).toBe(false);
    expect(canViewReportSection(user('MERCHANDISER'), 'factoryInvoice')).toBe(false);
  });
});
