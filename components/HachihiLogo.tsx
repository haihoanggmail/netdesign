import React, { useId } from 'react';

interface HachihiLogoProps {
  size?: number;
  variant?: 'auto' | 'light' | 'dark';
  showWordmark?: boolean;
  className?: string;
}

export const HachihiLogo: React.FC<HachihiLogoProps> = ({
  size = 28,
  variant = 'auto',
  showWordmark = false,
  className = ''
}) => {
  const uid = useId().replace(/:/g, '');
  const gradientId = `hachihiLogoBg_${uid}`;

  const wordmarkTone =
    variant === 'dark'
      ? 'text-white'
      : variant === 'light'
      ? 'text-slate-900'
      : 'text-slate-900 dark:text-white';

  const frameStrokeOpacity = variant === 'dark' ? '0.55' : '0.42';

  return (
    <span className={`inline-flex items-center gap-2 shrink-0 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#155EEF" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill={`url(#${gradientId})`} />
        <rect
          x="7"
          y="7"
          width="50"
          height="50"
          rx="10"
          stroke="#60A5FA"
          strokeOpacity={frameStrokeOpacity}
          strokeWidth="1.5"
        />
        <path
          d="M20 18V46M44 18V46M20 32H44"
          stroke="#FFFFFF"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="18" r="3.2" fill="#38BDF8" />
        <circle cx="44" cy="18" r="3.2" fill="#38BDF8" />
        <circle cx="20" cy="46" r="3.2" fill="#38BDF8" />
        <circle cx="44" cy="46" r="3.2" fill="#38BDF8" />
        <circle cx="32" cy="32" r="3.5" fill="#FBBF24" />
      </svg>
      {showWordmark && (
        <span className={`font-bold tracking-tight text-sm whitespace-nowrap ${wordmarkTone}`}>
          HACHIHI
        </span>
      )}
    </span>
  );
};
