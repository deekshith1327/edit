import fs from 'fs';
import { createRequire } from 'module';
import sharp from 'sharp';
import type * as archiverType from 'archiver';

const require = createRequire(import.meta.url);
const archiverPkg = require('archiver') as {
  ZipArchive?: new (options?: { zlib?: { level?: number } }) => archiverType.Archiver;
  default?: (format: 'zip', options?: { zlib?: { level?: number } }) => archiverType.Archiver;
};

function createZipArchiver(): archiverType.Archiver {
  if (typeof archiverPkg.ZipArchive === 'function') {
    return new archiverPkg.ZipArchive({ zlib: { level: 6 } });
  }
  if (typeof archiverPkg === 'function') {
    return (
      archiverPkg as unknown as (
        format: 'zip',
        options?: { zlib?: { level?: number } }
      ) => archiverType.Archiver
    )('zip', { zlib: { level: 6 } });
  }
  if (typeof archiverPkg.default === 'function') {
    return archiverPkg.default('zip', { zlib: { level: 6 } });
  }
  throw new Error('Zip archiver factory unavailable');
}
import {
  createStorageKey,
  ensureStorageDirs,
  resolveStoragePath,
} from './storageService';
import { resolveEffectiveGrade } from '../../src/shared/photoMath';
import type { MediaAsset, PhotoEditRecipe } from '../../src/shared/types';

export interface PhotoExportOptions {
  format: 'jpeg' | 'png' | 'tiff';
  quality: number; // 60..100
  maxDimension: number | null; // null = original dimensions
  colorProfile: 'srgb';
}

/**
 * Applies a non-destructive PhotoEditRecipe to a copy of the original image using Sharp.
 * The original file in storage/originals/ is NEVER modified.
 */
