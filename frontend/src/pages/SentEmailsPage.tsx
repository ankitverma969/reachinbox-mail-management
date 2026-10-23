import React, { useState, useEffect, useCallback } from 'react';
import {
  Send,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { api, type SentEmailItem, type PaginationMeta } from '../services/api.client';
import { useToast } from '../context/ToastContext';

export const SentEmailsPage: React.FC = () => {
  const { error: toastError } = useToast();

  const [emails, setEmails] = useState<SentEmailItem[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    totalRecords: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false
  });
  const [loading, setLoading] = useState<boolean>(true);

  const fetchSent = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.getSentEmails({ page, limit: 10 });
      setEmails(res.data);
      setPagination(res.pagination);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch sent emails';
      toastError('Fetch Error', message);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void fetchSent(1);

    const handleRefresh = () => {
      void fetchSent(1);
    };
    window.addEventListener('reachinbox:refresh', handleRefresh);
    return () => window.removeEventListener('reachinbox:refresh', handleRefresh);
  }, [fetchSent]);

  const formatSentTime = (dateStr: string | null) => {
    if (!dateStr) return '—';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center space-x-2">
            <span>Sent Emails</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
              {pagination.totalRecords}
            </span>
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Delivered outreach emails with Ethereal SMTP message previews & delivery confirmations
          </p>
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <p className="text-xs text-slate-500">Retrieving sent records from database...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Send className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No Sent Emails Found</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              As your scheduled campaigns reach their designated dispatch time, delivered messages will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4 sm:px-6">Recipient</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Sender</th>
                  <th className="py-3 px-4">Sent At</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ethereal Preview</th>
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

                    {/* Sender */}
                    <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400">
                      <span className="truncate block max-w-[150px]">{email.senderEmail}</span>
                    </td>

                    {/* Sent At */}
                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {formatSentTime(email.sentAt)}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      {email.status === 'SENT' ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5E9] dark:bg-emerald-950/60 text-[#2E7D32] dark:text-emerald-300 border border-[#C8E6C9] dark:border-emerald-800/60">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Delivered
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Failed
                        </span>
                      )}
                    </td>

                    {/* Preview Link */}
                    <td className="py-3.5 px-4 text-right">
                      {email.etherealPreviewUrl ? (
                        <a
                          href={email.etherealPreviewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center space-x-1 text-emerald-600 hover:text-emerald-700 hover:underline font-medium"
                        >
                          <span>View Email</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
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
                onClick={() => void fetchSent(pagination.page - 1)}
                disabled={!pagination.hasPreviousPage}
                className="p-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => void fetchSent(pagination.page + 1)}
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
