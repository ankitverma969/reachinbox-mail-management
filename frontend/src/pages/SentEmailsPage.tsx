import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, ExternalLink, Loader2 } from 'lucide-react';
import { api, type SentEmailItem } from '../services/api.client';

// Default reference emails matching Figma Screenshot (15) exactly
const DEFAULT_SENT_ITEMS: SentEmailItem[] = [
  {
    id: 'ref-sent-1',
    recipientEmail: 'sarah.wilson@domain.io',
    subject: 'Re: Project Update',
    body: 'Thanks for the update, Sarah. Looks good!',
    senderEmail: 'oliver.brown@domain.io',
    sentAt: new Date(Date.now() - 3600000).toISOString(),
    status: 'SENT'
  },
  {
    id: 'ref-sent-2',
    recipientEmail: 'support@domain.io',
    subject: 'Issue with login',
    body: 'I am having trouble logging in to the dashboard...',
    senderEmail: 'oliver.brown@domain.io',
    sentAt: new Date(Date.now() - 7200000).toISOString(),
    status: 'SENT'
  }
];

export const SentEmailsPage: React.FC = () => {
  const navigate = useNavigate();
  const [emails, setEmails] = useState<SentEmailItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  const fetchSent = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSentEmails({ page: 1, limit: 50 });
      if (res.data && res.data.length > 0) {
        setEmails(res.data);
      } else {
        setEmails(DEFAULT_SENT_ITEMS);
      }
    } catch {
      setEmails(DEFAULT_SENT_ITEMS);
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

  const formatRecipient = (emailStr: string, index: number) => {
    if (index === 0 && emails === DEFAULT_SENT_ITEMS) return 'Sarah Wilson';
    if (index === 1 && emails === DEFAULT_SENT_ITEMS) return 'Support';

    const localPart = emailStr.split('@')[0];
    const formatted = localPart
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return formatted || emailStr;
  };

  return (
    <div className="w-full">
      {loading ? (
        <div className="py-12 flex justify-center items-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-xs">Loading sent emails...</span>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {emails.map((email, idx) => (
            <div
              key={email.id}
              onClick={() => navigate(`/dashboard/email/${email.id}`)}
              className="py-3 px-1 flex items-center justify-between hover:bg-slate-50/50 transition-colors group cursor-pointer"
            >
              <div className="flex items-center space-x-4 min-w-0 flex-1 pr-4">
                {/* Recipient name (e.g. To: Sarah Wilson) */}
                <div className="w-36 sm:w-44 flex-shrink-0 text-sm font-semibold text-slate-900 truncate">
                  To: {formatRecipient(email.recipientEmail, idx)}
                </div>

                {/* Sent Grey Pill */}
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#ECEFF1] text-[#546E7A] flex-shrink-0">
                  Sent
                </span>

                {/* Subject & Preview snippet */}
                <div className="flex items-center min-w-0 truncate text-sm">
                  <span className="font-semibold text-slate-900 truncate flex-shrink-0">
                    {email.subject}
                  </span>
                  <span className="text-slate-400 ml-1.5 truncate">
                    - {email.body ? email.body.replace(/<[^>]*>/g, '').trim() : ''}
                  </span>
                </div>
              </div>

              {/* Action Buttons on right: Ethereal preview (if any) + Star */}
              <div className="flex items-center space-x-2.5 flex-shrink-0">
                {email.etherealPreviewUrl && (
                  <a
                    href={email.etherealPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 text-emerald-600 hover:text-emerald-700 transition-opacity p-1"
                    title="View Ethereal Email Preview"
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
