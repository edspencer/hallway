// The working mark: a door, ajar, with lamplight spilling out (D23). Provisional until Q-VISUAL-IDENTITY is signed
// off; public/favicon.svg is the same drawing. Colours come from the theme tokens.
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="6" y="3" width="20" height="27" rx="2" fill="var(--hw-bg-sunken)" stroke="var(--hw-door-edge)" strokeWidth="1.5" />
      <path d="M16 4.5 L24.5 4.5 L24.5 28.5 L16 28.5 Z" fill="var(--hw-lamplight)" opacity="0.9" />
      <path d="M7.5 4.5 L16 6.5 L16 26.5 L7.5 28.5 Z" fill="var(--hw-door)" stroke="var(--hw-door-edge)" strokeWidth="1" />
      <circle cx="13.6" cy="17" r="1.1" fill="var(--hw-accent)" />
    </svg>
  );
}
