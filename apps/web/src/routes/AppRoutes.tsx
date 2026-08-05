import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLES } from '@erve/types';
import { DashboardPage } from '../pages/DashboardPage.js';
import { ForbiddenPage } from '../pages/ForbiddenPage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { DistributorDetailPage } from '../pages/master-data/DistributorDetailPage.js';
import { DistributorFormPage } from '../pages/master-data/DistributorFormPage.js';
import { DistributorListPage } from '../pages/master-data/DistributorListPage.js';
import { FactoryListPage } from '../pages/master-data/FactoryListPage.js';
import { FactoryDetailPage } from '../pages/master-data/FactoryDetailPage.js';
import { FactoryFormPage } from '../pages/master-data/FactoryFormPage.js';
import { ProcessFlowDetailPage } from '../pages/master-data/ProcessFlowDetailPage.js';
import { ProcessFlowCreatePage } from '../pages/master-data/ProcessFlowCreatePage.js';
import { ProcessFlowListPage } from '../pages/master-data/ProcessFlowListPage.js';
import { ProcessFlowVersionEditorPage } from '../pages/master-data/ProcessFlowVersionEditorPage.js';
import { SizeListPage } from '../pages/master-data/SizeListPage.js';
import { SizeDetailPage } from '../pages/master-data/SizeDetailPage.js';
import { SizeFormPage } from '../pages/master-data/SizeFormPage.js';
import { StyleDetailPage } from '../pages/master-data/StyleDetailPage.js';
import { StyleFormPage } from '../pages/master-data/StyleFormPage.js';
import { StyleListPage } from '../pages/master-data/StyleListPage.js';
import { UserDetailPage } from '../pages/users/UserDetailPage.js';
import { UserFormPage } from '../pages/users/UserFormPage.js';
import { UserListPage } from '../pages/users/UserListPage.js';
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
import { QaDetailPage } from '../pages/qa/QaDetailPage.js';
import { QaQueuePage } from '../pages/qa/QaQueuePage.js';

import {
  DISTRIBUTOR_VIEW_ROLES,
  FACTORY_VIEW_ROLES,
  FACTORY_MANAGE_ROLES,
  JOB_ORDER_CREATE_ROLES,
  JOB_ORDER_VIEW_ROLES,
  PRICE_LIST_MANAGE_ROLES,
  PRICE_LIST_VIEW_ROLES,
  PROCESS_FLOW_MANAGE_ROLES,
  PURCHASE_ORDER_MANAGE_ROLES,
  PURCHASE_ORDER_VIEW_ROLES,
  QA_VIEW_ROLES,
  SIZE_MANAGE_ROLES,
  STYLE_VIEW_ROLES,
  USER_MANAGE_ROLES,
} from '../auth/permissions.js';

const MASTER_DATA_ROUTE_ROLES = ['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER'] as const;

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
          <RoleRoute allowed={MASTER_DATA_ROUTE_ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route index element={<Navigate to="/master-data/styles" replace />} />
        <Route path="styles" element={<StyleListPage />} />
        <Route
          path="styles/new"
          element={
            <RoleRoute allowed={STYLE_VIEW_ROLES}>
              <StyleFormPage />
            </RoleRoute>
          }
        />
        <Route path="styles/:id" element={<StyleDetailPage />} />
        <Route
          path="styles/:id/edit"
          element={
            <RoleRoute allowed={STYLE_VIEW_ROLES}>
              <StyleFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="sizes"
          element={
            <RoleRoute allowed={SIZE_MANAGE_ROLES}>
              <SizeListPage />
            </RoleRoute>
          }
        />
        <Route
          path="sizes/:id"
          element={
            <RoleRoute allowed={SIZE_MANAGE_ROLES}>
              <SizeDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="sizes/:id/edit"
          element={
            <RoleRoute allowed={SIZE_MANAGE_ROLES}>
              <SizeFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="factories"
          element={
            <RoleRoute allowed={FACTORY_VIEW_ROLES}>
              <FactoryListPage />
            </RoleRoute>
          }
        />
        <Route
          path="factories/:id"
          element={
            <RoleRoute allowed={FACTORY_VIEW_ROLES}>
              <FactoryDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="factories/:id/edit"
          element={
            <RoleRoute allowed={FACTORY_MANAGE_ROLES}>
              <FactoryFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="distributors"
          element={
            <RoleRoute allowed={DISTRIBUTOR_VIEW_ROLES}>
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
            <RoleRoute allowed={DISTRIBUTOR_VIEW_ROLES}>
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
          path="users"
          element={
            <RoleRoute allowed={USER_MANAGE_ROLES}>
              <UserListPage />
            </RoleRoute>
          }
        />
        <Route
          path="users/new"
          element={
            <RoleRoute allowed={USER_MANAGE_ROLES}>
              <UserFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="users/:id"
          element={
            <RoleRoute allowed={USER_MANAGE_ROLES}>
              <UserDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="users/:id/edit"
          element={
            <RoleRoute allowed={USER_MANAGE_ROLES}>
              <UserFormPage />
            </RoleRoute>
          }
        />
        <Route
          path="process-flows"
          element={
            <RoleRoute allowed={PROCESS_FLOW_MANAGE_ROLES}>
              <ProcessFlowListPage />
            </RoleRoute>
          }
        />
        <Route
          path="process-flows/new"
          element={
            <RoleRoute allowed={PROCESS_FLOW_MANAGE_ROLES}>
              <ProcessFlowCreatePage />
            </RoleRoute>
          }
        />
        <Route
          path="process-flows/:id"
          element={
            <RoleRoute allowed={PROCESS_FLOW_MANAGE_ROLES}>
              <ProcessFlowDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="process-flow-versions/:versionId/edit"
          element={
            <RoleRoute allowed={PROCESS_FLOW_MANAGE_ROLES}>
              <ProcessFlowVersionEditorPage />
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
          <RoleRoute allowed={PURCHASE_ORDER_VIEW_ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route
          index
          element={
            <RoleRoute allowed={PURCHASE_ORDER_VIEW_ROLES}>
              <PurchaseOrderListPage />
            </RoleRoute>
          }
        />
        <Route
          path="new"
          element={
            <RoleRoute allowed={PURCHASE_ORDER_MANAGE_ROLES}>
              <PurchaseOrderFormPage />
            </RoleRoute>
          }
        />
        <Route
          path=":id"
          element={
            <RoleRoute allowed={PURCHASE_ORDER_VIEW_ROLES}>
              <PurchaseOrderDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path=":id/edit"
          element={
            <RoleRoute allowed={PURCHASE_ORDER_MANAGE_ROLES}>
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
            <RoleRoute allowed={JOB_ORDER_CREATE_ROLES}>
              <JobOrderCreatePage />
            </RoleRoute>
          }
        />
        <Route path=":id" element={<JobOrderDetailPage />} />
      </Route>
      <Route
        path="/qa"
        element={
          <RoleRoute allowed={QA_VIEW_ROLES}>
            <AppLayout />
          </RoleRoute>
        }
      >
        <Route index element={<QaQueuePage />} />
        <Route path=":id" element={<QaDetailPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
