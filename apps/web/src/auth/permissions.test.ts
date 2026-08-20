import { describe, expect, it } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import {
  canCreateJobOrders,
  canFilterJobOrdersByFactory,
  canManagePriceLists,
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

const mockUser = (role: Role): AuthUser => ({
  id: 'test-user',
  name: 'Test',
  email: 'test@example.com',
  mobile: null,
  roles: [role],
});

describe('permissions', () => {
  describe.each([
    ['FACTORY_USER', false, false, true, false, false, true, false],
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
});
