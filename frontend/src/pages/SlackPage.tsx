import React, { useState, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  Send,
  Trash2,
  Loader2,
  ShieldAlert
} from 'lucide-react';
import { api, type SlackStatus } from '../services/api.client';
import { useToast } from '../context/ToastContext';

export const SlackPage: React.FC = () => {
  const { success: toastSuccess, error: toastError } = useToast();

  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await api.getSlackStatus();
      setStatus(res);
    } catch {
      setStatus({ isConnected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const handleConnect = () => {
    // Redirect to Slack OAuth authorization URL
    window.location.href = api.getSlackAuthorizeUrl();
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await api.disconnectSlack();
      toastSuccess('Slack Disconnected', 'Your Slack workspace has been disconnected.');
      await fetchStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect Slack';
      toastError('Disconnect Failed', message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSendTestNotification = async () => {
    setIsSendingTest(true);
    try {
      const res = await api.sendSlackTestNotification();
      toastSuccess('Test Notification Dispatched', res.message || 'Check your Slack channel!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Test alert failed';
      toastError('Slack Alert Error', message);
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center space-x-2">
          <span>Slack OAuth Integration</span>
        </h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Receive real-time notifications for rate-limit throttle events and delivery anomalies
        </p>
      </div>

      {/* Main Status Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm max-w-2xl space-y-6">
        {loading ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <p className="text-xs text-slate-500">Checking workspace integration state...</p>
          </div>
        ) : status?.isConnected ? (
          /* Connected State */
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Workspace Connected</h3>
                  <p className="text-xs text-slate-500">
                    Routing alerts to{' '}
                    <strong className="text-emerald-600 dark:text-emerald-400">
                      {status.defaultChannelName || status.defaultChannelId || 'Default Channel'}
                    </strong>
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                Active
              </span>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Workspace / Team:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">{status.teamName || 'Slack Team'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Target Channel ID:</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  {status.defaultChannelId || 'Configured via Bot'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Security Credentials:</span>
                <span className="text-slate-400 italic">Encrypted (AES-256-GCM)</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleSendTestNotification}
                disabled={isSendingTest}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center space-x-2 shadow-sm transition-all disabled:opacity-50"
              >
                {isSendingTest ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending Test...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Test Notification</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleConnect}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center space-x-2 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reconnect</span>
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="px-4 py-2.5 rounded-xl text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold flex items-center space-x-2 transition-all disabled:opacity-50 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        ) : (
          /* Disconnected State */
          <div className="space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                <Bell className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">No Slack Workspace Connected</h3>
                <p className="text-xs text-slate-500">
                  Connect your team Slack to receive real-time notifications when hourly limits defer email jobs
                </p>
              </div>
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start space-x-3 text-xs text-amber-800 dark:text-amber-200">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
              <div>
                <p className="font-semibold">OAuth 2.0 Security Note</p>
                <p className="mt-0.5 opacity-90">
                  ReachInbox uses official Slack OAuth 2.0 token exchange. Tokens are never exposed to browser memory.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConnect}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#4A154B] hover:bg-[#3F103F] text-white font-semibold text-xs flex items-center justify-center space-x-2 shadow-md shadow-[#4A154B]/20 transition-all hover:scale-[1.01]"
            >
              {/* Slack SVG icon */}
              <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
              </svg>
              <span>Connect Slack Workspace</span>
              <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
