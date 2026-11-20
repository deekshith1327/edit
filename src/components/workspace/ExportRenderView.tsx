import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api, ApiError, formatBytes } from '../../api/client';
import { getOutputDimensions } from '../../shared/reframing';
import { formatShortDuration, getTotalTimelineDuration } from '../../shared/timeline';
import type {
  AspectRatio,
  ExportArtifact,
  MediaAsset,
  ProcessingJob,
  Project,
  ProviderStatus,
} from '../../shared/types';

interface ExportRenderViewProps {
  project: Project;
  assets: MediaAsset[];
  jobs: ProcessingJob[];
  exportsList: ExportArtifact[];
  providerStatus: ProviderStatus | null;
  onRefreshProject: () => Promise<void>;
}

const VIDEO_PRESETS = [
  {
    id: '1080p_landscape',
    label: '1080p HD Landscape',
    aspectRatio: '16:9' as AspectRatio,
    resolution: '1920 × 1080',
    note: 'YouTube, desktop web, client review',
    requires4k: false,
  },
  {
    id: '1080p_social',
    label: '1080p Vertical Social',
    aspectRatio: '9:16' as AspectRatio,
    resolution: '1080 × 1920',
    note: 'Reels, Shorts, vertical mobile (uses Intelligent Reframing)',
    requires4k: false,
  },
  {
    id: '1080p_square',
    label: '1080p Square Feed',
    aspectRatio: '1:1' as AspectRatio,
    resolution: '1080 × 1080',
    note: 'Editorial square cut (uses Intelligent Reframing)',
    requires4k: false,
  },
  {
    id: '1080p_portrait',
    label: '1080p Portrait 4:5',
    aspectRatio: '4:5' as AspectRatio,
    resolution: '1080 × 1350',
    note: 'Portrait feed delivery (uses Intelligent Reframing)',
    requires4k: false,
  },
  {
    id: '720p_fast',
    label: '720p Fast Review Proxy',
    aspectRatio: '16:9' as AspectRatio,
    resolution: '1280 × 720',
    note: 'Lightweight MP4 for fast internal review',
    requires4k: false,
  },
  {
    id: '4k_master',
    label: '4K UHD Master',
    aspectRatio: '16:9' as AspectRatio,
    resolution: '3840 × 2160',
    note: 'Available when source clips are 4K (≥ 3840px wide)',
    requires4k: true,
  },
] as const;

