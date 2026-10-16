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
