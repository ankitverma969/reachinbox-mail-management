import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  Upload,
  X,
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
  Strikethrough,
  FileText,
  Send
} from 'lucide-react';
import { api, type SenderIdentityItem } from '../services/api.client';
import { parseLeadsContent } from '../utils/csv-parser.util';
import { useToast } from '../context/ToastContext';

export const ComposePage: React.FC = () => {
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const [senders, setSenders] = useState<SenderIdentityItem[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string>('');
  const [senderDropdownOpen, setSenderDropdownOpen] = useState<boolean>(false);

  // Dynamic recipients list
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState<string>('');

  const [subject, setSubject] = useState<string>('');
  const [delayBetweenEmails, setDelayBetweenEmails] = useState<string>('2');
  const [hourlyLimit, setHourlyLimit] = useState<string>('100');
  const [body, setBody] = useState<string>('');

  // Attachments
  const [attachments, setAttachments] = useState<File[]>([]);

  // Send Later Popover state
  const [isSendLaterOpen, setIsSendLaterOpen] = useState<boolean>(false);
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    // Default to tomorrow 9:00 AM in local timezone
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const localIso = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    return localIso;
  });
  const [selectedPreset, setSelectedPreset] = useState<string>('Tomorrow, 9:00 AM');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    void loadSenders();
  }, []);

  const loadSenders = async () => {
    try {
      const list = await api.getSenders();
      setSenders(list);
      if (list.length > 0) {
        setSelectedSenderId(list[0].id);
        setSelectedSenderEmail(list[0].emailAddress);
        setHourlyLimit(String(list[0].hourlyRateLimit || 100));
        setDelayBetweenEmails(String(list[0].minDelaySeconds || 2));
      }
    } catch {
      // Offline fallback
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = parseLeadsContent(text);
      if (result.validEmails.length > 0) {
        setRecipients((prev) => Array.from(new Set([...prev, ...result.validEmails])));
        toastSuccess('Leads Imported', `Imported ${result.validEmails.length} valid recipient emails from ${file.name}`);
      } else {
        toastError('Import Error', 'No valid email addresses found in CSV file');
      }
    } catch {
      toastError('Import Error', 'Failed to read CSV file');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files);
    setAttachments((prev) => [...prev, ...newFiles]);
    toastSuccess('Attachment Added', `Attached ${newFiles.length} file(s)`);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const handleAddRecipient = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = recipientInput.trim().replace(/,$/, '');
      if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        if (!recipients.includes(val)) {
          setRecipients((prev) => [...prev, val]);
        }
        setRecipientInput('');
      } else if (val) {
        toastError('Invalid Email', 'Please enter a valid email format');
      }
    }
  };

  const removeRecipient = (indexToRemove: number) => {
    setRecipients((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const removeAttachment = (indexToRemove: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Dynamic Presets generated from current date
  const getDynamicPresets = () => {
    const now = new Date();
    const laterToday = new Date(now.getTime() + 2 * 3600000);

    const tomorrowMorning = new Date(now);
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
    tomorrowMorning.setHours(9, 0, 0, 0);

    const tomorrowAfternoon = new Date(now);
    tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
    tomorrowAfternoon.setHours(14, 0, 0, 0);

    const nextMonday = new Date(now);
    const day = nextMonday.getDay();
    const daysUntilMonday = (1 + 7 - day) % 7 || 7;
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(9, 0, 0, 0);

    return [
      {
        label: `Later Today, ${laterToday.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
        date: laterToday
      },
      {
        label: 'Tomorrow, 9:00 AM',
        date: tomorrowMorning
      },
      {
        label: 'Tomorrow, 2:00 PM',
        date: tomorrowAfternoon
      },
      {
        label: `Next Monday, 9:00 AM (${nextMonday.toLocaleDateString([], { month: 'short', day: 'numeric' })})`,
        date: nextMonday
      }
    ];
  };

  const handlePresetSelect = (preset: { label: string; date: Date }) => {
    setSelectedPreset(preset.label);
    const localISO = new Date(preset.date.getTime() - preset.date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setScheduledDate(localISO);
  };

  const handleSendLater = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Include single input if typed but not confirmed
    let targetRecipients = [...recipients];
    if (recipientInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientInput.trim())) {
      if (!targetRecipients.includes(recipientInput.trim())) {
        targetRecipients.push(recipientInput.trim());
      }
    }

    if (targetRecipients.length === 0) {
      toastError('Validation Error', 'Please enter at least one recipient email address or upload a CSV lead list');
      return;
    }
    if (!subject.trim()) {
      toastError('Validation Error', 'Please enter an email subject line');
      return;
    }
    if (!body.trim()) {
      toastError('Validation Error', 'Please enter your email message body');
      return;
    }

    setIsSubmitting(true);
    try {
      let finalBody = body.trim();
      if (attachments.length > 0) {
        const fileListHtml = attachments
          .map((f) => `<li style="margin-bottom: 4px;">📎 <strong>${f.name}</strong> (${(f.size / 1024).toFixed(1)} KB)</li>`)
          .join('');
        finalBody += `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-family: sans-serif; font-size: 12px; color: #334155;"><p style="margin: 0 0 6px 0; font-weight: 600;">Attached Documents (${attachments.length}):</p><ul style="margin: 0; padding-left: 20px;">${fileListHtml}</ul></div>`;
      }

      const scheduledAtIso = scheduledDate
        ? new Date(scheduledDate).toISOString()
        : new Date(Date.now() + 3600000).toISOString();

      await api.scheduleCampaign({
        senderId: selectedSenderId || (senders[0]?.id ?? 'default'),
        subject: subject.trim(),
        body: finalBody,
        recipients: targetRecipients,
        scheduledAt: scheduledAtIso,
        delayBetweenEmails: Number(delayBetweenEmails) || 2,
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

  const handleSendNow = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Include single input if typed but not confirmed
    let targetRecipients = [...recipients];
    if (recipientInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientInput.trim())) {
      if (!targetRecipients.includes(recipientInput.trim())) {
        targetRecipients.push(recipientInput.trim());
      }
    }

    if (targetRecipients.length === 0) {
      toastError('Validation Error', 'Please enter at least one recipient email address or upload a CSV lead list');
      return;
    }
    if (!subject.trim()) {
      toastError('Validation Error', 'Please enter an email subject line');
      return;
    }
    if (!body.trim()) {
      toastError('Validation Error', 'Please enter your email message body');
      return;
    }

    setIsSubmitting(true);
    try {
      let finalBody = body.trim();
      if (attachments.length > 0) {
        const fileListHtml = attachments
          .map((f) => `<li style="margin-bottom: 4px;">📎 <strong>${f.name}</strong> (${(f.size / 1024).toFixed(1)} KB)</li>`)
          .join('');
        finalBody += `<div style="margin-top: 20px; padding: 12px 16px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-family: sans-serif; font-size: 12px; color: #334155;"><p style="margin: 0 0 6px 0; font-weight: 600;">Attached Documents (${attachments.length}):</p><ul style="margin: 0; padding-left: 20px;">${fileListHtml}</ul></div>`;
      }

      // Immediate delivery: scheduledAt set to current timestamp
      const scheduledAtIso = new Date().toISOString();

      await api.scheduleCampaign({
        senderId: selectedSenderId || (senders[0]?.id ?? 'default'),
        subject: subject.trim(),
        body: finalBody,
        recipients: targetRecipients,
        scheduledAt: scheduledAtIso,
        delayBetweenEmails: Number(delayBetweenEmails) || 2,
        hourlyLimit: Number(hourlyLimit) || 100
      });

      toastSuccess('Sent Successfully', `Campaign dispatched for immediate delivery to ${targetRecipients.length} recipients`);
      window.dispatchEvent(new CustomEvent('reachinbox:refresh'));
      navigate('/dashboard/sent');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Sending failed';
      toastError('Error', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white text-slate-900 font-sans antialiased relative pb-12">
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => void handleCsvUpload(e)}
        accept=".csv,.xlsx,.xls,.txt,.tsv,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
      />
      <input
        type="file"
        ref={attachmentInputRef}
        onChange={handleAttachmentUpload}
        multiple
        className="hidden"
      />

      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-100">
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

        {/* Right Action Bar */}
        <div className="flex items-center space-x-3">
          {/* Dynamic Attachment Icon & Badge */}
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            className={`flex items-center space-x-1 cursor-pointer transition-colors p-1.5 rounded-full hover:bg-slate-100 ${
              attachments.length > 0 ? 'text-[#2E7D32]' : 'text-slate-400 hover:text-slate-700'
            }`}
            title={attachments.length > 0 ? `${attachments.length} attachment(s) attached` : 'Attach file'}
          >
            <Paperclip className="w-4 h-4 transform rotate-45" />
            {attachments.length > 0 && (
              <span className="text-[11px] font-bold font-mono bg-emerald-50 text-[#2E7D32] px-1.5 py-0.2 rounded-full border border-emerald-200">
                {attachments.length}
              </span>
            )}
          </button>

          {/* Clock icon to toggle Send Later popover */}
          <button
            type="button"
            onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
            className={`p-1.5 rounded-full transition-colors ${
              isSendLaterOpen ? 'text-[#2E7D32] bg-emerald-50' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title="Schedule Delivery Time"
          >
            <Clock className="w-4 h-4" />
          </button>

          {/* Send Later Button (Outline) */}
          <button
            type="button"
            onClick={() => void handleSendLater()}
            disabled={isSubmitting}
            className="rounded-full border border-slate-300 hover:border-[#2E7D32] text-slate-700 hover:text-[#2E7D32] bg-white px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center space-x-1.5 shadow-none"
            title="Schedule email for delivery at specified time"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Scheduling...' : 'Send Later'}</span>
          </button>

          {/* Send Now Button (Primary Solid) */}
          <button
            type="button"
            onClick={() => void handleSendNow()}
            disabled={isSubmitting}
            className="rounded-full bg-[#2E7D32] hover:bg-[#1B5E20] text-white px-5 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-1.5"
            title="Send email immediately to all recipients"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSubmitting ? 'Sending...' : 'Send Now'}</span>
          </button>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="max-w-4xl space-y-4 pt-4">
        {/* From Row with Dynamic Sender Select */}
        <div className="flex items-center">
          <label className="w-20 text-xs font-semibold text-slate-500">From</label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSenderDropdownOpen(!senderDropdownOpen)}
              className="bg-[#F4F5F6] text-xs font-medium text-slate-800 rounded-xl px-3.5 py-1.5 flex items-center space-x-2 hover:bg-slate-200 transition-colors"
            >
              <span>{selectedSenderEmail || 'Select Sender Account'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {senderDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 p-1 z-30 min-w-[240px] text-xs">
                {senders.length === 0 ? (
                  <div className="p-3 text-slate-400 text-center">No sender accounts configured</div>
                ) : (
                  senders.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        setSelectedSenderId(s.id);
                        setSelectedSenderEmail(s.emailAddress);
                        setHourlyLimit(String(s.hourlyRateLimit || 100));
                        setDelayBetweenEmails(String(s.minDelaySeconds || 2));
                        setSenderDropdownOpen(false);
                      }}
                      className="px-3 py-2 hover:bg-slate-50 rounded-lg cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold text-slate-800">{s.displayName}</p>
                        <p className="text-[11px] text-slate-400">{s.emailAddress}</p>
                      </div>
                      {s.id === selectedSenderId && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* To Row with Dynamic Chips and CSV Upload */}
        <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-start space-x-2 flex-1 min-w-0 pr-4">
            <label className="w-20 text-xs font-semibold text-slate-500 pt-1.5 flex-shrink-0">To</label>
            <div className="flex-1 flex items-center flex-wrap gap-1.5 min-h-[32px]">
              {recipients.map((email, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center space-x-1 px-3 py-0.5 rounded-full text-xs font-medium bg-[#E8F5E9] text-[#2E7D32] border border-[#C8E6C9]"
                >
                  <span>{email}</span>
                  <button
                    type="button"
                    onClick={() => removeRecipient(idx)}
                    className="hover:text-rose-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              <input
                type="text"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={handleAddRecipient}
                placeholder={recipients.length === 0 ? "Enter recipient email and press Enter..." : "Add another..."}
                className="flex-1 min-w-[200px] text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none bg-transparent py-1"
              />
            </div>
          </div>

          {/* Upload List CTA button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[#2E7D32] hover:text-[#1B5E20] flex items-center space-x-1 text-xs font-semibold transition-colors flex-shrink-0 cursor-pointer pt-1"
            title="Upload CSV lead list"
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
            placeholder="Exploring Strategic Partnerships..."
            className="flex-1 text-xs text-slate-900 placeholder-slate-400 border-none focus:outline-none bg-transparent font-medium"
          />
        </div>

        {/* Delay and Hourly Limit Controls */}
        <div className="flex items-center space-x-8 text-xs text-slate-600 pt-1">
          <div className="flex items-center space-x-2">
            <span className="font-medium text-slate-700">Delay Between Emails (sec)</span>
            <input
              type="number"
              min="0"
              value={delayBetweenEmails}
              onChange={(e) => setDelayBetweenEmails(e.target.value)}
              className="w-16 h-8 bg-[#F4F5F6] rounded-xl text-center text-xs font-mono border-none focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div className="flex items-center space-x-2">
            <span className="font-medium text-slate-700">Hourly Quota Limit</span>
            <input
              type="number"
              min="1"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              className="w-16 h-8 bg-[#F4F5F6] rounded-xl text-center text-xs font-mono border-none focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Editor Container */}
        <div className="mt-4 bg-[#F8F9FA] rounded-2xl p-4 border border-slate-100 min-h-[340px] flex flex-col">
          {/* Floating Toolbar */}
          <div className="bg-white rounded-full px-4 py-2 border border-slate-100 shadow-sm flex items-center flex-wrap gap-2.5 text-slate-400 mb-3 w-fit">
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
            placeholder="Type your outreach email content here..."
            rows={10}
            className="w-full flex-1 bg-transparent text-xs text-slate-800 placeholder-slate-400 border-none focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Dynamic Attachment Chips List (only if files attached) */}
        {attachments.length > 0 && (
          <div className="pt-2">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Attachments ({attachments.length})</p>
            <div className="flex items-center flex-wrap gap-2">
              {attachments.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white shadow-sm text-xs text-slate-700"
                >
                  <FileText className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="truncate max-w-[150px] font-medium">{file.name}</span>
                  <span className="text-[10px] text-slate-400">({(file.size / 1024).toFixed(1)} KB)</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="text-slate-400 hover:text-rose-500 ml-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom Action Bar */}
        <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {recipients.length > 0 ? (
              <span>Ready to deliver to <strong className="text-slate-800">{recipients.length}</strong> recipient{recipients.length > 1 ? 's' : ''}</span>
            ) : (
              <span className="text-slate-400">Add recipients or upload a CSV lead list</span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
              className="text-xs text-slate-500 hover:text-slate-800 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              title="Configure delivery schedule"
            >
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{selectedPreset || (scheduledDate ? scheduledDate.replace('T', ' ') : 'Schedule')}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSendLater()}
              disabled={isSubmitting}
              className="rounded-full border border-slate-300 hover:border-[#2E7D32] text-slate-700 hover:text-[#2E7D32] bg-white px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 flex items-center space-x-1.5 shadow-none"
              title="Schedule email for delivery at specified time"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Scheduling...' : 'Send Later'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSendNow()}
              disabled={isSubmitting}
              className="rounded-full bg-[#2E7D32] hover:bg-[#1B5E20] text-white px-5 py-1.5 text-xs font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-1.5"
              title="Send email immediately to all recipients"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Sending...' : 'Send Now'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Send Later Popover with Dynamic Presets */}
      {isSendLaterOpen && (
        <div className="absolute top-16 right-8 w-80 bg-white rounded-2xl shadow-xl border border-slate-200/80 p-5 z-50 animate-fade-in font-sans">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Schedule Delivery Time
            </h3>
            <button
              onClick={() => setIsSendLaterOpen(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Date & Time Picker */}
          <div className="mb-4">
            <label className="text-[11px] text-slate-400 block mb-1">Pick Exact Time</label>
            <input
              type="datetime-local"
              value={scheduledDate}
              onChange={(e) => {
                setScheduledDate(e.target.value);
                setSelectedPreset('');
              }}
              className="w-full text-xs text-slate-800 bg-slate-50 rounded-lg p-2 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Dynamic Calculated Presets */}
          <div className="space-y-1.5 mb-4 text-xs text-slate-700">
            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Quick Presets</p>
            {getDynamicPresets().map((preset) => (
              <div
                key={preset.label}
                onClick={() => handlePresetSelect(preset)}
                className={`cursor-pointer py-1.5 px-2 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between ${
                  selectedPreset === preset.label ? 'bg-emerald-50 text-emerald-800 font-semibold' : ''
                }`}
              >
                <span>{preset.label}</span>
                {selectedPreset === preset.label && <span className="text-xs text-emerald-600">✓</span>}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsSendLaterOpen(false);
              toastSuccess('Time Selected', `Scheduled for ${scheduledDate.replace('T', ' ')}`);
            }}
            className="w-full py-2 bg-[#2E7D32] hover:bg-[#1B5E20] text-white rounded-xl text-xs font-semibold transition-colors shadow-sm"
          >
            Apply Schedule
          </button>
        </div>
      )}
    </div>
  );
};
