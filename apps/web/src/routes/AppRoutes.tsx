import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLES } from '@erve/types';
import { DashboardPage } from '../pages/DashboardPage.js';
import { ForbiddenPage } from '../pages/ForbiddenPage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { DistributorDetailPage } from '../pages/master-data/DistributorDetailPage.js';
import { DistributorFormPage } from '../pages/master-data/DistributorFormPage.js';
import { DistributorListPage } from '../pages/master-data/DistributorListPage.js';
import { FactoryListPage } from '../pages/master-data/FactoryListPage.js';
import { ProcessFlowDetailPage } from '../pages/master-data/ProcessFlowDetailPage.js';
import { ProcessFlowListPage } from '../pages/master-data/ProcessFlowListPage.js';
import { SizeListPage } from '../pages/master-data/SizeListPage.js';
import { StyleDetailPage } from '../pages/master-data/StyleDetailPage.js';
import { StyleFormPage } from '../pages/master-data/StyleFormPage.js';
import { StyleListPage } from '../pages/master-data/StyleListPage.js';
import { PriceListDetailPage } from '../pages/price-lists/PriceListDetailPage.js';
import { PriceListFormPage } from '../pages/price-lists/PriceListFormPage.js';
import { PriceListListPage } from '../pages/price-lists/PriceListListPage.js';
import { PurchaseOrderListPage } from '../pages/purchase-orders/PurchaseOrderListPage.js';
import { PurchaseOrderFormPage } from '../pages/purchase-orders/PurchaseOrderFormPage.js';
import { PurchaseOrderDetailPage } from '../pages/purchase-orders/PurchaseOrderDetailPage.js';
import { JobOrderCreatePage } from '../pages/job-orders/JobOrderCreatePage.js';
import { JobOrderDetailPage } from '../pages/job-orders/JobOrderDetailPage.js';
import { JobOrderListPage } from '../pages/job-orders/JobOrderListPage.js';
import { AppLayout } from '../pages/AppLayout.js';
import { RoleRoute } from './RoleRoute.js';

const PRICE_LIST_VIEW_ROLES = ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'ACCOUNTANT', 'DISTRIBUTOR'] as const;
const PRICE_LIST_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const;
const PO_VIEW_ROLES = ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR'] as const;
const PO_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER', 'DISTRIBUTOR'] as const;
const JOB_ORDER_VIEW_ROLES = ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER', 'QA_USER'] as const;
const JOB_ORDER_MANAGE_ROLES = ['ADMIN', 'MERCHANDISER'] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />
      <Route
        path="/dashboard"
        element={
          <RoleRoute allowed={ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route index element={<DashboardPage />} />
      </Route>
      <Route
        path="/master-data"
        element={
          <RoleRoute allowed={['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER']}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route index element={<Navigate to="/master-data/styles" replace />} />
        <Route path="styles" element={<StyleListPage />} />
        <Route
          path="styles/new"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER']}>
              <StyleFormPage />
            </RoleRoute>
          }
        />
        <Route path="styles/:id" element={<StyleDetailPage />} />
        <Route
          path="styles/:id/edit"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER']}>
              <StyleFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="sizes"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER']}>
              <SizeListPage />
            </RoleRoute>
          }
        />
        <Route
          path="factories"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER', 'FACTORY_USER']}>
              <FactoryListPage />
            </RoleRoute>
          }
        />
        <Route
          path="distributors"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT']}>
              <DistributorListPage />
            </RoleRoute>
          }
        />
        <Route
          path="distributors/new"
          element={
            <RoleRoute allowed={['ADMIN']}>
              <DistributorFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="distributors/:id"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT']}>
              <DistributorDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="distributors/:id/edit"
          element={
            <RoleRoute allowed={['ADMIN']}>
              <DistributorFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="process-flows"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER']}>
              <ProcessFlowListPage />
            </RoleRoute>
          }
        />
        <Route
          path="process-flows/:id"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER']}>
              <ProcessFlowDetailPage />
            </RoleRoute>
          }
        />
      </Route>

      <Route
        path="/price-lists"
        element={
          <RoleRoute allowed={PRICE_LIST_VIEW_ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route index element={<PriceListListPage />} />
        <Route
          path="new"
          element={
            <RoleRoute allowed={PRICE_LIST_MANAGE_ROLES}>
              <PriceListFormPage />
            </RoleRoute>
          }
        />
        <Route path=":id" element={<PriceListDetailPage />} />
        <Route
          path=":id/edit"
          element={
            <RoleRoute allowed={PRICE_LIST_MANAGE_ROLES}>
              <PriceListFormPage />
            </RoleRoute>
          }
        />
      </Route>

      <Route
        path="/purchase-orders"
        element={
          <RoleRoute allowed={PO_VIEW_ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route
          index
          element={
            <RoleRoute allowed={PO_VIEW_ROLES}>
              <PurchaseOrderListPage />
            </RoleRoute>
          }
        />
        <Route
          path="new"
          element={
            <RoleRoute allowed={PO_MANAGE_ROLES}>
              <PurchaseOrderFormPage />
            </RoleRoute>
          }
        />
        <Route
          path=":id"
          element={
            <RoleRoute allowed={PO_VIEW_ROLES}>
              <PurchaseOrderDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path=":id/edit"
          element={
            <RoleRoute allowed={PO_MANAGE_ROLES}>
              <PurchaseOrderFormPage />
            </RoleRoute>
          }
        />
      </Route>

      <Route
        path="/job-orders"
        element={
          <RoleRoute allowed={JOB_ORDER_VIEW_ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route index element={<JobOrderListPage />} />
        <Route
          path="new"
          element={
            <RoleRoute allowed={JOB_ORDER_MANAGE_ROLES}>
              <JobOrderCreatePage />
            </RoleRoute>
          }
        />
        <Route path=":id" element={<JobOrderDetailPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
