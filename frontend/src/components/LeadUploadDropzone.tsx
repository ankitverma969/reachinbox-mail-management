import React, { useRef, useState } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, Trash2, X, Plus } from 'lucide-react';
import { parseLeadsFile, parseLeadsText, type LeadParseResult } from '../utils/csv-parser.util';

interface LeadUploadDropzoneProps {
  recipients: string[];
  onChange: (recipients: string[]) => void;
  parseStats: LeadParseResult | null;
  setParseStats: (stats: LeadParseResult | null) => void;
}

export const LeadUploadDropzone: React.FC<LeadUploadDropzoneProps> = ({
  recipients,
  onChange,
  parseStats,
  setParseStats
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualInput, setManualInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setIsProcessing(true);
    try {
      const result = await parseLeadsFile(file);
      // Combine with existing unique recipients
      const merged = Array.from(new Set([...recipients, ...result.validEmails]));
      onChange(merged);
      setParseStats(result);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleManualAdd = () => {
    if (!manualInput.trim()) return;
    const result = parseLeadsText(manualInput);
    const merged = Array.from(new Set([...recipients, ...result.validEmails]));
    onChange(merged);
    setParseStats(result);
    setManualInput('');
  };

  const handleRemoveEmail = (emailToRemove: string) => {
    onChange(recipients.filter((email) => email !== emailToRemove));
  };

  const handleClearAll = () => {
    onChange([]);
    setParseStats(null);
  };

  return (
    <div className="space-y-4">
      {/* File Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
            : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400 bg-slate-50/50 dark:bg-slate-900/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div className="text-sm">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Click to upload CSV</span>
            <span className="text-slate-500"> or drag and drop</span>
          </div>
          <p className="text-xs text-slate-400">Supports .csv or .txt (auto-detects 'email' headers and plain-text lists)</p>
        </div>
      </div>

      {/* Manual Input Alternative */}
      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleManualAdd();
            }
          }}
          placeholder="Or paste email address(es) separated by commas / spaces..."
          className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={handleManualAdd}
          className="px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-lg flex items-center space-x-1"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add</span>
        </button>
      </div>

      {/* Parse Statistics & Feedback */}
      {parseStats && (
        <div className="flex flex-wrap items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
          <span className="font-medium text-slate-700 dark:text-slate-300">File Ingestion:</span>
          <span className="inline-flex items-center text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded font-medium">
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            {parseStats.validEmails.length} valid
          </span>
          {parseStats.duplicateCount > 0 && (
            <span className="text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded font-medium">
              {parseStats.duplicateCount} duplicates filtered
            </span>
          )}
          {parseStats.invalidRows.length > 0 && (
            <span className="text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded font-medium">
              <AlertCircle className="w-3.5 h-3.5 mr-1 inline" />
              {parseStats.invalidRows.length} invalid skipped
            </span>
          )}
        </div>
      )}

      {/* Recipient Chips Container */}
      {recipients.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              Target Audience: <strong className="text-slate-900 dark:text-white font-semibold">{recipients.length} recipients</strong>
            </span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-rose-600 hover:text-rose-700 text-xs flex items-center space-x-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear all</span>
            </button>
          </div>

          <div className="max-h-36 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-wrap gap-1.5">
            {recipients.slice(0, 50).map((email) => (
              <span
                key={email}
                className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm"
              >
                {email}
                <button
                  type="button"
                  onClick={() => handleRemoveEmail(email)}
                  className="ml-1 text-slate-400 hover:text-rose-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {recipients.length > 50 && (
              <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                +{recipients.length - 50} more recipients
              </span>
            )}
          </div>
        </div>
      )}

      {isProcessing && <p className="text-xs text-emerald-600 animate-pulse">Parsing lead dataset...</p>}
    </div>
  );
};
