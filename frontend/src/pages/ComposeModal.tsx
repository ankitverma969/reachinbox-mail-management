import React, { useState, useEffect } from 'react';
import { X, Send, Calendar, Clock, Layers, AlertCircle, Loader2 } from 'lucide-react';
import { api, type SenderIdentityItem } from '../services/api.client';
import { LeadUploadDropzone } from '../components/LeadUploadDropzone';
import { type LeadParseResult } from '../utils/csv-parser.util';
import { useToast } from '../context/ToastContext';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { success: toastSuccess, error: toastError } = useToast();

  const [senders, setSenders] = useState<SenderIdentityItem[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [parseStats, setParseStats] = useState<LeadParseResult | null>(null);

  // Send Later configuration
  const [isSendLater, setIsSendLater] = useState<boolean>(true);
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    // Default to 10 minutes in the future formatted for datetime-local
    const future = new Date(Date.now() + 10 * 60 * 1000);
    const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [delayBetweenEmails, setDelayBetweenEmails] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(100);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [loadingSenders, setLoadingSenders] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      void loadSenders();
    }
  }, [isOpen]);

  const loadSenders = async () => {
    setLoadingSenders(true);
    try {
      const list = await api.getSenders();
      setSenders(list);
      if (list.length > 0) {
        setSelectedSenderId(list[0].id);
        setHourlyLimit(list[0].hourlyRateLimit || 100);
        setDelayBetweenEmails(list[0].minDelaySeconds || 2);
      }
    } catch {
      toastError('Sender Error', 'Failed to retrieve active sender identities');
    } finally {
      setLoadingSenders(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedSenderId) {
      toastError('Validation Error', 'Please select a sender identity');
      return;
    }
    if (!subject.trim()) {
      toastError('Validation Error', 'Please specify an email subject');
      return;
    }
    if (!body.trim()) {
      toastError('Validation Error', 'Email body cannot be empty');
      return;
    }
    if (recipients.length === 0) {
      toastError('Validation Error', 'At least one valid recipient email is required');
      return;
    }

    const scheduledDateObj = new Date(scheduledDate);
    if (isSendLater && scheduledDateObj.getTime() < Date.now() - 30000) {
      toastError('Validation Error', 'Scheduled time cannot be in the past');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.scheduleCampaign({
        senderId: selectedSenderId,
        subject: subject.trim(),
        body: body.trim(),
        recipients,
        scheduledAt: isSendLater ? scheduledDateObj.toISOString() : new Date().toISOString(),
        delayBetweenEmails: Number(delayBetweenEmails),
        hourlyLimit: Number(hourlyLimit)
      });

      toastSuccess(
        'Campaign Scheduled Successfully',
        `Queued ${result.totalScheduled} email(s) under batch ${result.batchId.slice(0, 8)}...`
      );

      // Reset and close
      setSubject('');
      setBody('');
      setRecipients([]);
      setParseStats(null);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to schedule campaign';
      toastError('Scheduling Failed', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 dark:border-slate-800 my-8 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 rounded-lg">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Compose & Schedule Campaign</h2>
              <p className="text-xs text-slate-500">Persisted in PostgreSQL & distributed via BullMQ</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Sender Identity */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              From (Sender Identity)
            </label>
            {loadingSenders ? (
              <div className="flex items-center space-x-2 text-xs text-slate-400 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span>Loading sender identities...</span>
              </div>
            ) : senders.length === 0 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center space-x-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>No senders provisioned yet. A default test sender will be created automatically.</span>
              </div>
            ) : (
              <select
                value={selectedSenderId}
                onChange={(e) => {
                  setSelectedSenderId(e.target.value);
                  const found = senders.find((s) => s.id === e.target.value);
                  if (found) {
                    setHourlyLimit(found.hourlyRateLimit);
                    setDelayBetweenEmails(found.minDelaySeconds);
                  }
                }}
                className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName} ({s.emailAddress}) &bull; limit: {s.hourlyRateLimit}/hr
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Lead CSV & Recipient Ingest */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Recipients & Leads
            </label>
            <LeadUploadDropzone
              recipients={recipients}
              onChange={setRecipients}
              parseStats={parseStats}
              setParseStats={setParseStats}
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Subject
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Scaling outreach with ReachInbox Email Scheduler"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Message Body
            </label>
            <textarea
              required
              rows={4}
              placeholder="Write your email body or announcement..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-sans"
            />
          </div>

          {/* Schedule Controls */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-800/40 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Send Later / Schedule</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSendLater}
                  onChange={(e) => setIsSendLater(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:bg-slate-700 peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {isSendLater && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Start Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full text-xs px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    <Clock className="w-3 h-3 inline mr-1 text-slate-400" />
                    Delay Between Sends (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    value={delayBetweenEmails}
                    onChange={(e) => setDelayBetweenEmails(Number(e.target.value))}
                    className="w-full text-xs px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    <Layers className="w-3 h-3 inline mr-1 text-slate-400" />
                    Hourly Limit (req/hr)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(Number(e.target.value))}
                    className="w-full text-xs px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || recipients.length === 0}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Submitting to Queue...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Schedule {recipients.length > 0 ? `${recipients.length} Emails` : ''}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
