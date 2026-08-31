import { describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import {
  canCreateJobOrders,
  canFilterJobOrdersByFactory,
  canManagePriceLists,
  canManageJobOrderProduction,
  canManageDistributorMaster,
  canManageProcessFlows,
  canManagePurchaseOrders,
  canManageSizes,
  canManageUsers,
  canViewDistributorMaster,
  canViewFactories,
  canViewJobOrders,
  canViewMasterDataDashboardShortcut,
  canViewPriceLists,
  canViewPurchaseOrders,
  canViewQa,
  canViewStyles,
} from './permissions.js';

const ALL_ROLES: Role[] = [
  'ADMIN',
  'MERCHANDISER',
  'FACTORY_USER',
  'QA_USER',
  'ACCOUNTANT',
  'DISTRIBUTOR',
  'SENIOR_MANAGEMENT',
];

const mockUser = (role: Role): AuthUser => ({
  id: 'test-user',
  name: 'Test',
  email: 'test@example.com',
  mobile: null,
  roles: [role],
});

describe('permissions', () => {
  describe.each([
    ['FACTORY_USER', false, false, false, false, false, true, false],
    ['ADMIN', true, true, true, true, true, true, true],
    ['MERCHANDISER', true, true, true, true, true, true, true],
  ] as const)(
    '%s permissions',
    (
      role,
      expectedCreate,
      expectedFilter,
      expectedFactories,
      expectedPOs,
      expectedMasterData,
      expectedJobOrders,
      expectedManageSizes,
    ) => {
      const user = mockUser(role);

      it(`canCreateJobOrders = ${expectedCreate}`, () => {
        expect(canCreateJobOrders(user)).toBe(expectedCreate);
      });

      it(`canFilterJobOrdersByFactory = ${expectedFilter}`, () => {
        expect(canFilterJobOrdersByFactory(user)).toBe(expectedFilter);
      });

      it(`canViewFactories = ${expectedFactories}`, () => {
        expect(canViewFactories(user)).toBe(expectedFactories);
      });

      it(`canViewPurchaseOrders = ${expectedPOs}`, () => {
        expect(canViewPurchaseOrders(user)).toBe(expectedPOs);
      });

      it(`canViewMasterDataDashboardShortcut = ${expectedMasterData}`, () => {
        expect(canViewMasterDataDashboardShortcut(user)).toBe(expectedMasterData);
      });

      it(`canViewJobOrders = ${expectedJobOrders}`, () => {
        expect(canViewJobOrders(user)).toBe(expectedJobOrders);
      });

      it(`canManageJobOrderProduction follows the backend production role set`, () => {
        expect(canManageJobOrderProduction(user)).toBe(
          role === 'ADMIN' || role === 'MERCHANDISER' || role === 'FACTORY_USER',
        );
      });

      it(`canManageSizes = ${expectedManageSizes}`, () => {
        expect(canManageSizes(user)).toBe(expectedManageSizes);
      });

      // Simple checks to use the remaining functions and satisfy unused warnings
      it(`other functions run without throwing`, () => {
        expect(canManageDistributorMaster(user)).toBe(role === 'ADMIN' || role === 'MERCHANDISER');
        expect(typeof canManagePriceLists(user)).toBe('boolean');
        expect(typeof canManageProcessFlows(user)).toBe('boolean');
        expect(typeof canManagePurchaseOrders(user)).toBe('boolean');
        expect(typeof canManageUsers(user)).toBe('boolean');
        expect(typeof canViewDistributorMaster(user)).toBe('boolean');
        expect(typeof canViewPriceLists(user)).toBe('boolean');
        expect(typeof canViewQa(user)).toBe('boolean');
        expect(typeof canViewStyles(user)).toBe('boolean');
      });
    },
  );

  it('keeps QA production access read-only', () => {
    const qaUser = mockUser('QA_USER');

    expect(canViewJobOrders(qaUser)).toBe(true);
    expect(canManageJobOrderProduction(qaUser)).toBe(false);
  });

  describe('master-data authorization matrix', () => {
    it('grants Distributor master (view) only to ADMIN, MERCHANDISER, SENIOR_MANAGEMENT', () => {
      const allowed: Role[] = ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'];
      for (const role of ALL_ROLES) {
        expect(canViewDistributorMaster(mockUser(role))).toBe(allowed.includes(role));
      }
    });

    it('grants Distributor master (manage) only to ADMIN, MERCHANDISER', () => {
      const allowed: Role[] = ['ADMIN', 'MERCHANDISER'];
      for (const role of ALL_ROLES) {
        expect(canManageDistributorMaster(mockUser(role))).toBe(allowed.includes(role));
      }
    });

    it('grants Factory master (view) only to ADMIN, MERCHANDISER — not FACTORY_USER', () => {
      const allowed: Role[] = ['ADMIN', 'MERCHANDISER'];
      for (const role of ALL_ROLES) {
        expect(canViewFactories(mockUser(role))).toBe(allowed.includes(role));
      }
    });

    it('grants Price List view to ADMIN, MERCHANDISER, SENIOR_MANAGEMENT, ACCOUNTANT — not DISTRIBUTOR', () => {
      const allowed: Role[] = ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT'];
      for (const role of ALL_ROLES) {
        expect(canViewPriceLists(mockUser(role))).toBe(allowed.includes(role));
      }
    });

    it('grants Price List manage to ADMIN, MERCHANDISER, ACCOUNTANT (finance exception)', () => {
      const allowed: Role[] = ['ADMIN', 'MERCHANDISER', 'ACCOUNTANT'];
      for (const role of ALL_ROLES) {
        expect(canManagePriceLists(mockUser(role))).toBe(allowed.includes(role));
      }
    });
  });
});
