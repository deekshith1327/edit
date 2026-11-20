import React, { useMemo } from 'react';
import { Eye, RotateCcw, AlertTriangle } from 'lucide-react';
import { buildDynamicRangeCurvePoints } from '../../shared/photoMath';

export interface DynamicRangeValues {
  exposure: number; // -2..2
  highlights: number; // -50..50
  shadows: number; // -50..50
  whites: number; // -50..50
  blacks: number; // -50..50
}

interface DynamicRangePanelProps {
  values: DynamicRangeValues;
  onChange: (patch: Partial<DynamicRangeValues>) => void;
  onReset: () => void;
  compareOriginal: boolean;
  onToggleCompareOriginal: () => void;
  targetLabel: string;
}

export const DynamicRangePanel: React.FC<DynamicRangePanelProps> = ({
  values,
  onChange,
  onReset,
  compareOriginal,
  onToggleCompareOriginal,
  targetLabel,
}) => {
  const points = useMemo(() => buildDynamicRangeCurvePoints(values), [values]);

  const svgPath = useMemo(() => {
    // Map normalized [0..1] into SVG viewport 220x84 with 8px padding
    const w = 204;
    const h = 68;
    const ox = 8;
    const oy = 8;
    const coords = points.map((p) => ({
      x: ox + p.x * w,
      y: oy + (1 - p.y) * h,
    }));
    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[Math.max(0, i - 1)];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[Math.min(coords.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return { d, coords };
  }, [points]);

  const hasAdjustment =
    Math.abs(values.exposure) > 0.01 ||
    values.highlights !== 0 ||
    values.shadows !== 0 ||
    values.whites !== 0 ||
    values.blacks !== 0;

  const highlightClipRisk = values.exposure > 1.1 || values.whites > 36 || values.highlights > 40;
  const shadowCrushRisk = values.exposure < -1.1 || values.blacks < -36 || values.shadows < -40;

  const sliders: Array<{
    key: keyof DynamicRangeValues;
    label: string;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
  }> = [
    {
      key: 'exposure',
      label: 'Exposure',
      min: -2,
      max: 2,
      step: 0.05,
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`,
    },
    {
      key: 'highlights',
      label: 'Highlights',
      min: -50,
      max: 50,
      step: 1,
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    },
    {
      key: 'shadows',
      label: 'Shadows',
      min: -50,
      max: 50,
      step: 1,
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    },
    {
      key: 'whites',
      label: 'Whites',
      min: -50,
      max: 50,
      step: 1,
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    },
    {
      key: 'blacks',
      label: 'Blacks',
      min: -50,
      max: 50,
      step: 1,
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
    },
  ];

  return (
    <div className="space-y-3.5" data-testid="dynamic-range-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-[#F2EFE9]">Dynamic Range Correction</h3>
          <p className="text-[11px] text-[#9AA0AE] truncate max-w-[180px]" title={targetLabel}>
            Non-destructive · {targetLabel}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleCompareOriginal}
            aria-pressed={compareOriginal}
            title="Compare against untouched original"
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
              compareOriginal
                ? 'bg-[#D99B43] text-[#0D0E11] border-[#D99B43]'
                : 'bg-[#1B1E25] text-[#D1D5DF] border-[#2C313D] hover:border-[#41485A]'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>{compareOriginal ? 'Original' : 'Compare'}</span>
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!hasAdjustment}
            aria-label="Reset dynamic range adjustments"
            title="Reset dynamic range"
            className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] disabled:opacity-40 rounded hover:bg-[#222630]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Live Tone Response Curve Scope */}
      <div className="bg-[#0B0C0F] border border-[#232730] rounded p-2">
        <div className="flex items-center justify-between text-[10px] font-mono text-[#6C7280] mb-1 px-1">
          <span>Blacks</span>
          <span>Shadows</span>
          <span>Mid</span>
          <span>Highlights</span>
          <span>Whites</span>
        </div>
        <svg
          viewBox="0 0 220 84"
          className="w-full h-20 block"
          role="img"
          aria-label="Dynamic range luminance tone curve"
        >
          {/* Subtle grid */}
          <line x1="8" y1="76" x2="212" y2="8" stroke="#272B35" strokeDasharray="3 3" strokeWidth="1" />
          <line x1="59" y1="8" x2="59" y2="76" stroke="#1B1E25" strokeWidth="1" />
          <line x1="110" y1="8" x2="110" y2="76" stroke="#1B1E25" strokeWidth="1" />
          <line x1="161" y1="8" x2="161" y2="76" stroke="#1B1E25" strokeWidth="1" />
          {/* Active tone curve */}
          <path
            d={svgPath.d}
            fill="none"
            stroke={compareOriginal ? '#6C7280' : '#D99B43'}
            strokeWidth="2"
          />
          {svgPath.coords.map((c, idx) => (
            <circle
              key={idx}
              cx={c.x}
              cy={c.y}
              r="2.6"
              fill={compareOriginal ? '#6C7280' : '#F2EFE9'}
              stroke="#0B0C0F"
              strokeWidth="1"
            />
          ))}
        </svg>
      </div>

      {/* Precision Dynamic Range Sliders */}
      <div className="space-y-2.5">
        {sliders.map((s) => {
          const val = values[s.key] ?? 0;
          return (
            <div key={s.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor={`dr-${s.key}`} className="text-[#C8CDD8]">
                  {s.label}
                </label>
                <button
                  type="button"
                  onClick={() => onChange({ [s.key]: 0 })}
                  title={`Click to reset ${s.label} to 0`}
                  className="font-mono text-[11px] tabular-nums text-[#F2EFE9] hover:text-[#D99B43]"
                >
                  {s.format(val)}
                </button>
              </div>
              <input
                id={`dr-${s.key}`}
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={val}
                onChange={(e) => onChange({ [s.key]: Number(e.target.value) })}
                className="w-full studio-slider"
              />
            </div>
          );
        })}
      </div>

      {(highlightClipRisk || shadowCrushRisk) && (
        <div className="p-2 rounded bg-amber-950/35 border border-amber-800/50 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span>
            {highlightClipRisk
              ? 'Highlight clipping risk: pull Highlights or Whites slightly down to preserve bright detail.'
              : 'Shadow crush risk: lift Shadows or Blacks slightly to keep dark detail legible.'}
          </span>
        </div>
      )}
    </div>
  );
};
