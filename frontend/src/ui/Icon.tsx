import type { SVGProps } from 'react';

const paths = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></>,
  moon: <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  mountain: <><path d="m3 18 6-12 5 8 3-5 4 9H3Z" /><path d="m7 10 2 2 2-2" /></>,
  world: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>,
  layers: <path d="m12 3 10 6-10 6L2 9l10-6ZM3 13l9 5 9-5M3 17l9 5 9-5" />,
  arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
  shuffle: <path d="M3 6h3c5 0 7 12 12 12h3M3 18h3c5 0 7-12 12-12h3m-4-3 4 3-4 3m0 6 4 3-4 3" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  leaf: <path d="M20 3C5 3 2 9 6 16s16 1 14-13ZM5 20 16 8" />,
  drop: <path d="M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z" />,
  rain: <><path d="M7 15a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 8a4 4 0 0 1 0 8H7Z" /><path d="m8 19-1 2m5-2-1 2m5-2-1 2" /></>,
  temperature: <><path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z" /><path d="M12 8v9" /><circle cx="12" cy="18" r="1" /></>,
  diamond: <path d="m7 4-5 6 10 11 10-11-5-6H7Zm-5 6h20M7 4l5 17 5-17" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  play: <path d="M7 4v16l13-8L7 4Z" />,
  pause: <path d="M8 4v16M16 4v16" />,
  river: <path d="M4 4c4 2 0 6 4 8s6-2 8 2-2 6 4 6" />,
  grid: <path d="M3 9h18M3 15h18M9 3v18M15 3v18M3 3h18v18H3z" />,
  border: <path d="m4 7 6-3 7 3 3 7-5 6-8-1-3-6Z" />,
  dot: <><circle cx="7" cy="8" r="1.4" /><circle cx="16" cy="6" r="1.4" /><circle cx="12" cy="14" r="1.4" /><circle cx="6" cy="18" r="1.4" /><circle cx="18" cy="17" r="1.4" /></>,
  soil: <><path d="M3 10h18M3 15h18M3 20h18" /><path d="M12 10V4m0 0c-2 0-4 1-4 3m4-3c2 0 4 1 4 3" /></>,
  wheat: <><path d="M12 22V8" /><path d="M12 8c-3 0-4-2-4-5 3 0 4 2 4 5Zm0 0c3 0 4-2 4-5-3 0-4 2-4 5Zm0 5c-3 0-4-2-4-5 3 0 4 2 4 5Zm0 0c3 0 4-2 4-5-3 0-4 2-4 5Zm0 5c-3 0-4-2-4-5 3 0 4 2 4 5Zm0 0c3 0 4-2 4-5-3 0-4 2-4 5Z" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sparkle: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}
