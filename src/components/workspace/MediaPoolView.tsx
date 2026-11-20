import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Cpu,
  Film,
  Image as ImageIcon,
  Music,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  XCircle,
} from 'lucide-react';
import { api, ApiError, formatBytes } from '../../api/client';
import { formatShortDuration } from '../../shared/timeline';
import type { MediaAsset, ProcessingJob, Project, ProviderStatus } from '../../shared/types';

interface MediaPoolViewProps {
  project: Project;
  assets: MediaAsset[];
  jobs: ProcessingJob[];
  providerStatus: ProviderStatus | null;
  onRefreshProject: () => Promise<void>;
  onNavigateTab: (tab: 'edit' | 'photo') => void;
}

const IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'] as const;

export const MediaPoolView: React.FC<MediaPoolViewProps> = ({
  project,
  assets,
  jobs,
  providerStatus,
  onRefreshProject,
  onNavigateTab,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadErrors, setUploadErrors] = useState<
    Array<{ filename: string; error: string; recoveryAction: string; isRawFormat?: boolean }>
  >([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'video' | 'photo' | 'audio'>('all');
  const [analysisEngine, setAnalysisEngine] = useState<'gemini' | 'local'>('local');
  const [startingJob, setStartingJob] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Generative Media Studio drawer state (Nano Banana 2.1 Image + Omni 1.2 Flash Text-to-Video & Animate Photo)
  const [showGenPanel, setShowGenPanel] = useState(false);
  const [genMode, setGenMode] = useState<'image' | 'video' | 'animate_photo'>('image');
  const [genPrompt, setGenPrompt] = useState('');
  const [genImageAspect, setGenImageAspect] = useState<string>('16:9');
  const [genVideoAspect, setGenVideoAspect] = useState<'16:9' | '9:16'>('16:9');
  const [genVideoDuration, setGenVideoDuration] = useState(5);
  const [animateSourceAssetId, setAnimateSourceAssetId] = useState<string>('');
  const [animateUploadFile, setAnimateUploadFile] = useState<File | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  const latestAnalysisJob = jobs.find((j) => j.kind === 'analysis_plan') || null;
  const isJobActive = latestAnalysisJob?.status === 'running' || latestAnalysisJob?.status === 'queued';

  const handleFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setUploadErrors([]);
    setErrorBanner(null);
    setUploadPct(5);
    try {
      const res = await api.uploadAssetsWithProgress(project.id, arr, (pct) => setUploadPct(pct));
      if (res.rejected.length > 0) {
        setUploadErrors(res.rejected);
      }
      if (res.uploaded.length > 0) {
        setNotice(`Uploaded ${res.uploaded.length} original asset${res.uploaded.length === 1 ? '' : 's'} into immutable storage.`);
        await onRefreshProject();
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Upload interrupted. Try again.');
    } finally {
      setUploadPct(null);
    }
  };

  const handleDirectiveChange = async (asset: MediaAsset, directive: MediaAsset['directive']) => {
    try {
      await api.updateAsset(project.id, asset.id, { directive });
      await onRefreshProject();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update asset directive.');
    }
  };

  const handleReorder = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= assets.length) return;
    try {
      await Promise.all([
        api.updateAsset(project.id, assets[index].id, { orderIndex: target }),
        api.updateAsset(project.id, assets[target].id, { orderIndex: index }),
      ]);
      await onRefreshProject();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not reorder assets.');
    }
  };

  const handleDeleteAsset = async (asset: MediaAsset) => {
    try {
      await api.deleteAsset(project.id, asset.id);
      await onRefreshProject();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not delete asset.');
    }
  };

  const handleRunAnalysis = async (engineOverride?: 'gemini' | 'local') => {
    const engine = engineOverride || analysisEngine;
    setErrorBanner(null);
    setNotice(null);
    setStartingJob(true);
    try {
      await api.startAnalysis(project.id, engine);
      await onRefreshProject();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not start analysis job.');
    } finally {
      setStartingJob(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      await onRefreshProject();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Could not cancel job.');
    }
  };

  const handleGenerateMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genPrompt.trim()) return;
    setGenBusy(true);
    setErrorBanner(null);
    setNotice(null);
    try {
      if (genMode === 'image') {
        const res = await api.generateOrEditImage(project.id, {
          prompt: genPrompt.trim(),
          aspectRatio: genImageAspect,
        });
        setNotice(
          `Generated ${genImageAspect} image "${res.asset?.filename}" via Nano Banana 2.1 and added to Media Pool.`
        );
      } else if (genMode === 'animate_photo') {
        const photoAssets = assets.filter((a) => a.kind === 'photo');
        const chosenAssetId = animateSourceAssetId || photoAssets[0]?.id || '';
        if (animateUploadFile) {
          const res = await api.animateUploadedPhoto(project.id, {
            photoFile: animateUploadFile,
            prompt: genPrompt.trim(),
            aspectRatio: genVideoAspect,
            durationSec: genVideoDuration,
          });
          setNotice(
            `Animated "${animateUploadFile.name}" into ${genVideoAspect} video "${res.asset.filename}" via Omni 1.2 Flash.`
          );
          setAnimateUploadFile(null);
        } else if (chosenAssetId) {
          const res = await api.generateVideoClip(project.id, {
            prompt: genPrompt.trim(),
            aspectRatio: genVideoAspect,
            durationSec: genVideoDuration,
            sourceAssetId: chosenAssetId,
          });
          setNotice(
            `Animated project photo into ${genVideoAspect} video "${res.asset.filename}" via Omni 1.2 Flash.`
          );
        } else {
          setErrorBanner('Upload a photo or select an existing project photo to animate into video.');
          setGenBusy(false);
          return;
        }
      } else {
        const res = await api.generateVideoClip(project.id, {
          prompt: genPrompt.trim(),
          aspectRatio: genVideoAspect,
          durationSec: genVideoDuration,
        });
        setNotice(
          `Generated ${genVideoAspect} video "${res.asset.filename}" via Omni 1.2 Flash and added to Media Pool.`
        );
      }
      setGenPrompt('');
      await onRefreshProject();
    } catch (err) {
      if (err instanceof ApiError && err.providerError) {
        setErrorBanner(
          `${err.model || 'Gemini model'}: ${err.message}${
            err.requiresPaidKey ? ' (Requires a billing-enabled API key in Settings > Secrets.)' : ''
          }`
        );
      } else {
        setErrorBanner(err instanceof Error ? err.message : 'Media generation failed.');
      }
    } finally {
      setGenBusy(false);
    }
  };

  const filteredAssets = assets.filter((a) => {
    if (kindFilter !== 'all' && a.kind !== kindFilter) return false;
    if (search.trim() && !a.filename.toLowerCase().includes(search.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-[1360px] mx-auto space-y-6">
        {/* Top Row: Upload Dropzone + AI Analysis & Edit Plan Runner */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Upload Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
            }}
            className={`lg:col-span-7 bg-[#14161B] border border-dashed rounded-lg p-6 flex flex-col justify-between transition-colors ${
              dragActive ? 'border-[#D99B43] bg-[#1C1A15]' : 'border-[#323744]'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-4 mb-2">
                <h2 className="text-sm font-semibold text-[#F2EFE9]">Upload Source Media</h2>
                <span className="text-xs text-[#9AA0AE]">Originals stay immutable</span>
              </div>
              <p className="text-xs text-[#9AA0AE] leading-relaxed mb-4">
                Drag and drop MP4/MOV/WebM videos, JPEG/PNG/WebP/TIFF photos, or MP3/WAV audio.
                Camera RAW files are detected honestly with conversion guidance.
              </p>
            </div>

            {uploadPct !== null && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[#D1D5DF]">Uploading & extracting metadata…</span>
                  <span className="font-mono tabular-nums text-[#D99B43]">{uploadPct}%</span>
                </div>
                <div className="h-1.5 bg-[#0D0E11] rounded overflow-hidden">
                  <div
                    className="h-full bg-[#D99B43] transition-all duration-150"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="video/*,image/*,audio/*,.cr2,.cr3,.nef,.arw,.dng"
                onChange={(e) => {
                  if (e.target.files?.length) void handleFiles(e.target.files);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#F2EFE9] text-[#0D0E11] rounded-md hover:bg-white transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Select files from device</span>
              </button>
              <button
                type="button"
                onClick={() => setShowGenPanel((v) => !v)}
                aria-expanded={showGenPanel}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#1B1E25] border border-[#2E3340] text-[#F2EFE9] rounded-md hover:bg-[#232731] transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#D99B43]" />
                <span>Generate B-Roll or Stills</span>
              </button>
            </div>
          </div>

          {/* AI Analysis & Edit Plan Panel */}
          <div className="lg:col-span-5 bg-[#14161B] border border-[#272B35] rounded-lg p-5 flex flex-col justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[#F2EFE9] mb-1">
                Analysis & Editable Cut Generation
              </h2>
              <p className="text-xs text-[#9AA0AE] leading-relaxed mb-4">
                Analyzes shots, subject positions for Intelligent Reframing, and photo tone to
                build a revisable edit plan while preserving locked items.
              </p>

              <div className="grid grid-cols-2 gap-1 p-1 bg-[#0D0E11] border border-[#232730] rounded-md mb-4">
                <button
                  type="button"
                  onClick={() => setAnalysisEngine('gemini')}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors ${
                    analysisEngine === 'gemini'
                      ? 'bg-[#252A36] text-[#F2EFE9]'
                      : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  Gemini 4 AI Engine
                </button>
                <button
                  type="button"
                  onClick={() => setAnalysisEngine('local')}
                  className={`py-1.5 px-2 text-xs font-medium rounded transition-colors ${
                    analysisEngine === 'local'
                      ? 'bg-[#252A36] text-[#F2EFE9]'
                      : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  Local Analyzer (No AI)
                </button>
              </div>
              <p className="text-[11px] text-[#6C7280] mb-4">
                {analysisEngine === 'gemini'
                  ? providerStatus?.geminiConfigured
                    ? 'Uses Gemini 4 Neon (vision/video) + Gemini 4 Carbon High Thinking (editorial plan). Requires paid key for Gemini 4 models.'
                    : 'Gemini API key is not configured. Running Gemini mode will report an honest configuration error.'
                  : 'Deterministic FFprobe metadata + Sharp pixel saliency analyzer. Runs 100% locally with zero external API keys.'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={startingJob || isJobActive || assets.length === 0}
                onClick={() => void handleRunAnalysis()}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] disabled:opacity-50 transition-colors"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>
                  {isJobActive
                    ? 'Analysis running…'
                    : project.editPlan
                      ? 'Regenerate Edit Plan'
                      : 'Analyze & Build Edit Plan'}
                </span>
              </button>
              {project.editPlan && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('edit')}
                  className="px-3.5 py-2 text-xs font-medium bg-[#1B1E25] border border-[#2E3340] text-[#F2EFE9] rounded-md hover:bg-[#242834]"
                >
                  Open Timeline
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Generative Media Studio Drawer (Nano Banana 2.1 + Omni 1.2 Flash Text/Image-to-Video) */}
        {showGenPanel && (
          <section className="bg-[#14161B] border border-[#2E3340] rounded-lg p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-[#F2EFE9]">
                  Generative Studio Assets (Saved Separately as Generated Originals)
                </h3>
                <p className="text-xs text-[#9AA0AE]">
                  Create images with Nano Banana 2.1, generate video from text, or animate a photo into 16:9 / 9:16 video with Omni 1.2 Flash.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0D0E11] border border-[#232730] rounded-md">
                <button
                  type="button"
                  onClick={() => setGenMode('image')}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    genMode === 'image' ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE]'
                  }`}
                >
                  Create Image
                </button>
                <button
                  type="button"
                  onClick={() => setGenMode('video')}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    genMode === 'video' ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE]'
                  }`}
                >
                  Text to Video
                </button>
                <button
                  type="button"
                  onClick={() => setGenMode('animate_photo')}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    genMode === 'animate_photo' ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE]'
                  }`}
                >
                  Animate Photo to Video
                </button>
              </div>
            </div>

            {genMode === 'animate_photo' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-md border border-[#232730] bg-[#0D0E11] p-3.5">
                <div>
                  <label htmlFor="animate-source-select" className="block text-xs text-[#D1D5DF] mb-1.5">
                    Choose a photo from Media Pool
                  </label>
                  <select
                    id="animate-source-select"
                    value={animateSourceAssetId || assets.find((a) => a.kind === 'photo')?.id || ''}
                    onChange={(e) => {
                      setAnimateSourceAssetId(e.target.value);
                      setAnimateUploadFile(null);
                    }}
                    className="w-full px-3 py-2 text-xs bg-[#14161B] border border-[#2C313D] rounded-md text-[#F2EFE9]"
                  >
                    {assets.filter((a) => a.kind === 'photo').length === 0 ? (
                      <option value="">No project photos yet — upload one on the right</option>
                    ) : (
                      assets
                        .filter((a) => a.kind === 'photo')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.filename} ({p.metadata.width}×{p.metadata.height})
                          </option>
                        ))
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor="animate-upload-input" className="block text-xs text-[#D1D5DF] mb-1.5">
                    Or upload a starting-frame photo directly
                  </label>
                  <input
                    id="animate-upload-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setAnimateUploadFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-[#9AA0AE] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-[#2C313D] file:bg-[#1B1E25] file:text-xs file:text-[#F2EFE9] hover:file:bg-[#252A36]"
                  />
                  {animateUploadFile && (
                    <p className="text-[11px] text-emerald-400 mt-1">
                      Using uploaded photo: {animateUploadFile.name}
                    </p>
                  )}
                </div>
              </div>
            )}

            <form onSubmit={handleGenerateMedia} className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
              <div className="lg:col-span-6">
                <label htmlFor="gen-prompt" className="block text-xs text-[#D1D5DF] mb-1.5">
                  {genMode === 'image'
                    ? 'Still image prompt (Nano Banana 2.1)'
                    : genMode === 'animate_photo'
                      ? 'Motion & camera direction prompt (Omni 1.2 Flash)'
                      : 'Video B-roll scene prompt (Omni 1.2 Flash)'}
                </label>
                <input
                  id="gen-prompt"
                  type="text"
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder={
                    genMode === 'image'
                      ? 'e.g. Overhead editorial photograph of pour-over coffee on dark slate, natural morning light'
                      : genMode === 'animate_photo'
                        ? 'e.g. Gentle camera push-in while warm steam rises naturally and morning light shifts across the scene'
                        : 'e.g. Slow dolly shot of morning mist drifting through Pacific Northwest cedar trees at sunrise'
                  }
                  className="w-full px-3 py-2 text-xs bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
                />
              </div>

              {genMode === 'image' ? (
                <div className="lg:col-span-4">
                  <label htmlFor="gen-img-ar" className="block text-xs text-[#D1D5DF] mb-1.5">
                    Image aspect ratio
                  </label>
                  <select
                    id="gen-img-ar"
                    value={genImageAspect}
                    onChange={(e) => setGenImageAspect(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9]"
                  >
                    {IMAGE_ASPECT_RATIOS.map((ar) => (
                      <option key={ar} value={ar}>
                        {ar}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="lg:col-span-2">
                    <label htmlFor="gen-vid-ar" className="block text-xs text-[#D1D5DF] mb-1.5">
                      Aspect ratio
                    </label>
                    <select
                      id="gen-vid-ar"
                      value={genVideoAspect}
                      onChange={(e) => setGenVideoAspect(e.target.value as '16:9' | '9:16')}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9]"
                    >
                      <option value="16:9">16:9 Landscape</option>
                      <option value="9:16">9:16 Portrait</option>
                    </select>
                  </div>
                  <div className="lg:col-span-2">
                    <label htmlFor="gen-vid-dur" className="block text-xs text-[#D1D5DF] mb-1.5">
                      Duration
                    </label>
                    <select
                      id="gen-vid-dur"
                      value={genVideoDuration}
                      onChange={(e) => setGenVideoDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs font-mono bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9]"
                    >
                      <option value={5}>5 seconds</option>
                      <option value={8}>8 seconds</option>
                      <option value={10}>10 seconds</option>
                    </select>
                  </div>
                </>
              )}

              <div className="lg:col-span-2">
                <button
                  type="submit"
                  disabled={genBusy || !genPrompt.trim()}
                  className="w-full py-2 px-3 text-xs font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] disabled:opacity-50"
                >
                  {genBusy
                    ? 'Generating…'
                    : genMode === 'image'
                      ? 'Generate Image'
                      : genMode === 'animate_photo'
                        ? 'Animate Photo'
                        : 'Generate Video'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Truthful Notifications & Validation Recovery */}
        {notice && (
          <div className="p-3 bg-emerald-950/35 border border-emerald-800/60 rounded-md text-xs text-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{notice}</span>
            </div>
            <button type="button" onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white">
              Dismiss
            </button>
          </div>
        )}

        {errorBanner && (
          <div
            role="alert"
            className="p-3 bg-red-950/45 border border-red-800/65 rounded-md text-xs text-red-200 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorBanner}</span>
            </div>
            <button type="button" onClick={() => setErrorBanner(null)} className="text-red-300 hover:text-white shrink-0">
              Dismiss
            </button>
          </div>
        )}

        {uploadErrors.length > 0 && (
          <div className="p-4 bg-amber-950/35 border border-amber-800/60 rounded-md space-y-2">
            <h3 className="text-xs font-semibold text-amber-200">
              Upload validation issues ({uploadErrors.length})
            </h3>
            {uploadErrors.map((ue, idx) => (
              <div key={idx} className="text-xs text-amber-100/90 border-t border-amber-900/50 pt-2">
                <p className="font-medium">{ue.filename}: {ue.error}</p>
                <p className="text-amber-300/90 mt-0.5">Recovery: {ue.recoveryAction}</p>
              </div>
            ))}
          </div>
        )}

        {/* Persisted Background Job Status Strip (Named 7-Stage Progress) */}
        {latestAnalysisJob && (
          <div className="bg-[#14161B] border border-[#272B35] rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-[#F2EFE9]">
                  Stage {latestAnalysisJob.currentStage}/7 · {latestAnalysisJob.stageLabel}
                </span>
                <span aria-hidden="true" className="text-[#6C7280]">·</span>
                <span
                  className={
                    latestAnalysisJob.status === 'completed'
                      ? 'text-emerald-400'
                      : latestAnalysisJob.status === 'failed'
                        ? 'text-red-400'
                        : latestAnalysisJob.status === 'cancelled'
                          ? 'text-[#9AA0AE]'
                          : 'text-[#D99B43]'
                  }
                >
                  {latestAnalysisJob.status.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono tabular-nums text-[#D1D5DF]">
                  {latestAnalysisJob.progress}%
                </span>
                {isJobActive && (
                  <button
                    type="button"
                    onClick={() => void handleCancelJob(latestAnalysisJob.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-[#1F232D] hover:bg-red-950/60 text-red-300 rounded"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cancel</span>
                  </button>
                )}
                {latestAnalysisJob.status === 'failed' && (
                  <button
                    type="button"
                    onClick={() => void handleRunAnalysis('local')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-[#D99B43] text-[#0D0E11] font-medium rounded"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry with Local Analyzer</span>
                  </button>
                )}
              </div>
            </div>
            <div className="h-1.5 bg-[#0D0E11] rounded overflow-hidden mb-2">
              <div
                className={`h-full transition-all duration-200 ${
                  latestAnalysisJob.status === 'failed'
                    ? 'bg-red-500'
                    : latestAnalysisJob.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-[#D99B43]'
                }`}
                style={{ width: `${latestAnalysisJob.progress}%` }}
              />
            </div>
            <p className="text-xs text-[#9AA0AE]">
              {latestAnalysisJob.errorMessage || latestAnalysisJob.message}
            </p>
          </div>
        )}

        {/* Media Pool Filter Bar & Asset Table/Grid */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-[#F2EFE9]">
                Media Pool ({assets.length})
              </h2>
              <div className="flex items-center gap-1 p-1 bg-[#14161B] border border-[#272B35] rounded-md">
                {(['all', 'video', 'photo', 'audio'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(k)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                      kindFilter === k ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {k === 'all' ? 'All' : k.charAt(0).toUpperCase() + k.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#6C7280] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by filename…"
                aria-label="Filter media assets"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#14161B] border border-[#272B35] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />
            </div>
          </div>

          {filteredAssets.length === 0 ? (
            <div className="py-12 text-center bg-[#14161B] border border-[#272B35] rounded-lg">
              <p className="text-sm text-[#D1D5DF] mb-1">No media assets in this view</p>
              <p className="text-xs text-[#9AA0AE]">
                Upload video clips, photographs, or audio tracks above to begin.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredAssets.map((asset, index) => (
                <div
                  key={asset.id}
                  className="bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-video bg-[#090A0C] overflow-hidden">
                    {asset.kind === 'audio' ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-[#9AA0AE] gap-2">
                        <Music className="w-8 h-8 text-[#D99B43]" />
                        <span className="text-xs font-mono">
                          {formatShortDuration(asset.metadata.durationSec)} · {asset.metadata.format.toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.filename}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 py-2 flex items-center justify-between text-[11px] font-mono text-[#E4E6EC]">
                      <span className="inline-flex items-center gap-1.5">
                        {asset.kind === 'video' ? (
                          <Video className="w-3.5 h-3.5 text-[#D99B43]" />
                        ) : asset.kind === 'photo' ? (
                          <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                        ) : (
                          <Music className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span className="uppercase">{asset.kind}</span>
                        <span>·</span>
                        <span>{asset.role === 'generated' ? 'Generated' : 'Original'}</span>
                      </span>
                      <span className="tabular-nums">
                        {asset.kind === 'video'
                          ? `${formatShortDuration(asset.metadata.durationSec)} · ${asset.metadata.width}×${asset.metadata.height}`
                          : asset.kind === 'photo'
                            ? `${asset.metadata.width}×${asset.metadata.height}`
                            : formatShortDuration(asset.metadata.durationSec)}
                      </span>
                    </div>
                  </div>

                  <div className="p-3.5 flex-1 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-[#F2EFE9] truncate" title={asset.filename}>
                        {asset.filename}
                      </p>
                      <span className="text-[11px] font-mono tabular-nums text-[#9AA0AE] shrink-0">
                        {formatBytes(asset.fileSizeBytes)}
                      </span>
                    </div>

                    <div className="text-[11px] text-[#9AA0AE] flex flex-wrap items-center gap-x-2">
                      <span>{asset.bin}</span>
                      <span aria-hidden="true">·</span>
                      <span>{asset.metadata.format.toUpperCase()}</span>
                      {asset.kind === 'video' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{asset.metadata.hasAudio ? 'Audio track' : 'Silent'}</span>
                        </>
                      )}
                    </div>

                    {asset.analysis && (
                      <p className="text-[11px] text-[#C8CDD8] line-clamp-2">
                        Subject: {asset.analysis.label} ({Math.round(asset.analysis.confidence * 100)}% conf)
                      </p>
                    )}

                    {/* Binding Must-Keep / Do-Not-Use + Reorder + Delete */}
                    <div className="mt-auto pt-2.5 border-t border-[#222630] flex items-center justify-between gap-2">
                      <select
                        aria-label={`Directive for ${asset.filename}`}
                        value={asset.directive}
                        onChange={(e) =>
                          void handleDirectiveChange(asset, e.target.value as MediaAsset['directive'])
                        }
                        className={`px-2 py-1 text-[11px] rounded border bg-[#0D0E11] focus:outline-none ${
                          asset.directive === 'must_keep'
                            ? 'border-[#D99B43] text-[#D99B43]'
                            : asset.directive === 'do_not_use'
                              ? 'border-red-700 text-red-400'
                              : 'border-[#2C313D] text-[#D1D5DF]'
                        }`}
                      >
                        <option value="normal">Standard</option>
                        <option value="must_keep">Must-keep</option>
                        <option value="do_not_use">Do not use</option>
                      </select>

                      <div className="flex items-center gap-1">
                        {asset.kind === 'photo' && (
                          <button
                            type="button"
                            onClick={() => onNavigateTab('photo')}
                            className="px-2 py-1 text-[11px] text-[#D1D5DF] hover:text-[#F2EFE9] bg-[#1B1E25] rounded"
                          >
                            Edit photo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleReorder(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${asset.filename} earlier`}
                          className="p-1 text-[#9AA0AE] hover:text-[#F2EFE9] disabled:opacity-30 rounded"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReorder(index, 1)}
                          disabled={index === filteredAssets.length - 1}
                          aria-label={`Move ${asset.filename} later`}
                          className="p-1 text-[#9AA0AE] hover:text-[#F2EFE9] disabled:opacity-30 rounded"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteAsset(asset)}
                          aria-label={`Remove ${asset.filename}`}
                          className="p-1 text-[#9AA0AE] hover:text-red-400 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