export const ExportRenderView: React.FC<ExportRenderViewProps> = ({
  project,
  assets,
  jobs,
  exportsList,
  providerStatus,
  onRefreshProject,
}) => {
  const plan = project.editPlan;
  const photos = useMemo(() => assets.filter((a) => a.kind === 'photo'), [assets]);
  const maxSourceWidth = useMemo(
    () => assets.reduce((max, a) => Math.max(max, a.metadata.width || 0), 0),
    [assets]
  );
  const canExport4k = maxSourceWidth >= 3840;

  // Video render state
  const defaultPreset =
    plan?.aspectRatio === '9:16'
      ? '1080p_social'
      : plan?.aspectRatio === '1:1'
        ? '1080p_square'
        : plan?.aspectRatio === '4:5'
          ? '1080p_portrait'
          : '1080p_landscape';

  const [preset, setPreset] = useState<string>(defaultPreset);
  const [fps, setFps] = useState<number>(plan?.fps || 24);
  const [burnCaptions, setBurnCaptions] = useState<boolean>(
    Boolean(plan?.captions && plan.captions.length > 0)
  );
  const [includeTitles, setIncludeTitles] = useState<boolean>(
    Boolean(plan?.titles && plan.titles.some((t) => t.enabled))
  );
  const [startingRender, setStartingRender] = useState(false);

  // Photo export state
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>(() =>
    photos.slice(0, Math.min(photos.length, 4)).map((p) => p.id)
  );
  const [photoFormat, setPhotoFormat] = useState<'jpeg' | 'png' | 'tiff'>('jpeg');
  const [photoQuality, setPhotoQuality] = useState<number>(92);
  const [maxDimension, setMaxDimension] = useState<number | null>(null);
  const [exportingPhotos, setExportingPhotos] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePresetObj = VIDEO_PRESETS.find((p) => p.id === preset) || VIDEO_PRESETS[0];
  const renderAspectRatio: AspectRatio =
    preset === '720p_fast' ? plan?.aspectRatio || '16:9' : activePresetObj.aspectRatio;
  const qualityTier = preset === '4k_master' ? '4k' : preset === '720p_fast' ? '720p' : '1080p';
  const dims = getOutputDimensions(renderAspectRatio, qualityTier);
  const timelineDuration = plan ? getTotalTimelineDuration(plan.segments) : 0;

  // Approximate H.264 bitrate estimate in bytes
  const estimatedVideoBytes = useMemo(() => {
    const bitsPerSec =
      preset === '4k_master'
        ? 24_000_000
        : preset === '720p_fast'
          ? 3_200_000
          : 6_500_000;
    return Math.round((timelineDuration * bitsPerSec) / 8);
  }, [preset, timelineDuration]);

  const activeRenderJob = jobs.find(
    (j) => j.kind === 'video_render' && (j.status === 'queued' || j.status === 'running')
  );
  const latestRenderJob = jobs.find((j) => j.kind === 'video_render');

  const handleStartVideoRender = async () => {
    if (!plan || plan.segments.length === 0) return;
    setStartingRender(true);
    setError(null);
    setNotice(null);
    try {
      await api.renderVideo(project.id, {
        preset,
        aspectRatio: renderAspectRatio,
        fps,
        burnCaptions,
        includeTitles,
      });
      setNotice('FFmpeg video render started in the background. Originals remain untouched.');
      await onRefreshProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start video render.');
    } finally {
      setStartingRender(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      setNotice('Render cancelled safely. No project edits were lost.');
      await onRefreshProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel job.');
    }
  };

  const togglePhotoSelection = (id: string) => {
    setSelectedPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleExportPhotos = async () => {
    if (selectedPhotoIds.length === 0) {
      setError('Select at least one photo to export.');
      return;
    }
    setExportingPhotos(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.exportPhotos(project.id, {
        assetIds: selectedPhotoIds,
        format: photoFormat,
        quality: photoQuality,
        maxDimension,
      });
      setNotice(
        `Export ready: ${res.exportArtifact.filename} (${formatBytes(res.exportArtifact.fileSizeBytes)}).`
      );
      await onRefreshProject();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Photo export failed.');
    } finally {
      setExportingPhotos(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-[#0D0E11]">
      <div className="max-w-[1320px] mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#232730] pb-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#F2EFE9]">
              Render & Delivery
            </h2>
            <p className="text-sm text-[#9AA0AE] mt-1">
              Encode real H.264 MP4 masters via FFmpeg and non-destructive stills via Sharp. Original source files are never altered.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#9AA0AE]">
            <ShieldCheck size={15} className="text-emerald-400" />
            <span>
              Non-destructive pipeline · FFmpeg {providerStatus?.ffmpegAvailable ? 'ready' : 'unavailable'} · Sharp {providerStatus?.sharpAvailable ? 'ready' : 'unavailable'}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2.5">
            <AlertCircle size={16} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2.5">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            <span>{notice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Video Master Render Panel */}
          <section className="rounded-md border border-[#232730] bg-[#14161B] p-5 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Film size={18} className="text-[#D99B43]" />
                  <div>
                    <h3 className="text-sm font-semibold text-[#F2EFE9]">Video Master Export</h3>
                    <p className="text-xs text-[#9AA0AE]">
                      Applies Intelligent Reframing crops, per-clip Dynamic Range tone curves, transitions, and audio mix
                    </p>
                  </div>
                </div>
              </div>

              {!plan || plan.segments.length === 0 ? (
                <div className="rounded-md border border-[#232730] bg-[#1B1E25] p-4 text-xs text-[#9AA0AE]">
                  No timeline segments yet. Run analysis in the Media tab or add clips in the Edit tab before rendering video.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {VIDEO_PRESETS.map((p) => {
                      const disabled = p.requires4k && !canExport4k;
                      const selected = preset === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => setPreset(p.id)}
                          className={`text-left rounded-md border p-3 transition-colors ${
                            disabled
                              ? 'border-[#232730] bg-[#111318] opacity-50 cursor-not-allowed'
                              : selected
                                ? 'border-[#D99B43] bg-[#D99B43]/10'
                                : 'border-[#232730] bg-[#1B1E25] hover:border-[#343A47]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-[#F2EFE9]">{p.label}</span>
                            <span className="font-mono text-[11px] text-[#9AA0AE] tabular-nums">
                              {p.resolution}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#9AA0AE] mt-1">{p.note}</p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-1">
                    <label className="block">
                      <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                        Frame Rate
                      </span>
                      <select
                        value={fps}
                        onChange={(e) => setFps(Number(e.target.value))}
                        className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-2.5 py-1.5 text-xs text-[#F2EFE9]"
                      >
                        <option value={24}>24 fps (Cinema)</option>
                        <option value={30}>30 fps (Standard)</option>
                      </select>
                    </label>

                    <label className="flex items-center gap-2 pt-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeTitles}
                        onChange={(e) => setIncludeTitles(e.target.checked)}
                        className="accent-[#D99B43]"
                      />
                      <span className="text-xs text-[#F2EFE9]">Include Titles</span>
                    </label>

                    <label className="flex items-center gap-2 pt-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={burnCaptions}
                        onChange={(e) => setBurnCaptions(e.target.checked)}
                        className="accent-[#D99B43]"
                      />
                      <span className="text-xs text-[#F2EFE9]">Burn Captions</span>
                    </label>
                  </div>

                  <div className="rounded-md border border-[#232730] bg-[#0D0E11] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#9AA0AE] tabular-nums">
                    <span>
                      Output: <strong className="text-[#F2EFE9] font-mono">{dims.width}×{dims.height}</strong> · {renderAspectRatio} · H.264 MP4
                    </span>
                    <span>
                      {plan.segments.length} clips · {formatShortDuration(timelineDuration)} · Est. ~{formatBytes(estimatedVideoBytes)}
                    </span>
                  </div>
                </>
              )}

              {/* Active or latest video render status */}
              {activeRenderJob && (
                <div className="rounded-md border border-[#D99B43]/50 bg-[#D99B43]/10 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#F2EFE9]">
                      <Loader2 size={14} className="animate-spin text-[#D99B43]" />
                      <span>
                        Stage {activeRenderJob.currentStage}/7 — {activeRenderJob.stageLabel}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCancelJob(activeRenderJob.id)}
                      className="inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200"
                    >
                      <XCircle size={14} /> Cancel
                    </button>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#232730] overflow-hidden">
                    <div
                      className="h-full bg-[#D99B43] transition-all duration-300"
                      style={{ width: `${Math.max(4, activeRenderJob.progress)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#9AA0AE]">
                    <span>{activeRenderJob.message}</span>
                    <span className="font-mono tabular-nums">{activeRenderJob.progress}%</span>
                  </div>
                </div>
              )}

              {!activeRenderJob && latestRenderJob && latestRenderJob.status === 'failed' && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  Last render failed at {latestRenderJob.failedStage || latestRenderJob.stageLabel}:{' '}
                  {latestRenderJob.errorMessage || 'Unknown FFmpeg error.'}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-[#232730] flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#6C7280]">
                Saved as a new export artifact without modifying originals
              </span>
              <button
                type="button"
                disabled={
                  !plan ||
                  plan.segments.length === 0 ||
                  startingRender ||
                  Boolean(activeRenderJob) ||
                  !providerStatus?.ffmpegAvailable
                }
                onClick={handleStartVideoRender}
                className="inline-flex items-center gap-2 rounded-md bg-[#D99B43] hover:bg-[#E2AA57] disabled:opacity-45 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-[#0D0E11] transition-colors"
              >
                {startingRender || activeRenderJob ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Rendering MP4…
                  </>
                ) : (
                  <>
                    <Film size={14} /> Render Master MP4
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Photo Export Panel */}
          <section className="rounded-md border border-[#232730] bg-[#14161B] p-5 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <ImageIcon size={18} className="text-[#D99B43]" />
                  <div>
                    <h3 className="text-sm font-semibold text-[#F2EFE9]">Photo Stills Export</h3>
                    <p className="text-xs text-[#9AA0AE]">
                      Applies non-destructive crop, Dynamic Range tone, color grade, and look via Sharp
                    </p>
                  </div>
                </div>
                {photos.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedPhotoIds(photos.map((p) => p.id))}
                      className="text-[#D99B43] hover:underline"
                    >
                      All ({photos.length})
                    </button>
                    <span className="text-[#343A47]">·</span>
                    <button
                      type="button"
                      onClick={() => setSelectedPhotoIds([])}
                      className="text-[#9AA0AE] hover:text-[#F2EFE9]"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {photos.length === 0 ? (
                <div className="rounded-md border border-[#232730] bg-[#1B1E25] p-4 text-xs text-[#9AA0AE]">
                  This project has no photo assets yet. Upload JPEG, PNG, or WebP stills in the Media tab.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                    {photos.map((photo) => {
                      const checked = selectedPhotoIds.includes(photo.id);
                      const recipe = project.photoEdits[photo.id];
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => togglePhotoSelection(photo.id)}
                          className={`group text-left rounded-md border overflow-hidden transition-colors ${
                            checked
                              ? 'border-[#D99B43] bg-[#D99B43]/10'
                              : 'border-[#232730] bg-[#1B1E25] hover:border-[#343A47]'
                          }`}
                        >
                          <div className="relative h-20 bg-[#0D0E11] overflow-hidden">
                            <img
                              src={photo.thumbnailUrl}
                              alt={photo.filename}
                              className="w-full h-full object-cover"
                            />
                            <div
                              className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] font-bold ${
                                checked
                                  ? 'bg-[#D99B43] border-[#D99B43] text-[#0D0E11]'
                                  : 'bg-[#0D0E11]/70 border-[#9AA0AE]/60 text-transparent'
                              }`}
                            >
                              ✓
                            </div>
                          </div>
                          <div className="p-2">
                            <div className="text-[11px] text-[#F2EFE9] truncate">
                              {photo.filename}
                            </div>
                            <div className="text-[10px] text-[#9AA0AE] font-mono tabular-nums mt-0.5">
                              {photo.metadata.width}×{photo.metadata.height}
                              {recipe?.accepted ? ' · Accepted' : ''}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <label className="block">
                      <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                        Format
                      </span>
                      <select
                        value={photoFormat}
                        onChange={(e) => setPhotoFormat(e.target.value as 'jpeg' | 'png' | 'tiff')}
                        className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-2.5 py-1.5 text-xs text-[#F2EFE9]"
                      >
                        <option value="jpeg">JPEG (Web / Client)</option>
                        <option value="png">PNG (Lossless)</option>
                        <option value="tiff">TIFF (Print Master)</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                        Max Edge
                      </span>
                      <select
                        value={maxDimension === null ? 'orig' : String(maxDimension)}
                        onChange={(e) =>
                          setMaxDimension(e.target.value === 'orig' ? null : Number(e.target.value))
                        }
                        className="w-full rounded-md border border-[#2A2E39] bg-[#0D0E11] px-2.5 py-1.5 text-xs text-[#F2EFE9]"
                      >
                        <option value="orig">Original Resolution</option>
                        <option value="3840">3840px (4K Web)</option>
                        <option value="2560">2560px (Portfolio)</option>
                        <option value="1920">1920px (Social / Deck)</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="block text-[11px] uppercase tracking-wider text-[#9AA0AE] mb-1">
                        Quality ({photoQuality}%)
                      </span>
                      <input
                        type="range"
                        min={65}
                        max={100}
                        step={1}
                        disabled={photoFormat !== 'jpeg'}
                        value={photoQuality}
                        onChange={(e) => setPhotoQuality(Number(e.target.value))}
                        className="studio-slider w-full mt-2 disabled:opacity-40"
                      />
                    </label>
                  </div>
                </>
              )}
            </div>

            <div className="pt-2 border-t border-[#232730] flex items-center justify-between gap-3">
              <span className="text-[11px] text-[#6C7280]">
                {selectedPhotoIds.length > 1
                  ? `Packs ${selectedPhotoIds.length} graded photos into a downloadable ZIP archive`
                  : 'Exports single graded image file'}
              </span>
              <button
                type="button"
                disabled={selectedPhotoIds.length === 0 || exportingPhotos}
                onClick={handleExportPhotos}
                className="inline-flex items-center gap-2 rounded-md border border-[#D99B43]/60 bg-[#1B1E25] hover:bg-[#232730] disabled:opacity-45 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-[#F2EFE9] transition-colors"
              >
                {exportingPhotos ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-[#D99B43]" /> Processing…
                  </>
                ) : selectedPhotoIds.length > 1 ? (
                  <>
                    <Archive size={14} className="text-[#D99B43]" /> Export {selectedPhotoIds.length} Photos (ZIP)
                  </>
                ) : (
                  <>
                    <ImageIcon size={14} className="text-[#D99B43]" /> Export Photo
                  </>
                )}
              </button>
            </div>
          </section>
        </div>

        {/* Verified Export Artifacts Table */}
        <section className="rounded-md border border-[#232730] bg-[#14161B] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#232730] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-[#D99B43]" />
              <h3 className="text-sm font-semibold text-[#F2EFE9]">
                Rendered Exports ({exportsList.length})
              </h3>
            </div>
            <span className="text-xs text-[#9AA0AE]">
              Stored separately from original camera files
            </span>
          </div>

          {exportsList.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#9AA0AE]">
              No completed exports yet. Render a video master or export graded photos above to generate verifiable download files.
            </div>
          ) : (
            <div className="divide-y divide-[#232730]">
              {exportsList.map((exp) => (
                <div
                  key={exp.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-[#1B1E25]/60 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {exp.kind === 'video' ? (
                        <Film size={15} className="text-[#D99B43] shrink-0" />
                      ) : exp.kind === 'photo_batch' ? (
                        <Archive size={15} className="text-[#D99B43] shrink-0" />
                      ) : (
                        <ImageIcon size={15} className="text-[#D99B43] shrink-0" />
                      )}
                      <span className="text-sm font-medium text-[#F2EFE9] truncate">
                        {exp.filename}
                      </span>
                    </div>
                    <div className="text-xs text-[#9AA0AE] mt-1 font-mono tabular-nums">
                      {exp.format.toUpperCase()} · {exp.resolution} · {exp.aspectRatio}
                      {exp.fps ? ` · ${exp.fps}fps` : ''} · {formatBytes(exp.fileSizeBytes)} ·{' '}
                      {new Date(exp.createdAt).toLocaleString()}
                    </div>
                    {exp.settingsSummary && (
                      <div className="text-[11px] text-[#6C7280] mt-0.5">{exp.settingsSummary}</div>
                    )}
                  </div>

                  <a
                    href={exp.downloadUrl}
                    download={exp.filename}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#2A2E39] bg-[#1B1E25] hover:border-[#D99B43] px-3 py-1.5 text-xs font-medium text-[#F2EFE9] transition-colors shrink-0"
                  >
                    <Download size={13} className="text-[#D99B43]" /> Download
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
