import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  ExternalLink,
  Globe,
  History,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type {
  ChatMessage,
  Project,
  ProjectRevision,
  ProviderStatus,
} from '../../shared/types';

interface StudioAssistantDrawerProps {
  project: Project;
  revisions: ProjectRevision[];
  chatMessages: ChatMessage[];
  providerStatus: ProviderStatus | null;
  onClose: () => void;
  onRefreshProject: () => Promise<void>;
  onChatUpdated: (messages: ChatMessage[]) => void;
}

const QUICK_TIPS = [
  { label: 'Tighten pacing', prompt: 'Give one concrete edit suggestion to tighten pacing in this sequence.' },
  { label: 'Reframing check', prompt: 'How should I refine vertical 9:16 reframing so key subjects keep clean headroom?' },
  { label: 'Dynamic range', prompt: 'Give one concise Dynamic Range correction tip for balancing highlights and shadows across mixed lighting.' },
  { label: 'Audio polish', prompt: 'Suggest one practical dialogue and music balance adjustment for this cut.' },
];

export const StudioAssistantDrawer: React.FC<StudioAssistantDrawerProps> = ({
  project,
  revisions,
  chatMessages,
  providerStatus,
  onClose,
  onRefreshProject,
  onChatUpdated,
}) => {
  const [tab, setTab] = useState<'review' | 'chat'>('review');
  const [regenEngine, setRegenEngine] = useState<'local' | 'gemini'>('local');
  const [regenBusy, setRegenBusy] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);

  // Chat state
  const [chatMode, setChatMode] = useState<
    'general' | 'complex_interactive' | 'deep_thinking' | 'fast' | 'search_grounding'
  >('general');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [quickTipResult, setQuickTipResult] = useState<{ text: string; model: string } | null>(null);
  const [quickTipBusy, setQuickTipBusy] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = project.editPlan?.summary || null;
  const reframeWarnings = (project.editPlan?.segments || [])
    .filter((s) => s.reframe?.warning)
    .map((s) => ({ label: s.label, warning: s.reframe.warning! }));

  const handleRegenerate = async () => {
    setRegenBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.startAnalysis(project.id, regenEngine);
      setNotice(
        `Edit regeneration started (${regenEngine === 'gemini' ? 'Gemini AI Engine' : 'Local Studio Analyzer'}). Locked segments and locked photos will be preserved.`
      );
      await onRefreshProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start regeneration.');
    } finally {
      setRegenBusy(false);
    }
  };

  const handleRestoreRevision = async (revId: string, versionNumber: number) => {
    setRestoreBusyId(revId);
    setError(null);
    setNotice(null);
    try {
      await api.restoreRevision(project.id, revId);
      setNotice(`Restored revision v${versionNumber} as a new non-destructive checkpoint.`);
      await onRefreshProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to restore revision.');
    } finally {
      setRestoreBusyId(null);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.sendChatMessage(project.id, input.trim(), chatMode);
      onChatUpdated(res.messages);
      setInput('');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Unable to reach Gemini Co-Director. Verify your Gemini API configuration.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleQuickTip = async (prompt: string) => {
    setQuickTipBusy(true);
    setError(null);
    try {
      const res = await api.getQuickTip(project.id, prompt);
      setQuickTipResult({ text: res.suggestion, model: res.model });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Quick tip requires a configured Gemini API key.'
      );
    } finally {
      setQuickTipBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[1px]"
      role="dialog"
      aria-label="Edit Review and Studio Co-Director"
    >
      <div className="w-full max-w-[480px] h-full bg-[#14161B] border-l border-[#232730] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#232730] flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setTab('review')}
              className={`text-xs font-semibold pb-1 border-b-2 transition-colors ${
                tab === 'review'
                  ? 'border-[#D99B43] text-[#F2EFE9]'
                  : 'border-transparent text-[#9AA0AE] hover:text-[#F2EFE9]'
              }`}
            >
              Review Edit & Revisions
            </button>
            <button
              type="button"
              onClick={() => setTab('chat')}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold pb-1 border-b-2 transition-colors ${
                tab === 'chat'
                  ? 'border-[#D99B43] text-[#F2EFE9]'
                  : 'border-transparent text-[#9AA0AE] hover:text-[#F2EFE9]'
              }`}
            >
              <MessageSquare size={13} /> Co-Director Chat
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close review drawer"
            className="p-1 text-[#9AA0AE] hover:text-[#F2EFE9]"
          >
            <X size={16} />
          </button>
        </div>

        {(error || notice) && (
          <div className="px-5 pt-3 space-y-2">
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-400" />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {notice}
              </div>
            )}
          </div>
        )}

        {/* Tab 1: Review AI Edit & Revisions */}
        {tab === 'review' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {summary ? (
              <div className="space-y-4">
                <div className="space-y-0.5">
                  <div className="text-xs uppercase tracking-wider font-medium text-[#F2EFE9]">
                    Creative Plan Rationale
                  </div>
                  <div className="font-mono text-[11px] text-[#9AA0AE]">{summary.engineUsed}</div>
                </div>

                <dl className="space-y-2.5 text-xs rounded-md border border-[#232730] bg-[#0D0E11] p-3.5">
                  <div>
                    <dt className="text-[#9AA0AE]">Intended Viewer</dt>
                    <dd className="text-[#F2EFE9] mt-0.5">{summary.intendedViewer}</dd>
                  </div>
                  <div>
                    <dt className="text-[#9AA0AE]">Story Emphasis</dt>
                    <dd className="text-[#F2EFE9] mt-0.5">{summary.storyEmphasis}</dd>
                  </div>
                  <div>
                    <dt className="text-[#9AA0AE]">Visual Mood & Pace</dt>
                    <dd className="text-[#F2EFE9] mt-0.5">{summary.visualMoodAndPace}</dd>
                  </div>
                  <div>
                    <dt className="text-[#9AA0AE]">Media Strategy</dt>
                    <dd className="text-[#F2EFE9] mt-0.5">{summary.mediaUsageStrategy}</dd>
                  </div>
                </dl>

                {summary.prioritizedChoices.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-[11px] uppercase tracking-wider text-[#9AA0AE] font-medium">
                      Prioritized Editorial Decisions
                    </h4>
                    <ul className="space-y-1 text-xs text-[#F2EFE9] list-disc pl-4">
                      {summary.prioritizedChoices.map((choice, idx) => (
                        <li key={idx}>{choice}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {reframeWarnings.length > 0 && (
                  <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
                      <AlertTriangle size={14} /> Intelligent Reframing Notes
                    </div>
                    {reframeWarnings.map((w, idx) => (
                      <p key={idx} className="text-[11px] text-amber-100/90">
                        <strong>{w.label}:</strong> {w.warning}
                      </p>
                    ))}
                  </div>
                )}

                {summary.sourceLimitations.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-[11px] uppercase tracking-wider text-[#9AA0AE] font-medium">
                      Source Limitations Noted
                    </h4>
                    <ul className="space-y-1 text-xs text-[#9AA0AE] list-disc pl-4">
                      {summary.sourceLimitations.map((lim, idx) => (
                        <li key={idx}>{lim}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-[#232730] bg-[#0D0E11] p-4 text-xs text-[#9AA0AE]">
                No edit plan has been generated yet. Run analysis below or from the Media Pool.
              </div>
            )}

            {/* Regenerate Controls */}
            <div className="rounded-md border border-[#232730] bg-[#1B1E25] p-4 space-y-3">
              <div className="text-xs font-semibold text-[#F2EFE9]">
                Regenerate Edit Plan (Preserves Locks)
              </div>
              <p className="text-[11px] text-[#9AA0AE]">
                Any locked timeline clips and locked photo recipes are preserved unchanged during regeneration.
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={regenEngine}
                  onChange={(e) => setRegenEngine(e.target.value as 'local' | 'gemini')}
                  className="flex-1 rounded-md border border-[#2A2E39] bg-[#0D0E11] px-2.5 py-1.5 text-xs text-[#F2EFE9]"
                >
                  <option value="local">Local Studio Analyzer (No AI · Offline)</option>
                  <option value="gemini">
                    Gemini AI Director ({providerStatus?.models.deepThinking || 'gemini-4-carbon'})
                  </option>
                </select>
                <button
                  type="button"
                  disabled={regenBusy}
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#D99B43] hover:bg-[#E2AA57] disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-[#0D0E11]"
                >
                  {regenBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  Regenerate
                </button>
              </div>
            </div>

            {/* Revision History */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F2EFE9]">
                <History size={14} className="text-[#D99B43]" />
                <span>Non-Destructive Revisions ({revisions.length})</span>
              </div>

              {revisions.length === 0 ? (
                <p className="text-xs text-[#9AA0AE]">No saved checkpoints yet.</p>
              ) : (
                <div className="space-y-2">
                  {revisions.map((rev) => (
                    <div
                      key={rev.id}
                      className="rounded-md border border-[#232730] bg-[#0D0E11] p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[#F2EFE9] truncate">
                          <span className="font-mono text-[#D99B43] mr-1.5">
                            v{rev.versionNumber}
                          </span>
                          {rev.label}
                        </div>
                        <div className="text-[11px] text-[#9AA0AE] mt-0.5 truncate">
                          {rev.authorNote || 'Saved snapshot'} ·{' '}
                          {new Date(rev.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={restoreBusyId === rev.id}
                        onClick={() => handleRestoreRevision(rev.id, rev.versionNumber)}
                        className="inline-flex items-center gap-1 rounded-md border border-[#2A2E39] bg-[#1B1E25] hover:border-[#D99B43] px-2.5 py-1 text-[11px] text-[#F2EFE9] shrink-0"
                      >
                        {restoreBusyId === rev.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <RotateCcw size={11} />
                        )}
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Tab 2: Co-Director Chat */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-[#232730] bg-[#0D0E11] space-y-2.5">
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'general', label: 'General (Hydrogen)', icon: Sparkles },
                  { id: 'complex_interactive', label: 'Interactive (Neon)', icon: Sparkles },
                  { id: 'deep_thinking', label: 'Deep Reason (Carbon)', icon: Brain },
                  { id: 'fast', label: 'Fast (Flash Lite)', icon: Zap },
                  { id: 'search_grounding', label: 'Web Grounding (Live Search)', icon: Globe, fullWidth: true },
                ].map((m) => {
                  const Icon = m.icon;
                  const active = chatMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setChatMode(m.id as typeof chatMode)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                        'fullWidth' in m && m.fullWidth ? 'col-span-2' : ''
                      } ${
                        active
                          ? 'border-[#D99B43] bg-[#D99B43]/15 text-[#F2EFE9]'
                          : 'border-[#232730] bg-[#14161B] text-[#9AA0AE] hover:text-[#F2EFE9]'
                      }`}
                    >
                      <Icon size={12} /> {m.label}
                    </button>
                  );
                })}
              </div>

              {/* Low-Latency Quick Tips */}
              <div className="flex flex-wrap gap-1.5">
                {QUICK_TIPS.map((tip) => (
                  <button
                    key={tip.label}
                    type="button"
                    disabled={quickTipBusy}
                    onClick={() => handleQuickTip(tip.prompt)}
                    className="rounded border border-[#232730] bg-[#14161B] hover:border-[#343A47] px-2 py-1 text-[11px] text-[#9AA0AE] hover:text-[#F2EFE9]"
                  >
                    {tip.label}
                  </button>
                ))}
              </div>

              {quickTipResult && (
                <div className="rounded-md border border-[#D99B43]/35 bg-[#D99B43]/10 p-2.5 text-xs text-[#F2EFE9]">
                  <div className="text-[10px] font-mono text-[#D99B43] mb-1">
                    Quick Tip · {quickTipResult.model}
                  </div>
                  <p className="leading-relaxed">{quickTipResult.text}</p>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="text-xs text-[#9AA0AE] leading-relaxed rounded-md border border-[#232730] bg-[#0D0E11] p-4">
                  Ask the Studio Co-Director about cut pacing, aspect-ratio reframing, dynamic range grading, or search current broadcast/social specs with Web Grounding.
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-md p-3 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#1B1E25] border border-[#2A2E39] text-[#F2EFE9] ml-6'
                        : 'bg-[#0D0E11] border border-[#232730] text-[#F2EFE9] mr-4'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#9AA0AE] mb-1 font-mono">
                      <span>{msg.role === 'user' ? 'Editor' : msg.model}</span>
                      <span>{msg.mode.replace('_', ' ')}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[#232730] space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[#9AA0AE]">
                          Sources
                        </div>
                        {msg.sources.map((src, i) => (
                          <a
                            key={i}
                            href={src.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-[11px] text-[#D99B43] hover:underline truncate"
                          >
                            <ExternalLink size={11} className="shrink-0" />
                            <span className="truncate">{src.title || src.uri}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form
              onSubmit={handleSendChat}
              className="p-4 border-t border-[#232730] bg-[#0D0E11] flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about sequencing, grading, or specs…"
                className="flex-1 rounded-md border border-[#2A2E39] bg-[#14161B] px-3 py-2 text-xs text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="inline-flex items-center justify-center rounded-md bg-[#D99B43] hover:bg-[#E2AA57] disabled:opacity-45 px-3 py-2 text-[#0D0E11]"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
