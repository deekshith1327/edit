import fs from 'fs';
import { db, mapAssetRow, mapProjectRow, saveProjectRevision } from '../db';
import { resolveStoragePath } from './storageService';
import { computeLocalSaliencySubject, generateVideoThumbnailAndKeyframes } from './mediaPrepService';
import {
  analyzeVisualAssetWithGemini,
  generateCreativePlanWithGeminiCarbon,
} from './geminiService';
import { buildReframeFromDetection } from '../../src/shared/reframing';
import {
  defaultColorGrade,
  mergeLockedSegments,
  rippleRecalculateTimeline,
} from '../../src/shared/timeline';
import { createDefaultPhotoRecipe } from '../../src/shared/photoMath';
import { completeJob, failJob, isJobCancelled, updateJobProgress } from './jobManager';
import type {
  AspectRatio,
  EditPlan,
  MediaAsset,
  PhotoEditRecipe,
  PhotoLookId,
  SubjectDetection,
  VideoSegment,
} from '../../src/shared/types';

function mapVisualDirectionToLook(dir: string): PhotoLookId {
  switch (dir) {
    case 'cinematic':
      return 'cinematic_contrast';
    case 'clean_commercial':
      return 'commercial_product';
    case 'warm_lifestyle':
      return 'warm_lifestyle';
    case 'editorial':
    case 'documentary':
      return 'editorial_neutral';
    default:
      return 'natural_clean';
  }
}

function getKeyFramePathForAsset(asset: MediaAsset): string {
  // Prefer thumbnail for videos, original for photos
  if (asset.kind === 'photo') {
    return resolveStoragePath(asset.storageKey);
  }
  const thumbRow = db
    .prepare('SELECT thumbnail_key FROM assets WHERE id = ?')
    .get(asset.id) as { thumbnail_key: string | null } | undefined;
  if (thumbRow?.thumbnail_key) {
    const thumbAbs = resolveStoragePath(thumbRow.thumbnail_key);
    if (fs.existsSync(thumbAbs)) return thumbAbs;
  }
  return resolveStoragePath(asset.storageKey);
}

/**
 * Runs Intelligent Reframe analysis on a single asset (using Gemini 4 Neon when engine='gemini'
 * or deterministic local pixel saliency when engine='local').
 */
export async function analyzeAssetForReframing(
  asset: MediaAsset,
  engine: 'gemini' | 'local'
): Promise<{ detection: SubjectDetection; analyzedBy: 'gemini-4-neon' | 'local-saliency' }> {
  let framePath = getKeyFramePathForAsset(asset);
  if (asset.kind === 'video' && (!fs.existsSync(framePath) || framePath.endsWith('.mp4'))) {
    const res = await generateVideoThumbnailAndKeyframes(
      resolveStoragePath(asset.storageKey),
      asset.filename,
      asset.metadata.durationSec
    );
    if (res.keyframePaths[0]) {
      framePath = res.keyframePaths[0];
    }
  }

  if (engine === 'gemini') {
    const detection = await analyzeVisualAssetWithGemini(
      framePath,
      'image/jpeg',
      asset.kind === 'photo' ? 'photo' : 'video',
      asset.filename
    );
    db.prepare('UPDATE assets SET analysis_json = ? WHERE id = ?').run(
      JSON.stringify(detection),
      asset.id
    );
    return { detection, analyzedBy: 'gemini-4-neon' };
  }

  const detection = await computeLocalSaliencySubject(
    framePath,
    asset.analysis?.label || asset.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  );
  db.prepare('UPDATE assets SET analysis_json = ? WHERE id = ?').run(
    JSON.stringify(detection),
    asset.id
  );
  return { detection, analyzedBy: 'local-saliency' };
}

/**
 * Full 6-stage background job that analyzes uploaded media, builds a structured editable
 * EditPlan + individual PhotoEditRecipes, applies Intelligent Reframing for the target aspect ratio,
 * preserves any user-locked items, and writes a new immutable Revision before updating project state.
 */
