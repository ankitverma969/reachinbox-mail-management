import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, Archive, Trash2, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const EmailDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [isStarred, setIsStarred] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Email detail content matching Figma Screenshot (16) 1:1
  const emailData = {
    subject: 'Oliver, hello there! | MJWYT44 BM#52W01',
    senderName: 'Amanda Clark',
    senderEmail: 'sender@example.com',
    recipientEmail: 'oliver.brown@domain.io',
    dateFormatted: 'Nov 3, 10:23 AM',
    bodyText1: "Hey Oliver,",
    bodyText2: "You've just RECEIVED something",
    calloutLine1: "⚡ Extremely Exclusive—Only 4 Spots Worldwide Per Year | $25,000 investment ⚡",
    calloutLine2: '⚡ To explore securing your private transformation, simply reply right now with "FLY OUT FIX" .',
    closing1: "Your coach for world-class performance,",
    closing2: "Grant",
    psText: "P.S. Always remember that you can develop world class technique! 🚀",
    attachments: [
      {
        id: 'att-1',
        filename: 'Tennis_Coach_Profile.png',
        size: '1.2 MB',
        thumbnailUrl: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=500&auto=format&fit=crop&q=80'
      },
      {
        id: 'att-2',
        filename: 'Tennis_Coach_Profile2.png',
        size: '1.2 MB',
        thumbnailUrl: 'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=500&auto=format&fit=crop&q=80'
      }
    ]
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans antialiased px-8 py-6">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-6">
        {/* Left: Back button + Subject */}
        <div className="flex items-center space-x-3.5 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1 text-slate-700 hover:text-slate-900 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[17px] font-semibold text-slate-900 tracking-tight truncate">
            {emailData.subject}
          </h1>
        </div>

        {/* Right Action Icons: Star, Archive, Trash, Avatar */}
        <div className="flex items-center space-x-4 text-slate-400">
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
            className="p-1 hover:text-slate-600 transition-colors"
            title="Archive"
          >
            <Archive className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1 hover:text-rose-500 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* User profile avatar */}
          <img
            src={user?.avatarUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80"}
            alt="Profile"
            className="w-7 h-7 rounded-full object-cover ml-2"
          />
        </div>
      </div>

      {/* Main Email Content */}
      <div className="max-w-4xl pt-2 pl-8 space-y-6">
        {/* Sender Header Block */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            {/* Circular initial avatar: Green circle with letter 'A' */}
            <div className="w-9 h-9 rounded-full bg-[#4CAF50] text-white flex items-center justify-center font-bold text-sm">
              A
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-semibold text-sm text-slate-900">
                  {emailData.senderName}
                </span>
                <span className="text-xs text-slate-400">
                  &lt;{emailData.senderEmail}&gt;
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailsOpen(!detailsOpen)}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center space-x-1 mt-0.5"
              >
                <span>to me</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-400 font-normal">
            {emailData.dateFormatted}
          </div>
        </div>

        {/* Email Body */}
        <div className="space-y-4 text-sm text-slate-800 leading-relaxed font-normal pt-2">
          <p>{emailData.bodyText1}</p>
          <p>{emailData.bodyText2}</p>

          {/* Special Yellow Callout Banner */}
          <div className="bg-[#FFFDE7] border-l-4 border-[#FBC02D] p-4 rounded-r-lg space-y-2 text-xs text-slate-900 font-medium">
            <p className="font-bold">{emailData.calloutLine1}</p>
            <p>{emailData.calloutLine2}</p>
          </div>

          <p className="pt-2">{emailData.closing1}</p>
          <p className="font-medium">{emailData.closing2}</p>

          <p className="italic text-slate-700 pt-2">
            {emailData.psText}
          </p>
        </div>

        {/* Attachments Section */}
        <div className="pt-4 flex items-center space-x-4">
          {emailData.attachments.map((att) => (
            <div
              key={att.id}
              className="w-52 rounded-xl overflow-hidden border border-slate-200/80 bg-white hover:shadow-md transition-shadow cursor-pointer"
            >
              {/* Thumbnail */}
              <div className="h-28 bg-slate-100 overflow-hidden">
                <img
                  src={att.thumbnailUrl}
                  alt={att.filename}
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Info Bar */}
              <div className="p-2.5 bg-white">
                <p className="text-xs font-semibold text-slate-800 truncate" title={att.filename}>
                  {att.filename}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {att.size}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
