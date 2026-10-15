// Small inline icons for the Terms of Use / Privacy Notice screens.
// The "At a glance" cards pick one by name (highlights[].icon from GET /api/legal).

function Svg({ size = 20, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function AccountIcon(props) {
  return (
    <Svg {...props}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.4" />
    </Svg>
  );
}

export function RecordsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="m9 14 2 2 4-4" />
    </Svg>
  );
}

export function DataIcon(props) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </Svg>
  );
}

export function RightsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function DocIcon(props) {
  return (
    <Svg {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Svg>
  );
}

export function ArrowRightIcon(props) {
  return (
    <Svg size={16} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function PrintIcon(props) {
  return (
    <Svg size={16} {...props}>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </Svg>
  );
}

export function CheckIcon(props) {
  return (
    <Svg size={14} {...props}>
      <path d="m5 12 5 5 9-10" />
    </Svg>
  );
}

const BY_NAME = {
  account: AccountIcon,
  records: RecordsIcon,
  data: DataIcon,
  rights: RightsIcon,
};

export function HighlightIcon({ name, ...props }) {
  const Icon = BY_NAME[name] || DocIcon;
  return <Icon {...props} />;
}
