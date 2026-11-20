import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Mic,
  Music,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { formatShortDuration } from '../../shared/timeline';
import type { AudioMixConfig, EditPlan, MediaAsset, Project } from '../../shared/types';

interface AudioStudioViewProps {
  project: Project;
  assets: MediaAsset[];
  onChangeEditPlan: (nextPlan: EditPlan) => void;
  onRefreshProject: () => Promise<void>;
}

export const AudioStudioView: React.FC<AudioStudioViewProps> = ({
  project,
  assets,
  onChangeEditPlan,
  onRefreshProject,
}) => {
  const plan = project.editPlan;
  const audioAssets = useMemo(() => assets.filter((a) => a.kind === 'audio'), [assets]);

  // Lyria Music Generation state
  const [musicPrompt, setMusicPrompt] = useState(
    'Warm restrained documentary acoustic piano and subtle cello pulse, 84 BPM, uncluttered under dialogue'
  );
  const [lyriaMode, setLyriaMode] = useState<'clip' | 'pro'>('clip');
  const [musicBusy, setMusicBusy] = useState(false);

  // Microphone Transcription (gemini-3.5-transcribe) state
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateMix = (patch: Partial<AudioMixConfig>) => {
    if (!plan) return;
    onChangeEditPlan({
      ...plan,
      audioMix: { ...plan.audioMix, ...patch },
    });
  };

  const handleGenerateMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!musicPrompt.trim()) return;
    setMusicBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.generateMusicTrack(project.id, {
        prompt: musicPrompt.trim(),
        mode: lyriaMode,
      });
      await onRefreshProject();
      if (plan) {
        updateMix({ musicAssetId: res.asset.id });
      }
      setNotice(`Generated track "${res.asset.filename}" using ${res.model} and assigned to Track A2.`);
    } catch (err) {
      if (err instanceof ApiError && err.providerError) {
        setError(`${err.model}: ${err.message}`);
      } else {
        setError(err instanceof Error ? err.message : 'Music generation failed.');
      }
    } finally {
      setMusicBusy(false);
    }
  };

  const handleToggleMicRecord = async () => {
    setError(null);
    setNotice(null);

    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 200) return;
        setTranscribing(true);
        try {
          const res = await api.transcribeAudioBlob(project.id, blob, 'voiceover.webm');
          setTranscriptText(res.transcript);
          setNotice(`Transcribed via ${res.model}. Click "Insert as Timeline Captions" below.`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed.');
        } finally {
          setTranscribing(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setError('Microphone permission is unavailable in this browser. Upload an audio clip to transcribe instead.');
    }
  };

  const handleTranscribeAsset = async (assetId: string) => {
    setTranscribing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.transcribeAudioAsset(project.id, assetId);
      setTranscriptText(res.transcript);
      setNotice(`Transcribed audio asset via ${res.model}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transcribe audio asset.');
    } finally {
      setTranscribing(false);
    }
  };

  const handleInsertTranscriptAsCaptions = () => {
    if (!plan || !transcriptText.trim()) return;
    const sentences = transcriptText
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const total = Math.max(4, plan.segments.reduce((m, s) => Math.max(m, s.timelineOutSec), 0));
    const slot = total / Math.max(1, sentences.length);
    const newCaps = sentences.map((text, idx) => ({
      id: `cap_tr_${Date.now().toString(36)}_${idx}`,
      startSec: Number((idx * slot).toFixed(2)),
      endSec: Number(Math.min(total, (idx + 1) * slot - 0.15).toFixed(2)),
      text,
      speaker: 'Transcript',
    }));
    onChangeEditPlan({ ...plan, captions: [...plan.captions, ...newCaps] });
    setNotice(`Added ${newCaps.length} timed caption cue(s) to Track T1.`);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-[1320px] mx-auto space-y-6">
        {notice && (
          <div className="p-3 bg-emerald-950/35 border border-emerald-800/60 rounded text-xs text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="p-3 bg-red-950/45 border border-red-800/60 rounded text-xs text-red-200 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Mixer & Ducking Console */}
          <section className="lg:col-span-6 bg-[#14161B] border border-[#272B35] rounded-lg p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#F2EFE9]">Multitrack Sound Mixer</h2>
                <p className="text-xs text-[#9AA0AE]">
                  Smooth dialogue levels and automatically duck music under speech.
                </p>
              </div>
              {plan && (
                <button
                  type="button"
                  onClick={() => updateMix({ masterMuted: !plan.audioMix.masterMuted })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border ${
                    plan.audioMix.masterMuted
                      ? 'bg-red-950/50 border-red-700 text-red-300'
                      : 'bg-[#1B1E25] border-[#2C313D] text-[#D1D5DF]'
                  }`}
                >
                  {plan.audioMix.masterMuted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  <span>{plan.audioMix.masterMuted ? 'Master Muted' : 'Master Active'}</span>
                </button>
              )}
            </div>

            {!plan ? (
              <p className="text-xs text-[#9AA0AE]">Build a timeline first to configure audio tracks.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <label htmlFor="audio-track-select" className="block text-xs text-[#D1D5DF] mb-1.5">
                    Assigned Music Track (A2)
                  </label>
                  <select
                    id="audio-track-select"
                    value={plan.audioMix.musicAssetId || ''}
                    onChange={(e) => updateMix({ musicAssetId: e.target.value || null })}
                    className="w-full px-3 py-2 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  >
                    <option value="">No music track (natural sound only)</option>
                    {audioAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.filename} ({formatShortDuration(a.metadata.durationSec)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="mix-dlg" className="text-[#C8CDD8]">
                      A1 Dialogue / Native Gain
                    </label>
                    <span className="font-mono text-[11px] tabular-nums">
                      {plan.audioMix.dialogueGainDb > 0 ? '+' : ''}
                      {plan.audioMix.dialogueGainDb} dB
                    </span>
                  </div>
                  <input
                    id="mix-dlg"
                    type="range"
                    min={-18}
                    max={12}
                    value={plan.audioMix.dialogueGainDb}
                    onChange={(e) => updateMix({ dialogueGainDb: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="mix-mus" className="text-[#C8CDD8]">
                      A2 Music Bed Gain
                    </label>
                    <span className="font-mono text-[11px] tabular-nums">
                      {plan.audioMix.musicGainDb} dB
                    </span>
                  </div>
                  <input
                    id="mix-mus"
                    type="range"
                    min={-30}
                    max={0}
                    value={plan.audioMix.musicGainDb}
                    onChange={(e) => updateMix({ musicGainDb: Number(e.target.value) })}
                    className="w-full studio-slider"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#232730]">
                  <label className="flex items-center gap-2 text-xs text-[#D1D5DF] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={plan.audioMix.autoDucking}
                      onChange={(e) => updateMix({ autoDucking: e.target.checked })}
                      className="accent-[#D99B43]"
                    />
                    <span>Duck music under dialogue</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[#D1D5DF] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={plan.audioMix.smoothLevels}
                      onChange={(e) => updateMix({ smoothLevels: e.target.checked })}
                      className="accent-[#D99B43]"
                    />
                    <span>Smooth clip loudness</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[#D1D5DF] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={plan.audioMix.noiseReduction}
                      onChange={(e) => updateMix({ noiseReduction: e.target.checked })}
                      className="accent-[#D99B43]"
                    />
                    <span>Gentle voice denoise</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="fade-in" className="block text-[11px] text-[#9AA0AE] mb-1">
                      Fade In (sec)
                    </label>
                    <input
                      id="fade-in"
                      type="number"
                      step={0.1}
                      min={0}
                      max={4}
                      value={plan.audioMix.fadeInSec}
                      onChange={(e) => updateMix({ fadeInSec: Number(e.target.value) })}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    />
                  </div>
                  <div>
                    <label htmlFor="fade-out" className="block text-[11px] text-[#9AA0AE] mb-1">
                      Fade Out (sec)
                    </label>
                    <input
                      id="fade-out"
                      type="number"
                      step={0.1}
                      min={0}
                      max={5}
                      value={plan.audioMix.fadeOutSec}
                      onChange={(e) => updateMix({ fadeOutSec: Number(e.target.value) })}
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Speech Transcription & Lyria Music Studio */}
          <div className="lg:col-span-6 space-y-6">
            {/* Audio Transcription (gemini-3.5-transcribe) */}
            <section className="bg-[#14161B] border border-[#272B35] rounded-lg p-5 space-y-3.5">
              <div>
                <h2 className="text-sm font-semibold text-[#F2EFE9]">
                  Speech Transcription & Captions (Gemini 3.5 Transcribe)
                </h2>
                <p className="text-xs text-[#9AA0AE]">
                  Record voiceover via microphone or transcribe an uploaded audio track into editable captions.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleMicRecord()}
                  disabled={transcribing}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors ${
                    recording
                      ? 'bg-red-600 text-white hover:bg-red-500'
                      : 'bg-[#F2EFE9] text-[#0D0E11] hover:bg-white'
                  }`}
                >
                  {recording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span>
                    {recording ? 'Stop & Transcribe' : transcribing ? 'Transcribing…' : 'Record Microphone'}
                  </span>
                </button>

                {audioAssets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={transcribing}
                    onClick={() => void handleTranscribeAsset(a.id)}
                    className="px-3 py-2 text-xs bg-[#1B1E25] border border-[#2C313D] text-[#D1D5DF] rounded hover:text-[#F2EFE9]"
                  >
                    Transcribe {a.filename}
                  </button>
                ))}
              </div>

              <textarea
                rows={3}
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                placeholder="Transcribed speech will appear here for review before adding to captions…"
                className="w-full px-3 py-2 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />

              <button
                type="button"
                disabled={!transcriptText.trim() || !plan}
                onClick={handleInsertTranscriptAsCaptions}
                className="px-3.5 py-1.5 text-xs font-medium bg-[#1B1E25] border border-[#323744] text-[#F2EFE9] rounded hover:bg-[#252A36] disabled:opacity-40"
              >
                Insert as Timed Timeline Captions
              </button>
            </section>

            {/* Lyria Music Generation */}
            <section className="bg-[#14161B] border border-[#272B35] rounded-lg p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#F2EFE9]">
                    Custom Music Scoring (Lyria)
                  </h2>
                  <p className="text-xs text-[#9AA0AE]">
                    Generate original background music directly into your project audio pool.
                  </p>
                </div>
                <Music className="w-4 h-4 text-[#D99B43] shrink-0" />
              </div>

              <form onSubmit={handleGenerateMusic} className="space-y-3">
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0D0E11] border border-[#232730] rounded">
                  <button
                    type="button"
                    onClick={() => setLyriaMode('clip')}
                    className={`py-1.5 text-xs font-medium rounded ${
                      lyriaMode === 'clip' ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE]'
                    }`}
                  >
                    30s Clip (lyria-3-clip-preview)
                  </button>
                  <button
                    type="button"
                    onClick={() => setLyriaMode('pro')}
                    className={`py-1.5 text-xs font-medium rounded ${
                      lyriaMode === 'pro' ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE]'
                    }`}
                  >
                    Full Track (lyria-3-pro-preview)
                  </button>
                </div>

                <textarea
                  rows={2}
                  value={musicPrompt}
                  onChange={(e) => setMusicPrompt(e.target.value)}
                  aria-label="Music generation prompt"
                  className="w-full px-3 py-2 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9] focus:border-[#D99B43] focus:outline-none"
                />

                <button
                  type="submit"
                  disabled={musicBusy || !musicPrompt.trim()}
                  className="px-4 py-2 text-xs font-semibold bg-[#D99B43] text-[#0D0E11] rounded hover:bg-[#E5AA54] disabled:opacity-50"
                >
                  {musicBusy ? 'Composing track…' : 'Generate Music Track'}
                </button>
              </form>

              {audioAssets.length > 0 && (
                <div className="pt-3 border-t border-[#232730] space-y-2">
                  <p className="text-[11px] font-medium text-[#9AA0AE]">Project Audio Assets</p>
                  {audioAssets.map((a) => (
                    <div key={a.id} className="p-2 bg-[#101216] border border-[#232730] rounded space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate text-[#F2EFE9]">{a.filename}</span>
                        <span className="text-[11px] font-mono text-[#9AA0AE]">
                          {formatShortDuration(a.metadata.durationSec)}
                        </span>
                      </div>
                      <audio controls src={a.mediaUrl} className="w-full h-8" />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
