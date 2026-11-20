import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFfmpegReframeFilter,
  buildReframeFromDetection,
  computeReframeCrop,
  getPreviewReframeStyle,
} from './reframing';
import {
  addTimelineMarker,
  defaultColorGrade,
  deleteTimelineMarker,
  findAdjacentMarker,
  findSegmentAtTime,
  formatTimecode,
  mergeLockedSegments,
  reorderSegments,
  rippleRecalculateTimeline,
  splitSegmentAtTime,
  trimSegment,
  updateTimelineMarker,
} from './timeline';
import {
  adaptPhotoRecipeToBatchLook,
  buildCssFilterFromGrade,
  buildDynamicRangeCurvePoints,
  createDefaultPhotoRecipe,
  resolveEffectiveGrade,
} from './photoMath';
import type { EditPlan, VideoSegment } from './types';

test('Intelligent Reframing centers detected subject when cropping 16:9 to 9:16', () => {
  const reframe = buildReframeFromDetection(
    {
      label: 'Artisan roaster portrait',
      confidence: 0.92,
      centerX: 0.72,
      centerY: 0.44,
      boxWidth: 0.22,
      boxHeight: 0.6,
      shotScale: 'medium',
      cameraMovement: 'static',
      qualityNotes: 'Sharp focus',
    },
    1920,
    1080,
    '9:16',
    'gemini-4-neon'
  );

  const crop = computeReframeCrop(1920, 1080, reframe);
  // Output crop aspect ratio should match 9:16 closely
  const actualAspect = crop.pixelWidth / crop.pixelHeight;
  assert.ok(Math.abs(actualAspect - 9 / 16) < 0.02, `Expected ~0.5625, got ${actualAspect}`);
  // Crop window should shift right toward subject at x=0.72 without overflowing source bounds
  assert.ok(crop.pixelX > 800, `Expected right-shifted cropX > 800, got ${crop.pixelX}`);
  assert.ok(crop.pixelX + crop.pixelWidth <= 1920);
  // Even pixel dimensions for FFmpeg compatibility
  assert.equal(crop.pixelWidth % 2, 0);
  assert.equal(crop.pixelHeight % 2, 0);
});

test('Intelligent Reframing flags wide subjects that exceed narrow 9:16 crop window', () => {
  const reframe = buildReframeFromDetection(
    {
      label: 'Wide coastal highway panorama',
      confidence: 0.88,
      centerX: 0.5,
      centerY: 0.5,
      boxWidth: 0.75,
      boxHeight: 0.5,
      shotScale: 'wide',
      cameraMovement: 'pan',
      qualityNotes: 'Clean exposure',
    },
    1920,
    1080,
    '9:16',
    'gemini-4-neon'
  );
  assert.ok(reframe.warning && reframe.warning.includes('spans wider'));
});

test('FFmpeg reframe filter builds valid non-destructive crop+scale or fit+pad', () => {
  const autoReframe = buildReframeFromDetection(undefined, 1920, 1080, '1:1', 'local-saliency');
  const filter = buildFfmpegReframeFilter(1920, 1080, autoReframe, 1080, 1080);
  assert.match(filter, /^crop=1080:1080:420:0,scale=1080:1080/);

  const fitFilter = buildFfmpegReframeFilter(
    1920,
    1080,
    { ...autoReframe, mode: 'fit' },
    1080,
    1920
  );
  assert.match(fitFilter, /force_original_aspect_ratio=decrease,pad=1080:1920/);

  const style = getPreviewReframeStyle(1920, 1080, autoReframe, 0.5);
  assert.equal(style.objectFit, 'cover');
});

