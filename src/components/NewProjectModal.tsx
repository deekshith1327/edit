import React, { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type {
  AspectRatio,
  ContentPriority,
  CreativeBrief,
  EditingPace,
  ProjectType,
  VisualDirection,
} from '../shared/types';

interface NewProjectModalProps {
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    type: ProjectType;
    brief: Partial<CreativeBrief>;
  }) => Promise<void>;
}

const PURPOSES = [
  { value: 'social_short', label: 'Social Short' },
  { value: 'youtube_video', label: 'YouTube Video' },
  { value: 'event_recap', label: 'Event Recap' },
  { value: 'travel_story', label: 'Travel Story' },
  { value: 'product_promotion', label: 'Product Promotion' },
  { value: 'brand_story', label: 'Brand Story' },
  { value: 'podcast_clip', label: 'Podcast Clip' },
  { value: 'photo_gallery', label: 'Photo Gallery' },
  { value: 'portrait_collection', label: 'Portrait Collection' },
  { value: 'custom', label: 'Custom' },
];

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('mixed');
  const [purpose, setPurpose] = useState('brand_story');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [durationMode, setDurationMode] = useState<'auto' | 'custom'>('auto');
  const [targetDurationSec, setTargetDurationSec] = useState(30);
  const [pace, setPace] = useState<EditingPace>('balanced');
  const [visualDirection, setVisualDirection] = useState<VisualDirection>('cinematic');
  const [contentPriority, setContentPriority] = useState<ContentPriority>('balanced');
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [titlesEnabled, setTitlesEnabled] = useState(true);
  const [logoEnabled, setLogoEnabled] = useState(false);
  const [endCardEnabled, setEndCardEnabled] = useState(true);
  const [musicSource, setMusicSource] = useState<CreativeBrief['musicSource']>('later');
  const [writtenInstruction, setWrittenInstruction] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [brandPrimaryColor, setBrandPrimaryColor] = useState('#D99B43');
  const [brandTitleText, setBrandTitleText] = useState('');
  const [endCardText, setEndCardText] = useState('');
  const [mustKeepNotes, setMustKeepNotes] = useState('');
  const [doNotUseNotes, setDoNotUseNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter a project name to continue.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        type,
        brief: {
          purpose,
          aspectRatio,
          targetDurationSec: durationMode === 'custom' ? targetDurationSec : null,
          pace,
          visualDirection,
          contentPriority,
          captionsEnabled,
          titlesEnabled,
          logoEnabled,
          endCardEnabled,
          musicSource,
          writtenInstruction: writtenInstruction.trim(),
          brandPrimaryColor,
          brandTitleText: brandTitleText.trim() || name.trim(),
          endCardText: endCardText.trim(),
          mustKeepNotes: mustKeepNotes.trim(),
          doNotUseNotes: doNotUseNotes.trim(),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project.');
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-heading"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-2xl bg-[#14161B] border border-[#2E3340] rounded-lg overflow-hidden my-8">
        <div className="px-6 py-4 border-b border-[#232730] flex items-center justify-between">
          <div>
            <h2 id="new-project-heading" className="text-lg font-semibold text-[#F2EFE9]">
              New Project & Creative Brief
            </h2>
            <p className="text-xs text-[#9AA0AE] mt-0.5">
              Define your editing goals. Optional settings default sensibly and remain editable later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new project dialog"
            className="p-1.5 text-[#9AA0AE] hover:text-[#F2EFE9] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          {error && (
            <div role="alert" className="p-3 bg-red-950/50 border border-red-800/70 rounded text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="proj-name" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Project name
              </label>
              <input
                id="proj-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Autumn Roastery Launch Film"
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D1D5DF] mb-1.5">Project type</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#0D0E11] border border-[#272B35] rounded-md">
                {(['mixed', 'video', 'photo'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`py-1.5 text-xs font-medium rounded transition-colors ${
                      type === t ? 'bg-[#252A36] text-[#F2EFE9]' : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {t === 'photo' ? 'Photo Set' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="proj-purpose" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Purpose
              </label>
              <select
                id="proj-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] focus:border-[#D99B43] focus:outline-none"
              >
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Platform & aspect ratio
              </label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-[#0D0E11] border border-[#272B35] rounded-md">
                {(['16:9', '9:16', '1:1', '4:5'] as const).map((ar) => (
                  <button
                    key={ar}
                    type="button"
                    onClick={() => setAspectRatio(ar)}
                    className={`py-1.5 text-xs font-mono tabular-nums rounded transition-colors ${
                      aspectRatio === ar
                        ? 'bg-[#252A36] text-[#F2EFE9]'
                        : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {ar}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="proj-pace" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Editing pace
              </label>
              <select
                id="proj-pace"
                value={pace}
                onChange={(e) => setPace(e.target.value as EditingPace)}
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] focus:border-[#D99B43] focus:outline-none"
              >
                <option value="calm">Calm (longer holds)</option>
                <option value="balanced">Balanced (editorial)</option>
                <option value="energetic">Energetic</option>
                <option value="fast">Fast (social pacing)</option>
              </select>
            </div>

            <div>
              <label htmlFor="proj-direction" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Visual direction
              </label>
              <select
                id="proj-direction"
                value={visualDirection}
                onChange={(e) => setVisualDirection(e.target.value as VisualDirection)}
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] focus:border-[#D99B43] focus:outline-none"
              >
                <option value="cinematic">Cinematic</option>
                <option value="clean_commercial">Clean Commercial</option>
                <option value="documentary">Documentary</option>
                <option value="warm_lifestyle">Warm Lifestyle</option>
                <option value="editorial">Editorial</option>
                <option value="bold_social">Bold Social</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label htmlFor="proj-priority" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Content priority
              </label>
              <select
                id="proj-priority"
                value={contentPriority}
                onChange={(e) => setContentPriority(e.target.value as ContentPriority)}
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] focus:border-[#D99B43] focus:outline-none"
              >
                <option value="balanced">Balanced</option>
                <option value="dialogue">Dialogue & Speech</option>
                <option value="action">Action & Movement</option>
                <option value="scenery">Scenery & Atmosphere</option>
                <option value="people">People & Portraits</option>
                <option value="product">Product Details</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Target video duration
              </label>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Duration mode"
                  value={durationMode}
                  onChange={(e) => setDurationMode(e.target.value as 'auto' | 'custom')}
                  className="flex-1 px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9]"
                >
                  <option value="auto">Automatic (best honest cut)</option>
                  <option value="custom">Target seconds</option>
                </select>
                {durationMode === 'custom' && (
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={targetDurationSec}
                    onChange={(e) => setTargetDurationSec(Number(e.target.value))}
                    aria-label="Target duration in seconds"
                    className="w-24 px-3 py-2 text-sm font-mono tabular-nums bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9]"
                  />
                )}
              </div>
            </div>

            <div>
              <label htmlFor="proj-music" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Music source
              </label>
              <select
                id="proj-music"
                value={musicSource}
                onChange={(e) => setMusicSource(e.target.value as CreativeBrief['musicSource'])}
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9]"
              >
                <option value="later">Choose later in Audio Studio</option>
                <option value="uploaded">Upload my own licensed track</option>
                <option value="generated">Generate custom track with Lyria</option>
                <option value="none">No music (natural sound only)</option>
              </select>
            </div>
          </div>

          {/* Captions, titles, logo, end card toggles */}
          <div className="flex flex-wrap items-center gap-5 pt-1 text-xs text-[#D1D5DF]">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={titlesEnabled}
                onChange={(e) => setTitlesEnabled(e.target.checked)}
                className="accent-[#D99B43]"
              />
              <span>Titles</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={captionsEnabled}
                onChange={(e) => setCaptionsEnabled(e.target.checked)}
                className="accent-[#D99B43]"
              />
              <span>Captions</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={endCardEnabled}
                onChange={(e) => setEndCardEnabled(e.target.checked)}
                className="accent-[#D99B43]"
              />
              <span>End card</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={logoEnabled}
                onChange={(e) => setLogoEnabled(e.target.checked)}
                className="accent-[#D99B43]"
              />
              <span>Logo mark</span>
            </label>
          </div>

          <div>
            <label htmlFor="proj-instruction" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
              Creative direction notes (optional)
            </label>
            <textarea
              id="proj-instruction"
              rows={2}
              value={writtenInstruction}
              onChange={(e) => setWrittenInstruction(e.target.value)}
              placeholder='e.g. "Focus on product craft, keep the speaker’s full explanation, use restrained warm highlights."'
              className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
            />
          </div>

          {/* Collapsed Advanced Controls */}
          <div className="border-t border-[#232730] pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#9AA0AE] hover:text-[#F2EFE9]"
            >
              {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span>Advanced brief, branding & binding rules</span>
            </button>

            {showAdvanced && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="brand-title" className="block text-xs text-[#9AA0AE] mb-1">
                    Opening title text
                  </label>
                  <input
                    id="brand-title"
                    type="text"
                    value={brandTitleText}
                    onChange={(e) => setBrandTitleText(e.target.value)}
                    placeholder="Defaults to project name"
                    className="w-full px-3 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  />
                </div>
                <div>
                  <label htmlFor="end-card-text" className="block text-xs text-[#9AA0AE] mb-1">
                    End-card subtitle
                  </label>
                  <input
                    id="end-card-text"
                    type="text"
                    value={endCardText}
                    onChange={(e) => setEndCardText(e.target.value)}
                    placeholder="e.g. Crafted in Seattle"
                    className="w-full px-3 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  />
                </div>
                <div>
                  <label htmlFor="must-keep" className="block text-xs text-[#9AA0AE] mb-1">
                    Binding must-keep instructions
                  </label>
                  <input
                    id="must-keep"
                    type="text"
                    value={mustKeepNotes}
                    onChange={(e) => setMustKeepNotes(e.target.value)}
                    placeholder="Moments or products that must stay"
                    className="w-full px-3 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  />
                </div>
                <div>
                  <label htmlFor="do-not-use" className="block text-xs text-[#9AA0AE] mb-1">
                    Binding do-not-use instructions
                  </label>
                  <input
                    id="do-not-use"
                    type="text"
                    value={doNotUseNotes}
                    onChange={(e) => setDoNotUseNotes(e.target.value)}
                    placeholder="Shots or scenes to exclude"
                    className="w-full px-3 py-1.5 text-xs bg-[#0D0E11] border border-[#2C313D] rounded text-[#F2EFE9]"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <label htmlFor="brand-color" className="text-xs text-[#9AA0AE]">
                    Brand accent color
                  </label>
                  <input
                    id="brand-color"
                    type="color"
                    value={brandPrimaryColor}
                    onChange={(e) => setBrandPrimaryColor(e.target.value)}
                    className="w-8 h-6 bg-transparent border border-[#2C313D] rounded cursor-pointer"
                  />
                  <span className="text-xs font-mono text-[#9AA0AE]">{brandPrimaryColor}</span>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#232730] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#D1D5DF] hover:text-[#F2EFE9] bg-[#1B1E25] rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] disabled:opacity-60"
            >
              {submitting ? 'Creating…' : 'Create Project & Open Media Pool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
