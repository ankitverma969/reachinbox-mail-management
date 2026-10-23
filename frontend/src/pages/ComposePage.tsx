import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  Upload,
  Undo2,
  Redo2,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  ChevronsUpDown,
  ListOrdered,
  List,
  Indent,
  Outdent,
  Quote,
  Code,
  Strikethrough
} from 'lucide-react';
import { api } from '../services/api.client';
import { parseLeadsContent } from '../utils/csv-parser.util';
import { useToast } from '../context/ToastContext';

export const ComposePage: React.FC = () => {
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string>('oliver.brown@domain.io');
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');

  // Mode: if true, show ingested lead chips (Screenshot 18), if false, show text input (Screenshot 17)
  const [showLeadChips, setShowLeadChips] = useState<boolean>(true);
  const [recipients, setRecipients] = useState<string[]>([
    'tame@jmail.com',
    'lame@jmail.com',
    'dame@jmail.com',
    'lead4@jmail.com',
    'lead5@jmail.com',
    'lead6@jmail.com',
    'lead7@jmail.com'
  ]);
  const [singleRecipient, setSingleRecipient] = useState<string>('');

  const [subject, setSubject] = useState<string>('');
  const [delayBetweenEmails, setDelayBetweenEmails] = useState<string>('00');
  const [hourlyLimit, setHourlyLimit] = useState<string>('00');
  const [body, setBody] = useState<string>('');

  // Send Later Popover state
  const [isSendLaterOpen, setIsSendLaterOpen] = useState<boolean>(false);
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('Tomorrow, 10:00 AM');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    void loadSenders();
  }, []);

  const loadSenders = async () => {
    try {
      const list = await api.getSenders();
      if (list.length > 0) {
        setSelectedSenderId(list[0].id);
        setSelectedSenderEmail(list[0].emailAddress);
      }
    } catch {
      // Fallback
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseLeadsContent(text);
      if (result.validEmails.length > 0) {
        setRecipients(result.validEmails);
        setShowLeadChips(true);
        toastSuccess('Leads Imported', `Successfully imported ${result.validEmails.length} recipients`);
      } else {
        toastError('Import Error', 'No valid email addresses found in CSV');
      }
    } catch {
      toastError('Import Error', 'Failed to read CSV file');
    }
  };

  const toggleLeadMode = () => {
    setShowLeadChips(!showLeadChips);
  };

  const handlePresetSelect = (presetLabel: string) => {
    setSelectedPreset(presetLabel);
    const target = new Date();
    target.setDate(target.getDate() + 1);

    if (presetLabel.includes('10:00 AM')) {
      target.setHours(10, 0, 0, 0);
    } else if (presetLabel.includes('11:00 AM')) {
      target.setHours(11, 0, 0, 0);
    } else if (presetLabel.includes('3:00 PM')) {
      target.setHours(15, 0, 0, 0);
    } else {
      target.setHours(9, 0, 0, 0);
    }

    const localISO = new Date(target.getTime() - target.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setScheduledDate(localISO);
  };

  const handleSendLater = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const targetRecipients = showLeadChips
      ? recipients
      : singleRecipient.trim() ? [singleRecipient.trim()] : [];

    if (targetRecipients.length === 0) {
      toastError('Validation Error', 'Please enter at least one recipient email or upload a list');
      return;
    }
    if (!subject.trim()) {
      toastError('Validation Error', 'Please enter an email subject');
      return;
    }
    if (!body.trim()) {
      toastError('Validation Error', 'Please write your email message');
      return;
    }

    setIsSubmitting(true);
    try {
      const scheduledAtIso = scheduledDate
        ? new Date(scheduledDate).toISOString()
        : new Date(Date.now() + 86400000).toISOString();

      await api.scheduleCampaign({
        senderId: selectedSenderId || 'default',
        subject: subject.trim(),
        body: body.trim(),
        recipients: targetRecipients,
        scheduledAt: scheduledAtIso,
        delayBetweenEmails: Number(delayBetweenEmails) || 0,
        hourlyLimit: Number(hourlyLimit) || 100
      });

      toastSuccess('Scheduled Successfully', `Campaign scheduled to ${targetRecipients.length} recipients`);
      window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
      navigate('/dashboard/scheduled');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Scheduling failed';
      toastError('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans antialiased relative px-8 py-6">
      {/* Hidden CSV file upload input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => void handleFileUpload(e)}
        accept=".csv,text/csv"
        className="hidden"
      />

      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-6">
        {/* Left: Back button + Title */}
        <div className="flex items-center space-x-3.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1 text-slate-700 hover:text-slate-900 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[17px] font-semibold text-slate-900 tracking-tight">
            Compose New Email
          </h1>
        </div>

        {/* Right: Green Attachment badge (1), Clock Schedule Icon, Send Later Outline Button */}
        <div className="flex items-center space-x-4">
          {/* Green Attachment Icon with Badge 1 */}
          <div className="flex items-center text-[#2E7D32] space-x-0.5 cursor-pointer" title="1 Attachment attached">
            <Paperclip className="w-4 h-4 transform rotate-45" />
            <span className="text-[11px] font-bold">1</span>
          </div>

          {/* Clock icon to toggle Send Later popover */}
          <button
            type="button"
            onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
            className={`p-1 transition-colors ${
              isSendLaterOpen ? 'text-[#2E7D32]' : 'text-slate-700 hover:text-slate-900'
            }`}
            title="Send Later Options"
          >
            <Clock className="w-4 h-4" />
          </button>

          {/* Send Later Button (exact match to Screenshot 17 & 18) */}
          <button
            type="button"
            onClick={() => void handleSendLater()}
            disabled={isSubmitting}
            className="rounded-full border border-[#2E7D32] text-[#2E7D32] bg-white hover:bg-[#E8F5E9]/50 px-5 py-1 text-sm font-medium transition-colors shadow-none disabled:opacity-50"
          >
            {isSubmitting ? 'Scheduling...' : 'Send Later'}
          </button>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="max-w-4xl space-y-4 pt-1">
        {/* From Row */}
        <div className="flex items-center">
          <label className="w-20 text-xs font-semibold text-slate-500">From</label>
          <div className="relative">
            <button
              type="button"
              className="bg-[#F4F5F6] text-xs font-medium text-slate-800 rounded-xl px-3.5 py-1.5 flex items-center space-x-2"
            >
              <span>{selectedSenderEmail}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* To Row (with Chips and 'Upload List' CTA) */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center space-x-2 flex-1 min-w-0 pr-4">
            <label className="w-20 text-xs font-semibold text-slate-500 flex-shrink-0">To</label>
            {showLeadChips ? (
              <div className="flex items-center flex-wrap gap-1.5">
                {/* First 3 ingested chips */}
                {recipients.slice(0, 3).map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]"
                  >
                    {email}
                  </span>
                ))}
                {/* Remainder badge (+4) */}
                {recipients.length > 3 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]">
                    +{recipients.length - 3}
                  </span>
                )}
              </div>
            ) : (
              <input
                type="text"
                value={singleRecipient}
                onChange={(e) => setSingleRecipient(e.target.value)}
                placeholder="recipient@example.com"
                className="flex-1 text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none bg-transparent"
              />
            )}
          </div>

          {/* Upload List CTA button */}
          <button
            type="button"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.click();
              } else {
                toggleLeadMode();
              }
            }}
            onDoubleClick={toggleLeadMode}
            className="text-[#2E7D32] hover:text-[#1B5E20] flex items-center space-x-1 text-xs font-medium transition-colors flex-shrink-0 cursor-pointer"
            title="Upload CSV lead list (click to upload, double click to toggle chips)"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload List</span>
          </button>
        </div>

        {/* Subject Row */}
        <div className="flex items-center border-b border-slate-100 pb-2.5">
          <label className="w-20 text-xs font-semibold text-slate-500">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none bg-transparent"
          />
        </div>

        {/* Delay & Limit Row */}
        <div className="flex items-center space-x-6 text-xs text-slate-700 py-1">
          <div className="flex items-center space-x-2">
            <span className="font-medium text-slate-800">Delay between 2 emails</span>
            <input
              type="text"
              value={delayBetweenEmails}
              onChange={(e) => setDelayBetweenEmails(e.target.value)}
              className="w-14 h-9 bg-[#F4F5F6] rounded-xl text-center text-xs font-mono border-none focus:outline-none"
            />
          </div>

          <div className="flex items-center space-x-2">
            <span className="font-medium text-slate-800">Hourly Limit</span>
            <input
              type="text"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              className="w-14 h-9 bg-[#F4F5F6] rounded-xl text-center text-xs font-mono border-none focus:outline-none"
            />
          </div>
        </div>

        {/* Rich Text Editor Container with Floating White Pill Toolbar */}
        <div className="mt-4 bg-[#F8F9FA] rounded-2xl p-4 border border-slate-100 min-h-[360px] flex flex-col">
          {/* White Pill Floating Toolbar matching Screenshots 17 & 18 */}
          <div className="bg-white rounded-full px-4 py-2 border border-slate-100 shadow-sm flex items-center flex-wrap gap-2.5 text-slate-400 mb-4 w-fit">
            <button type="button" className="p-0.5 hover:text-slate-600"><Undo2 className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><Redo2 className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-200 mx-0.5" />

            <button type="button" className="p-0.5 hover:text-slate-600"><Type className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600 font-bold"><Bold className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600 italic"><Italic className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600 underline"><Underline className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-200 mx-0.5" />

            <button type="button" className="p-0.5 hover:text-slate-600"><AlignLeft className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><ChevronsUpDown className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-200 mx-0.5" />

            <button type="button" className="p-0.5 hover:text-slate-600"><ListOrdered className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><List className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><Outdent className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><Indent className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-200 mx-0.5" />

            <button type="button" className="p-0.5 hover:text-slate-600"><Quote className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><Code className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-0.5 hover:text-slate-600"><Strikethrough className="w-3.5 h-3.5" /></button>
          </div>

          {/* Text Area */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type Your Reply..."
            rows={10}
            className="w-full flex-1 bg-transparent text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Attachment Card Thumbnail at Bottom-Left matching Figma Reference */}
        <div className="pt-2">
          <div className="w-36 rounded-xl overflow-hidden border border-slate-200/80 bg-white shadow-sm">
            <div className="h-20 bg-slate-100 overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=400&auto=format&fit=crop&q=80"
                alt="Attachment preview"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Send Later Popover (opened when clicking Clock icon) */}
      {isSendLaterOpen && (
        <div className="absolute top-16 right-8 w-72 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-5 z-50 animate-fade-in font-sans">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Send Later
          </h3>

          {/* Date & Time Picker */}
          <div className="relative mb-3">
            <input
              type="datetime-local"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full text-xs text-slate-700 placeholder-slate-400 border-b border-slate-200 pb-1.5 focus:outline-none"
            />
          </div>

          {/* Presets */}
          <div className="space-y-2.5 my-4 text-xs text-slate-600">
            {[
              'Tomorrow',
              'Tomorrow, 10:00 AM',
              'Tomorrow, 11:00 AM',
              'Tomorrow, 3:00 PM'
            ].map((preset) => (
              <div
                key={preset}
                onClick={() => handlePresetSelect(preset)}
                className={`cursor-pointer py-1 hover:text-slate-900 transition-colors ${
                  selectedPreset === preset ? 'font-medium text-slate-900' : ''
                }`}
              >
                {preset}
              </div>
            ))}
          </div>

          {/* Popover Footer Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsSendLaterOpen(false)}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setIsSendLaterOpen(false)}
              className="rounded-full border border-[#2E7D32] text-[#2E7D32] bg-white hover:bg-emerald-50 px-4 py-1 text-xs font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