test('Timeline SMPTE timecode, split, trim, reorder, and locked regeneration rules work', () => {
  assert.equal(formatTimecode(65.5, 24), '00:01:05:12');

  const seg1: VideoSegment = {
    id: 'seg-1',
    assetId: 'asset-1',
    mediaKind: 'video',
    label: 'Opening Highway',
    sourceInSec: 0,
    sourceOutSec: 6,
    timelineInSec: 0,
    timelineOutSec: 6,
    editorialRole: 'opening',
    selectionReason: 'Strong establishing motion',
    confidence: 0.9,
    warnings: [],
    reframe: buildReframeFromDetection(undefined, 1920, 1080, '16:9', 'local-saliency'),
    speed: 1,
    transitionIn: 'cut',
    transitionDurationSec: 0,
    color: defaultColorGrade(),
    audioMode: 'normal',
    audioGainDb: 0,
    locked: true,
  };

  const seg2: VideoSegment = {
    ...seg1,
    id: 'seg-2',
    assetId: 'asset-2',
    label: 'Roaster Detail',
    sourceInSec: 0,
    sourceOutSec: 4,
    timelineInSec: 6,
    timelineOutSec: 10,
    locked: false,
  };

  const split = splitSegmentAtTime([seg1, seg2], 'seg-1', 2.5);
  assert.equal(split.length, 3);
  assert.equal(split[0].timelineOutSec, 2.5);
  assert.equal(split[1].timelineInSec, 2.5);
  assert.equal(split[2].timelineOutSec, 10);

  const reordered = reorderSegments(rippleRecalculateTimeline([seg1, seg2]), 0, 1);
  assert.equal(reordered[0].id, 'seg-2');
  assert.equal(reordered[0].timelineInSec, 0);
  assert.equal(reordered[1].timelineInSec, 4);

  const trimmed = trimSegment([seg1, seg2], 'seg-2', 1, 3.5, 10);
  assert.equal(trimmed[1].timelineOutSec, 8.5);

  const found = findSegmentAtTime(trimmed, 7.0);
  assert.equal(found?.segment.id, 'seg-2');

  const existingPlan: EditPlan = {
    version: 1,
    aspectRatio: '16:9',
    fps: 24,
    summary: {
      intendedViewer: 'Editorial',
      storyEmphasis: 'Craft',
      visualMoodAndPace: 'Calm',
      mediaUsageStrategy: 'Mixed',
      estimatedDurationSec: 10,
      photoEditScope: '2 photos',
      assumptions: [],
      sourceLimitations: [],
      prioritizedChoices: [],
      engineUsed: 'local',
      generatedAt: new Date().toISOString(),
    },
    segments: [seg1, seg2],
    captions: [],
    titles: [],
    audioMix: {
      musicAssetId: null,
      musicGainDb: -12,
      dialogueGainDb: 0,
      autoDucking: true,
      duckAmountDb: -10,
      smoothLevels: true,
      noiseReduction: false,
      fadeInSec: 0.5,
      fadeOutSec: 1.0,
      masterMuted: false,
    },
    showLogoWatermark: false,
    logoPosition: 'top_right',
  };

  const regenerated = mergeLockedSegments(existingPlan, {
    ...existingPlan,
    version: 2,
    segments: [{ ...seg2, label: 'Updated Roaster' }],
  });
  assert.equal(regenerated.segments.length, 2);
  assert.ok(regenerated.segments.some((s) => s.id === 'seg-1' && s.locked));
});

test('Photo grading & batch consistency adapt per image and respect locks', () => {
  const photoA = createDefaultPhotoRecipe('p1', 'natural_clean');
  photoA.tone.exposure = 0.4;
  photoA.color.temperature = 14;

  const photoB = createDefaultPhotoRecipe('p2', 'natural_clean');
  photoB.tone.exposure = -0.3;
  photoB.color.temperature = -10;

  const photoLocked = createDefaultPhotoRecipe('p3', 'editorial_neutral');
  photoLocked.locked = true;

  const adaptedB = adaptPhotoRecipeToBatchLook(
    photoB,
    'warm_lifestyle',
    70,
    80,
    photoA,
    true
  );
  assert.equal(adaptedB.look, 'warm_lifestyle');
  // Adapted rather than blindly copied identically from photoA
  assert.notEqual(adaptedB.tone.exposure, photoA.tone.exposure);
  assert.ok(adaptedB.color.temperature > photoB.color.temperature);

  const unchangedLocked = adaptPhotoRecipeToBatchLook(
    photoLocked,
    'warm_lifestyle',
    70,
    100,
    photoA,
    false
  );
  assert.equal(unchangedLocked.look, 'editorial_neutral');

  const orig = resolveEffectiveGrade(
    { ...photoA.tone, ...photoA.color, look: 'black_and_white', lookIntensity: 100 },
    'original'
  );
  assert.equal(orig.grayscale, 0);
  const bwFilter = buildCssFilterFromGrade(
    { ...photoA.tone, ...photoA.color, look: 'black_and_white', lookIntensity: 100 },
    'graded'
  );
  assert.match(bwFilter, /grayscale\(1\)/);
});

