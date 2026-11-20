import fs from 'fs';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AspectRatio,
  CreativeBrief,
  MediaAsset,
  ProviderStatus,
  SubjectDetection,
} from '../../src/shared/types';
import { checkFfmpegAvailable } from './mediaPrepService';

export class ProviderConfigError extends Error {
  public readonly statusCode: number;
  public readonly requiresPaidKey: boolean;
  public readonly model: string;

  constructor(message: string, model: string, statusCode = 503, requiresPaidKey = false) {
    super(message);
    this.name = 'ProviderConfigError';
    this.statusCode = statusCode;
    this.requiresPaidKey = requiresPaidKey;
    this.model = model;
  }
}

function getClient(modelName: string): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new ProviderConfigError(
      `Gemini API key is not configured for ${modelName}. Configure GEMINI_API_KEY in Settings > Secrets, or choose Local Studio Analyzer for offline metadata/saliency editing.`,
      modelName,
      503,
      false
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function classifyGeminiError(err: unknown, model: string): ProviderConfigError {
  if (err instanceof ProviderConfigError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes('403') ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key')
  ) {
    return new ProviderConfigError(
      `${model} returned an authentication or permission error. Check or select a billing-enabled API key in Settings > Secrets.`,
      model,
      403,
      true
    );
  }
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return new ProviderConfigError(
      `${model} reached its rate or tier quota limit. Select a paid billing-enabled API key in Settings > Secrets to unlock higher quotas and paid models.`,
      model,
      429,
      true
    );
  }
  if (lower.includes('404') || lower.includes('not_found')) {
    return new ProviderConfigError(
      `${model} is currently unavailable for the attached API key tier. You can continue using Local Studio Analyzer or another available model.`,
      model,
      404,
      true
    );
  }
  return new ProviderConfigError(`${model} request failed: ${raw}`, model, 502, false);
}

export async function getProviderStatus(): Promise<ProviderStatus> {
  const apiKey = process.env.GEMINI_API_KEY;
  const geminiConfigured = Boolean(apiKey && apiKey.trim().length > 10 && apiKey !== 'MY_GEMINI_API_KEY');
  const ffmpegAvailable = await checkFfmpegAvailable();

  return {
    geminiConfigured,
    ffmpegAvailable,
    sharpAvailable: true,
    storageMode: 'Protected Local Object Storage (.frameflow_storage)',
    models: {
      analysis: 'gemini-4-neon',
      deepThinking: 'gemini-4-carbon',
      general: 'gemini-4-hydrogen',
      lowLatency: 'gemini-3.1-flash-lite',
      transcribe: 'gemini-3.5-transcribe',
      imageGenEdit: 'gemini-nano-banana-2.1',
      videoGen: 'gemini-omni-1.2-flash',
      musicClip: 'lyria-3-clip-preview',
      musicPro: 'lyria-3-pro-preview',
    },
  };
}

/**
 * Analyzes an image or video keyframe using Gemini 4 Neon to extract subject framing
 * coordinates (for Intelligent Reframing), shot scale, lighting, and quality notes.
 */
