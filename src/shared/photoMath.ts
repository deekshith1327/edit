import type { ColorGrade, PhotoEditRecipe, PhotoLookId } from './types';

export interface PhotoLookPreset {
  id: PhotoLookId;
  name: string;
  description: string;
  contrastDelta: number;
  saturationDelta: number;
  temperatureDelta: number;
  tintDelta: number;
  exposureDelta: number;
  monochrome?: boolean;
}

export const PHOTO_LOOK_PRESETS: PhotoLookPreset[] = [
  {
    id: 'natural_clean',
    name: 'Natural Clean',
    description: 'Balanced tonal neutrality with authentic skin and true-to-life whites.',
    contrastDelta: 6,
    saturationDelta: 4,
    temperatureDelta: 2,
    tintDelta: 0,
    exposureDelta: 0.05,
  },
  {
    id: 'cinematic_contrast',
    name: 'Cinematic Contrast',
    description: 'Controlled roll-off, rich midtone depth, subtle warm highlights.',
    contrastDelta: 18,
    saturationDelta: -6,
    temperatureDelta: 8,
    tintDelta: -2,
    exposureDelta: -0.04,
  },
  {
    id: 'warm_lifestyle',
    name: 'Warm Lifestyle',
    description: 'Golden-hour warmth with gentle lifted shadows and natural saturation.',
    contrastDelta: 8,
    saturationDelta: 8,
    temperatureDelta: 16,
    tintDelta: 3,
    exposureDelta: 0.1,
  },
  {
    id: 'editorial_neutral',
    name: 'Editorial Neutral',
    description: 'Restrained documentary neutrality tuned for architecture and portraits.',
    contrastDelta: 10,
    saturationDelta: -10,
    temperatureDelta: -3,
    tintDelta: 0,
    exposureDelta: 0,
  },
  {
    id: 'commercial_product',
    name: 'Commercial Product',
    description: 'Crisp micro-contrast and clean color separation preserving brand hues.',
    contrastDelta: 14,
    saturationDelta: 6,
    temperatureDelta: -2,
    tintDelta: 0,
    exposureDelta: 0.08,
  },
  {
    id: 'black_and_white',
    name: 'Black & White',
    description: 'Monochrome tonal print with structured shadows and clean luminance.',
    contrastDelta: 22,
    saturationDelta: -100,
    temperatureDelta: 0,
    tintDelta: 0,
    exposureDelta: 0.02,
    monochrome: true,
  },
  {
    id: 'match_reference',
    name: 'Match Reference',
    description: 'Adapts exposure and white balance toward the chosen reference photo.',
    contrastDelta: 12,
    saturationDelta: 2,
    temperatureDelta: 6,
    tintDelta: 1,
    exposureDelta: 0.04,
  },
];

export function getLookPreset(id: PhotoLookId): PhotoLookPreset {
  return PHOTO_LOOK_PRESETS.find((p) => p.id === id) || PHOTO_LOOK_PRESETS[0];
}

export function createDefaultPhotoRecipe(
  assetId: string,
  look: PhotoLookId = 'natural_clean',
  includedInTimeline = true
): PhotoEditRecipe {
  return {
    assetId,
    accepted: true,
    locked: false,
    includedInTimeline,
    crop: {
      aspectRatio: 'original',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotationDeg: 0,
      perspectiveY: 0,
    },
    tone: {
      exposure: 0,
      contrast: 4,
      highlights: -4,
      shadows: 6,
      whites: 2,
      blacks: -2,
    },
    color: {
      temperature: 0,
      tint: 0,
      saturation: 2,
      vibrance: 6,
    },
    detail: {
      sharpening: 18,
      noiseReduction: 10,
      portraitCleanup: false,
      lensCorrection: true,
    },
    look,
    lookIntensity: 65,
    generativeEdits: [],
    analysisNotes: 'Initial balanced correction preserving original tonal range.',
    confidence: 0.85,
    processingProvider: 'sharp-local',
    warnings: [],
    updatedAt: new Date().toISOString(),
  };
}

