import React, { useMemo, useState } from 'react';
import { Eye, Layers, RotateCcw } from 'lucide-react';
import {
  buildCssFilterFromGrade,
  PHOTO_LOOK_PRESETS,
} from '../../shared/photoMath';
import { defaultColorGrade } from '../../shared/timeline';
import { DynamicRangePanel } from './DynamicRangePanel';
import type { ColorGrade, EditPlan, MediaAsset, PhotoLookId, Project } from '../../shared/types';

interface ColorGradeViewProps {
  project: Project;
  assets: MediaAsset[];
  onChangeEditPlan: (nextPlan: EditPlan) => void;
}

export const ColorGradeView: React.FC<ColorGradeViewProps> = ({
  project,
  assets,
  onChangeEditPlan,
}) => {
  const plan = project.editPlan;
  const segments = plan?.segments || [];
  const assetsById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const [selectedId, setSelectedId] = useState<string>(segments[0]?.id || '');
  const [compareStage, setCompareStage] = useState<'graded' | 'corrected' | 'original'>('graded');

  const selectedSeg = segments.find((s) => s.id === selectedId) || segments[0] || null;
  const selectedAsset = selectedSeg ? assetsById.get(selectedSeg.assetId) : undefined;

  const updateColor = (patch: Partial<ColorGrade>) => {
    if (!plan || !selectedSeg) return;
    onChangeEditPlan({
      ...plan,
      segments: plan.segments.map((s) =>
        s.id === selectedSeg.id ? { ...s, color: { ...s.color, ...patch } } : s
      ),
    });
  };

  const handleMatchNeighbors = () => {
    if (!plan || !selectedSeg) return;
    const base = selectedSeg.color;
    onChangeEditPlan({
      ...plan,
      segments: plan.segments.map((s) => {
        if (s.locked || s.id === selectedSeg.id) return s;
        return {
          ...s,
          color: {
            ...s.color,
            look: base.look,
            lookIntensity: base.lookIntensity,
            temperature: Math.round((s.color.temperature + base.temperature) / 2),
            tint: Math.round((s.color.tint + base.tint) / 2),
          },
        };
      }),
    });
  };

  if (!plan || !selectedSeg || !selectedAsset) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm font-medium text-[#F2EFE9] mb-1">No timeline clips to grade yet</p>
          <p className="text-xs text-[#9AA0AE]">
            Generate an edit plan or add clips to the timeline in the Edit workspace.
          </p>
        </div>
      </div>
    );
  }

  const filterCss = buildCssFilterFromGrade(selectedSeg.color, compareStage);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0D0E11]">
      <div className="flex-1 min-h-0 grid grid-cols-12 border-b border-[#232730]">
        {/* Color Monitor */}
        <section className="col-span-8 bg-[#0A0B0E] flex flex-col min-h-0">
          <div className="px-4 py-2.5 bg-[#111318] border-b border-[#232730] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#F2EFE9]">{selectedSeg.label}</span>
              <span aria-hidden="true" className="text-[#6C7280]">·</span>
              <span className="text-[#9AA0AE] font-mono">{selectedAsset.metadata.colorSpace}</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 p-0.5 bg-[#0D0E11] border border-[#272B35] rounded">
                {(
                  [
                    { id: 'original', label: 'Original' },
                    { id: 'corrected', label: 'Corrected' },
                    { id: 'graded', label: 'Creative Grade' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setCompareStage(st.id)}
                    className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                      compareStage === st.id
                        ? 'bg-[#D99B43] text-[#0D0E11] font-semibold'
                        : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleMatchNeighbors}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] bg-[#1B1E25] border border-[#2E3340] text-[#F2EFE9] rounded hover:bg-[#242834]"
              >
                <Layers className="w-3.5 h-3.5 text-[#D99B43]" />
                <span>Match Neighboring Shots</span>
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 p-6 flex items-center justify-center overflow-hidden">
            <div className="relative max-w-full max-h-full aspect-video bg-black border border-[#272B35] overflow-hidden">
              <img
                src={selectedAsset.kind === 'photo' ? selectedAsset.mediaUrl : selectedAsset.thumbnailUrl}
                alt={`Color preview of ${selectedSeg.label}`}
                referrerPolicy="no-referrer"
                style={{ filter: filterCss }}
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-2.5 left-3 bg-[#0D0E11]/85 px-2.5 py-1 rounded text-[11px] font-mono text-[#E4E6EC] flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-[#D99B43]" />
                <span>
                  {compareStage === 'original'
                    ? 'Original Source (Bypass)'
                    : compareStage === 'corrected'
                      ? 'Primary Correction Only'
                      : `Primary + ${selectedSeg.color.look.replace(/_/g, ' ')} (${selectedSeg.color.lookIntensity}%)`}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Colorist Controls Inspector */}
        <aside className="col-span-4 bg-[#14161B] border-l border-[#232730] overflow-y-auto p-4 space-y-5">
          {/* Dynamic Range Correction */}
          <DynamicRangePanel
            targetLabel={selectedSeg.label}
            values={{
              exposure: selectedSeg.color.exposure,
              highlights: selectedSeg.color.highlights,
              shadows: selectedSeg.color.shadows,
              whites: selectedSeg.color.whites ?? 0,
              blacks: selectedSeg.color.blacks ?? 0,
            }}
            onChange={(patch) => updateColor(patch)}
            onReset={() =>
              updateColor({ exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 })
            }
            compareOriginal={compareStage === 'original'}
            onToggleCompareOriginal={() =>
              setCompareStage((s) => (s === 'original' ? 'graded' : 'original'))
            }
          />

          {/* White Balance, Contrast & Saturation */}
          <div className="pt-4 border-t border-[#232730] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#F2EFE9]">Color Balance & Tone</h3>
              <button
                type="button"
                onClick={() => updateColor(defaultColorGrade('natural_clean'))}
                className="inline-flex items-center gap-1 text-[11px] text-[#9AA0AE] hover:text-[#F2EFE9]"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Shot</span>
              </button>
            </div>

            {(
              [
                { key: 'contrast', label: 'Contrast', min: -50, max: 50 },
                { key: 'temperature', label: 'White Balance Temp', min: -50, max: 50 },
                { key: 'tint', label: 'Tint (Green / Magenta)', min: -50, max: 50 },
                { key: 'saturation', label: 'Saturation', min: -50, max: 50 },
                { key: 'vibrance', label: 'Vibrance', min: -50, max: 50 },
              ] as const
            ).map((c) => (
              <div key={c.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor={`col-${c.key}`} className="text-[#C8CDD8]">
                    {c.label}
                  </label>
                  <span className="font-mono text-[11px] tabular-nums text-[#F2EFE9]">
                    {selectedSeg.color[c.key] > 0 ? '+' : ''}
                    {selectedSeg.color[c.key]}
                  </span>
                </div>
                <input
                  id={`col-${c.key}`}
                  type="range"
                  min={c.min}
                  max={c.max}
                  value={selectedSeg.color[c.key]}
                  onChange={(e) => updateColor({ [c.key]: Number(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>
            ))}
          </div>

          {/* Creative Look & Intensity */}
          <div className="pt-4 border-t border-[#232730] space-y-3">
            <h3 className="text-xs font-semibold text-[#F2EFE9]">Creative Look</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {PHOTO_LOOK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => updateColor({ look: preset.id as PhotoLookId })}
                  className={`px-2.5 py-2 text-left rounded border text-xs transition-colors ${
                    selectedSeg.color.look === preset.id
                      ? 'bg-[#28231B] border-[#D99B43] text-[#F2EFE9]'
                      : 'bg-[#101216] border-[#232730] text-[#9AA0AE] hover:text-[#F2EFE9]'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="col-look-int" className="text-[#C8CDD8]">
                  Look Intensity
                </label>
                <span className="font-mono text-[11px] tabular-nums">
                  {selectedSeg.color.lookIntensity}%
                </span>
              </div>
              <input
                id="col-look-int"
                type="range"
                min={0}
                max={100}
                value={selectedSeg.color.lookIntensity}
                onChange={(e) => updateColor({ lookIntensity: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>
          </div>
        </aside>
      </div>

      {/* Bottom Shot Strip */}
      <div className="h-28 shrink-0 bg-[#111318] px-4 py-2.5 flex items-center gap-3 overflow-x-auto">
        {segments.map((seg, idx) => {
          const asset = assetsById.get(seg.assetId);
          const active = seg.id === selectedSeg.id;
          return (
            <button
              key={seg.id}
              type="button"
              onClick={() => setSelectedId(seg.id)}
              className={`shrink-0 w-36 rounded overflow-hidden border text-left transition-colors ${
                active ? 'border-[#D99B43] bg-[#221F1A]' : 'border-[#272B35] bg-[#14161B] hover:border-[#3A404F]'
              }`}
            >
              <div className="h-14 bg-black overflow-hidden">
                {asset && (
                  <img
                    src={asset.thumbnailUrl}
                    alt={seg.label}
                    referrerPolicy="no-referrer"
                    style={{ filter: buildCssFilterFromGrade(seg.color, 'graded') }}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="px-2 py-1 text-[10px] truncate text-[#D1D5DF]">
                {idx + 1}. {seg.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
