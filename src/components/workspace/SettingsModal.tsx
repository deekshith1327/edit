import React, { useState } from 'react';
import { CheckCircle2, HardDrive, Server, Sliders, User as UserIcon, X } from 'lucide-react';
import { api, ApiError, formatBytes } from '../../api/client';
import type { CreativeBrief, Project, ProviderStatus, User } from '../../shared/types';

interface SettingsModalProps {
  user: User;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  storageBreakdown: Record<string, number>;
  providerStatus: ProviderStatus | null;
  activeProject?: Project | null;
  onUserUpdated: (user: User) => void;
  onUpdateBrief?: (briefPatch: Partial<CreativeBrief>) => Promise<void>;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  user,
  storageUsedBytes,
  storageQuotaBytes,
  storageBreakdown,
  providerStatus,
  activeProject,
  onUserUpdated,
  onUpdateBrief,
  onClose,
}) => {
  const [section, setSection] = useState<'account' | 'brief' | 'engines'>('account');
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [savingAccount, setSavingAccount] = useState(false);

  const [writtenInstruction, setWrittenInstruction] = useState(
    activeProject?.brief.writtenInstruction || ''
  );
  const [mustKeepNotes, setMustKeepNotes] = useState(activeProject?.brief.mustKeepNotes || '');
  const [doNotUseNotes, setDoNotUseNotes] = useState(activeProject?.brief.doNotUseNotes || '');
  const [savingBrief, setSavingBrief] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usagePct =
    storageQuotaBytes > 0
      ? Math.min(100, Math.round((storageUsedBytes / storageQuotaBytes) * 100))
      : 0;

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.updateAccount(name.trim(), role.trim());
      onUserUpdated(res.user);
      setMessage('Account profile saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save profile.');
    } finally {
      setSavingAccount(false);
    }
  };

  const handleSaveBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateBrief) return;
    setSavingBrief(true);
    setError(null);
    setMessage(null);
    try {
      await onUpdateBrief({
        writtenInstruction: writtenInstruction.trim(),
        mustKeepNotes: mustKeepNotes.trim(),
        doNotUseNotes: doNotUseNotes.trim(),
      });
      setMessage('Project brief updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update brief.');
    } finally {
      setSavingBrief(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label="Studio Settings"
    >
      <div className="w-full max-w-[640px] rounded-md border border-[#232730] bg-[#14161B] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#232730] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#F2EFE9]">Studio Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="text-[#9AA0AE] hover:text-[#F2EFE9]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-[#232730] flex items-center gap-5 text-xs">
          <button
            type="button"
            onClick={() => setSection('account')}
            className={`pb-2.5 border-b-2 inline-flex items-center gap-1.5 font-medium ${
              section === 'account'
                ? 'border-[#D99B43] text-[#F2EFE9]'
                : 'border-transparent text-[#9AA0AE] hover:text-[#F2EFE9]'
            }`}
          >
            <UserIcon size={13} /> Account & Storage
          </button>
          {activeProject && onUpdateBrief && (
            <button
              type="button"
              onClick={() => setSection('brief')}
              className={`pb-2.5 border-b-2 inline-flex items-center gap-1.5 font-medium ${
                section === 'brief'
                  ? 'border-[#D99B43] text-[#F2EFE9]'
                  : 'border-transparent text-[#9AA0AE] hover:text-[#F2EFE9]'
              }`}
            >
              <Sliders size={13} /> Project Brief
            </button>
          )}
          <button
            type="button"
            onClick={() => setSection('engines')}
            className={`pb-2.5 border-b-2 inline-flex items-center gap-1.5 font-medium ${
              section === 'engines'
                ? 'border-[#D99B43] text-[#F2EFE9]'
                : 'border-transparent text-[#9AA0AE] hover:text-[#F2EFE9]'
            }`}
          >
            <Server size={13} /> Services & Engines
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <span>{message}</span>
            </div>
          )}

          {section === 'account' && (
            <div className="space-y-6">
              <form onSubmit={handleSaveAccount} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                      Display Name
                    </span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-3 py-2 text-xs text-[#F2EFE9]"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                      Studio Role
                    </span>
                    <input
                      type="text"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-3 py-2 text-xs text-[#F2EFE9]"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6C7280] font-mono">{user.email}</span>
                  <button
                    type="submit"
                    disabled={savingAccount}
                    className="rounded-md bg-[#D99B43] hover:bg-[#E2AA57] px-3.5 py-1.5 text-xs font-semibold text-[#0D0E11]"
                  >
                    {savingAccount ? 'Saving…' : 'Save Profile'}
                  </button>
                </div>
              </form>

              <div className="rounded-md border border-[#232730] bg-[#0D0E11] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#F2EFE9]">
                    <HardDrive size={14} className="text-[#D99B43]" /> Media Storage Quota
                  </span>
                  <span className="font-mono text-[#9AA0AE] tabular-nums">
                    {formatBytes(storageUsedBytes)} / {formatBytes(storageQuotaBytes)} ({usagePct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#232730] overflow-hidden">
                  <div
                    className="h-full bg-[#D99B43]"
                    style={{ width: `${Math.max(2, usagePct)}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-[#9AA0AE] font-mono tabular-nums pt-1">
                  <div>Originals: {formatBytes(storageBreakdown.originals || 0)}</div>
                  <div>Exports: {formatBytes(storageBreakdown.exports || 0)}</div>
                  <div>Generated: {formatBytes(storageBreakdown.generated || 0)}</div>
                  <div>Thumbnails: {formatBytes(storageBreakdown.thumbnails || 0)}</div>
                </div>
              </div>
            </div>
          )}

          {section === 'brief' && activeProject && onUpdateBrief && (
            <form onSubmit={handleSaveBrief} className="space-y-3.5">
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                  Creative Direction
                </span>
                <textarea
                  rows={3}
                  value={writtenInstruction}
                  onChange={(e) => setWrittenInstruction(e.target.value)}
                  className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-3 py-2 text-xs text-[#F2EFE9]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                  Must-Keep Rules (Binding)
                </span>
                <input
                  type="text"
                  value={mustKeepNotes}
                  onChange={(e) => setMustKeepNotes(e.target.value)}
                  className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-3 py-2 text-xs text-[#F2EFE9]"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                  Do-Not-Use Exclusions (Binding)
                </span>
                <input
                  type="text"
                  value={doNotUseNotes}
                  onChange={(e) => setDoNotUseNotes(e.target.value)}
                  className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-3 py-2 text-xs text-[#F2EFE9]"
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingBrief}
                  className="rounded-md bg-[#D99B43] hover:bg-[#E2AA57] px-3.5 py-1.5 text-xs font-semibold text-[#0D0E11]"
                >
                  {savingBrief ? 'Saving…' : 'Update Brief'}
                </button>
              </div>
            </form>
          )}

          {section === 'engines' && (
            <div className="space-y-3 text-xs">
              <div className="rounded-md border border-[#232730] bg-[#0D0E11] p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#9AA0AE]">Video Renderer (FFmpeg)</span>
                  <span className={providerStatus?.ffmpegAvailable ? 'text-emerald-400' : 'text-red-400'}>
                    {providerStatus?.ffmpegAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#9AA0AE]">Photo Engine (Sharp)</span>
                  <span className={providerStatus?.sharpAvailable ? 'text-emerald-400' : 'text-red-400'}>
                    {providerStatus?.sharpAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#9AA0AE]">Storage Backend</span>
                  <span className="text-[#F2EFE9]">{providerStatus?.storageMode || 'Local Persistent Disk'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#9AA0AE]">Server Gemini API</span>
                  <span className={providerStatus?.geminiConfigured ? 'text-emerald-400' : 'text-amber-300'}>
                    {providerStatus?.geminiConfigured
                      ? 'Configured via environment secret'
                      : 'Not configured (Local Studio Analyzer available)'}
                  </span>
                </div>
              </div>

              {providerStatus?.models && (
                <div className="rounded-md border border-[#232730] bg-[#0D0E11] p-3.5 space-y-1.5 font-mono text-[11px]">
                  <div className="text-[#9AA0AE] font-sans text-xs font-medium mb-2">
                    Configured Model Routing
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Media & Reframing Analysis</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.analysis}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Creative Planning (High Thinking)</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.deepThinking}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">General / Search Grounding</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.general}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Low-Latency Tips</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.lowLatency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Audio Transcription</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.transcribe}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Image Create / Retouch</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.imageGenEdit}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Video Generation</span>
                    <span className="text-[#F2EFE9]">{providerStatus.models.videoGen}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6C7280]">Music Generation</span>
                    <span className="text-[#F2EFE9]">
                      {providerStatus.models.musicClip} / {providerStatus.models.musicPro}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
