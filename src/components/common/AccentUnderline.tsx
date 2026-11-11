import React from 'react';

interface AccentUnderlineProps {
  children: React.ReactNode;
}

/**
 * Editorial italic emphasis paired with the signature curved electric-purple underline.
 */
export const AccentUnderline: React.FC<AccentUnderlineProps> = ({ children }) => {
  return (
    <span className="relative inline-block italic font-normal text-[#F7F4EC]">
      {children}
      <svg
        viewBox="0 0 220 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute left-0 -bottom-1.5 w-full h-3 pointer-events-none"
      >
        <path
          d="M2 10.5C68 3.5 148 2.5 218 8.5"
          stroke="#9670FF"
          strokeWidth="3.25"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
};