export interface DynamicRangeParams {
  exposure: number; // -2..2
  highlights?: number; // -50..50
  shadows?: number; // -50..50
  whites?: number; // -50..50
  blacks?: number; // -50..50
}

/**
 * Computes 5 normalized control points [0, 0.25, 0.5, 0.75, 1.0] for the live
 * Dynamic Range tone curve visualization and FFmpeg curves filter.
 */
export function buildDynamicRangeCurvePoints(dr: DynamicRangeParams): Array<{ x: number; y: number }> {
  const expShift = (dr.exposure || 0) * 0.14;
  const blk = (dr.blacks || 0) / 250; // -0.2..0.2
  const shd = (dr.shadows || 0) / 220;
  const hlt = (dr.highlights || 0) / 220;
  const wht = (dr.whites || 0) / 250;

  const clamp01 = (v: number) => Number(Math.max(0, Math.min(1, v)).toFixed(3));
  return [
    { x: 0, y: clamp01(0 + blk * 0.65 + expShift * 0.25) },
    { x: 0.25, y: clamp01(0.25 + shd * 0.8 + blk * 0.35 + expShift * 0.7) },
    { x: 0.5, y: clamp01(0.5 + expShift + (shd + hlt) * 0.22) },
    { x: 0.75, y: clamp01(0.75 + hlt * 0.8 + wht * 0.35 + expShift * 0.75) },
    { x: 1, y: clamp01(1 + wht * 0.65 + expShift * 0.2) },
  ];
}

/**
 * Computes effective numeric grading parameters by combining base correction,
 * dynamic range tone adjustments (exposure, highlights, shadows, whites, blacks),
 * and scaled look preset deltas (reversible, non-destructive).
 */
