import React, { useMemo, useState } from 'react';
import {
  Check,
  Crop,
  Film,
  Layers,
  Lock,
  RotateCcw,
  Sliders,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import { api, ApiError } from '../../api/client';
import {
  adaptPhotoRecipeToBatchLook,
  buildCssFilterFromGrade,
  createDefaultPhotoRecipe,
  PHOTO_LOOK_PRESETS,
} from '../../shared/photoMath';
import { DynamicRangePanel } from './DynamicRangePanel';
import type {
  BatchLookProfile,
  MediaAsset,
  PhotoEditRecipe,
  PhotoLookId,
  Project,
} from '../../shared/types';

interface PhotoStudioViewProps {
  project: Project;
  assets: MediaAsset[];
  onChangePhotoEdits: (
    nextRecipes: Record<string, PhotoEditRecipe>,
    nextBatchLook?: BatchLookProfile
  ) => void;
  onTogglePhotoInTimeline: (asset: MediaAsset, include: boolean) => void;
  onRefreshProject: () => Promise<void>;
}

export const PhotoStudioView: React.FC<PhotoStudioViewProps> = ({
  project,
  assets,
  onChangePhotoEdits,
  onTogglePhotoInTimeline,
  onRefreshProject,
}) => {
  const photos = useMemo(() => assets.filter((a) => a.kind === 'photo'), [assets]);
  const [selectedId, setSelectedId] = useState<string>(photos[0]?.id || '');
  const [inspectorTab, setInspectorTab] = useState<'tone' | 'color' | 'crop' | 'batch' | 'retouch'>('tone');
  const [compareMode, setCompareMode] = useState<'split' | 'graded' | 'corrected' | 'original'>('split');
  const [splitPct, setSplitPct] = useState(50);

  // Nano Banana 2.1 Explicit Prompt Retouch state
  const [retouchPrompt, setRetouchPrompt] = useState('');
  const [retouchAspect, setRetouchAspect] = useState('4:3');
  const [retouchBusy, setRetouchBusy] = useState(false);
  const [retouchError, setRetouchError] = useState<string | null>(null);
  const [retouchNotice, setRetouchNotice] = useState<string | null>(null);

  const selectedPhoto = photos.find((p) => p.id === selectedId) || photos[0] || null;
  const recipe: PhotoEditRecipe | null = selectedPhoto
    ? project.photoEdits[selectedPhoto.id] ||
      createDefaultPhotoRecipe(selectedPhoto.id, project.batchLook.look, false)
    : null;

  const updateRecipe = (updater: (r: PhotoEditRecipe) => PhotoEditRecipe) => {
    if (!selectedPhoto || !recipe) return;
    const updated = updater({ ...recipe, updatedAt: new Date().toISOString() });
    onChangePhotoEdits({
      ...project.photoEdits,
      [selectedPhoto.id]: updated,
    });
  };

  const handleApplyBatchConsistency = () => {
    const refRecipe = project.batchLook.referenceAssetId
      ? project.photoEdits[project.batchLook.referenceAssetId]
      : recipe;
    const nextAll: Record<string, PhotoEditRecipe> = { ...project.photoEdits };
    for (const p of photos) {
      const curr = nextAll[p.id] || createDefaultPhotoRecipe(p.id, project.batchLook.look, false);
      nextAll[p.id] = adaptPhotoRecipeToBatchLook(
        curr,
        project.batchLook.look,
        project.batchLook.intensity,
        project.batchLook.consistencyStrength,
        refRecipe,
        project.batchLook.preserveDistinctLighting
      );
    }
    onChangePhotoEdits(nextAll, {
      ...project.batchLook,
      updatedAt: new Date().toISOString(),
    });
    setRetouchNotice(
      `Adapted ${photos.length} photo recipes to "${project.batchLook.look.replace(/_/g, ' ')}" while respecting locked photos and individual lighting.`
    );
  };

  const handleGenerativeEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPhoto || !retouchPrompt.trim()) return;
    setRetouchBusy(true);
    setRetouchError(null);
    setRetouchNotice(null);
    try {
      await api.generateOrEditImage(project.id, {
        prompt: retouchPrompt.trim(),
        aspectRatio: retouchAspect,
        sourceAssetId: selectedPhoto.id,
      });
      setRetouchPrompt('');
      setRetouchNotice('Saved reversible Nano Banana 2.1 edit layer. Original photo remains untouched.');
      await onRefreshProject();
    } catch (err) {
      if (err instanceof ApiError && err.providerError) {
        setRetouchError(`${err.model}: ${err.message}`);
      } else {
        setRetouchError(err instanceof Error ? err.message : 'Generative edit failed.');
      }
    } finally {
      setRetouchBusy(false);
    }
  };

  if (!selectedPhoto || !recipe) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm font-medium text-[#F2EFE9] mb-1">No photos in this project yet</p>
          <p className="text-xs text-[#9AA0AE]">
            Upload JPEG, PNG, WebP, or TIFF photos in the Media tab to edit individual stills or batches.
          </p>
        </div>
      </div>
    );
  }

  const activeGenLayer = recipe.generativeEdits.find((g) => g.enabled);
  const editedSrc = activeGenLayer ? activeGenLayer.resultUrl : selectedPhoto.mediaUrl;
  const gradedFilter = buildCssFilterFromGrade(
    {
      ...recipe.tone,
      ...recipe.color,
      look: recipe.look,
      lookIntensity: recipe.lookIntensity,
    },
    compareMode === 'corrected' ? 'corrected' : compareMode === 'original' ? 'original' : 'graded'
  );
  const inTimeline = Boolean(project.editPlan?.segments.some((s) => s.assetId === selectedPhoto.id));

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0D0E11]">
      <div className="flex-1 min-h-0 grid grid-cols-12 border-b border-[#232730]">
        {/* Central Photo Viewer with Before/After Split Comparison */}
        <section className="col-span-8 bg-[#0A0B0E] flex flex-col min-h-0">
          <div className="px-4 py-2 bg-[#111318] border-b border-[#232730] flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[#F2EFE9] truncate">{selectedPhoto.filename}</span>
              <span aria-hidden="true" className="text-[#6C7280]">·</span>
              <span className="font-mono tabular-nums text-[#9AA0AE]">
                {selectedPhoto.metadata.width}×{selectedPhoto.metadata.height}
              </span>
              {activeGenLayer && (
                <>
                  <span aria-hidden="true" className="text-[#6C7280]">·</span>
                  <span className="text-[#D99B43]">Generative layer active</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-0.5 p-0.5 bg-[#0D0E11] border border-[#272B35] rounded">
                {(
                  [
                    { id: 'split', label: 'Split Compare' },
                    { id: 'original', label: 'Original' },
                    { id: 'corrected', label: 'Corrected' },
                    { id: 'graded', label: 'Creative Look' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setCompareMode(m.id)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap ${
                      compareMode === m.id
                        ? 'bg-[#D99B43] text-[#0D0E11] font-semibold'
                        : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Photo Canvas */}
          <div className="flex-1 min-h-0 p-6 flex items-center justify-center overflow-hidden">
            <div
              data-testid="photo-studio-viewer"
              className="relative max-w-full max-h-full h-full flex items-center justify-center overflow-hidden border border-[#272B35] bg-black"
            >
              {/* Base Edited Photo */}
              <img
                src={editedSrc}
                alt={`Edited ${selectedPhoto.filename}`}
                referrerPolicy="no-referrer"
                style={{
                  filter: gradedFilter,
                  transform: `rotate(${recipe.crop.rotationDeg}deg)`,
                }}
                className="max-h-full max-w-full object-contain select-none"
              />

              {/* Split Before/After Overlay showing untouched Original */}
              {compareMode === 'split' && (
                <>
                  <div
                    style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                    className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  >
                    <img
                      src={selectedPhoto.mediaUrl}
                      alt={`Original ${selectedPhoto.filename}`}
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div
                    style={{ left: `${splitPct}%` }}
                    className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#D99B43]"
                  />
                  <span className="pointer-events-none absolute top-2.5 left-3 bg-[#0D0E11]/85 px-2 py-0.5 text-[10px] font-mono text-[#D1D5DF]">
                    ORIGINAL
                  </span>
                  <span className="pointer-events-none absolute top-2.5 right-3 bg-[#0D0E11]/85 px-2 py-0.5 text-[10px] font-mono text-[#D99B43]">
                    EDITED ({recipe.look.replace(/_/g, ' ')})
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Bottom Split Slider & Quick Photo Decisions */}
          <div className="px-4 py-2 bg-[#111318] border-t border-[#232730] flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              {compareMode === 'split' && (
                <div className="flex items-center gap-2">
                  <label htmlFor="split-slider" className="text-[11px] text-[#9AA0AE]">
                    Before / After Split
                  </label>
                  <input
                    id="split-slider"
                    type="range"
                    min={5}
                    max={95}
                    value={splitPct}
                    onChange={(e) => setSplitPct(Number(e.target.value))}
                    className="w-32 studio-slider"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateRecipe((r) => ({ ...r, accepted: !r.accepted }))}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border ${
                  recipe.accepted
                    ? 'bg-emerald-950/40 border-emerald-700/70 text-emerald-300'
                    : 'bg-red-950/40 border-red-800/70 text-red-300'
                }`}
              >
                {recipe.accepted ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                <span>{recipe.accepted ? 'Accepted' : 'Rejected'}</span>
              </button>

              <button
                type="button"
                onClick={() => updateRecipe((r) => ({ ...r, locked: !r.locked }))}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border ${
                  recipe.locked
                    ? 'border-[#D99B43] text-[#D99B43] bg-[#D99B43]/10'
                    : 'border-[#2C313D] text-[#9AA0AE] hover:text-[#F2EFE9]'
                }`}
              >
                {recipe.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span>{recipe.locked ? 'Locked' : 'Lock Edit'}</span>
              </button>

              {project.type !== 'photo' && (
                <button
                  type="button"
                  onClick={() => onTogglePhotoInTimeline(selectedPhoto, !inTimeline)}
                  title="Add or remove this photo from the video timeline without affecting its independent photo recipe"
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border ${
                    inTimeline
                      ? 'bg-[#252A36] border-[#41495E] text-[#F2EFE9]'
                      : 'bg-[#14161B] border-[#2C313D] text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  <Film className="w-3 h-3" />
                  <span>{inTimeline ? 'Remove from Video' : 'Add to Video Timeline'}</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right Photo Inspector */}
        <aside className="col-span-4 bg-[#14161B] border-l border-[#232730] flex flex-col min-h-0">
          <div className="px-2.5 pt-2.5 pb-2 border-b border-[#232730] grid grid-cols-5 gap-1">
            {(
              [
                { id: 'tone', label: 'Tone', icon: Sliders },
                { id: 'color', label: 'Look', icon: Layers },
                { id: 'crop', label: 'Crop', icon: Crop },
                { id: 'batch', label: 'Batch', icon: Check },
                { id: 'retouch', label: 'AI Edit', icon: Sparkles },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setInspectorTab(t.id)}
                  className={`py-1.5 px-1 text-[11px] font-medium rounded inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                    inspectorTab === t.id
                      ? 'bg-[#252A36] text-[#F2EFE9]'
                      : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {retouchNotice && (
              <div className="p-2.5 bg-emerald-950/35 border border-emerald-800/60 rounded text-[11px] text-emerald-200">
                {retouchNotice}
              </div>
            )}
            {retouchError && (
              <div className="p-2.5 bg-red-950/45 border border-red-800/60 rounded text-[11px] text-red-200">
                {retouchError}
              </div>
            )}

            {inspectorTab === 'tone' && (
              <div className="space-y-4">
                <DynamicRangePanel
                  targetLabel={selectedPhoto.filename}
                  values={{
                    exposure: recipe.tone.exposure,
                    highlights: recipe.tone.highlights,
                    shadows: recipe.tone.shadows,
                    whites: recipe.tone.whites,
                    blacks: recipe.tone.blacks,
                  }}
                  onChange={(patch) =>
                    updateRecipe((r) => ({ ...r, tone: { ...r.tone, ...patch } }))
                  }
                  onReset={() =>
                    updateRecipe((r) => ({
                      ...r,
                      tone: { ...r.tone, exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
                    }))
                  }
                  compareOriginal={compareMode === 'original'}
                  onToggleCompareOriginal={() =>
                    setCompareMode((m) => (m === 'original' ? 'split' : 'original'))
                  }
                />

                <div className="pt-3 border-t border-[#232730] space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="ph-contrast" className="text-[#C8CDD8]">
                      Contrast
                    </label>
                    <span className="font-mono text-[11px] tabular-nums">{recipe.tone.contrast}</span>
                  </div>
                  <input
                    id="ph-contrast"
                    type="range"
                    min={-50}
                    max={50}
                    value={recipe.tone.contrast}
                    onChange={(e) =>
                      updateRecipe((r) => ({
                        ...r,
                        tone: { ...r.tone, contrast: Number(e.target.value) },
                      }))
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <div className="p-2.5 bg-[#101216] border border-[#232730] rounded text-[11px] text-[#9AA0AE]">
                  {recipe.analysisNotes}
                </div>
              </div>
            )}

            {inspectorTab === 'color' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#F2EFE9]">Color & Restrained Looks</h3>
                  <button
                    type="button"
                    onClick={() =>
                      updateRecipe(() =>
                        createDefaultPhotoRecipe(selectedPhoto.id, 'natural_clean', inTimeline)
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-[#9AA0AE] hover:text-[#F2EFE9]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Photo</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {PHOTO_LOOK_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => updateRecipe((r) => ({ ...r, look: preset.id as PhotoLookId }))}
                      className={`p-2 text-left rounded border transition-colors ${
                        recipe.look === preset.id
                          ? 'bg-[#28231B] border-[#D99B43] text-[#F2EFE9]'
                          : 'bg-[#101216] border-[#232730] text-[#9AA0AE] hover:text-[#F2EFE9]'
                      }`}
                    >
                      <p className="text-xs font-medium">{preset.name}</p>
                      <p className="text-[10px] text-[#6C7280] line-clamp-1 mt-0.5">
                        {preset.description}
                      </p>
                    </button>
                  ))}
                </div>

                <div className="space-y-2.5 pt-2 border-t border-[#232730]">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <label htmlFor="ph-look-int" className="text-[#C8CDD8]">
                        Look Intensity
                      </label>
                      <span className="font-mono text-[11px] tabular-nums">{recipe.lookIntensity}%</span>
                    </div>
                    <input
                      id="ph-look-int"
                      type="range"
                      min={0}
                      max={100}
                      value={recipe.lookIntensity}
                      onChange={(e) =>
                        updateRecipe((r) => ({ ...r, lookIntensity: Number(e.target.value) }))
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  {(
                    [
                      { key: 'temperature', label: 'White Balance Temp' },
                      { key: 'tint', label: 'Tint' },
                      { key: 'saturation', label: 'Saturation' },
                      { key: 'vibrance', label: 'Vibrance' },
                    ] as const
                  ).map((c) => (
                    <div key={c.key} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <label htmlFor={`ph-${c.key}`} className="text-[#C8CDD8]">
                          {c.label}
                        </label>
                        <span className="font-mono text-[11px] tabular-nums">{recipe.color[c.key]}</span>
                      </div>
                      <input
                        id={`ph-${c.key}`}
                        type="range"
                        min={-50}
                        max={50}
                        value={recipe.color[c.key]}
                        onChange={(e) =>
                          updateRecipe((r) => ({
                            ...r,
                            color: { ...r.color, [c.key]: Number(e.target.value) },
                          }))
                        }
                        className="w-full studio-slider"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inspectorTab === 'crop' && (
              <div className="space-y-4">
                <h3 className="text-xs font-semibold text-[#F2EFE9]">
                  Geometry, Detail & Authentic Retouch
                </h3>

                <div>
                  <label htmlFor="ph-crop-ar" className="block text-[11px] text-[#9AA0AE] mb-1">
                    Crop Aspect Ratio
                  </label>
                  <select
                    id="ph-crop-ar"
                    value={recipe.crop.aspectRatio}
                    onChange={(e) =>
                      updateRecipe((r) => ({
                        ...r,
                        crop: {
                          ...r.crop,
                          aspectRatio: e.target.value as PhotoEditRecipe['crop']['aspectRatio'],
                        },
                      }))
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  >
                    <option value="original">Original Aspect</option>
                    <option value="16:9">16:9 Landscape</option>
                    <option value="4:3">4:3 Editorial</option>
                    <option value="3:2">3:2 Classic 35mm</option>
                    <option value="4:5">4:5 Portrait</option>
                    <option value="1:1">1:1 Square</option>
                    <option value="9:16">9:16 Vertical</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="ph-rot" className="text-[#C8CDD8]">
                      Straighten Horizon
                    </label>
                    <span className="font-mono text-[11px] tabular-nums">
                      {recipe.crop.rotationDeg.toFixed(1)}°
                    </span>
                  </div>
                  <input
                    id="ph-rot"
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={recipe.crop.rotationDeg}
                    onChange={(e) =>
                      updateRecipe((r) => ({
                        ...r,
                        crop: { ...r.crop, rotationDeg: Number(e.target.value) },
                      }))
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="ph-sharp" className="text-[#C8CDD8]">
                      Subtle Sharpening
                    </label>
                    <span className="font-mono text-[11px] tabular-nums">
                      {recipe.detail.sharpening}
                    </span>
                  </div>
                  <input
                    id="ph-sharp"
                    type="range"
                    min={0}
                    max={100}
                    value={recipe.detail.sharpening}
                    onChange={(e) =>
                      updateRecipe((r) => ({
                        ...r,
                        detail: { ...r.detail, sharpening: Number(e.target.value) },
                      }))
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <label className="flex items-start justify-between gap-3 pt-2 border-t border-[#232730] text-xs text-[#D1D5DF] cursor-pointer">
                  <span>
                    Natural portrait cleanup
                    <span className="block text-[11px] text-[#6C7280] mt-0.5">
                      Preserves authentic skin texture, age, and identity (no beauty blur).
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={recipe.detail.portraitCleanup}
                    onChange={(e) =>
                      updateRecipe((r) => ({
                        ...r,
                        detail: { ...r.detail, portraitCleanup: e.target.checked },
                      }))
                    }
                    className="accent-[#D99B43] mt-1"
                  />
                </label>
              </div>
            )}

            {inspectorTab === 'batch' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-[#F2EFE9]">Batch Photo Consistency</h3>
                  <p className="text-[11px] text-[#9AA0AE] mt-0.5">
                    Adapts exposure, white balance, and look direction across all unlocked photos
                    without blindly cloning identical numbers.
                  </p>
                </div>

                <div>
                  <label htmlFor="batch-look" className="block text-[11px] text-[#9AA0AE] mb-1">
                    Shared Batch Look
                  </label>
                  <select
                    id="batch-look"
                    value={project.batchLook.look}
                    onChange={(e) =>
                      onChangePhotoEdits(project.photoEdits, {
                        ...project.batchLook,
                        look: e.target.value as PhotoLookId,
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  >
                    {PHOTO_LOOK_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="batch-ref" className="block text-[11px] text-[#9AA0AE] mb-1">
                    Reference Target Photo
                  </label>
                  <select
                    id="batch-ref"
                    value={project.batchLook.referenceAssetId || ''}
                    onChange={(e) =>
                      onChangePhotoEdits(project.photoEdits, {
                        ...project.batchLook,
                        referenceAssetId: e.target.value || null,
                      })
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  >
                    <option value="">Use currently selected photo</option>
                    {photos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.filename}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="batch-strength" className="text-[#C8CDD8]">
                      Consistency Strength
                    </label>
                    <span className="font-mono text-[11px] tabular-nums">
                      {project.batchLook.consistencyStrength}%
                    </span>
                  </div>
                  <input
                    id="batch-strength"
                    type="range"
                    min={20}
                    max={100}
                    value={project.batchLook.consistencyStrength}
                    onChange={(e) =>
                      onChangePhotoEdits(project.photoEdits, {
                        ...project.batchLook,
                        consistencyStrength: Number(e.target.value),
                      })
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <label className="flex items-center justify-between text-xs text-[#D1D5DF] cursor-pointer">
                  <span>Preserve distinct scene lighting</span>
                  <input
                    type="checkbox"
                    checked={project.batchLook.preserveDistinctLighting}
                    onChange={(e) =>
                      onChangePhotoEdits(project.photoEdits, {
                        ...project.batchLook,
                        preserveDistinctLighting: e.target.checked,
                      })
                    }
                    className="accent-[#D99B43]"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleApplyBatchConsistency}
                  className="w-full py-2 text-xs font-semibold bg-[#D99B43] text-[#0D0E11] rounded hover:bg-[#E5AA54]"
                >
                  Apply Adaptive Batch Match ({photos.length} photos)
                </button>
              </div>
            )}

            {inspectorTab === 'retouch' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-[#F2EFE9]">
                    Explicit Generative Edit (Nano Banana 2.1)
                  </h3>
                  <p className="text-[11px] text-[#9AA0AE] mt-0.5">
                    Only runs when you explicitly request cleanup or scene edits. Stored as a
                    visible, toggleable layer—never alters the original photograph.
                  </p>
                </div>

                <form onSubmit={handleGenerativeEdit} className="space-y-3">
                  <div>
                    <label htmlFor="nb-prompt" className="block text-[11px] text-[#D1D5DF] mb-1">
                      Edit instruction
                    </label>
                    <textarea
                      id="nb-prompt"
                      rows={3}
                      value={retouchPrompt}
                      onChange={(e) => setRetouchPrompt(e.target.value)}
                      placeholder="e.g. Remove distracting power cable on the left edge while keeping the subject and natural lighting intact"
                      className="w-full px-2.5 py-2 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="nb-ar" className="block text-[11px] text-[#D1D5DF] mb-1">
                      Output aspect ratio
                    </label>
                    <select
                      id="nb-ar"
                      value={retouchAspect}
                      onChange={(e) => setRetouchAspect(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                    >
                      {['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'].map((ar) => (
                        <option key={ar} value={ar}>
                          {ar}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={retouchBusy || !retouchPrompt.trim()}
                    className="w-full py-2 text-xs font-semibold bg-[#D99B43] text-[#0D0E11] rounded hover:bg-[#E5AA54] disabled:opacity-50"
                  >
                    {retouchBusy ? 'Applying with Nano Banana 2.1…' : 'Create Reversible AI Edit Layer'}
                  </button>
                </form>

                {recipe.generativeEdits.length > 0 && (
                  <div className="pt-3 border-t border-[#232730] space-y-2">
                    <p className="text-[11px] font-medium text-[#9AA0AE]">
                      Reversible Generative Layers
                    </p>
                    {recipe.generativeEdits.map((g) => (
                      <div
                        key={g.id}
                        className="p-2.5 bg-[#101216] border border-[#232730] rounded flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="min-w-0">
                          <p className="text-[#F2EFE9] truncate">{g.prompt}</p>
                          <p className="text-[10px] text-[#6C7280] font-mono">{g.model}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updateRecipe((r) => ({
                              ...r,
                              generativeEdits: r.generativeEdits.map((item) =>
                                item.id === g.id ? { ...item, enabled: !item.enabled } : item
                              ),
                            }))
                          }
                          className={`px-2 py-1 rounded text-[10px] font-medium shrink-0 ${
                            g.enabled
                              ? 'bg-[#D99B43] text-[#0D0E11]'
                              : 'bg-[#1B1E25] text-[#9AA0AE]'
                          }`}
                        >
                          {g.enabled ? 'Active' : 'Disabled'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Contact Sheet Filmstrip */}
      <div className="h-32 shrink-0 bg-[#111318] px-4 py-2.5 flex items-center gap-3 overflow-x-auto">
        {photos.map((photo) => {
          const r =
            project.photoEdits[photo.id] ||
            createDefaultPhotoRecipe(photo.id, project.batchLook.look, false);
          const isSel = photo.id === selectedPhoto.id;
          const usedInVideo = Boolean(project.editPlan?.segments.some((s) => s.assetId === photo.id));

          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => setSelectedId(photo.id)}
              className={`shrink-0 w-40 rounded overflow-hidden border text-left transition-colors ${
                isSel
                  ? 'border-[#D99B43] bg-[#242018]'
                  : 'border-[#272B35] bg-[#14161B] hover:border-[#3A404F]'
              }`}
            >
              <div className="h-16 bg-black relative overflow-hidden">
                <img
                  src={photo.thumbnailUrl}
                  alt={photo.filename}
                  referrerPolicy="no-referrer"
                  style={{
                    filter: buildCssFilterFromGrade(
                      { ...r.tone, ...r.color, look: r.look, lookIntensity: r.lookIntensity },
                      'graded'
                    ),
                  }}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="px-2 py-1.5">
                <p className="text-[11px] font-medium text-[#F2EFE9] truncate">{photo.filename}</p>
                <p className="text-[10px] text-[#9AA0AE] truncate">
                  {r.accepted ? 'Accepted' : 'Rejected'}
                  {r.locked ? ' · Locked' : ''}
                  {usedInVideo ? ' · In Video' : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
