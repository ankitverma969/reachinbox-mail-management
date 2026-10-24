import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, ExternalLink, Loader2, Send } from 'lucide-react';
import { api, type SentEmailItem } from '../services/api.client';
import { formatDynamicSentDate } from '../utils/date-formatter.util';
import { formatEmailSnippet } from '../utils/html-sanitizer.util';

export const SentEmailsPage: React.FC = () => {
  const navigate = useNavigate();
  const [emails, setEmails] = useState<SentEmailItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const fetchSent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSentEmails({ page: 1, limit: 100 });
      setEmails(res.data || []);
    } catch {
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSent();

    const handleRefresh = () => {
      void fetchSent();
    };
    window.addEventListener('reachinbox:refresh', handleRefresh);
    return () => window.removeEventListener('reachinbox:refresh', handleRefresh);
  }, [fetchSent]);

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
      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-slate-400 space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
          <span className="text-xs">Loading sent emails...</span>
        </div>
      ) : emails.length === 0 ? (
        <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
            <Send className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-800">No sent emails yet</p>
          <p className="text-xs text-slate-400 max-w-sm">
            Emails dispatched by workers via Ethereal or SMTP will appear here along with live delivery timestamps.
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
                {/* Recipient name (e.g. To: Sarah Wilson) */}
                <div className="w-36 sm:w-44 flex-shrink-0 text-sm font-semibold text-slate-900 truncate">
                  To: {formatRecipient(email.recipientEmail)}
                </div>

                {/* Sent Green Pill */}
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]/60 flex-shrink-0 font-mono">
                  Sent · {formatDynamicSentDate(email.sentAt)}
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

              {/* Action Icons on right: Ethereal preview link (if available) + Star */}
              <div className="flex items-center space-x-2.5 flex-shrink-0">
                {email.etherealPreviewUrl && (
                  <a
                    href={email.etherealPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                    title="View in Ethereal Mail Viewer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
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