export async function analyzeVisualAssetWithGemini(
  imageAbsPath: string,
  mimeType: string,
  assetKind: 'video' | 'photo',
  filename: string
): Promise<SubjectDetection> {
  const model = 'gemini-4-neon';
  const ai = getClient(model);
  const base64 = fs.readFileSync(imageAbsPath).toString('base64');

  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
              data: base64,
            },
          },
          {
            text: `Analyze this ${assetKind} frame ("${filename}") for professional nonlinear video editing and intelligent aspect-ratio reframing.
Identify the primary subject (person, face, product, vehicle, or focal landscape element), its normalized center (centerX, centerY from 0.0 to 1.0 where 0,0 is top-left), its bounding box width/height (0.05 to 1.0), shot scale, camera movement hint, and concise technical quality notes (exposure, focus, white balance). Never invent content not visible in the frame.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            centerX: { type: Type.NUMBER },
            centerY: { type: Type.NUMBER },
            boxWidth: { type: Type.NUMBER },
            boxHeight: { type: Type.NUMBER },
            shotScale: { type: Type.STRING },
            cameraMovement: { type: Type.STRING },
            qualityNotes: { type: Type.STRING },
          },
          required: ['label', 'confidence', 'centerX', 'centerY', 'boxWidth', 'boxHeight', 'shotScale', 'qualityNotes'],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    const validScales = new Set(['establishing', 'wide', 'medium', 'close_up', 'detail', 'unknown']);
    const validMoves = new Set(['static', 'pan', 'tilt', 'handheld', 'tracking', 'unknown']);

    return {
      label: String(parsed.label || 'Primary subject'),
      confidence: Math.max(0.1, Math.min(1, Number(parsed.confidence || 0.85))),
      centerX: Math.max(0.05, Math.min(0.95, Number(parsed.centerX ?? 0.5))),
      centerY: Math.max(0.05, Math.min(0.95, Number(parsed.centerY ?? 0.48))),
      boxWidth: Math.max(0.1, Math.min(1, Number(parsed.boxWidth ?? 0.4))),
      boxHeight: Math.max(0.1, Math.min(1, Number(parsed.boxHeight ?? 0.5))),
      shotScale: validScales.has(parsed.shotScale) ? parsed.shotScale : 'medium',
      cameraMovement: validMoves.has(parsed.cameraMovement) ? parsed.cameraMovement : 'static',
      qualityNotes: String(parsed.qualityNotes || 'Analyzed with Gemini 4 Neon.'),
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Generates a deep editorial creative plan and sequencing strategy using Gemini 4 Carbon
 * with ThinkingLevel.HIGH (no maxOutputTokens set, per skill guidelines).
 */
export async function generateCreativePlanWithGeminiCarbon(
  projectName: string,
  brief: CreativeBrief,
  assets: MediaAsset[]
): Promise<{
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
}> {
  const model = 'gemini-4-carbon';
  const ai = getClient(model);

  const assetInventory = assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    directive: a.directive,
    width: a.metadata.width,
    height: a.metadata.height,
    durationSec: a.metadata.durationSec,
    hasAudio: a.metadata.hasAudio,
    subject: a.analysis?.label || 'Unanalyzed',
    centerX: a.analysis?.centerX ?? 0.5,
    centerY: a.analysis?.centerY ?? 0.5,
    shotScale: a.analysis?.shotScale || 'unknown',
    qualityNotes: a.analysis?.qualityNotes || '',
  }));

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `You are a senior documentary film editor, colorist, and photo director at Frameflow Studio.
Create an honest, structured, non-destructive creative plan for project "${projectName}".
Creative Brief:
${JSON.stringify(brief, null, 2)}

Source Media Inventory:
${JSON.stringify(assetInventory, null, 2)}

Rules:
- Respect binding "must_keep" and "do_not_use" directives strictly.
- Never invent dialogue, events, or facts not present in the media inventory.
- Prefer straight cuts as default; use dissolves or fades sparingly.
- Do not pad duration artificially. Explain source limitations honestly.
- Select which assets belong in the ordered video sequence (orderedAssetIds) and give each a concise editorial role (opening, context, progression, detail, payoff, ending), selection reason, recommended holdSec (2 to 6s), and transition (cut, dissolve, fade_black).`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intendedViewer: { type: Type.STRING },
            storyEmphasis: { type: Type.STRING },
            visualMoodAndPace: { type: Type.STRING },
            mediaUsageStrategy: { type: Type.STRING },
            photoEditScope: { type: Type.STRING },
            assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
            sourceLimitations: { type: Type.ARRAY, items: { type: Type.STRING } },
            prioritizedChoices: { type: Type.ARRAY, items: { type: Type.STRING } },
            orderedAssetIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            segmentPlans: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  assetId: { type: Type.STRING },
                  role: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  holdSec: { type: Type.NUMBER },
                  transition: { type: Type.STRING },
                },
                required: ['assetId', 'role', 'reason', 'holdSec', 'transition'],
              },
            },
          },
          required: [
            'intendedViewer',
            'storyEmphasis',
            'visualMoodAndPace',
            'mediaUsageStrategy',
            'photoEditScope',
            'assumptions',
            'sourceLimitations',
            'prioritizedChoices',
            'orderedAssetIds',
            'segmentPlans',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    const segmentNotes: Record<string, { role: string; reason: string; holdSec: number; transition: string }> = {};
    for (const sp of parsed.segmentPlans || []) {
      segmentNotes[sp.assetId] = {
        role: sp.role || 'progression',
        reason: sp.reason || 'Selected for narrative progression.',
        holdSec: Math.max(1.5, Math.min(8, Number(sp.holdSec || 3.8))),
        transition: sp.transition || 'cut',
      };
    }

    return {
      intendedViewer: parsed.intendedViewer,
      storyEmphasis: parsed.storyEmphasis,
      visualMoodAndPace: parsed.visualMoodAndPace,
      mediaUsageStrategy: parsed.mediaUsageStrategy,
      photoEditScope: parsed.photoEditScope,
      assumptions: parsed.assumptions || [],
      sourceLimitations: parsed.sourceLimitations || [],
      prioritizedChoices: parsed.prioritizedChoices || [],
      orderedAssetIds: parsed.orderedAssetIds || [],
      segmentNotes,
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Multi-turn Studio Co-Director Chat supporting:
 * - general (gemini-4-hydrogen)
 * - deep_thinking (gemini-4-carbon with ThinkingLevel.HIGH, no maxOutputTokens)
 * - fast (gemini-3.1-flash-lite for low-latency advice)
 * - search_grounding (gemini-4-hydrogen with googleSearch tool returning groundingChunks)
 */
export async function runStudioAssistantChat(params: {
  mode: 'general' | 'complex_interactive' | 'deep_thinking' | 'fast' | 'search_grounding';
  projectContext: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
}): Promise<{ text: string; model: string; sources: Array<{ title: string; uri: string }> }> {
  const modelMap = {
    general: 'gemini-4-hydrogen',
    complex_interactive: 'gemini-4-neon',
    deep_thinking: 'gemini-4-carbon',
    fast: 'gemini-3.1-flash-lite',
    search_grounding: 'gemini-4-hydrogen',
  } as const;

  const model = modelMap[params.mode];
  const ai = getClient(model);

  const systemInstruction = `You are the Creative Co-Director & Finishing Editor inside Frameflow Studio.
You advise on nonlinear video pacing, intelligent aspect-ratio reframing, color grading, non-destructive photo retouching, audio mixing, and platform delivery specs.
Stay concise, practical, and truthful to the user's real project assets. Never invent footage or claim edits were applied unless the user applies them.

Current Project Context:
${params.projectContext}`;

  const contents = [
    ...params.history.slice(-10).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: params.userMessage }] },
  ];

  try {
    const config: Record<string, unknown> = { systemInstruction };
    if (params.mode === 'deep_thinking') {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
    } else if (params.mode === 'search_grounding') {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model,
      contents,
      config,
    });

    const sources: Array<{ title: string; uri: string }> = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }

    return {
      text: (response.text || '').trim() || 'No response returned by model.',
      model,
      sources,
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Low-latency micro-suggestion helper using gemini-3.1-flash-lite.
 */
export async function getQuickSuggestionWithFlashLite(prompt: string): Promise<string> {
  const model = 'gemini-3.1-flash-lite';
  const ai = getClient(model);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction:
          'You are a concise post-production editor. Respond in 2–3 crisp, actionable bullet points with no fluff.',
      },
    });
    return (response.text || '').trim();
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Transcribes uploaded or microphone-recorded audio using gemini-3.5-transcribe.
 */
export async function transcribeAudioWithGemini(
  audioBase64: string,
  mimeType: string
): Promise<{ transcript: string; model: string }> {
  const model = 'gemini-3.5-transcribe';
  const ai = getClient(model);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/webm',
              data: audioBase64,
            },
          },
          {
            text: 'Transcribe this audio accurately for video captions. Preserve punctuation and speaker clarity without inventing words.',
          },
        ],
      },
    });
    return {
      transcript: (response.text || '').trim(),
      model,
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Generates or edits an image with explicit aspect ratio control using gemini-nano-banana-2.1.
 * Supported ratios: 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9.
 */
export async function generateOrEditImageWithNanoBanana(params: {
  prompt: string;
  aspectRatio: string;
  sourceImageBase64?: string;
  sourceMimeType?: string;
}): Promise<{ buffer: Buffer; mimeType: string; notes: string; model: string }> {
  const model = 'gemini-nano-banana-2.1';
  const ai = getClient(model);

  const parts: Array<Record<string, unknown>> = [];
  if (params.sourceImageBase64) {
    parts.push({
      inlineData: {
        data: params.sourceImageBase64,
        mimeType: params.sourceMimeType || 'image/jpeg',
      },
    });
  }
  parts.push({ text: params.prompt });

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: params.aspectRatio || '16:9',
          imageSize: '1K',
        },
      },
    });

    let imgData: string | null = null;
    let imgMime = 'image/png';
    let notes = '';

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data && !imgData) {
        imgData = part.inlineData.data;
        imgMime = part.inlineData.mimeType || 'image/png';
      } else if (part.text) {
        notes += part.text;
      }
    }

    if (!imgData) {
      throw new ProviderConfigError(
        'Nano Banana 2.1 did not return an image for this prompt. Try refining the visual description.',
        model,
        502,
        false
      );
    }

    return {
      buffer: Buffer.from(imgData, 'base64'),
      mimeType: imgMime,
      notes: notes.trim(),
      model,
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Generates a video clip from text or animates a source image into video using
 * gemini-omni-1.2-flash via the Interactions API. Strictly supports 16:9 or 9:16.
 */
export async function generateVideoWithOmniFlash(params: {
  prompt: string;
  aspectRatio: '16:9' | '9:16';
  durationSec?: number;
  sourceImageBase64?: string;
  sourceMimeType?: string;
}): Promise<{ buffer: Buffer; mimeType: string; model: string }> {
  const model = 'gemini-omni-1.2-flash';
  const ai = getClient(model);
  const clampedDur = Math.max(3, Math.min(10, Math.round(params.durationSec || 5)));

  const interactionInput = params.sourceImageBase64
    ? [
        {
          type: 'image',
          mime_type: params.sourceMimeType || 'image/jpeg',
          data: params.sourceImageBase64,
        },
        {
          type: 'text',
          text: params.prompt,
        },
      ]
    : params.prompt;

  try {
    const interaction = await ai.interactions.create(
      {
        model,
        input: interactionInput,
        background: false,
        store: false,
        stream: false,
        response_format: {
          type: 'video',
          aspect_ratio: params.aspectRatio === '9:16' ? '9:16' : '16:9',
          duration: `${clampedDur}s`,
          resolution: '720p',
        },
      } as Parameters<typeof ai.interactions.create>[0],
      { timeout: 300000 }
    );

    const videoPart = (interaction as unknown as { output_video?: { data?: string; mime_type?: string } }).output_video;
    if (!videoPart?.data) {
      throw new ProviderConfigError(
        'Omni 1.2 Flash completed without returning video bytes.',
        model,
        502,
        false
      );
    }

    return {
      buffer: Buffer.from(videoPart.data, 'base64'),
      mimeType: videoPart.mime_type || 'video/mp4',
      model,
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

/**
 * Generates custom studio music using Lyria (lyria-3-clip-preview for 30s clips
 * or lyria-3-pro-preview for full-length tracks).
 */
export async function generateMusicWithLyria(params: {
  prompt: string;
  mode: 'clip' | 'pro';
}): Promise<{ buffer: Buffer; mimeType: string; lyrics: string; model: string }> {
  const model = params.mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';
  const ai = getClient(model);

  try {
    const stream = await ai.models.generateContentStream({
      model,
      contents: params.prompt,
    });

    const audioChunks: Buffer[] = [];
    let lyrics = '';
    let mimeType = 'audio/mpeg';

    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (audioChunks.length === 0 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
        }
        if (part.text) {
          lyrics += part.text;
        }
      }
    }

    if (audioChunks.length === 0) {
      throw new ProviderConfigError(
        `${model} did not return audio data. Try a clearer musical mood description.`,
        model,
        502,
        false
      );
    }

    return {
      buffer: Buffer.concat(audioChunks),
      mimeType,
      lyrics: lyrics.trim(),
      model,
    };
  } catch (err) {
    throw classifyGeminiError(err, model);
  }
}

export function mapAspectRatioToOmni(ratio: AspectRatio): '16:9' | '9:16' {
  return ratio === '9:16' || ratio === '4:5' ? '9:16' : '16:9';
}
