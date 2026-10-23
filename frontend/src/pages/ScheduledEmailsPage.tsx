import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { api, type ScheduledEmailItem, type PaginationMeta } from '../services/api.client';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useToast } from '../context/ToastContext';

export const ScheduledEmailsPage: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();

  const [emails, setEmails] = useState<ScheduledEmailItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    totalRecords: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [emailToCancel, setEmailToCancel] = useState<ScheduledEmailItem | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  const fetchScheduled = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.getScheduledEmails({ page, limit: 10 });
      setEmails(res.data);
      setPagination(res.pagination);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch scheduled emails';
      toastError('Fetch Error', message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void fetchScheduled(1);

    const handleRefresh = () => {
      void fetchScheduled(1);
    };
    window.addEventListener('reachinbox:refresh', handleRefresh);
    return () => window.removeEventListener('reachinbox:refresh', handleRefresh);
  }, [fetchScheduled]);

  const handleConfirmCancel = async () => {
    if (!emailToCancel) return;
    setIsCancelling(true);
    try {
      await api.cancelScheduledEmail(emailToCancel.id);
      toastSuccess('Job Cancelled', `Scheduled email to ${emailToCancel.recipientEmail} has been cancelled.`);
      setEmailToCancel(null);
      await fetchScheduled(pagination.page);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Cancellation failed';
      toastError('Cancellation Error', message);
    } finally {
      setIsCancelling(false);
    }
  };

  const formatScheduledTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const isToday = new Date().toDateString() === date.toDateString();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = tomorrow.toDateString() === date.toDateString();

      const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      if (isToday) return `Today at ${timePart}`;
      if (isTomorrow) return `Tomorrow at ${timePart}`;
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timePart}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Cancellation Modal */}
      <ConfirmationModal
        isOpen={!!emailToCancel}
        title="Cancel Scheduled Email?"
        message={`Are you sure you want to cancel the scheduled email to "${emailToCancel?.recipientEmail}"? This will permanently remove the delayed job from the BullMQ Redis queue and mark it CANCELLED in PostgreSQL.`}
        confirmLabel="Cancel Email Job"
        isDestructive={true}
        isLoading={isCancelling}
        onConfirm={() => void handleConfirmCancel()}
        onCancel={() => setEmailToCancel(null)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center space-x-2">
            <span>Scheduled Emails</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold">
              {pagination.totalRecords}
            </span>
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active email delivery jobs queued in BullMQ and scheduled for delayed dispatch
          </p>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <p className="text-xs text-slate-500">Querying scheduled jobs from PostgreSQL & Redis...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No Scheduled Emails</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              You don&rsquo;t have any pending emails in the schedule queue. Click &ldquo;Compose&rdquo; to launch your outreach campaign.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">Recipient</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Scheduled For</th>
                  <th className="py-3 px-4">Sender</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {emails.map((email) => (
                  <tr
                    key={email.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    {/* Recipient */}
                    <td className="py-3.5 px-4 sm:px-6 font-medium text-slate-900 dark:text-white">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center font-bold text-[10px]">
                          {email.recipientEmail.charAt(0).toUpperCase()}
                        </div>
                        <span className="truncate max-w-[180px]">{email.recipientEmail}</span>
                      </div>
                    </td>

                    {/* Subject */}
                    <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300">
                      <span className="truncate block max-w-[220px] font-medium" title={email.subject}>
                        {email.subject}
                      </span>
                    </td>

                    {/* Scheduled For (Figma Amber Pill with Clock) */}
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#FFF3E0] dark:bg-amber-950/60 text-[#E65100] dark:text-amber-300 border border-[#FFE0B2] dark:border-amber-800/60">
                        <Clock className="w-3 h-3 mr-1 flex-shrink-0" />
                        {formatScheduledTime(email.scheduledAt)}
                      </span>
                    </td>

                    {/* Sender */}
                    <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                      <span className="truncate block max-w-[150px]">{email.senderEmail}</span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      {email.status === 'RATE_LIMITED_RESCHEDULED' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          Rate Limited
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Queued
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setEmailToCancel(email)}
                        title="Cancel Scheduled Job"
                        className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors border border-rose-200/60 dark:border-rose-900/40"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        <span>Cancel</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-xs text-slate-500">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.totalRecords} total)
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => void fetchScheduled(pagination.page - 1)}
                disabled={!pagination.hasPreviousPage}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => void fetchScheduled(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