export function resolveEffectiveGrade(
  base: {
    exposure: number;
    contrast: number;
    highlights?: number;
    shadows?: number;
    whites?: number;
    blacks?: number;
    saturation: number;
    temperature: number;
    tint: number;
    vibrance?: number;
    look: PhotoLookId;
    lookIntensity: number;
  },
  stage: 'original' | 'corrected' | 'graded' = 'graded'
): {
  brightness: number; // CSS/Sharp multiplier (1.0 = neutral)
  contrast: number; // CSS multiplier (1.0 = neutral)
  saturate: number; // CSS/Sharp multiplier (1.0 = neutral)
  sepia: number; // 0..0.35 subtle warm shift
  hueRotateDeg: number; // -15..15
  grayscale: number; // 0..1
  gamma: number; // 0.6..1.6 for midtone/shadow lift
} {
  if (stage === 'original') {
    return {
      brightness: 1,
      contrast: 1,
      saturate: 1,
      sepia: 0,
      hueRotateDeg: 0,
      grayscale: 0,
      gamma: 1,
    };
  }

  const preset = getLookPreset(base.look);
  const weight = stage === 'corrected' ? 0 : Math.max(0, Math.min(1, base.lookIntensity / 100));

  const shadows = base.shadows || 0;
  const highlights = base.highlights || 0;
  const whites = base.whites || 0;
  const blacks = base.blacks || 0;

  // Dynamic range affects overall exposure lift and micro-contrast cleanly
  const drExposureDelta = (shadows * 0.0045) + (highlights * 0.004) + (whites * 0.0035) + (blacks * 0.0035);
  const drContrastDelta = ((whites - blacks) * 0.28) + ((highlights - shadows) * 0.22);

  const exposure = base.exposure + drExposureDelta + preset.exposureDelta * weight;
  const contrastVal = base.contrast + drContrastDelta + preset.contrastDelta * weight;
  const satVal = base.saturation + (base.vibrance || 0) * 0.35 + preset.saturationDelta * weight;
  const tempVal = base.temperature + preset.temperatureDelta * weight;
  const tintVal = base.tint + preset.tintDelta * weight;

  const brightness = Math.max(0.5, Math.min(1.75, Math.pow(2, exposure * 0.45)));
  const contrast = Math.max(0.6, Math.min(1.65, 1 + contrastVal / 120));
  const saturate = preset.monochrome
    ? Math.max(0, 1 - weight)
    : Math.max(0, Math.min(1.8, 1 + satVal / 100));

  const sepia = tempVal > 0 ? Math.min(0.28, (tempVal / 100) * 0.38) : 0;
  const hueRotateDeg = Math.max(-18, Math.min(18, (tintVal * 0.25) + (tempVal < 0 ? tempVal * 0.14 : 0)));
  const grayscale = preset.monochrome ? weight : 0;
  const gamma = Math.max(0.65, Math.min(1.5, 1 + (shadows * 0.004) - (blacks * 0.002)));

  return {
    brightness: Number(brightness.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
    saturate: Number(saturate.toFixed(3)),
    sepia: Number(sepia.toFixed(3)),
    hueRotateDeg: Number(hueRotateDeg.toFixed(2)),
    grayscale: Number(grayscale.toFixed(3)),
    gamma: Number(gamma.toFixed(3)),
  };
}

export function buildCssFilterFromGrade(
  grade: ColorGrade | {
    exposure: number;
    contrast: number;
    highlights?: number;
    shadows?: number;
    whites?: number;
    blacks?: number;
    saturation: number;
    temperature: number;
    tint: number;
    vibrance?: number;
    look: PhotoLookId;
    lookIntensity: number;
  },
  stage: 'original' | 'corrected' | 'graded' = 'graded'
): string {
  const g = resolveEffectiveGrade(grade, stage);
  if (stage === 'original') return 'none';
  return `brightness(${g.brightness}) contrast(${g.contrast}) saturate(${g.saturate}) sepia(${g.sepia}) hue-rotate(${g.hueRotateDeg}deg) grayscale(${g.grayscale})`;
}

/**
 * Adapts a shared BatchLookProfile to an individual photo recipe rather than blindly
 * cloning identical numeric sliders — respects distinct exposure and preserves locked photos.
 */
export function adaptPhotoRecipeToBatchLook(
  recipe: PhotoEditRecipe,
  targetLook: PhotoLookId,
  targetIntensity: number,
  consistencyStrength: number,
  referenceRecipe?: PhotoEditRecipe | null,
  preserveDistinctLighting = true
): PhotoEditRecipe {
  if (recipe.locked) return recipe;

  const strength = Math.max(0, Math.min(1, consistencyStrength / 100));
  const damping = preserveDistinctLighting ? 0.55 : 0.85;
  const blend = strength * damping;

  const refTemp = referenceRecipe?.color.temperature ?? 0;
  const refTint = referenceRecipe?.color.tint ?? 0;
  const refContrast = referenceRecipe?.tone.contrast ?? 6;
  const refExposure = referenceRecipe?.tone.exposure ?? 0;

  // Adapt gently toward reference while retaining individual photo's base correction
  const adaptedExposure = preserveDistinctLighting
    ? Number((recipe.tone.exposure * (1 - blend * 0.35) + refExposure * (blend * 0.35)).toFixed(2))
    : Number((recipe.tone.exposure * (1 - blend) + refExposure * blend).toFixed(2));

  return {
    ...recipe,
    look: targetLook,
    lookIntensity: Math.round(targetIntensity),
    tone: {
      ...recipe.tone,
      exposure: adaptedExposure,
      contrast: Math.round(recipe.tone.contrast * (1 - blend) + refContrast * blend),
    },
    color: {
      ...recipe.color,
      temperature: Math.round(recipe.color.temperature * (1 - blend) + refTemp * blend),
      tint: Math.round(recipe.color.tint * (1 - blend) + refTint * blend),
    },
    updatedAt: new Date().toISOString(),
  };
}
