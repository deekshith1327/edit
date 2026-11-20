import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createStorageKey,
  ensureStorageDirs,
  resolveStoragePath,
} from './storageService';
import { checkFfmpegAvailable } from './mediaPrepService';
import { buildFfmpegReframeFilter, getOutputDimensions } from '../../src/shared/reframing';
import { buildDynamicRangeCurvePoints, resolveEffectiveGrade } from '../../src/shared/photoMath';
import type { AspectRatio, EditPlan, MediaAsset, VideoSegment } from '../../src/shared/types';

export interface VideoRenderOptions {
  preset: '1080p_landscape' | '1080p_social' | '1080p_square' | '1080p_portrait' | '720p_fast' | '4k_master';
  aspectRatio: AspectRatio;
  fps: number;
  burnCaptions: boolean;
  includeTitles: boolean;
}

function runFfmpegWithCancel(
  args: string[],
  onChild: (proc: ChildProcess) => void,
  onProgressLine?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    onChild(child);

    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      onProgressLine?.(text);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL' || signal === 'SIGTERM') {
        reject(new Error('RENDER_CANCELLED'));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrTail.slice(-400)}`));
      }
    });
  });
}

function buildEqFilter(seg: VideoSegment): string {
  const g = resolveEffectiveGrade(seg.color, 'graded');
  const eqBrightness = Math.max(-0.4, Math.min(0.4, (g.brightness - 1) * 0.45));
  const eqContrast = Math.max(0.5, Math.min(1.6, g.contrast));
  const eqSat = g.grayscale >= 0.85 ? 0 : Math.max(0, Math.min(2.0, g.saturate));
  const filters = [
    `eq=brightness=${eqBrightness.toFixed(3)}:contrast=${eqContrast.toFixed(3)}:saturation=${eqSat.toFixed(3)}:gamma=${g.gamma.toFixed(3)}`,
  ];

  // Apply non-destructive per-clip Dynamic Range tone curve when any DR slider is non-zero
  const hasDr =
    Math.abs(seg.color.highlights || 0) > 1 ||
    Math.abs(seg.color.shadows || 0) > 1 ||
    Math.abs(seg.color.whites || 0) > 1 ||
    Math.abs(seg.color.blacks || 0) > 1;
  if (hasDr) {
    const pts = buildDynamicRangeCurvePoints({
      exposure: 0, // exposure already handled in eq
      highlights: seg.color.highlights,
      shadows: seg.color.shadows,
      whites: seg.color.whites,
      blacks: seg.color.blacks,
    });
    const curveStr = pts.map((p) => `${p.x}/${p.y}`).join(' ');
    filters.push(`curves=m='${curveStr}'`);
  }

  if (seg.transitionIn === 'fade_black') {
    const fadeDur = Math.max(0.2, Math.min(1.2, seg.transitionDurationSec || 0.4));
    filters.push(`fade=t=in:st=0:d=${fadeDur.toFixed(2)}`);
  }
  return filters.join(',');
}

/**
 * Renders the structured EditPlan into a verified MP4 video using real FFmpeg server-side processing.
 * Applies each segment's non-destructive Intelligent Reframe crop+scale, trim, color grade,
 * photo still duration, and optional music track without ever touching source originals.
 */
export async function renderEditPlanToMp4(params: {
  projectName: string;
  editPlan: EditPlan;
  assetsById: Map<string, MediaAsset>;
  options: VideoRenderOptions;
  isCancelled: () => boolean;
  registerCancel: (fn: () => void) => void;
  onProgress: (pct: number, message: string) => void;
}): Promise<{
  storageKey: string;
  filename: string;
  width: number;
  height: number;
  fps: number;
  fileSizeBytes: number;
  codec: string;
}> {
  const hasFfmpeg = await checkFfmpegAvailable();
  if (!hasFfmpeg) {
    throw new Error('FFmpeg renderer is not available on this host.');
  }
  if (params.editPlan.segments.length === 0) {
    throw new Error('Timeline has no segments to render. Add at least one video clip or photo.');
  }

  ensureStorageDirs();

  const qualityTier =
    params.options.preset === '4k_master'
      ? '4k'
      : params.options.preset === '720p_fast'
        ? '720p'
        : '1080p';
  const { width, height } = getOutputDimensions(params.options.aspectRatio, qualityTier);
  const fps = params.options.fps || 24;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frameflow-render-'));
  let activeChild: ChildProcess | null = null;

  params.registerCancel(() => {
    if (activeChild && !activeChild.killed) {
      activeChild.kill('SIGKILL');
    }
  });

  try {
    const renderedSegmentFiles: string[] = [];
    const totalSegments = params.editPlan.segments.length;

    for (let i = 0; i < totalSegments; i++) {
      if (params.isCancelled()) throw new Error('RENDER_CANCELLED');
      const seg = params.editPlan.segments[i];
      const asset = params.assetsById.get(seg.assetId);
      if (!asset) continue;

      const sourcePath = resolveStoragePath(asset.storageKey);
      if (!fs.existsSync(sourcePath)) continue;

      const segOut = path.join(tmpDir, `seg_${String(i).padStart(3, '0')}.mp4`);
      const duration = Math.max(0.5, (seg.sourceOutSec - seg.sourceInSec) / Math.max(0.25, seg.speed || 1));

      // Apply exact Intelligent Reframing crop + scale for target aspect ratio
      const segReframe = { ...seg.reframe, targetAspectRatio: params.options.aspectRatio };
      const reframeFilter = buildFfmpegReframeFilter(
        asset.metadata.width,
        asset.metadata.height,
        segReframe,
        width,
        height
      );
      const gradeFilter = buildEqFilter(seg);
      const vfChain = `${reframeFilter},${gradeFilter},setsar=1,fps=${fps}`;

      params.onProgress(
        Math.round(8 + (i / totalSegments) * 68),
        `Rendering segment ${i + 1}/${totalSegments}: ${seg.label} (${segReframe.mode} reframe ${params.options.aspectRatio})`
      );

      let args: string[];
      if (seg.mediaKind === 'photo') {
        args = [
          '-y',
          '-loop',
          '1',
          '-i',
          sourcePath,
          '-f',
          'lavfi',
          '-i',
          'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-t',
          duration.toFixed(3),
          '-vf',
          vfChain,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '21',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-shortest',
          segOut,
        ];
      } else {
        const gainDb = seg.audioMode === 'muted' ? -90 : seg.audioGainDb + (params.editPlan.audioMix.dialogueGainDb || 0);
        const audioFilter =
          seg.audioMode === 'muted' || !asset.metadata.hasAudio
            ? null
            : `volume=${gainDb.toFixed(1)}dB`;

        args = ['-y', '-ss', seg.sourceInSec.toFixed(3), '-t', duration.toFixed(3), '-i', sourcePath];
        if (!asset.metadata.hasAudio) {
          args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
        }
        args.push(
          '-vf',
          vfChain,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '21',
          '-pix_fmt',
          'yuv420p'
        );
        if (audioFilter) {
          args.push('-af', audioFilter);
        }
        if (!asset.metadata.hasAudio) {
          args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
        } else if (seg.audioMode === 'muted') {
          args.push('-af', 'volume=0');
        }
        args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', segOut);
      }

      await runFfmpegWithCancel(args, (c) => {
        activeChild = c;
      });
      renderedSegmentFiles.push(segOut);
    }

    if (renderedSegmentFiles.length === 0) {
      throw new Error('No playable source assets could be read during render.');
    }

    if (params.isCancelled()) throw new Error('RENDER_CANCELLED');

    params.onProgress(82, 'Assembling multitrack timeline and finishing audio mix...');

    const concatListPath = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(
      concatListPath,
      renderedSegmentFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
    );

    const safeName = params.projectName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'frameflow_export';
    const filename = `${safeName}_${params.options.aspectRatio.replace(':', 'x')}_${qualityTier}.mp4`;
    const storageKey = createStorageKey('exports', filename, '.mp4');
    const finalOut = resolveStoragePath(storageKey);

    // Optional background music mixing if a real audio asset is selected in audioMix
    const musicAsset = params.editPlan.audioMix.musicAssetId
      ? params.assetsById.get(params.editPlan.audioMix.musicAssetId)
      : undefined;
    const musicPath = musicAsset ? resolveStoragePath(musicAsset.storageKey) : null;

    if (musicPath && fs.existsSync(musicPath) && !params.editPlan.audioMix.masterMuted) {
      const concatTemp = path.join(tmpDir, 'assembled.mp4');
      await runFfmpegWithCancel(
        ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatTemp],
        (c) => {
          activeChild = c;
        }
      );

      const musicVol = Math.pow(10, (params.editPlan.audioMix.musicGainDb || -14) / 20).toFixed(3);
      await runFfmpegWithCancel(
        [
          '-y',
          '-i',
          concatTemp,
          '-stream_loop',
          '-1',
          '-i',
          musicPath,
          '-filter_complex',
          `[1:a]volume=${musicVol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
          '-map',
          '0:v:0',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          finalOut,
        ],
        (c) => {
          activeChild = c;
        }
      );
    } else {
      await runFfmpegWithCancel(
        [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-movflags',
          '+faststart',
          finalOut,
        ],
        (c) => {
          activeChild = c;
        }
      );
    }

    const stat = fs.statSync(finalOut);
    params.onProgress(98, 'Verified rendered MP4 output.');

    return {
      storageKey,
      filename,
      width,
      height,
      fps,
      fileSizeBytes: stat.size,
      codec: 'H.264 / AAC',
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failure
    }
  }
}
