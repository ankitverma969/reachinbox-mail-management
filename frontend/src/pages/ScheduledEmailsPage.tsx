import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Star, Trash2, Loader2, Calendar } from 'lucide-react';
import { api, type ScheduledEmailItem } from '../services/api.client';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useToast } from '../context/ToastContext';
import { formatDynamicScheduledDate } from '../utils/date-formatter.util';
import { formatEmailSnippet } from '../utils/html-sanitizer.util';

export const ScheduledEmailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();

  const [emails, setEmails] = useState<ScheduledEmailItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [emailToCancel, setEmailToCancel] = useState<ScheduledEmailItem | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const fetchScheduled = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getScheduledEmails({ page: 1, limit: 100 });
      setEmails(res.data || []);
    } catch {
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchScheduled();

    const handleRefresh = () => {
      void fetchScheduled();
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
      setEmails((prev) => prev.filter((item) => item.id !== emailToCancel.id));
      setEmailToCancel(null);
      window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Cancellation failed';
      toastError('Cancellation Error', message);
    } finally {
      setIsCancelling(false);
    }
  };

  const toggleStar = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatRecipient = (emailStr: string) => {
    if (!emailStr) return 'Recipient';
    const localPart = emailStr.split('@')[0];
    const formatted = localPart
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return formatted || emailStr;
  };

  return (
    <div className="w-full">
      {/* Cancellation Modal */}
      <ConfirmationModal
        isOpen={!!emailToCancel}
        title="Cancel Scheduled Email?"
        message={`Are you sure you want to cancel the scheduled email to "${emailToCancel?.recipientEmail}"? This will permanently remove the delayed dispatch job from the queue.`}
        confirmLabel="Cancel Email Job"
        isDestructive={true}
        isLoading={isCancelling}
        onConfirm={() => void handleConfirmCancel()}
        onCancel={() => setEmailToCancel(null)}
      />

      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-slate-400 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <span className="text-xs">Loading scheduled emails...</span>
        </div>
      ) : emails.length === 0 ? (
        <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
            <Calendar className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-800">No scheduled emails</p>
          <p className="text-xs text-slate-400 max-w-sm">
            When you schedule an outreach campaign, pending jobs and delayed delivery slots will appear here in real time.
          </p>
          <button
            onClick={() => navigate('/dashboard/compose')}
            className="mt-3 px-5 py-2 rounded-full border border-[#2E7D32] bg-white hover:bg-[#E8F5E9]/50 text-[#2E7D32] font-semibold text-xs transition-colors"
          >
            Compose New Email
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {emails.map((email) => (
            <div
              key={email.id}
              onClick={() => navigate(`/dashboard/email/${email.id}`)}
              className="py-3 px-1 flex items-center justify-between hover:bg-slate-50/50 transition-colors group cursor-pointer"
            >
              <div className="flex items-center space-x-4 min-w-0 flex-1 pr-4">
                {/* Recipient name (e.g. To: John Smith) */}
                <div className="w-36 sm:w-44 flex-shrink-0 text-sm font-semibold text-slate-900 truncate">
                  To: {formatRecipient(email.recipientEmail)}
                </div>

                {/* Scheduled Amber Pill with Clock Icon - Dynamic Date */}
                <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#FFF3E0] text-[#D9531E] border border-[#FFE0B2]/60 flex-shrink-0 font-mono">
                  <Clock className="w-3 h-3 text-[#D9531E]" />
                  <span>{formatDynamicScheduledDate(email.scheduledAt)}</span>
                </span>

                {/* Subject & Preview snippet */}
                <div className="flex items-center min-w-0 truncate text-sm">
                  <span className="font-semibold text-slate-900 truncate flex-shrink-0">
                    {email.subject}
                  </span>
                  {email.body && formatEmailSnippet(email.body) && (
                    <span className="text-slate-400 ml-1.5 truncate">
                      - {formatEmailSnippet(email.body)}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons on right: Cancel (on hover) + Star */}
              <div className="flex items-center space-x-2.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmailToCancel(email);
                  }}
                  title="Cancel scheduled email"
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 transition-opacity p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => toggleStar(email.id, e)}
                  className="text-slate-300 hover:text-amber-400 p-1 transition-colors"
                >
                  <Star
                    className={`w-4 h-4 ${
                      starredIds.has(email.id)
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-slate-300'
                    }`}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
