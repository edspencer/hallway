// Small line icons, drawn in currentColor so they take the theme's text colours.
const svg = (d: React.ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

export const CopyIcon = () =>
  svg(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
      <path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7" />
    </>,
  );
export const MoreIcon = () =>
  svg(
    <>
      <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
    </>,
  );
export const CloseIcon = () => svg(<path d="M4 4l8 8M12 4l-8 8" />);
export const SearchIcon = () =>
  svg(
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L13.5 13.5" />
    </>,
  );
export const ChevronIcon = () => svg(<path d="M6 4l4 4-4 4" />);
export const PlusIcon = () => svg(<path d="M8 3.5v9M3.5 8h9" />);
export const PencilIcon = () => svg(<path d="M10.8 2.8l2.4 2.4-7.4 7.4-3 .6.6-3z" />);
export const ExternalIcon = () => svg(<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />);
export const WarnIcon = () =>
  svg(
    <>
      <path d="M8 2.2L14.2 13H1.8z" />
      <path d="M8 6.5v3M8 11.2v.1" />
    </>,
  );
export const KeyIcon = () =>
  svg(
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.8" />
      <path d="M4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M5 9.5h6" />
    </>,
  );
/** Local domains: a globe. */
export const GlobeIcon = () =>
  svg(
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c1.7 1.8 2.6 3.8 2.6 6.2S9.7 12.4 8 14.2C6.3 12.4 5.4 10.4 5.4 8S6.3 3.6 8 1.8z" />
    </>,
  );
/** A padlock, closed (HTTPS) or open (plain HTTP), for an address. */
export const LockIcon = ({ open = false }: { open?: boolean }) =>
  svg(
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
      <path d={open ? 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.7' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'} />
    </>,
  );
export const CheckIcon = () => svg(<path d="M3.5 8.4l3 3 6-6.6" />);
export const TerminalIcon = () =>
  svg(
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.8" />
      <path d="M5 6.5l2 1.5-2 1.5M8.5 10H11" />
    </>,
  );
/** Touch ID's fingerprint: what macOS will ask for. */
export const FingerprintIcon = () =>
  svg(
    <>
      <path d="M4.2 3.6A5.3 5.3 0 0 1 13.3 7.5v1" />
      <path d="M2.7 6.2a5.3 5.3 0 0 0-.1 1.3v1.6" />
      <path d="M5 13.2c.6-1 .9-2.3.9-3.7V7.6a2.1 2.1 0 0 1 4.2 0v1.9" />
      <path d="M8 7.8v1.7c0 1.8-.5 3.4-1.3 4.6" />
      <path d="M10.1 11.6c-.2.9-.5 1.7-.9 2.4" />
      <path d="M13.2 10.6c-.1.9-.3 1.8-.6 2.6" />
    </>,
  );
