// The "I" from the IWI Consulting logo: green dot over a blue stem, with the
// grey swoosh. Brand blue/green brightened a step so they hold up on the dark UI.
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <ellipse cx="16" cy="25" rx="13" ry="4.2" fill="none" stroke="#8a8f98" strokeWidth="1.6" transform="rotate(-12 16 25)" />
      <circle cx="16.5" cy="6.5" r="4" fill="#7cc242" />
      <rect x="13" y="12" width="7" height="15" rx="1.5" fill="#2f9be0" />
    </svg>
  );
}
