import { Navigate, Route, Routes } from 'react-router-dom';
import { ROLES } from '@erve/types';
import { DashboardPage } from '../pages/DashboardPage.js';
import { LoginPage } from '../pages/LoginPage.js';
import { AuthenticatedShell } from '../shell/AuthenticatedShell.js';
import { RoleRoute } from './RoleRoute.js';
import { FactoryTaskListPage } from '../pages/job-orders/FactoryTaskListPage.js';
import { FactoryTaskDetailPage } from '../pages/job-orders/FactoryTaskDetailPage.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
