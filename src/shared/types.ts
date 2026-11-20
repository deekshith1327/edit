export type ProjectType = 'video' | 'photo' | 'mixed';
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';
export type ProjectStatus =
  | 'draft'
  | 'uploading'
  | 'analyzing'
  | 'editing'
  | 'rendering'
  | 'completed'
  | 'failed'
  | 'archived';

export type EditingPace = 'calm' | 'balanced' | 'energetic' | 'fast';
export type VisualDirection =
  | 'cinematic'
  | 'clean_commercial'
  | 'documentary'
  | 'warm_lifestyle'
  | 'editorial'
  | 'bold_social'
  | 'custom';

export type ContentPriority =
  | 'dialogue'
  | 'action'
  | 'scenery'
  | 'people'
  | 'product'
  | 'balanced';

export type PhotoLookId =
  | 'natural_clean'
  | 'cinematic_contrast'
  | 'warm_lifestyle'
  | 'editorial_neutral'
  | 'commercial_product'
  | 'black_and_white'
  | 'match_reference';

export type WorkspaceTab = 'media' | 'edit' | 'color' | 'photo' | 'audio' | 'export';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface CreativeBrief {
  purpose: string;
  aspectRatio: AspectRatio;
  targetDurationSec: number | null; // null = automatic
  pace: EditingPace;
  visualDirection: VisualDirection;
  contentPriority: ContentPriority;
  captionsEnabled: boolean;
  titlesEnabled: boolean;
  logoEnabled: boolean;
  endCardEnabled: boolean;
  musicSource: 'uploaded' | 'library' | 'generated' | 'none' | 'later';
  brandPrimaryColor: string;
  brandTitleText: string;
  endCardText: string;
  writtenInstruction: string;
  mustKeepNotes: string;
  doNotUseNotes: string;
  referenceAssetId: string | null;
}

export interface MediaMetadata {
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  hasAudio: boolean;
  codec: string;
  format: string;
  orientation: 'landscape' | 'portrait' | 'square';
  colorSpace: string;
  exifSummary?: string;
}

export interface SubjectDetection {
  label: string;
  confidence: number; // 0..1
  // Normalized 0..1 coordinates in source frame
  centerX: number;
  centerY: number;
  boxWidth: number;
  boxHeight: number;
  shotScale: 'establishing' | 'wide' | 'medium' | 'close_up' | 'detail' | 'unknown';
  cameraMovement: 'static' | 'pan' | 'tilt' | 'handheld' | 'tracking' | 'unknown';
  qualityNotes: string;
}

export interface MediaAsset {
  id: string;
  projectId: string;
  kind: 'video' | 'photo' | 'audio' | 'brand';
  role: 'original' | 'proxy' | 'preview' | 'generated';
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  storageKey: string;
  thumbnailUrl: string;
  mediaUrl: string;
  proxyUrl: string | null;
  metadata: MediaMetadata;
  orderIndex: number;
  directive: 'normal' | 'must_keep' | 'do_not_use';
  bin: string;
  analysis?: SubjectDetection;
  warnings: string[];
  createdAt: string;
}

export interface ReframeConfig {
  mode: 'auto' | 'manual' | 'fit';
  targetAspectRatio: AspectRatio;
  focalX: number; // 0..1 normalized in source frame
  focalY: number; // 0..1 normalized in source frame
  zoom: number; // 1.0..2.2
  safeHeadroom: boolean;
  subjectLabel: string;
  confidence: number; // 0..1
  // Optional subtle motion for photo still segments (Ken Burns)
  motionEnabled: boolean;
  motionScaleEnd: number; // e.g. 1.06
  motionEndX: number; // 0..1
  motionEndY: number; // 0..1
  warning: string | null;
  analyzedBy: 'gemini-4-neon' | 'local-saliency' | 'manual' | 'default';
}

export interface ColorGrade {
  look: PhotoLookId;
  lookIntensity: number; // 0..100
  exposure: number; // -2..2
  contrast: number; // -50..50
  highlights: number; // -50..50
  shadows: number; // -50..50
  whites: number; // -50..50
  blacks: number; // -50..50
  temperature: number; // -50..50
  tint: number; // -50..50
  saturation: number; // -50..50
  vibrance: number; // -50..50
}

export interface VideoSegment {
  id: string;
  assetId: string;
  mediaKind: 'video' | 'photo';
  label: string;
  sourceInSec: number;
  sourceOutSec: number;
  timelineInSec: number;
  timelineOutSec: number;
  editorialRole: 'opening' | 'context' | 'progression' | 'detail' | 'payoff' | 'ending' | 'b_roll';
  selectionReason: string;
  confidence: number;
  warnings: string[];
  reframe: ReframeConfig;
  speed: number; // 0.5..2.0
  transitionIn: 'cut' | 'dissolve' | 'fade_black' | 'slide';
  transitionDurationSec: number;
  color: ColorGrade;
  audioMode: 'normal' | 'muted' | 'ducked' | 'boosted';
  audioGainDb: number; // -24..12
  locked: boolean;
}

