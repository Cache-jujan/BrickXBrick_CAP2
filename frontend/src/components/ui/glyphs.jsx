// More small stroke icons for page content (account settings, the new-project start screen).
// Same approach as ./icons.jsx: no icon library, stroke follows the parent's text colour.

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

function make(children) {
  return function Glyph({ size = 20 }) {
    return <svg width={size} height={size} {...base}>{children}</svg>;
  };
}

export const UserGlyph = make(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" /></>);
export const LockGlyph = make(<><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const CameraGlyph = make(<><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" /><circle cx="12" cy="12.5" r="3.2" /></>);
export const MonitorGlyph = make(<><rect x="3.5" y="4.5" width="17" height="11" rx="1.8" /><path d="M9 20h6M12 15.5V20" /></>);
export const RefreshGlyph = make(<><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" /><path d="M18 3v4h-4M6 21v-4h4" /></>);
export const CheckSquareGlyph = make(<><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></>);
export const FlagGlyph = make(<><path d="M5 21V4" /><path d="M5 5h11l-2 3.5 2 3.5H5" /></>);
export const FileGlyph = make(<><path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /></>);
export const FilePlusGlyph = make(<><path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4M12 11v6M9 14h6" /></>);
export const HelmetGlyph = make(<><path d="M4 16a8 8 0 0 1 16 0" /><path d="M2.5 16h19v2.5h-19zM12 8V5M9.5 9.5 10 6h4l.5 3.5" /></>);
export const BuildingGlyph = make(<><rect x="5" y="3.5" width="9" height="17" rx="1" /><path d="M14 9h4a1 1 0 0 1 1 1v10.5h-5M8.5 7.5h2M8.5 11h2M8.5 14.5h2M8.5 18h2" /></>);
export const WavesGlyph = make(<><path d="M3 8c2 0 2-1.5 4.5-1.5S10 8 12 8s2.5-1.5 4.5-1.5S19 8 21 8" /><path d="M3 13c2 0 2-1.5 4.5-1.5S10 13 12 13s2.5-1.5 4.5-1.5S19 13 21 13" /><path d="M3 18c2 0 2-1.5 4.5-1.5S10 18 12 18s2.5-1.5 4.5-1.5S19 18 21 18" /></>);
export const LayersGlyph = make(<><path d="m12 3.5 9 4.5-9 4.5L3 8l9-4.5Z" /><path d="m3 12.5 9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" /></>);
export const ChevronRightGlyph = make(<path d="m9 6 6 6-6 6" />);
export const ChevronDownGlyph = make(<path d="m6 9 6 6 6-6" />);
