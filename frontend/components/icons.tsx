/* Line icons on a 24px grid, 1.75 stroke, currentColor (the Torob drawing style).
   TorobLogo, SearchIcon and the bell/heart paths are Torob's own marks from torob.com. */
type P = { className?: string; title?: string };

const cls = (c?: string) => `icon ${c ?? ""}`;

export const TorobLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 88 88" role="img" aria-label="ترب">
    <path style={{ fill: "var(--logo-1)" }} d="M79.245 20.322l-.627.726c-2.474 2.656-5.814 4.2-9.462 4.313-.16.023-.342.023-.502.023-.456 0-.878-.023-1.31-.068 8.595 10.1 9.895 24.968 2.222 36.579-7.638 11.542-21.774 16.252-34.428 12.484h-.08c-5.13-1.34-10.944.68-14.022 5.414 3.192-4.847 2.736-11.055-.798-15.322v-.045c-8.333-10.079-9.473-24.72-1.87-36.16C26.692 15.67 42.766 11.22 56.195 17.031c-.57-1.476-.935-3.065-1.026-4.688-.114-2.95.741-5.788 2.371-8.171-18.012-5.902-38.532.567-49.476 17.137C-5.104 41.171.425 67.842 20.261 80.893c19.882 13.064 46.592 7.502 59.702-12.246 10.032-15.174 9.177-34.331-.707-48.348l-.011.023z" />
    <path style={{ fill: "var(--logo-2)" }} d="M31.969 10.22c-10.91 1.08-20.463 5.721-24.054 11.191C-5.195 41.216.3 67.853 20.193 80.905l.73-1.112c3.191-4.847 2.735-11.055-.799-15.322v-.045c-8.22-10.079-9.36-24.72-1.835-36.16C26.61 15.67 42.685 11.22 56.114 17.031c0 0-11.4-8.059-24.122-6.81h-.023z" />
    <path style={{ fill: "var(--logo-3)" }} d="M62.544 22.32s-.342-4.086 1.482-7.037c1.824-2.951 5.7-5.845 10.602-5.539 4.925.307 5.723 1.442 5.723 1.442s.114 3.972-1.254 6.242-4.218 5.606-8.322 6.446c-4.104.829-8.231-1.555-8.231-1.555z" />
    <path style={{ fill: "var(--logo-4)" }} d="M61.062 21.173s-.456-3.972 2.28-7.944c2.736-3.973 5.7-4.563 5.7-4.563S68.7 3.218 66.078.608c.228-.057-3.124.08-6.042 3.291-2.577 2.815-4.104 7.264-2.964 11.577 1.14 4.312 3.99 5.697 3.99 5.697z" />
  </svg>
);

export const SearchIcon = ({ className }: P) => (
  <svg className={cls(className)} viewBox="9.5 9.5 20.5 20.5" aria-hidden="true" style={{ fill: "currentColor", stroke: "none" }}>
    <path d="M29.7,28.3 L25.2,23.8 C26.3,22.4 27,20.5 27,18.5 C27,13.8 23.2,10 18.5,10 C13.8,10 10,13.8 10,18.5 C10,23.2 13.8,27 18.5,27 C20.5,27 22.3,26.3 23.8,25.2 L28.3,29.7 C28.5,29.9 28.8,30 29,30 C29.2,30 29.5,29.9 29.7,29.7 C30.1,29.3 30.1,28.7 29.7,28.3 Z M12,18.5 C12,14.9 14.9,12 18.5,12 C22.1,12 25,14.9 25,18.5 C25,22.1 22.1,25 18.5,25 C14.9,25 12,22.1 12,18.5 Z" />
  </svg>
);

export const BellIcon = ({ className }: P) => (
  <svg className={cls(className)} viewBox="0 0 16 16" aria-hidden="true" style={{ strokeWidth: 1.2 }}>
    <g transform="translate(2, 1.3333)">
      <path d="M10,4 C10,1.790861 8.209139,0 6,0 C3.790861,0 2,1.790861 2,4 C2,8.66666667 0,10 0,10 L12,10 C12,10 10,8.66666667 10,4" />
      <path d="M7.15333333,12.6666667 C6.91480149,13.0778696 6.47537907,13.3309709 6,13.3309709 C5.52462093,13.3309709 5.08519851,13.0778696 4.84666667,12.6666667" />
    </g>
  </svg>
);

const I = (d: React.ReactNode) =>
  function Icon({ className }: P) {
    return (
      <svg className={cls(className)} viewBox="0 0 24 24" aria-hidden="true">
        {d}
      </svg>
    );
  };

export const SendIcon = I(<path d="M12 19V5M6 11l6-6 6 6" />);
export const StopIcon = I(<rect x="7" y="7" width="10" height="10" rx="2" style={{ fill: "currentColor", stroke: "none" }} />);
export const PlusIcon = I(<path d="M12 5v14M5 12h14" />);
export const CloseIcon = I(<path d="M6 6l12 12M18 6 6 18" />);
export const MenuIcon = I(<path d="M4 7h16M4 12h16M4 17h10" />);
export const PanelIcon = I(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M15 4.5v15" /></>);
export const ChevronLeft = I(<path d="m14 6-6 6 6 6" />);
export const ChevronRight = I(<path d="m10 6 6 6-6 6" />);
export const ChevronDown = I(<path d="m6 9 6 6 6-6" />);
export const CheckIcon = I(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const ClockIcon = I(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>);
export const PinIcon = I(<><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></>);
export const TargetIcon = I(<><circle cx="12" cy="12" r="3.5" style={{ fill: "currentColor", stroke: "none" }} /><circle cx="12" cy="12" r="8" /></>);
export const PhoneIcon = I(<path d="M6 4h3l1.5 4-2 1.5a10 10 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 2-2z" />);
export const InstagramIcon = I(<><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></>);
export const GlobeIcon = I(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>);
export const NavigateIcon = I(<path d="M12 3 20 21l-8-4-8 4z" />);
export const ExternalIcon = I(<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />);
export const AttachIcon = I(<path d="M21 11.5 12.8 19.7a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />);
export const InfoIcon = I(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5M12 15.5v.5" /></>);
export const WarnIcon = I(<><path d="M12 4 3 20h18z" /><path d="M12 10v4M12 17v.5" /></>);
export const TruckIcon = I(<><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.5" /><circle cx="17" cy="17.5" r="1.5" /></>);
export const ShieldIcon = I(<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z" />);
export const StoreIcon = I(<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5h16M9 20v-5h6v5" />);
export const MapIcon = I(<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>);
export const CardIcon = I(<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></>);
export const HistoryIcon = I(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>);
export const UserIcon = I(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" /></>);
export const SunMoonIcon = I(<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>);
export const CopyIcon = I(<><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2" /></>);
export const GridIcon = I(<><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>);
export const DatabaseIcon = I(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>);
export const InboxIcon = I(<><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5.5 5h13L20 13v6H4v-6z" /></>);
export const UploadIcon = I(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
