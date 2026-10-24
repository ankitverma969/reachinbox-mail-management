import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Star, Trash2, ChevronDown, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api.client';
import { useToast } from '../context/ToastContext';
import { formatDetailFullDate } from '../utils/date-formatter.util';
import { sanitizeEmailHtml } from '../utils/html-sanitizer.util';

interface EmailDetailData {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  senderEmail: string;
  senderName: string;
  scheduledAt?: string;
  sentAt?: string;
  status: string;
  messageId?: string | null;
  previewUrl?: string | null;
  createdAt: string;
}

export const EmailDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [email, setEmail] = useState<EmailDetailData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isStarred, setIsStarred] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('No email ID provided');
      setLoading(false);
      return;
    }

    const fetchEmailDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getEmailById(id);
        setEmail(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to fetch email details';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void fetchEmailDetail();
  }, [id]);

  const handleDeleteOrCancel = async () => {
    if (!email) return;
    try {
      if (email.status === 'SCHEDULED' || email.status === 'RATE_LIMITED_RESCHEDULED') {
        await api.cancelScheduledEmail(email.id);
        toastSuccess('Job Cancelled', 'Scheduled email was successfully cancelled');
      } else {
        toastSuccess('Removed', 'Email view closed');
      }
      window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
      navigate(-1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      toastError('Error', message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-slate-900 font-sans antialiased px-8 py-16 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        <p className="text-xs text-slate-400">Loading email details...</p>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="min-h-screen bg-white text-slate-900 font-sans antialiased px-8 py-16 max-w-xl mx-auto text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Email Not Found</h2>
        <p className="text-xs text-slate-500">{error || 'The requested email could not be located in database records.'}</p>
        <button
          onClick={() => navigate('/dashboard/scheduled')}
          className="px-4 py-2 rounded-full bg-[#2E7D32] text-white text-xs font-semibold hover:bg-[#1B5E20] transition-colors"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  const senderInitial = (email.senderName || email.senderEmail || 'S').charAt(0).toUpperCase();
  const dateFormatted = formatDetailFullDate(email.sentAt || email.scheduledAt || email.createdAt);

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans antialiased px-8 py-6">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-100">
        {/* Left: Back button + Subject */}
        <div className="flex items-center space-x-3.5 min-w-0 flex-1 pr-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1 text-slate-700 hover:text-slate-900 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[17px] font-semibold text-slate-900 tracking-tight truncate">
            {email.subject}
          </h1>

          {/* Status Badge */}
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
              email.status === 'SENT'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                : email.status === 'SCHEDULED'
                ? 'bg-amber-50 text-amber-700 border border-amber-200/60'
                : email.status === 'FAILED'
                ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {email.status}
          </span>
        </div>

        {/* Right Action Icons: Star, Ethereal Link, Trash, Avatar */}
        <div className="flex items-center space-x-3 text-slate-400 flex-shrink-0">
          {email.previewUrl && (
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-1 px-3 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-full transition-colors"
              title="Open raw Ethereal SMTP message"
            >
              <span>View Ethereal Preview</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          <button
            type="button"
            onClick={() => setIsStarred(!isStarred)}
            className="p-1 hover:text-amber-400 transition-colors"
            title="Star email"
          >
            <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
          </button>

          <button
            type="button"
            onClick={() => void handleDeleteOrCancel()}
            className="p-1 hover:text-rose-500 transition-colors"
            title={email.status === 'SCHEDULED' ? 'Cancel scheduled job' : 'Back'}
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* User profile avatar */}
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt="Profile"
              className="w-7 h-7 rounded-full object-cover ml-1"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs ml-1">
              {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Main Email Content */}
      <div className="max-w-4xl pt-6 pl-4 space-y-6">
        {/* Sender Header Block */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              {senderInitial}
            </div>
            <div>
              <div className="flex items-center space-x-1.5 flex-wrap">
                <span className="font-semibold text-sm text-slate-900">
                  {email.senderName}
                </span>
                <span className="text-xs text-slate-400">
                  &lt;{email.senderEmail}&gt;
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailsOpen(!detailsOpen)}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center space-x-1 mt-0.5"
              >
                <span>to {email.recipientEmail}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500 font-normal">
            {dateFormatted}
          </div>
        </div>

        {/* Expandable Technical Details */}
        {detailsOpen && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1 text-slate-600 font-mono animate-fade-in">
            <p><strong className="font-semibold text-slate-700">Message ID:</strong> {email.messageId || 'Pending dispatch'}</p>
            <p><strong className="font-semibold text-slate-700">Recipient:</strong> {email.recipientEmail}</p>
            <p><strong className="font-semibold text-slate-700">Sender Identity:</strong> {email.senderEmail}</p>
            <p><strong className="font-semibold text-slate-700">Created:</strong> {email.createdAt}</p>
            {email.scheduledAt && <p><strong className="font-semibold text-slate-700">Scheduled For:</strong> {email.scheduledAt}</p>}
            {email.sentAt && <p><strong className="font-semibold text-slate-700">Delivered At:</strong> {email.sentAt}</p>}
          </div>
        )}

        {/* Dynamic Email Body & Attachments */}
        <div className="text-sm text-slate-800 leading-relaxed font-normal pt-2">
          {(() => {
            const rawBody = email.body || '';
            const attachmentSplitRegex = /(<div[\s\S]*?(?:Attached Documents|📎)[\s\S]*?<\/div>)/i;
            const parts = rawBody.split(attachmentSplitRegex);

            if (parts.length > 1) {
              return (
                <div className="space-y-4">
                  {parts.map((part, index) => {
                    if (!part.trim()) return null;
                    if (attachmentSplitRegex.test(part)) {
                      return (
                        <div
                          key={index}
                          className="rounded-lg overflow-hidden animate-fade-in"
                          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(part) }}
                        />
                      );
                    }
                    return (
                      <div key={index} className="whitespace-pre-wrap leading-relaxed text-slate-800">
                        {part.trim()}
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Generic HTML email body
            if (/<[a-z][\s\S]*>/i.test(rawBody)) {
              return (
                <div
                  className="leading-relaxed text-slate-800 space-y-3"
                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(rawBody) }}
                />
              );
            }

            // Default plain text email body
            return (
              <div className="whitespace-pre-wrap leading-relaxed text-slate-800">
                {rawBody}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
