import type { AspectRatio, ReframeConfig, SubjectDetection } from './types';

export interface ComputedCropRect {
  // Normalized 0..1 coordinates inside the original source media
  x: number;
  y: number;
  width: number;
  height: number;
  // Exact even-aligned pixel values for FFmpeg crop filter
  pixelX: number;
  pixelY: number;
  pixelWidth: number;
  pixelHeight: number;
  // Scale factor relative to native source width/height (for upscale honesty)
  cropCoverageRatio: number;
  warning: string | null;
}

export function parseAspectRatio(ratio: AspectRatio | string): number {
  switch (ratio) {
    case '16:9':
      return 16 / 9;
    case '9:16':
      return 9 / 16;
    case '1:1':
      return 1;
    case '4:5':
      return 4 / 5;
    case '4:3':
      return 4 / 3;
    case '3:2':
      return 3 / 2;
    default: {
      const parts = ratio.split(':').map(Number);
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        return parts[0] / parts[1];
      }
      return 16 / 9;
    }
  }
}

export function getOutputDimensions(
  aspectRatio: AspectRatio,
  preset: '1080p' | '720p' | '4k' = '1080p'
): { width: number; height: number } {
  const shortSide = preset === '4k' ? 2160 : preset === '720p' ? 720 : 1080;
  switch (aspectRatio) {
    case '16:9':
      return preset === '4k'
        ? { width: 3840, height: 2160 }
        : preset === '720p'
          ? { width: 1280, height: 720 }
          : { width: 1920, height: 1080 };
    case '9:16':
      return preset === '4k'
        ? { width: 2160, height: 3840 }
        : preset === '720p'
          ? { width: 720, height: 1280 }
          : { width: 1080, height: 1920 };
    case '1:1':
      return { width: shortSide, height: shortSide };
    case '4:5': {
      const width = shortSide;
      const height = Math.round((shortSide * 5) / 4 / 2) * 2;
      return { width, height };
    }
  }
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function toEven(n: number, maxVal: number): number {
  const clamped = Math.max(2, Math.min(maxVal, Math.round(n)));
  return clamped % 2 === 0 ? clamped : Math.max(2, clamped - 1);
}

/**
 * Pure non-destructive Intelligent Reframing geometry solver.
 * Given original media dimensions and a ReframeConfig, calculates exact normalized
 * and pixel-aligned crop bounds that keep the subject centered with safe headroom
 * while flagging excessive crop loss honestly.
 */
export function computeReframeCrop(
  sourceWidth: number,
  sourceHeight: number,
  reframe: ReframeConfig
): ComputedCropRect {
  const sw = Math.max(2, Math.round(sourceWidth));
  const sh = Math.max(2, Math.round(sourceHeight));
  const sourceAspect = sw / sh;
  const targetAspect = parseAspectRatio(reframe.targetAspectRatio);

  if (reframe.mode === 'fit') {
    return {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      pixelX: 0,
      pixelY: 0,
      pixelWidth: toEven(sw, sw),
      pixelHeight: toEven(sh, sh),
      cropCoverageRatio: 1,
      warning:
        Math.abs(sourceAspect - targetAspect) > 0.15
          ? 'Fit mode preserves the entire original frame with letterboxing/pillarboxing.'
          : null,
    };
  }

  const zoom = clamp(reframe.zoom || 1, 1, 2.5);

  // Maximum normalized crop rectangle matching targetAspect inside source frame
  let baseCropW: number;
  let baseCropH: number;
  if (sourceAspect > targetAspect) {
    // Source is wider than target (e.g. 16:9 -> 9:16): constrain by height
    baseCropH = 1;
    baseCropW = targetAspect / sourceAspect;
  } else {
    // Source is taller than target (e.g. 3:4 -> 16:9): constrain by width
    baseCropW = 1;
    baseCropH = sourceAspect / targetAspect;
  }

  const cropW = clamp(baseCropW / zoom, 0.12, 1);
  const cropH = clamp(baseCropH / zoom, 0.12, 1);

  // Safe headroom shifts vertical framing slightly upward for portraits/people
  const headroomOffset = reframe.safeHeadroom ? -0.045 * cropH : 0;
  const targetCenterX = clamp(reframe.focalX, 0, 1);
  const targetCenterY = clamp(reframe.focalY + headroomOffset, 0, 1);

  const x = clamp(targetCenterX - cropW / 2, 0, 1 - cropW);
  const y = clamp(targetCenterY - cropH / 2, 0, 1 - cropH);

  const pixelWidth = toEven(cropW * sw, sw);
  const pixelHeight = toEven(cropH * sh, sh);
  const pixelX = Math.max(0, Math.min(sw - pixelWidth, Math.round(x * sw)));
  const pixelY = Math.max(0, Math.min(sh - pixelHeight, Math.round(y * sh)));

  const cropCoverageRatio = (pixelWidth * pixelHeight) / (sw * sh);

  let warning: string | null = reframe.warning;
  if (!warning) {
    if (cropCoverageRatio < 0.28) {
      warning =
        'Heavy aspect-ratio crop retains under 28% of source area. Inspect edges and avoid excessive zoom.';
    } else if (reframe.confidence > 0 && reframe.confidence < 0.55) {
      warning =
        'Low subject-tracking confidence on this shot. Review focal framing in the Reframe inspector.';
    } else if (pixelWidth < 640 || pixelHeight < 640) {
      warning =
        'Cropped region is lower resolution than HD export; upscaling will not restore missing detail.';
    }
  }

  return {
    x,
    y,
    width: cropW,
    height: cropH,
    pixelX,
    pixelY,
    pixelWidth,
    pixelHeight,
    cropCoverageRatio,
    warning,
  };
}

/**
 * Generates an initial intelligent ReframeConfig from a SubjectDetection result
 * (either Gemini 4 Neon video/image analysis or deterministic local saliency).
 */
export function buildReframeFromDetection(
  detection: SubjectDetection | undefined,
  sourceWidth: number,
  sourceHeight: number,
  targetAspectRatio: AspectRatio,
  analyzedBy: ReframeConfig['analyzedBy'],
  isPhotoStill = false
): ReframeConfig {
  const focalX = detection ? clamp(detection.centerX, 0.08, 0.92) : 0.5;
  const focalY = detection ? clamp(detection.centerY, 0.08, 0.92) : 0.48;
  const isPerson =
    detection?.label.toLowerCase().includes('person') ||
    detection?.label.toLowerCase().includes('portrait') ||
    detection?.label.toLowerCase().includes('speaker') ||
    detection?.label.toLowerCase().includes('roaster') ||
    detection?.label.toLowerCase().includes('filmmaker') ||
    detection?.label.toLowerCase().includes('face') ||
    false;

  const baseConfig: ReframeConfig = {
    mode: 'auto',
    targetAspectRatio,
    focalX,
    focalY,
    zoom: 1.0,
    safeHeadroom: isPerson,
    subjectLabel: detection?.label || 'Primary frame center',
    confidence: detection?.confidence ?? 0.72,
    motionEnabled: isPhotoStill,
    motionScaleEnd: isPhotoStill ? 1.05 : 1.0,
    motionEndX: clamp(focalX + (focalX < 0.5 ? 0.03 : -0.03), 0.1, 0.9),
    motionEndY: focalY,
    warning: null,
    analyzedBy,
  };

  // Validate feasibility immediately
  const computed = computeReframeCrop(sourceWidth, sourceHeight, baseConfig);
  if (detection && detection.boxWidth > computed.width * 1.15) {
    baseConfig.warning = `Detected subject ("${detection.label}") spans wider than the ${targetAspectRatio} crop window. Consider Fit mode or manual adjustment.`;
  } else {
    baseConfig.warning = computed.warning;
  }

  return baseConfig;
}

/**
 * Produces CSS object-position and transform values to accurately preview
 * the non-destructive reframe crop inside a container matching targetAspectRatio.
 */
export function getPreviewReframeStyle(
  sourceWidth: number,
  sourceHeight: number,
  reframe: ReframeConfig,
  progressInSegment = 0
): {
  objectFit: 'cover' | 'contain';
  objectPosition: string;
  transform: string;
} {
  if (reframe.mode === 'fit') {
    return {
      objectFit: 'contain',
      objectPosition: '50% 50%',
      transform: 'scale(1)',
    };
  }

  const crop = computeReframeCrop(sourceWidth, sourceHeight, reframe);
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;

  // Interpolate subtle still-image pan/zoom if enabled
  const t = clamp(progressInSegment, 0, 1);
  const effectiveX = reframe.motionEnabled
    ? centerX + (reframe.motionEndX - centerX) * t
    : centerX;
  const effectiveY = reframe.motionEnabled
    ? centerY + (reframe.motionEndY - centerY) * t
    : centerY;
  const motionScale = reframe.motionEnabled
    ? 1 + (clamp(reframe.motionScaleEnd || 1.05, 1, 1.18) - 1) * t
    : 1;

  const totalZoom = clamp((reframe.zoom || 1) * motionScale, 1, 2.5);

  return {
    objectFit: 'cover',
    objectPosition: `${(effectiveX * 100).toFixed(2)}% ${(effectiveY * 100).toFixed(2)}%`,
    transform: `scale(${totalZoom.toFixed(4)})`,
  };
}

/**
 * Builds the exact FFmpeg video filter chain segment for a non-destructive reframe.
 */
export function buildFfmpegReframeFilter(
  sourceWidth: number,
  sourceHeight: number,
  reframe: ReframeConfig,
  outputWidth: number,
  outputHeight: number
): string {
  if (reframe.mode === 'fit') {
    return `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2:color=#0D0E11`;
  }
  const crop = computeReframeCrop(sourceWidth, sourceHeight, reframe);
  return `crop=${crop.pixelWidth}:${crop.pixelHeight}:${crop.pixelX}:${crop.pixelY},scale=${outputWidth}:${outputHeight}:flags=lanczos`;
}
