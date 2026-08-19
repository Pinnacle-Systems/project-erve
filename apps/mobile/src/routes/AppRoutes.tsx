import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLES } from '@erve/types';
import { DashboardPage } from '../pages/DashboardPage.js';
import { AuthenticatedShell } from '../shell/AuthenticatedShell.js';
import { RoleRoute } from './RoleRoute.js';
import { LoginRoute } from './LoginRoute.js';
import { FactoryTaskListPage } from '../pages/job-orders/FactoryTaskListPage.js';
import { FactoryTaskDetailPage } from '../pages/job-orders/FactoryTaskDetailPage.js';
import { FactoryReworkPage } from '../pages/qa/FactoryReworkPage.js';
import { QaInspectionPage } from '../pages/qa/QaInspectionPage.js';
import { QaQueuePage } from '../pages/qa/QaQueuePage.js';
import { useAuth } from '../auth/AuthContext.js';
import { OperationalJobOrderListPage } from '../pages/job-orders/OperationalJobOrderListPage.js';
import { QA_OPERATION_ROLES } from '@erve/shared';
import { QualityExecutionPage } from '../pages/qa/QualityExecutionPage.js';

const QA_ROUTE_ROLES = [...QA_OPERATION_ROLES, 'MERCHANDISER'] as const;

function DashboardRoute() {
  const { user } = useAuth();
  return user ? <DashboardPage user={user} /> : null;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        element={
          <RoleRoute allowed={ROLES}>
            <AuthenticatedShell />
          </RoleRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardRoute />} />
        <Route
          path="/factory-tasks"
          element={
            <RoleRoute allowed={['FACTORY_USER']}>
              <FactoryTaskListPage />
            </RoleRoute>
          }
        />
        <Route
          path="/job-orders"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER', 'QA_USER']}>
              <OperationalJobOrderListPage />
            </RoleRoute>
          }
        />
        <Route
          path="/job-orders/:id"
          element={
            <RoleRoute allowed={['ADMIN', 'MERCHANDISER', 'QA_USER']}>
              <FactoryTaskDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="/factory-tasks/:id"
          element={
            <RoleRoute allowed={['FACTORY_USER']}>
              <FactoryTaskDetailPage />
            </RoleRoute>
          }
        />
        <Route
          path="/factory-rework"
          element={
            <RoleRoute allowed={['FACTORY_USER', 'ADMIN', 'MERCHANDISER']}>
              <FactoryReworkPage />
            </RoleRoute>
          }
        />
        <Route
          path="/qa"
          element={
            <RoleRoute allowed={QA_ROUTE_ROLES}>
              <QaQueuePage />
            </RoleRoute>
          }
        />
        <Route
          path="/qa/:id"
          element={
            <RoleRoute allowed={QA_ROUTE_ROLES}>
              <QaInspectionPage />
            </RoleRoute>
          }
        />
        <Route
          path="/quality-executions/:executionId"
          element={
            <RoleRoute allowed={['ADMIN', 'QA_USER', 'MERCHANDISER', 'SENIOR_MANAGEMENT']}>
              <QualityExecutionPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
