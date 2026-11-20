import React, { useState } from 'react';
import { ArrowRight, Crop, Film, Layers, Sliders, Check } from 'lucide-react';
import { BrandMark } from './BrandMark';

interface LandingPageProps {
  onLaunchDemo: () => void;
  onOpenAuth: (mode: 'signin' | 'signup') => void;
  demoLoading: boolean;
  launchError?: string | null;
}

const HERO_IMG = '/src/assets/images/hero_studio_frame_1795169067824.jpg';
const ROASTER_IMG = '/src/assets/images/media_craft_roaster_1795169056288.jpg';
const WATCH_IMG = '/src/assets/images/media_watch_detail_1795169048977.jpg';
const PORTRAIT_IMG = '/src/assets/images/media_portrait_filmmaker_1795169045724.jpg';
const ALPINE_IMG = '/src/assets/images/media_alpine_ridge_1795169049175.jpg';

export const LandingPage: React.FC<LandingPageProps> = ({
  onLaunchDemo,
  onOpenAuth,
  demoLoading,
  launchError,
}) => {
  const [previewRatio, setPreviewRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');

  return (
    <div className="min-h-screen bg-[#0D0E11] text-[#F2EFE9] flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-[#232730] bg-[#0D0E11]/95 backdrop-blur-sm">
        <div className="max-w-[1360px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-[#F2EFE9] whitespace-nowrap shrink-0"
          >
            <BrandMark size={22} />
            <span>Frameflow Studio</span>
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm text-[#9AA0AE]"
          >
            <a href="#workflow" className="hover:text-[#F2EFE9] transition-colors whitespace-nowrap shrink-0">
              Workflow
            </a>
            <a href="#reframing" className="hover:text-[#F2EFE9] transition-colors whitespace-nowrap shrink-0">
              Reframing
            </a>
            <a href="#photo-grade" className="hover:text-[#F2EFE9] transition-colors whitespace-nowrap shrink-0">
              Photo & Color
            </a>
            <a href="#delivery" className="hover:text-[#F2EFE9] transition-colors whitespace-nowrap shrink-0">
              Delivery
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('signin')}
              className="px-3.5 py-2 text-sm font-medium text-[#D1D5DF] hover:text-[#F2EFE9] transition-colors whitespace-nowrap shrink-0"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={onLaunchDemo}
              disabled={demoLoading}
              className="px-4 py-2 text-sm font-medium bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {demoLoading ? 'Opening…' : 'Open Studio'}
            </button>
          </div>
        </div>
      </header>

      {/* Split-Screen Editorial Hero */}
      <main id="top" className="flex-1">
        <section className="max-w-[1360px] mx-auto px-6 pt-14 pb-12 lg:pt-20 lg:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-5 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-[0.08em] text-[#D99B43] mb-4">
                Nonlinear AI Video & Photo Post-Production
              </p>
              <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08] text-[#F2EFE9] mb-5">
                AI cuts the first assembly. You own every frame.
              </h1>
              <p className="text-[15px] leading-relaxed text-[#9AA0AE] max-w-[46ch] mb-8">
                Upload raw clips and still photography, define your creative brief, and let
                Frameflow assemble a structured, revisable edit—complete with intelligent
                aspect-ratio reframing, per-clip dynamic range correction, batch photo grading,
                and real server-side rendering.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onLaunchDemo}
                  disabled={demoLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <span>{demoLoading ? 'Loading Workspace…' : 'Launch Studio Workspace'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth('signup')}
                  className="px-5 py-2.5 text-sm font-medium border border-[#323744] text-[#F2EFE9] rounded-md hover:bg-[#1A1D24] transition-colors whitespace-nowrap shrink-0"
                >
                  Create Account
                </button>
              </div>

              {launchError && (
                <div
                  role="alert"
                  className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-200"
                >
                  {launchError}
                </div>
              )}

              <p className="mt-6 text-xs text-[#6C7280]">
                Non-destructive revisions · Originals preserved untouched · FFmpeg & Sharp pipeline
              </p>
            </div>

            {/* Interactive Studio Monitor Preview */}
            <div className="lg:col-span-7 flex flex-col bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#232730] flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3 text-[#9AA0AE]">
                  <span className="text-[#F2EFE9] font-medium">Pacific Craft — Master Sequence</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-[#D99B43]">00:00:04:18</span>
                </div>
                <div className="flex items-center gap-1 bg-[#0D0E11] p-0.5 rounded border border-[#272B35]">
                  {(['16:9', '9:16', '1:1'] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setPreviewRatio(ratio)}
                      className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded transition-colors ${
                        previewRatio === ratio
                          ? 'bg-[#262B36] text-[#F2EFE9]'
                          : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative flex-1 min-h-[300px] sm:min-h-[360px] bg-[#090A0C] overflow-hidden flex items-center justify-center">
                <img
                  src={HERO_IMG}
                  alt="Pacific Northwest coastal highway documentary frame inside Frameflow Studio monitor"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-90"
                />
                {/* Live Intelligent Reframing Overlay Box */}
                <div
                  aria-label={`Intelligent reframe crop guide for ${previewRatio}`}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center transition-all duration-200"
                >
                  {previewRatio === '16:9' && (
                    <div className="w-[92%] h-[88%] border border-[#D99B43]/70 relative">
                      <span className="absolute top-2 left-2 text-[11px] font-mono text-[#F2EFE9] bg-[#0D0E11]/85 px-2 py-0.5">
                        16:9 Safe Frame · Subject Centered
                      </span>
                    </div>
                  )}
                  {previewRatio === '9:16' && (
                    <div className="h-[92%] aspect-[9/16] translate-x-[16%] border-2 border-[#D99B43] shadow-[0_0_0_9999px_rgba(9,10,12,0.62)] relative">
                      <span className="absolute top-2 left-2 text-[11px] font-mono text-[#F2EFE9] bg-[#0D0E11]/90 px-2 py-0.5">
                        9:16 Auto-Reframe · x=0.66
                      </span>
                      <div className="absolute left-1/2 top-[60%] -translate-x-1/2 -translate-y-1/2 w-5 h-5 border border-[#D99B43] rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-[#D99B43] rounded-full" />
                      </div>
                    </div>
                  )}
                  {previewRatio === '1:1' && (
                    <div className="h-[92%] aspect-square translate-x-[10%] border-2 border-[#D99B43] shadow-[0_0_0_9999px_rgba(9,10,12,0.58)] relative">
                      <span className="absolute top-2 left-2 text-[11px] font-mono text-[#F2EFE9] bg-[#0D0E11]/90 px-2 py-0.5">
                        1:1 Auto-Reframe · x=0.62
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Minimal timeline strip preview */}
              <div className="px-4 py-3 bg-[#111318] border-t border-[#232730] grid grid-cols-12 gap-1.5 text-[11px] font-mono">
                <div className="col-span-4 bg-[#222733] border border-[#363D4E] rounded-sm px-2 py-1.5 truncate text-[#F2EFE9]">
                  V1 · Coastal_A001.mp4
                </div>
                <div className="col-span-4 bg-[#2A251D] border border-[#D99B43]/60 rounded-sm px-2 py-1.5 truncate text-[#F2EFE9]">
                  V1 · Roaster_B004.mp4
                </div>
                <div className="col-span-2 bg-[#1D2428] border border-[#324148] rounded-sm px-2 py-1.5 truncate text-[#C9D2D9]">
                  STILL · Watch
                </div>
                <div className="col-span-2 bg-[#1D2428] border border-[#324148] rounded-sm px-2 py-1.5 truncate text-[#C9D2D9]">
                  STILL · Ridge
                </div>
              </div>
            </div>
          </div>

          {/* 4-Column Studio Workflow Strip (below hero split) */}
          <div
            id="workflow"
            className="mt-12 pt-8 border-t border-[#232730] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8"
          >
            <div>
              <p className="font-mono text-xs text-[#D99B43] mb-1.5">01. Ingest & Brief</p>
              <h2 className="text-base font-semibold text-[#F2EFE9] mb-1">Immutable originals</h2>
              <p className="text-sm text-[#9AA0AE] leading-relaxed">
                Upload video, stills, and audio with real format validation and binding must-keep rules.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-[#D99B43] mb-1.5">02. Structured AI Plan</p>
              <h2 className="text-base font-semibold text-[#F2EFE9] mb-1">Editable multitrack cut</h2>
              <p className="text-sm text-[#9AA0AE] leading-relaxed">
                Scene analysis and creative sequencing produce revisable timeline segments—never a locked black box.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-[#D99B43] mb-1.5">03. Reframe & Grade</p>
              <h2 className="text-base font-semibold text-[#F2EFE9] mb-1">Precision finishing</h2>
              <p className="text-sm text-[#9AA0AE] leading-relaxed">
                Subject-aware crop tracking, per-clip dynamic range curves, and consistent batch photo looks.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs text-[#D99B43] mb-1.5">04. Verified Delivery</p>
              <h2 className="text-base font-semibold text-[#F2EFE9] mb-1">Real FFmpeg & Sharp</h2>
              <p className="text-sm text-[#9AA0AE] leading-relaxed">
                Track background render progress, cancel safely, and download real MP4, JPEG, PNG, or ZIP batches.
              </p>
            </div>
          </div>
        </section>

        {/* Reframing & Dynamic Range Showcase */}
        <section id="reframing" className="border-t border-[#232730] bg-[#111318]">
          <div className="max-w-[1360px] mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <div className="flex items-center gap-2 text-xs text-[#D99B43] font-medium mb-3">
                <Crop className="w-4 h-4" />
                <span>Intelligent Reframing & Dynamic Range</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-[#F2EFE9] mb-4">
                Deliver 16:9, 9:16, 1:1, and 4:5 from one non-destructive timeline.
              </h2>
              <p className="text-sm text-[#9AA0AE] leading-relaxed mb-6">
                Frameflow detects primary subjects—people, faces, hands, and products—and computes
                safe crop windows with headroom protection. Every crop and dynamic range adjustment
                stays editable per clip and compares cleanly against the untouched source.
              </p>
              <ul className="space-y-2.5 text-sm text-[#D1D5DF]">
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#D99B43] mt-0.5 shrink-0" />
                  <span>Manual focal X/Y, zoom, and safe-margin guides inside the Inspector</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#D99B43] mt-0.5 shrink-0" />
                  <span>Exposure, highlights, shadows, whites, and blacks per video clip and photo</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-[#D99B43] mt-0.5 shrink-0" />
                  <span>Honest crop-loss and resolution warnings before you render</span>
                </li>
              </ul>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden">
                <div className="aspect-[4/3] relative overflow-hidden">
                  <img
                    src={ROASTER_IMG}
                    alt="Artisan coffee roaster framed for editorial video and photo grading"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3">
                    <p className="text-xs font-medium text-[#F2EFE9]">Subject Tracking · Roaster Pour</p>
                    <p className="text-[11px] font-mono text-[#D1D5DF] tabular-nums">
                      Focal (0.64, 0.42) · Headroom Protected
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden">
                <div className="aspect-[4/3] relative overflow-hidden">
                  <img
                    src={WATCH_IMG}
                    alt="Brushed titanium chronograph studio product photo"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3">
                    <p className="text-xs font-medium text-[#F2EFE9]">Commercial Product · Macro Detail</p>
                    <p className="text-[11px] font-mono text-[#D1D5DF] tabular-nums">
                      Highlights -8 · Shadows +10 · Crisp Dial
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Photo Studio & Mixed Delivery */}
        <section id="photo-grade" className="border-t border-[#232730]">
          <div className="max-w-[1360px] mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 grid grid-cols-12 gap-4">
              <div className="col-span-7 bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden">
                <img
                  src={ALPINE_IMG}
                  alt="Alpine granite mountain ridge edited in Photo Studio"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover min-h-[240px]"
                />
              </div>
              <div className="col-span-5 bg-[#14161B] border border-[#272B35] rounded-lg overflow-hidden">
                <img
                  src={PORTRAIT_IMG}
                  alt="Natural light documentary portrait preserving authentic skin texture"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover min-h-[240px]"
                />
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="flex items-center gap-2 text-xs text-[#D99B43] font-medium mb-3">
                <Sliders className="w-4 h-4" />
                <span>Photo Collection & Mixed-Project Architecture</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-semibold text-[#F2EFE9] mb-4">
                Batch consistency that adapts to each photograph.
              </h2>
              <p className="text-sm text-[#9AA0AE] leading-relaxed mb-6">
                Every photo keeps its own independent recipe even when sequenced as a still segment
                inside a video edit. Match exposure and color direction across a collection while
                preserving natural skin texture, authentic lighting, and recognizable identity.
              </p>
              <div id="delivery" className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-[#14161B] border border-[#272B35] rounded-md">
                  <Film className="w-4 h-4 text-[#D99B43] mb-2" />
                  <h3 className="text-sm font-semibold text-[#F2EFE9] mb-1">Video Mastering</h3>
                  <p className="text-xs text-[#9AA0AE] leading-relaxed">
                    Server-side FFmpeg MP4 export with per-clip reframing, color curves, and audio mix.
                  </p>
                </div>
                <div className="p-4 bg-[#14161B] border border-[#272B35] rounded-md">
                  <Layers className="w-4 h-4 text-[#D99B43] mb-2" />
                  <h3 className="text-sm font-semibold text-[#F2EFE9] mb-1">Photo Delivery</h3>
                  <p className="text-xs text-[#9AA0AE] leading-relaxed">
                    Export single JPEG, PNG, or TIFF stills, or download full edited sets as a ZIP archive.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#232730] py-6 px-6">
        <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6C7280]">
          <div className="flex items-center gap-2">
            <BrandMark size={16} />
            <span>Frameflow Studio</span>
            <span aria-hidden="true">·</span>
            <span>Non-destructive AI photo & video editing suite</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => onOpenAuth('signin')}
              className="hover:text-[#F2EFE9] transition-colors"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={onLaunchDemo}
              className="hover:text-[#F2EFE9] transition-colors"
            >
              Demo workspace
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
