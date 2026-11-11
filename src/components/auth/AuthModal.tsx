'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AuthFormContent } from '@/components/auth/AuthFormContent';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'signin' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'signin',
}) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      preventClose={isAuthenticating}
      title="Member Access"
      description="Sign in to host private screening rooms, save favorites, and keep your display identity."
    >
      <AuthFormContent
        key={initialTab}
        initialTab={initialTab}
        onLoadingChange={setIsAuthenticating}
        onAuthenticated={(immediate) => {
          if (immediate) {
            onClose();
          } else {
            setTimeout(() => {
              onClose();
            }, 900);
          }
        }}
      />
    </Modal>
  );
};
