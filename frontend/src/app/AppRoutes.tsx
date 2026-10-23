import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { DashboardLayout } from '../layouts/DashboardLayout';
import { LoginPage } from '../pages/LoginPage';
import { ScheduledEmailsPage } from '../pages/ScheduledEmailsPage';
import { SentEmailsPage } from '../pages/SentEmailsPage';
import { SendersPage } from '../pages/SendersPage';
import { SlackPage } from '../pages/SlackPage';
import { ComposePage } from '../pages/ComposePage';
import { EmailDetailPage } from '../pages/EmailDetailPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Public Login Route */}
      <Route path="/login" element={<LoginPage />} />

      {/* Main Dashboard with Sidebar Navigation */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard/scheduled" replace />} />
        <Route path="scheduled" element={<ScheduledEmailsPage />} />
        <Route path="sent" element={<SentEmailsPage />} />
        <Route path="senders" element={<SendersPage />} />
        <Route path="slack" element={<SlackPage />} />
        <Route path="compose" element={<ComposePage />} />
        <Route path="email/:id" element={<EmailDetailPage />} />
      </Route>

      {/* Root Redirection */}
      <Route path="/" element={<Navigate to="/dashboard/scheduled" replace />} />
      <Route path="*" element={<Navigate to="/dashboard/scheduled" replace />} />
    </Routes>
  );
};
