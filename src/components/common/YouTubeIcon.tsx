import React from 'react';

interface YouTubeIconProps {
  className?: string;
}

export const YouTubeIcon: React.FC<YouTubeIconProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#FF0000" />
    <path d="M10 9.25L15.6 12L10 14.75V9.25Z" fill="#FFFFFF" />
  </svg>
);