test('Dynamic Range Correction shapes 5-point tone curve and resolves non-destructively', () => {
  const neutral = buildDynamicRangeCurvePoints({
    exposure: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
  });
  assert.deepEqual(
    neutral.map((p) => p.y),
    [0, 0.25, 0.5, 0.75, 1]
  );

  const recovered = buildDynamicRangeCurvePoints({
    exposure: 0.5,
    highlights: -40,
    shadows: 35,
    whites: -15,
    blacks: 10,
  });
  // Shadow point lifts above 0.25, black floor lifts above 0, highlight rolloff stays bounded <= 1
  assert.ok(recovered[0].y > 0, `Expected blacks lift > 0, got ${recovered[0].y}`);
  assert.ok(recovered[1].y > 0.35, `Expected shadows lift > 0.35, got ${recovered[1].y}`);
  assert.ok(recovered[3].y < 0.75, `Expected highlights recovery < 0.75, got ${recovered[3].y}`);

  const drRecovered = resolveEffectiveGrade(
    {
      exposure: 0.4,
      contrast: 0,
      highlights: -35,
      shadows: 35,
      whites: 0,
      blacks: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      look: 'natural_clean',
      lookIntensity: 0,
    },
    'graded'
  );
  assert.ok(drRecovered.brightness > 1.05);
  assert.ok(drRecovered.contrast < 1.0);

  const drExpanded = resolveEffectiveGrade(
    {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 30,
      blacks: -30,
      saturation: 0,
      temperature: 0,
      tint: 0,
      look: 'natural_clean',
      lookIntensity: 0,
    },
    'graded'
  );
  assert.ok(drExpanded.contrast > 1.05);
});

test('Custom Timeline Markers add, clamp, sort, rename, recolor, jump, and delete cleanly', () => {
  const step1 = addTimelineMarker(
    [],
    { id: 'm1', timeSec: 9.4, name: 'Climax Cut', color: 'rose', note: 'Peak music swell' },
    18
  );
  const step2 = addTimelineMarker(
    step1.markers,
    { id: 'm2', timeSec: 1.2, name: 'Opening Hook', color: 'amber' },
    18
  );
  const step3 = addTimelineMarker(
    step2.markers,
    { id: 'm3', timeSec: 99, name: 'End Beat', color: 'sky' },
    18
  );

  // Sorted chronologically and clamped to timeline max duration
  assert.deepEqual(
    step3.markers.map((m) => m.id),
    ['m2', 'm1', 'm3']
  );
  assert.equal(step3.markers[2].timeSec, 18);

  // Rename and recolor
  const renamed = updateTimelineMarker(
    step3.markers,
    'm1',
    { name: 'Roaster Reveal', color: 'emerald' },
    18
  );
  assert.equal(renamed[1].name, 'Roaster Reveal');
  assert.equal(renamed[1].color, 'emerald');

  // Prev / next marker navigation
  assert.equal(findAdjacentMarker(renamed, 2.0, 'next')?.id, 'm1');
  assert.equal(findAdjacentMarker(renamed, 2.0, 'prev')?.id, 'm2');
  assert.equal(findAdjacentMarker(renamed, 18.0, 'next')?.id, 'm2'); // wraps cleanly

  // Delete marker
  const afterDelete = deleteTimelineMarker(renamed, 'm1');
  assert.deepEqual(
    afterDelete.map((m) => m.id),
    ['m2', 'm3']
  );
});

