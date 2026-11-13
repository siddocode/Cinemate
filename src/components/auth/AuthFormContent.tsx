'use client';

import React, { useState } from 'react';
import {
  LogIn,
  UserPlus,
  AlertCircle,
  Mail,
  Lock,
  User,
  CheckCircle2,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

interface AuthFormContentProps {
  initialTab?: 'signin' | 'signup';
  initialError?: string | null;
  tone?: 'sand' | 'dark';
  onTabChange?: (tab: 'signin' | 'signup') => void;
  onLoadingChange?: (loading: boolean) => void;
  onAuthenticated: (immediate: boolean) => void;
}

export const AuthFormContent: React.FC<AuthFormContentProps> = ({
  initialTab = 'signin',
  initialError = null,
  tone = 'sand',
  onTabChange,
  onLoadingChange,
  onAuthenticated,
}) => {
  const isDark = tone === 'dark';
  const { signInWithEmail, signUpWithEmail } = useSession();
  const [tab, setTab] = useState<'signin' | 'signup'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const switchTab = (nextTab: 'signin' | 'signup', force: boolean = false) => {
    if (isLoading && !force) return;
    setTab(nextTab);
    setError(null);
    setSuccessMessage(null);
    onTabChange?.(nextTab);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Please provide both email and password.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);
    onLoadingChange?.(true);

    try {
      if (tab === 'signin') {
        const res = await signInWithEmail(trimmedEmail, password);
        if (res.error) {
          setError(res.error);
        } else {
          onAuthenticated(true);
        }
      } else {
        const res = await signUpWithEmail(trimmedEmail, password, username);
        if (res.error) {
          setError(res.error);
        } else if (res.requiresEmailConfirmation) {
          setSuccessMessage(
            res.message ||
              'Registration successful! Please check your email to confirm your account before signing in.'
          );
          switchTab('signin', true);
        } else {
          setSuccessMessage('Account created successfully. Entering lounge...');
          onAuthenticated(false);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsLoading(false);
      onLoadingChange?.(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Pill Tab Switcher */}
      <div
        className={`grid grid-cols-2 p-1 rounded-full text-xs ${
          isDark ? 'bg-[#173D30]' : 'bg-[#DFD2B4]'
        }`}
      >
        <button
          type="button"
          onClick={() => switchTab('signin')}
          disabled={isLoading}
          className={`py-2 px-3 rounded-full font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
            tab === 'signin'
              ? isDark
                ? 'bg-[#0B1E17] text-[#F7F4EC] shadow-sm'
                : 'bg-[#102B23] text-[#F7F4EC] shadow-sm'
              : isDark
                ? 'text-[#CDBF9F]/90 hover:text-[#F7F4EC]'
                : 'text-[#173D30]/80 hover:text-[#102B23]'
          }`}
        >
          <LogIn className="w-3.5 h-3.5" />
          Sign In
        </button>
        <button
          type="button"
          onClick={() => switchTab('signup')}
          disabled={isLoading}
          className={`py-2 px-3 rounded-full font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:pointer-events-none ${
            tab === 'signup'
              ? isDark
                ? 'bg-[#0B1E17] text-[#F7F4EC] shadow-sm'
                : 'bg-[#102B23] text-[#F7F4EC] shadow-sm'
              : isDark
                ? 'text-[#CDBF9F]/90 hover:text-[#F7F4EC]'
                : 'text-[#173D30]/80 hover:text-[#102B23]'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Register
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          className={`flex flex-col gap-2 text-xs p-3.5 rounded-xl border ${
            isDark
              ? 'text-[#FCA5A5] bg-[#2A1215] border-[#DC2626]/40'
              : 'text-[#7F1D1D] bg-[#FDECEC] border-[#DC2626]/30'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle
              className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-[#EF4444]' : 'text-[#B91C1C]'}`}
            />
            <span className="leading-relaxed">{error}</span>
          </div>
          {error.toLowerCase().includes('already exists') && (
            <button
              type="button"
              onClick={() => switchTab('signin')}
              className={`self-start text-xs underline underline-offset-4 font-semibold cursor-pointer ${
                isDark
                  ? 'text-[#B397FF] hover:text-[#D2C1FF]'
                  : 'text-[#7235A8] hover:text-[#5B218F]'
              }`}
            >
              Already have an account? Click here to sign in
            </button>
          )}
          {error.toLowerCase().includes('not confirmed') && (
            <div
              className={`text-xs p-2.5 rounded-lg mt-0.5 leading-relaxed border ${
                isDark
                  ? 'text-[#F0C987] bg-[#292214] border-[#D97706]/40'
                  : 'text-[#78350F] bg-[#FDF3DC] border-[#D97706]/30'
              }`}
            >
              <strong>Development Tip:</strong> In your Supabase Dashboard under{' '}
              <strong>Authentication → Providers → Email</strong>, disable{' '}
              <strong>&ldquo;Confirm email&rdquo;</strong> to allow instant sign-ins.
            </div>
          )}
        </div>
      )}

      {/* Success Alert */}
      {successMessage && (
        <div
          className={`flex items-start gap-2.5 text-xs p-3.5 rounded-xl border ${
            isDark
              ? 'text-[#9FE2BF] bg-[#133528] border-[#16A34A]/40'
              : 'text-[#14532D] bg-[#ECFDF5] border-[#16A34A]/30'
          }`}
        >
          <CheckCircle2
            className={`w-4 h-4 shrink-0 mt-0.5 ${isDark ? 'text-[#7AD3A8]' : 'text-[#15803D]'}`}
          />
          <span className="leading-relaxed">{successMessage}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {tab === 'signup' && (
          <Input
            label="Display Name"
            placeholder="e.g. Elena"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            leftIcon={<User className="w-4 h-4" />}
            disabled={isLoading}
            tone={tone}
            required
          />
        )}

        <Input
          label="Email Address"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leftIcon={<Mail className="w-4 h-4" />}
          disabled={isLoading}
          tone={tone}
          required
          autoFocus
        />

        <Input
          label="Password"
          type={showPassword ? 'text' : 'password'}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<Lock className="w-4 h-4" />}
          disabled={isLoading}
          tone={tone}
          rightIcon={
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              disabled={isLoading}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={`transition-colors cursor-pointer disabled:pointer-events-none ${
                isDark
                  ? 'text-[#CDBF9F]/80 hover:text-[#F7F4EC]'
                  : 'text-[#173D30]/70 hover:text-[#102B23]'
              }`}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
          helperText={tab === 'signup' ? 'Minimum 6 characters.' : undefined}
          required
        />

        <div className="pt-1">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full justify-center"
            isLoading={isLoading}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            {isLoading
              ? tab === 'signin'
                ? 'Signing In…'
                : 'Creating Account…'
              : tab === 'signin'
              ? 'Enter Screening Lounge'
              : 'Create Account'}
          </Button>
        </div>
      </form>

      {/* Bottom Switcher */}
      <div
        className={`pt-3.5 border-t text-center text-xs ${
          isDark
            ? 'border-[#E8DDC5]/12 text-[#CDBF9F]/90'
            : 'border-[#173D30]/12 text-[#173D30]/85'
        }`}
      >
        {tab === 'signin' ? (
          <p>
            New to Syncora?{' '}
            <button
              type="button"
              onClick={() => switchTab('signup')}
              disabled={isLoading}
              className={`font-semibold underline underline-offset-4 cursor-pointer disabled:opacity-50 disabled:pointer-events-none ${
                isDark
                  ? 'text-[#B397FF] hover:text-[#D2C1FF]'
                  : 'text-[#7235A8] hover:text-[#5B218F]'
              }`}
            >
              Create an account
            </button>
          </p>
        ) : (
          <p>
            Already registered?{' '}
            <button
              type="button"
              onClick={() => switchTab('signin')}
              disabled={isLoading}
              className={`font-semibold underline underline-offset-4 cursor-pointer disabled:opacity-50 disabled:pointer-events-none ${
                isDark
                  ? 'text-[#B397FF] hover:text-[#D2C1FF]'
                  : 'text-[#7235A8] hover:text-[#5B218F]'
              }`}
            >
              Sign in here
            </button>
          </p>
        )}
      </div>
    </div>
  );
};
