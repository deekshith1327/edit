import React from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 24, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="3" width="24" height="22" rx="4" stroke="#F2EFE9" strokeWidth="1.75" />
      <path d="M9 3V25" stroke="#363C4A" strokeWidth="1.5" />
      <path d="M19 3V25" stroke="#363C4A" strokeWidth="1.5" />
      <rect x="11.5" y="8.5" width="5" height="11" rx="1.2" fill="#D99B43" />
      <path d="M5 10.5H6.5M5 14H6.5M5 17.5H6.5" stroke="#9AA0AE" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M21.5 10.5H23M21.5 14H23M21.5 17.5H23" stroke="#9AA0AE" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
};
