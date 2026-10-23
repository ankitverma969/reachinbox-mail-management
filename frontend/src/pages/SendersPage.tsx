import React, { useState, useEffect } from 'react';
import {
  Mail,
  Plus,
  Layers,
  Clock,
  Server,
  Lock,
  CheckCircle2,
  Loader2,
  X
} from 'lucide-react';
import { api, type SenderIdentityItem } from '../services/api.client';
import { useToast } from '../context/ToastContext';

export const SendersPage: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();

  const [senders, setSenders] = useState<SenderIdentityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // New sender state
  const [emailAddress, setEmailAddress] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [smtpHost, setSmtpHost] = useState('smtp.ethereal.email');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPasswordPlain, setSmtpPasswordPlain] = useState('');
  const [hourlyRateLimit, setHourlyRateLimit] = useState(50);
  const [minDelaySeconds, setMinDelaySeconds] = useState(2);

  const fetchSenders = async () => {
    setLoading(true);
    try {
      const data = await api.getSenders();
      setSenders(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch senders';
      toastError('Sender Error', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSenders();
  }, []);

  const handleCreateSender = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.createSender({
        emailAddress: emailAddress.trim(),
        displayName: displayName.trim(),
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort),
        smtpUsername: smtpUsername.trim(),
        smtpPasswordPlain: smtpPasswordPlain.trim(),
        hourlyRateLimit: Number(hourlyRateLimit),
        minDelaySeconds: Number(minDelaySeconds)
      });
      toastSuccess('Sender Created', `Identity ${emailAddress} is ready for outreach`);
      setModalOpen(false);
      setEmailAddress('');
      setDisplayName('');
      setSmtpUsername('');
      setSmtpPasswordPlain('');
      await fetchSenders();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create sender identity';
      toastError('Creation Failed', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center space-x-2">
            <span>Sender Identities</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
              {senders.length}
            </span>
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Configure SMTP credentials, distributed hourly rate limits, and dispatch throttle intervals
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs shadow-md shadow-emerald-700/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Sender Identity</span>
        </button>
      </div>

      {/* Senders Cards Grid */}
      {loading ? (
        <div className="p-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <p className="text-xs text-slate-500">Querying sender configurations...</p>
        </div>
      ) : senders.length === 0 ? (
        <div className="p-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-center flex flex-col items-center justify-center space-y-3">
          <Mail className="w-8 h-8 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No Sender Identities</h3>
          <p className="text-xs text-slate-500">Add an SMTP sender or let ReachInbox auto-provision a test sender.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {senders.map((s) => (
            <div
              key={s.id}
              className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-sm">
                    {s.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{s.displayName}</h3>
                    <p className="text-xs text-slate-500 truncate max-w-[170px]">{s.emailAddress}</p>
                  </div>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Active
                </span>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span className="flex items-center space-x-1.5">
                    <Server className="w-3.5 h-3.5 text-slate-400" />
                    <span>Host / Port:</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200">
                    {s.smtpHost}:{s.smtpPort}
                  </span>
                </div>

                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span className="flex items-center space-x-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    <span>Hourly Rate Limit:</span>
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{s.hourlyRateLimit} / hr</span>
                </div>

                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span className="flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Throttle Delay:</span>
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{s.minDelaySeconds}s delay</span>
                </div>

                <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                  <span className="flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                    <span>SMTP Password:</span>
                  </span>
                  <span className="font-mono text-slate-400 text-xs tracking-widest">{s.smtpPasswordMasked}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal to add sender */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>

            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Mail className="w-5 h-5 text-emerald-600" />
              <span>Register New Sender Identity</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Credentials are encrypted at rest; secrets are never returned in cleartext.
            </p>

            <form onSubmit={handleCreateSender} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Support Outreach"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="support@example.com"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SMTP Host
                  </label>
                  <input
                    type="text"
                    required
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SMTP Port
                  </label>
                  <input
                    type="number"
                    required
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SMTP Username
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="user@example.com"
                    value={smtpUsername}
                    onChange={(e) => setSmtpUsername(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    SMTP Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={smtpPasswordPlain}
                    onChange={(e) => setSmtpPasswordPlain(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Hourly Limit (req/hr)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={hourlyRateLimit}
                    onChange={(e) => setHourlyRateLimit(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Min Send Delay (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minDelaySeconds}
                    onChange={(e) => setMinDelaySeconds(Number(e.target.value))}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Sender'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
