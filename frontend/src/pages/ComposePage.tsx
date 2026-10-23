import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  Undo2,
  Redo2,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  ListOrdered,
  List,
  Indent,
  Outdent,
  Quote,
  Code,
  Strikethrough
} from 'lucide-react';
import { api } from '../services/api.client';
import { useToast } from '../context/ToastContext';

export const ComposePage: React.FC = () => {
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();

  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string>('oliver.brown@domain.io');
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [recipient, setRecipient] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [delayBetweenEmails, setDelayBetweenEmails] = useState<number>(0);
  const [hourlyLimit, setHourlyLimit] = useState<number>(0);
  const [body, setBody] = useState<string>('');

  // Send Later Popover state
  const [isSendLaterOpen, setIsSendLaterOpen] = useState<boolean>(true); // default open matching user screenshot
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
        setHourlyLimit(list[0].hourlyRateLimit || 100);
        setDelayBetweenEmails(list[0].minDelaySeconds || 2);
      }
    } catch {
      // Fallback
    }
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

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!recipient.trim()) {
      toastError('Validation Error', 'Please enter a recipient email');
      return;
    }
    if (!subject.trim()) {
      toastError('Validation Error', 'Please specify a subject');
      return;
    }
    if (!body.trim()) {
      toastError('Validation Error', 'Email message cannot be empty');
      return;
    }

    setIsSubmitting(true);
    try {
      const scheduledAtIso = scheduledDate
        ? new Date(scheduledDate).toISOString()
        : new Date().toISOString();

      await api.scheduleCampaign({
        senderId: selectedSenderId || 'default',
        subject: subject.trim(),
        body: body.trim(),
        recipients: [recipient.trim()],
        scheduledAt: scheduledAtIso,
        delayBetweenEmails: Number(delayBetweenEmails) || 0,
        hourlyLimit: Number(hourlyLimit) || 100
      });

      toastSuccess('Scheduled Successfully', `Email scheduled to ${recipient}`);
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
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-6">
        {/* Left: Back button + Header title */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-1 text-slate-700 hover:text-slate-900 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold text-slate-900">
            Compose New Email
          </h1>
        </div>

        {/* Right: Attachment, Schedule Clock, and Send Pill Button */}
        <div className="flex items-center space-x-4">
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 transition-colors p-1"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
            className={`p-1 transition-colors ${isSendLaterOpen ? 'text-[#2E7D32]' : 'text-slate-400 hover:text-slate-600'}`}
            title="Send Later"
          >
            <Clock className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isSubmitting}
            className="rounded-full border border-[#2E7D32] text-[#2E7D32] bg-white hover:bg-[#E8F5E9]/50 px-6 py-1 text-sm font-medium transition-colors shadow-none disabled:opacity-50"
          >
            {isSubmitting ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>

      {/* Main Email Form Fields */}
      <div className="max-w-4xl space-y-4 pt-1">
        {/* From Field */}
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

        {/* To Field */}
        <div className="flex items-center border-b border-slate-100 pb-2">
          <label className="w-20 text-xs font-semibold text-slate-500">To</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="recipient@example.com"
            className="flex-1 text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none bg-transparent"
          />
        </div>

        {/* Subject Field */}
        <div className="flex items-center border-b border-slate-100 pb-2">
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
              type="number"
              value={delayBetweenEmails === 0 ? '00' : delayBetweenEmails}
              onChange={(e) => setDelayBetweenEmails(Number(e.target.value))}
              className="w-14 h-9 bg-[#F4F5F6] rounded-xl text-center text-xs font-medium border-none focus:outline-none"
            />
          </div>

          <div className="flex items-center space-x-2">
            <span className="font-medium text-slate-800">Hourly Limit</span>
            <input
              type="number"
              value={hourlyLimit === 0 ? '00' : hourlyLimit}
              onChange={(e) => setHourlyLimit(Number(e.target.value))}
              className="w-14 h-9 bg-[#F4F5F6] rounded-xl text-center text-xs font-medium border-none focus:outline-none"
            />
          </div>
        </div>

        {/* Rich Text Editor Container */}
        <div className="mt-4 bg-[#F8F9FA] rounded-2xl p-4 border border-slate-100">
          {/* Formatting Toolbar */}
          <div className="flex items-center flex-wrap gap-2 text-slate-400 pb-3 border-b border-slate-200/60 mb-3">
            <button type="button" className="p-1 hover:text-slate-600"><Undo2 className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><Redo2 className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-300 mx-1" />

            <button type="button" className="p-1 hover:text-slate-600"><Type className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600 font-bold"><Bold className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600 italic"><Italic className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600 underline"><Underline className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-300 mx-1" />

            <button type="button" className="p-1 hover:text-slate-600"><AlignLeft className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><ListOrdered className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><List className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><Indent className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><Outdent className="w-3.5 h-3.5" /></button>
            <span className="h-3 w-[1px] bg-slate-300 mx-1" />

            <button type="button" className="p-1 hover:text-slate-600"><Quote className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><Code className="w-3.5 h-3.5" /></button>
            <button type="button" className="p-1 hover:text-slate-600"><Strikethrough className="w-3.5 h-3.5" /></button>
          </div>

          {/* Text Area */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type Your Reply..."
            rows={12}
            className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none resize-none leading-relaxed"
          />
        </div>
      </div>

      {/* Send Later Popover (Screenshot 2026-10-23 162154.png 1:1) */}
      {isSendLaterOpen && (
        <div className="absolute top-16 right-8 w-72 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-5 z-50 animate-fade-in font-sans">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Send Later
          </h3>

          {/* Pick Date & Time Input */}
          <div className="relative mb-3">
            <input
              type="datetime-local"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full text-xs text-slate-700 placeholder-slate-400 border-b border-slate-200 pb-1.5 focus:outline-none"
            />
          </div>

          {/* Presets List */}
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

          {/* Footer Actions */}
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
