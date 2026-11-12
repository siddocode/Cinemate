'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/hooks/useSession';
import { Card } from '@/components/ui/Card';
import { AuthFormContent } from '@/components/auth/AuthFormContent';
import { AccentUnderline } from '@/components/common/AccentUnderline';
import { FeaturePillars } from '@/components/common/FeaturePillars';

interface AuthPageProps {
  initialTab?: 'signin' | 'signup';
}

interface AuthShellProps {
  resolvedInitialTab: 'signin' | 'signup';
  initialError: string | null;
  redirectTarget: string;
}

function AuthShell({ resolvedInitialTab, initialError, redirectTarget }: AuthShellProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>(resolvedInitialTab);

  return (
    <div className="flex-1 flex flex-col justify-between max-w-6xl w-full mx-auto px-4 sm:px-6 pt-8 pb-12 sm:pt-12 sm:pb-16">
      <div className="flex flex-col items-center text-center">
        {/* Eyebrow Indicator */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#173D30]/80 border border-[#E8DDC5]/16 text-[10px] font-mono uppercase tracking-[0.18em] text-[#E8DDC5] mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF]" />
          <span>Private Screening Access</span>
        </div>

        {/* Centered Editorial Headline */}
        <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] font-bold tracking-[-0.02em] leading-[1.1] text-[#F7F4EC] max-w-2xl">
          {activeTab === 'signin'
            ? 'Welcome back to Syncora.'
            : 'Join the screening room.'}
          <br />
          <span className="font-normal">
            Watch together in{' '}
            <AccentUnderline>real-time.</AccentUnderline>
          </span>
        </h1>

        <p className="mt-4 text-sm sm:text-base text-[#CDBF9F] max-w-lg leading-relaxed">
          {activeTab === 'signin'
            ? 'Sign in to access your private screening rooms, favorites, and synchronized sessions.'
            : 'Create an account to host persistent watch parties with your partner.'}
        </p>

        {/* Warm Sand Beige Auth Card */}
        <div className="w-full max-w-[440px] mt-8 text-left">
          <Card glow tone="sand" className="p-5 sm:p-6">
            <AuthFormContent
              initialTab={resolvedInitialTab}
              initialError={initialError}
              onTabChange={setActiveTab}
              onAuthenticated={(immediate) => {
                const target = redirectTarget || '/';
                if (typeof window !== 'undefined') {
                  if (immediate) {
                    window.location.replace(target);
                  } else {
                    setTimeout(() => {
                      window.location.replace(target);
                    }, 1000);
                  }
                } else if (immediate) {
                  router.replace(target);
                } else {
                  setTimeout(() => {
                    router.replace(target);
                  }, 1000);
                }
              }}
            />
          </Card>
        </div>
      </div>

      {/* Bottom 3-Column Feature Pillars */}
      <FeaturePillars />
    </div>
  );
}

function AuthForm({ initialTab = 'signin' }: AuthPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || '/';
  const queryTab = searchParams.get('tab') as 'signin' | 'signup' | null;
  const initialError = searchParams.get('error');

  const { isAuthenticated } = useSession();
  const resolvedInitialTab = queryTab || initialTab;

  useEffect(() => {
    if (isAuthenticated) {
      const target = redirectTarget || '/';
      if (typeof window !== 'undefined') {
        window.location.replace(target);
      } else {
        router.replace(target);
      }
    }
  }, [isAuthenticated, redirectTarget, router]);

  if (isAuthenticated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-[#CDBF9F]">
        <div className="w-7 h-7 border-2 border-[#E8DDC5]/25 border-t-[#9670FF] rounded-full animate-spin mb-3" />
        <p className="text-xs font-mono uppercase tracking-[0.14em]">
          Entering your screening lounge...
        </p>
      </div>
    );
  }

  return (
    <AuthShell
      key={resolvedInitialTab}
      resolvedInitialTab={resolvedInitialTab}
      initialError={initialError}
      redirectTarget={redirectTarget}
    />
  );
}

export default function AuthPage(props: AuthPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <div className="w-7 h-7 border-2 border-[#E8DDC5]/25 border-t-[#9670FF] rounded-full animate-spin" />
        </div>
      }
    >
      <AuthForm {...props} />
    </Suspense>
  );
}