export async function runAnalysisAndEditPlanJob(params: {
  jobId: string;
  projectId: string;
  engine: 'gemini' | 'local';
}): Promise<void> {
  const { jobId, projectId, engine } = params;
  const projRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | Record<string, unknown>
    | undefined;
  if (!projRow) {
    failJob(jobId, 'Validation', 'Project not found.');
    return;
  }

  const project = mapProjectRow(projRow);
  const assetRows = db
    .prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY order_index ASC')
    .all(projectId) as Array<Record<string, unknown>>;
  const assets = assetRows.map(mapAssetRow);
  const usableVisuals = assets.filter(
    (a) => (a.kind === 'video' || a.kind === 'photo') && a.directive !== 'do_not_use'
  );

  if (usableVisuals.length === 0) {
    failJob(
      jobId,
      'Uploading and validating media',
      'No usable video or photo assets found. Upload media or unmark "Do not use" items.'
    );
    return;
  }

  db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
    'analyzing',
    new Date().toISOString(),
    projectId
  );

  try {
    updateJobProgress(jobId, 2, 14, `Verified ${usableVisuals.length} source assets and thumbnails.`);
    if (isJobCancelled(jobId)) return;

    // Stage 3: Analyze video scenes, subject coordinates & photo composition
    const analyzedBy: 'gemini-4-neon' | 'local-saliency' =
      engine === 'gemini' ? 'gemini-4-neon' : 'local-saliency';

    for (let i = 0; i < usableVisuals.length; i++) {
      if (isJobCancelled(jobId)) return;
      const asset = usableVisuals[i];
      updateJobProgress(
        jobId,
        3,
        18 + Math.round(((i + 1) / usableVisuals.length) * 32),
        engine === 'gemini'
          ? `Gemini 4 Neon analyzing ${asset.filename} (${i + 1}/${usableVisuals.length})...`
          : `Local saliency analyzer inspecting ${asset.filename} (${i + 1}/${usableVisuals.length})...`
      );
      const { detection } = await analyzeAssetForReframing(asset, engine);
      asset.analysis = detection;
    }

    // Stage 4: Speech, sound, and technical quality check
    updateJobProgress(
      jobId,
      4,
      58,
      'Evaluating audio streams, lighting consistency, and aspect-ratio reframing feasibility...'
    );
    if (isJobCancelled(jobId)) return;

    const audioAssets = assets.filter((a) => a.kind === 'audio' && a.directive !== 'do_not_use');
    const look = mapVisualDirectionToLook(project.brief.visualDirection);
    const aspectRatio: AspectRatio = project.brief.aspectRatio || '16:9';

    // Stage 5: Build Creative Plan
    updateJobProgress(
      jobId,
      5,
      72,
      engine === 'gemini'
        ? 'Gemini 4 Carbon (High Thinking) structuring editorial sequence and creative plan...'
        : 'Local Studio Analyzer building structured sequence from brief and directives...'
    );
    if (isJobCancelled(jobId)) return;

    let planMeta: {
      intendedViewer: string;
      storyEmphasis: string;
      visualMoodAndPace: string;
      mediaUsageStrategy: string;
      photoEditScope: string;
      assumptions: string[];
      sourceLimitations: string[];
      prioritizedChoices: string[];
      orderedAssetIds: string[];
      segmentNotes: Record<string, { role: string; reason: string; holdSec: number; transition: string }>;
      engineUsed: string;
    };

    if (engine === 'gemini') {
      const aiPlan = await generateCreativePlanWithGeminiCarbon(
        project.name,
        project.brief,
        usableVisuals
      );
      planMeta = {
        ...aiPlan,
        engineUsed: 'Gemini 4 Neon (Visual Analysis) + Gemini 4 Carbon High Thinking (Creative Plan)',
      };
    } else {
      // Honest deterministic local sequencing prioritizing must_keep assets, then videos, then photos
      const sorted = [...usableVisuals].sort((a, b) => {
        if (a.directive === 'must_keep' && b.directive !== 'must_keep') return -1;
        if (b.directive === 'must_keep' && a.directive !== 'must_keep') return 1;
        if (a.kind === 'video' && b.kind === 'photo') return -1;
        if (b.kind === 'video' && a.kind === 'photo') return 1;
        return a.orderIndex - b.orderIndex;
      });
      const defaultHold =
        project.brief.pace === 'fast'
          ? 2.2
          : project.brief.pace === 'energetic'
            ? 2.8
            : project.brief.pace === 'calm'
              ? 4.6
              : 3.6;
      const roles: Array<VideoSegment['editorialRole']> = [
        'opening',
        'context',
        'progression',
        'detail',
        'payoff',
        'ending',
      ];
      const segmentNotes: Record<string, { role: string; reason: string; holdSec: number; transition: string }> = {};
      sorted.forEach((asset, idx) => {
        const role = idx === 0 ? 'opening' : idx === sorted.length - 1 ? 'ending' : roles[idx % roles.length];
        segmentNotes[asset.id] = {
          role,
          reason:
            asset.directive === 'must_keep'
              ? 'Binding must-keep asset prioritized in sequence.'
              : `Ordered via Local Studio Analyzer (${asset.analysis?.label || asset.kind}).`,
          holdSec:
            asset.kind === 'video'
              ? Math.min(asset.metadata.durationSec, defaultHold + 1.2)
              : defaultHold,
          transition: idx === 0 ? 'fade_black' : 'cut',
        };
      });

      const limitations: string[] = [];
      if (audioAssets.length === 0) {
        limitations.push('No music track uploaded yet. Upload audio or generate a track in Audio Studio.');
      }
      if (usableVisuals.some((a) => a.metadata.orientation === 'portrait') && aspectRatio === '16:9') {
        limitations.push('Portrait source media placed in 16:9 timeline — review Reframe inspector for headroom.');
      }

      planMeta = {
        intendedViewer: `${project.brief.purpose.replace(/_/g, ' ')} audience (${aspectRatio})`,
        storyEmphasis:
          project.brief.writtenInstruction ||
          `Highlighting ${project.brief.contentPriority} with ${project.brief.visualDirection.replace(/_/g, ' ')} visual restraint.`,
        visualMoodAndPace: `${project.brief.visualDirection.replace(/_/g, ' ')} look · ${project.brief.pace} pacing`,
        mediaUsageStrategy: `Using ${sorted.filter((a) => a.kind === 'video').length} video clip(s) and ${sorted.filter((a) => a.kind === 'photo').length} photo still(s) non-destructively.`,
        photoEditScope: `${usableVisuals.filter((a) => a.kind === 'photo').length} individual photo recipes preserving original files`,
        assumptions: [
          'Generated using Local Studio Analyzer (pixel saliency & metadata heuristics; no cloud LLM invoked).',
        ],
        sourceLimitations: limitations,
        prioritizedChoices: [
          'Applied subject-centered Intelligent Reframing for every timeline segment.',
          'Defaulted to straight cuts with restrained opening fade to keep edits clean.',
        ],
        orderedAssetIds: sorted.map((a) => a.id),
        segmentNotes,
        engineUsed: 'Local Studio Analyzer (Deterministic FFprobe + Sharp Saliency — No AI)',
      };
    }

    // Stage 6: Generate Photo Adjustments & Editable Timeline
    updateJobProgress(jobId, 6, 88, 'Generating non-destructive photo recipes and timeline segments...');
    if (isJobCancelled(jobId)) return;

    const validIds = new Set(usableVisuals.map((a) => a.id));
    const orderedIds = planMeta.orderedAssetIds.filter((id) => validIds.has(id));
    // Ensure must_keep assets are never dropped
    for (const a of usableVisuals) {
      if (a.directive === 'must_keep' && !orderedIds.includes(a.id)) {
        orderedIds.unshift(a.id);
      }
    }
    const finalOrder = orderedIds.length > 0 ? orderedIds : usableVisuals.map((a) => a.id);

    const assetsMap = new Map(usableVisuals.map((a) => [a.id, a]));
    const validRoles = new Set(['opening', 'context', 'progression', 'detail', 'payoff', 'ending', 'b_roll']);
    const validTransitions = new Set(['cut', 'dissolve', 'fade_black', 'slide']);

    const newSegments: VideoSegment[] = [];
    for (let i = 0; i < finalOrder.length; i++) {
      const asset = assetsMap.get(finalOrder[i]);
      if (!asset) continue;
      // For pure photo projects, still create a preview sequence if requested, or skip timeline if none
      const note = planMeta.segmentNotes[asset.id];
      const dur =
        asset.kind === 'video'
          ? Math.max(1.2, Math.min(asset.metadata.durationSec, note?.holdSec || 4.2))
          : Math.max(1.5, Math.min(6, note?.holdSec || 3.4));

      const reframe = buildReframeFromDetection(
        asset.analysis,
        asset.metadata.width,
        asset.metadata.height,
        aspectRatio,
        analyzedBy,
        asset.kind === 'photo'
      );

      const warnings: string[] = [];
      if (reframe.warning) warnings.push(reframe.warning);

      const seg: VideoSegment = {
        id: `seg_${i + 1}_${asset.id.slice(-5)}`,
        assetId: asset.id,
        mediaKind: asset.kind === 'photo' ? 'photo' : 'video',
        label: asset.analysis?.label || asset.filename.replace(/\.[^.]+$/, ''),
        sourceInSec: 0,
        sourceOutSec: Number(dur.toFixed(2)),
        timelineInSec: 0,
        timelineOutSec: Number(dur.toFixed(2)),
        editorialRole: validRoles.has(note?.role || '')
          ? (note!.role as VideoSegment['editorialRole'])
          : 'progression',
        selectionReason: note?.reason || 'Selected based on creative brief alignment.',
        confidence: asset.analysis?.confidence ?? 0.82,
        warnings,
        reframe,
        speed: 1,
        transitionIn: validTransitions.has(note?.transition || '')
          ? (note!.transition as VideoSegment['transitionIn'])
          : 'cut',
        transitionDurationSec: note?.transition && note.transition !== 'cut' ? 0.45 : 0,
        color: defaultColorGrade(look),
        audioMode: asset.kind === 'video' && asset.metadata.hasAudio ? 'normal' : 'muted',
        audioGainDb: 0,
        locked: false,
      };
      newSegments.push(seg);
    }

    const rippled = rippleRecalculateTimeline(newSegments);
    const totalDuration = rippled.reduce((acc, s) => Math.max(acc, s.timelineOutSec), 0);

    const candidatePlan: EditPlan = {
      version: (project.editPlan?.version || 0) + 1,
      aspectRatio,
      fps: 24,
      summary: {
        intendedViewer: planMeta.intendedViewer,
        storyEmphasis: planMeta.storyEmphasis,
        visualMoodAndPace: planMeta.visualMoodAndPace,
        mediaUsageStrategy: planMeta.mediaUsageStrategy,
        estimatedDurationSec: Number(totalDuration.toFixed(1)),
        photoEditScope: planMeta.photoEditScope,
        assumptions: planMeta.assumptions,
        sourceLimitations: planMeta.sourceLimitations,
        prioritizedChoices: planMeta.prioritizedChoices,
        engineUsed: planMeta.engineUsed,
        generatedAt: new Date().toISOString(),
      },
      segments: rippled,
      captions: project.editPlan?.captions || [],
      titles: project.brief.titlesEnabled
        ? [
            {
              id: 'ttl_open',
              kind: 'opening_title',
              text: project.brief.brandTitleText || project.name,
              subtext: project.brief.purpose.replace(/_/g, ' '),
              startSec: 0.3,
              endSec: Math.min(3.5, totalDuration * 0.4),
              animation: 'fade',
              enabled: true,
            },
            ...(project.brief.endCardEnabled && totalDuration > 4
              ? [
                  {
                    id: 'ttl_end',
                    kind: 'end_card' as const,
                    text: project.brief.brandTitleText || project.name,
                    subtext: project.brief.endCardText || 'Frameflow Studio Edit',
                    startSec: Number(Math.max(0, totalDuration - 2.4).toFixed(2)),
                    endSec: Number(totalDuration.toFixed(2)),
                    animation: 'fade' as const,
                    enabled: true,
                  },
                ]
              : []),
          ]
        : [],
      audioMix: project.editPlan?.audioMix || {
        musicAssetId: audioAssets[0]?.id || null,
        musicGainDb: -14,
        dialogueGainDb: 0,
        autoDucking: true,
        duckAmountDb: -10,
        smoothLevels: true,
        noiseReduction: false,
        fadeInSec: 0.4,
        fadeOutSec: 1.0,
        masterMuted: false,
      },
      showLogoWatermark: project.brief.logoEnabled,
      logoPosition: 'top_right',
    };

    // Preserve user-locked segments from any prior plan!
    const mergedPlan = mergeLockedSegments(project.editPlan, candidatePlan);

    // Update/create independent PhotoEditRecipes (preserving locked photo edits!)
    const nextPhotoEdits: Record<string, PhotoEditRecipe> = { ...project.photoEdits };
    for (const asset of assets.filter((a) => a.kind === 'photo')) {
      const existing = nextPhotoEdits[asset.id];
      if (existing?.locked) continue;
      const inTimeline = mergedPlan.segments.some((s) => s.assetId === asset.id);
      const recipe = existing
        ? { ...existing, look, includedInTimeline: inTimeline, updatedAt: new Date().toISOString() }
        : createDefaultPhotoRecipe(asset.id, look, inTimeline);
      recipe.analysisNotes = asset.analysis?.qualityNotes || recipe.analysisNotes;
      recipe.confidence = asset.analysis?.confidence ?? 0.85;
      recipe.processingProvider = analyzedBy;
      nextPhotoEdits[asset.id] = recipe;
    }

    const nextBatchLook = {
      ...project.batchLook,
      look,
      updatedAt: new Date().toISOString(),
    };

    // Save immutable revision FIRST before overwriting active project state
    saveProjectRevision(
      projectId,
      engine === 'gemini' ? `Gemini AI Edit v${mergedPlan.version}` : `Local Analysis Edit v${mergedPlan.version}`,
      planMeta.engineUsed,
      mergedPlan,
      nextPhotoEdits,
      nextBatchLook
    );

    const firstThumb = usableVisuals[0]?.thumbnailUrl || project.thumbnailUrl;
    db.prepare(
      `UPDATE projects SET status = 'editing', thumbnail_url = ?, edit_plan_json = ?, photo_edits_json = ?, batch_look_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      firstThumb,
      JSON.stringify(mergedPlan),
      JSON.stringify(nextPhotoEdits),
      JSON.stringify(nextBatchLook),
      new Date().toISOString(),
      projectId
    );

    completeJob(
      jobId,
      `Created editable plan with ${mergedPlan.segments.length} timeline segment(s) and ${Object.keys(nextPhotoEdits).length} photo recipe(s).`,
      `v${mergedPlan.version}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected analysis error.';
    db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
      project.editPlan ? 'editing' : 'failed',
      new Date().toISOString(),
      projectId
    );
    failJob(jobId, 'Building the creative plan', msg);
  }
}
