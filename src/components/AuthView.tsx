import React, { useState } from 'react';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { BrandMark } from './BrandMark';
import type { User } from '../shared/types';

interface AuthViewProps {
  initialMode: 'signin' | 'signup';
  onAuthenticated: (user: User) => void;
  onBack: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({ initialMode, onAuthenticated, onBack }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode === 'signup' && name.trim().length < 2) {
      setError('Enter your full name (at least 2 characters).');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    try {
      const res =
        mode === 'signin'
          ? await api.signIn(email.trim(), password)
          : await api.signUp(email.trim(), name.trim(), password);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to complete authentication.');
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.signInDemo();
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open demo workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0E11] text-[#F2EFE9] flex flex-col">
      <header className="px-6 h-16 border-b border-[#232730] flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-[#9AA0AE] hover:text-[#F2EFE9] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to overview</span>
        </button>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BrandMark size={20} />
          <span>Frameflow Studio</span>
        </div>
        <div className="w-24" />
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-[#14161B] border border-[#272B35] rounded-lg p-7">
          <h1 className="text-xl font-semibold text-[#F2EFE9] mb-1">
            {mode === 'signin' ? 'Sign in to Frameflow Studio' : 'Create your studio account'}
          </h1>
          <p className="text-sm text-[#9AA0AE] mb-6">
            {mode === 'signin'
              ? 'Access your projects, non-destructive revisions, and media library.'
              : 'Your uploads, timelines, and exports are isolated to your account.'}
          </p>

          <div className="grid grid-cols-2 gap-1 p-1 bg-[#0D0E11] rounded-md border border-[#232730] mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`py-1.5 text-xs font-medium rounded transition-colors ${
                mode === 'signin'
                  ? 'bg-[#222630] text-[#F2EFE9]'
                  : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
              className={`py-1.5 text-xs font-medium rounded transition-colors ${
                mode === 'signup'
                  ? 'bg-[#222630] text-[#F2EFE9]'
                  : 'text-[#9AA0AE] hover:text-[#F2EFE9]'
              }`}
            >
              Create account
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-md bg-red-950/50 border border-red-800/70 text-xs text-red-200 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                  Full name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Mercer"
                  className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="editor@studio.com"
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-[#D1D5DF] mb-1.5">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-3 py-2 text-sm bg-[#0D0E11] border border-[#2C313D] rounded-md text-[#F2EFE9] placeholder:text-[#6C7280] focus:border-[#D99B43] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 text-sm font-semibold bg-[#D99B43] text-[#0D0E11] rounded-md hover:bg-[#E5AA54] transition-colors disabled:opacity-60"
            >
              {busy
                ? 'Please wait…'
                : mode === 'signin'
                  ? 'Sign in'
                  : 'Create studio account'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-[#232730]">
            <button
              type="button"
              onClick={handleDemo}
              disabled={busy}
              className="w-full py-2.5 text-sm font-medium bg-[#1B1E25] border border-[#323744] text-[#F2EFE9] rounded-md hover:bg-[#232731] transition-colors disabled:opacity-60"
            >
              Continue with Seeded Studio Demo
            </button>
            <p className="mt-2 text-[11px] text-[#6C7280] text-center">
              Opens a ready-to-edit mixed video & photo project with real source files.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};