export async function renderEditedPhotoToBuffer(
  asset: MediaAsset,
  recipe: PhotoEditRecipe,
  options: PhotoExportOptions
): Promise<{ buffer: Buffer; width: number; height: number; ext: string }> {
  // If an enabled generative edit exists, use its stored image as the non-destructive base
  const activeGen = recipe.generativeEdits.find((g) => g.enabled);
  const sourceAbsPath = activeGen
    ? resolveStoragePath(activeGen.storageKey)
    : resolveStoragePath(asset.storageKey);

  let pipeline = sharp(sourceAbsPath).rotate();

  // Apply non-destructive straighten rotation if set
  if (Math.abs(recipe.crop.rotationDeg) >= 0.2) {
    pipeline = pipeline.rotate(recipe.crop.rotationDeg, { background: '#0D0E11' });
  }

  // Extract metadata after rotation for accurate crop extraction
  const rotatedBuf = await pipeline.toBuffer();
  const meta = await sharp(rotatedBuf).metadata();
  const imgW = meta.width || asset.metadata.width;
  const imgH = meta.height || asset.metadata.height;

  let work = sharp(rotatedBuf);

  // Non-destructive crop
  const cropW = Math.max(16, Math.min(imgW, Math.round(recipe.crop.width * imgW)));
  const cropH = Math.max(16, Math.min(imgH, Math.round(recipe.crop.height * imgH)));
  const cropX = Math.max(0, Math.min(imgW - cropW, Math.round(recipe.crop.x * imgW)));
  const cropY = Math.max(0, Math.min(imgH - cropH, Math.round(recipe.crop.y * imgH)));

  if (cropW < imgW || cropH < imgH) {
    work = work.extract({ left: cropX, top: cropY, width: cropW, height: cropH });
  }

  // Optional user-requested resize (never upscale above source!)
  if (options.maxDimension && options.maxDimension > 0) {
    work = work.resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Resolve combined non-destructive color & look adjustments
  const effective = resolveEffectiveGrade(
    {
      exposure: recipe.tone.exposure,
      contrast: recipe.tone.contrast,
      saturation: recipe.color.saturation,
      temperature: recipe.color.temperature,
      tint: recipe.color.tint,
      vibrance: recipe.color.vibrance,
      look: recipe.look,
      lookIntensity: recipe.lookIntensity,
    },
    'graded'
  );

  // Modulate brightness, saturation, hue
  work = work.modulate({
    brightness: effective.brightness,
    saturation: effective.saturate,
    hue: Math.round(effective.hueRotateDeg),
  });

  // Apply linear contrast adjustment cleanly without clipping
  if (Math.abs(effective.contrast - 1) > 0.02) {
    const a = effective.contrast;
    const b = 128 * (1 - a);
    work = work.linear(a, b);
  }

  if (effective.grayscale >= 0.85) {
    work = work.grayscale();
  }

  // Subtle sharpening & natural portrait cleanup (gentle median/blur avoidance to preserve skin texture)
  if (recipe.detail.sharpening > 10) {
    const sigma = Number((0.4 + (recipe.detail.sharpening / 100) * 1.1).toFixed(2));
    work = work.sharpen({ sigma });
  }

  work = work.toColorspace('srgb');

  let ext = '.jpg';
  if (options.format === 'png') {
    work = work.png({ compressionLevel: 7 });
    ext = '.png';
  } else if (options.format === 'tiff') {
    work = work.tiff({ compression: 'lzw' });
    ext = '.tiff';
  } else {
    work = work.jpeg({ quality: Math.max(60, Math.min(100, options.quality || 92)), mozjpeg: true });
    ext = '.jpg';
  }

  const outBuf = await work.toBuffer();
  const outMeta = await sharp(outBuf).metadata();

  return {
    buffer: outBuf,
    width: outMeta.width || cropW,
    height: outMeta.height || cropH,
    ext,
  };
}

export async function exportSinglePhoto(
  asset: MediaAsset,
  recipe: PhotoEditRecipe,
  options: PhotoExportOptions
): Promise<{
  storageKey: string;
  filename: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}> {
  ensureStorageDirs();
  const rendered = await renderEditedPhotoToBuffer(asset, recipe, options);
  const baseName = asset.filename.replace(/\.[^.]+$/, '');
  const filename = `${baseName}_edited${rendered.ext}`;
  const storageKey = createStorageKey('exports', filename, rendered.ext);
  const dest = resolveStoragePath(storageKey);
  fs.writeFileSync(dest, rendered.buffer);
  return {
    storageKey,
    filename,
    width: rendered.width,
    height: rendered.height,
    fileSizeBytes: rendered.buffer.length,
  };
}

export async function exportBatchPhotosZip(
  projectName: string,
  items: Array<{ asset: MediaAsset; recipe: PhotoEditRecipe }>,
  options: PhotoExportOptions,
  onProgress?: (pct: number, currentName: string) => void
): Promise<{
  storageKey: string;
  filename: string;
  fileSizeBytes: number;
  count: number;
}> {
  ensureStorageDirs();
  const safeProj = projectName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'photo_collection';
  const filename = `${safeProj}_edited_photos.zip`;
  const storageKey = createStorageKey('exports', filename, '.zip');
  const dest = resolveStoragePath(storageKey);

  const output = fs.createWriteStream(dest);
  const archive = createZipArchiver();

  const donePromise = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', (err: Error) => reject(err));
  });

  archive.pipe(output);

  for (let i = 0; i < items.length; i++) {
    const { asset, recipe } = items[i];
    onProgress?.(Math.round(((i + 0.5) / items.length) * 90), asset.filename);
    const rendered = await renderEditedPhotoToBuffer(asset, recipe, options);
    const baseName = asset.filename.replace(/\.[^.]+$/, '');
    archive.append(rendered.buffer, { name: `${baseName}_edited${rendered.ext}` });
  }

  await archive.finalize();
  await donePromise;

  const stat = fs.statSync(dest);
  return {
    storageKey,
    filename,
    fileSizeBytes: stat.size,
    count: items.length,
  };
}
