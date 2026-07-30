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
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/factory-tasks"
          element={
            <RoleRoute allowed={['FACTORY_USER']}>
              <FactoryTaskListPage />
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
            <RoleRoute allowed={['FACTORY_USER']}>
              <FactoryReworkPage />
            </RoleRoute>
          }
        />
        <Route
          path="/qa"
          element={
            <RoleRoute allowed={['QA_USER', 'ADMIN', 'MERCHANDISER']}>
              <QaQueuePage />
            </RoleRoute>
          }
        />
        <Route
          path="/qa/:id"
          element={
            <RoleRoute allowed={['QA_USER', 'ADMIN', 'MERCHANDISER']}>
              <QaInspectionPage />
            </RoleRoute>
          }
        />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