export interface CaptionItem {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
}

export interface TitleGraphic {
  id: string;
  kind: 'opening_title' | 'lower_third' | 'end_card';
  text: string;
  subtext: string;
  startSec: number;
  endSec: number;
  animation: 'fade' | 'clean_slide' | 'masked_reveal' | 'none';
  enabled: boolean;
}

export type MarkerColor = 'amber' | 'emerald' | 'sky' | 'rose' | 'violet';

export interface TimelineMarker {
  id: string;
  timeSec: number;
  name: string;
  color: MarkerColor;
  note?: string;
}

export interface AudioMixConfig {
  musicAssetId: string | null;
  musicGainDb: number;
  dialogueGainDb: number;
  autoDucking: boolean;
  duckAmountDb: number;
  smoothLevels: boolean;
  noiseReduction: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  masterMuted: boolean;
}

export interface CreativePlanSummary {
  intendedViewer: string;
  storyEmphasis: string;
  visualMoodAndPace: string;
  mediaUsageStrategy: string;
  estimatedDurationSec: number;
  photoEditScope: string;
  assumptions: string[];
  sourceLimitations: string[];
  prioritizedChoices: string[];
  engineUsed: string;
  generatedAt: string;
}

export interface EditPlan {
  version: number;
  aspectRatio: AspectRatio;
  fps: number;
  summary: CreativePlanSummary;
  segments: VideoSegment[];
  captions: CaptionItem[];
  titles: TitleGraphic[];
  markers?: TimelineMarker[];
  audioMix: AudioMixConfig;
  showLogoWatermark: boolean;
  logoPosition: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
}

export interface PhotoEditRecipe {
  assetId: string;
  accepted: boolean;
  locked: boolean;
  includedInTimeline: boolean;
  crop: {
    aspectRatio: 'original' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '3:2';
    x: number; // 0..1
    y: number; // 0..1
    width: number; // 0..1
    height: number; // 0..1
    rotationDeg: number; // -15..15
    perspectiveY: number; // -10..10
  };
  tone: {
    exposure: number; // -2..2
    contrast: number; // -50..50
    highlights: number; // -50..50
    shadows: number; // -50..50
    whites: number; // -50..50
    blacks: number; // -50..50
  };
  color: {
    temperature: number; // -50..50
    tint: number; // -50..50
    saturation: number; // -50..50
    vibrance: number; // -50..50
  };
  detail: {
    sharpening: number; // 0..100
    noiseReduction: number; // 0..100
    portraitCleanup: boolean; // Natural cleanup preserving skin texture
    lensCorrection: boolean;
  };
  look: PhotoLookId;
  lookIntensity: number; // 0..100
  generativeEdits: Array<{
    id: string;
    prompt: string;
    resultUrl: string;
    storageKey: string;
    model: string;
    enabled: boolean;
    createdAt: string;
  }>;
  analysisNotes: string;
  confidence: number;
  processingProvider: string;
  warnings: string[];
  updatedAt: string;
}

export interface BatchLookProfile {
  look: PhotoLookId;
  intensity: number;
  referenceAssetId: string | null;
  consistencyStrength: number; // 0..100
  preserveDistinctLighting: boolean;
  updatedAt: string;
}

export interface ProjectRevision {
  id: string;
  projectId: string;
  versionNumber: number;
  label: string;
  authorNote: string;
  editPlan: EditPlan;
  photoEdits: Record<string, PhotoEditRecipe>;
  batchLook: BatchLookProfile;
  createdAt: string;
}

export type JobStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ProcessingJob {
  id: string;
  projectId: string;
  kind: 'analysis_plan' | 'video_render' | 'photo_export' | 'reframe_all' | 'media_gen';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStage: JobStageNumber;
  stageLabel: string;
  progress: number; // 0..100 real server-reported progress
  message: string;
  errorMessage: string | null;
  failedStage: string | null;
  resultRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportArtifact {
  id: string;
  projectId: string;
  kind: 'video' | 'photo' | 'photo_batch';
  filename: string;
  format: string;
  resolution: string;
  aspectRatio: string;
  fps: number | null;
  codec: string | null;
  fileSizeBytes: number;
  downloadUrl: string;
  settingsSummary: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  mode: 'general' | 'complex_interactive' | 'deep_thinking' | 'fast' | 'search_grounding';
  sources?: Array<{ title: string; uri: string }>;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  brief: CreativeBrief;
  thumbnailUrl: string | null;
  assetCount: number;
  videoCount: number;
  photoCount: number;
  estimatedDurationSec: number;
  editPlan: EditPlan | null;
  photoEdits: Record<string, PhotoEditRecipe>;
  batchLook: BatchLookProfile;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderStatus {
  geminiConfigured: boolean;
  ffmpegAvailable: boolean;
  sharpAvailable: boolean;
  storageMode: string;
  models: {
    analysis: string;
    deepThinking: string;
    general: string;
    lowLatency: string;
    transcribe: string;
    imageGenEdit: string;
    videoGen: string;
    musicClip: string;
    musicPro: string;
  };
}
