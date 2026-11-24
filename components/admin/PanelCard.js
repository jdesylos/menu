export function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="#6C7C87"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}

export function StoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 6.5V13.5H13.5V6.5" />
      <path d="M1.5 6.5L3 2.5H13L14.5 6.5C13.5 7.5 12 7.5 11 6.5C10 7.5 8.5 7.5 8 6.5C7.5 7.5 6 7.5 5 6.5C4 7.5 2.5 7.5 1.5 6.5Z" />
      <path d="M6.5 13.5V10H9.5V13.5" />
    </svg>
  );
}

export function InboxIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 9.5L4 3H12L14 9.5V13H2V9.5Z" />
      <path d="M2 9.5H5.5L6.5 11H9.5L10.5 9.5H14" />
    </svg>
  );
}

export function UsersIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5.5" r="2.25" />
      <path d="M2 13C2 10.8 3.8 9.25 6 9.25C8.2 9.25 10 10.8 10 13" />
      <circle cx="11.5" cy="6" r="1.75" />
      <path d="M11 9.5C12.7 9.6 14 10.9 14 13" />
    </svg>
  );
}

export function UserCircleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="6.25" r="1.85" />
      <path d="M4.5 12.6C5.3 11.2 6.5 10.5 8 10.5C9.5 10.5 10.7 11.2 11.5 12.6" />
    </svg>
  );
}

export function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8.25L10.5 9.75" />
    </svg>
  );
}

export function CrownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4.5L3 12.25H13L14 4.5L10.75 7.75L8 3.5L5.25 7.75L2 4.5Z" />
    </svg>
  );
}

export function CrownOffIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4.5L3 12.25H13L14 4.5L10.75 7.75L8 3.5L5.25 7.75L2 4.5Z" />
      <path d="M2.25 13L13.75 2.75" />
    </svg>
  );
}

export function OpenIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.75 3.5H3.5C2.95 3.5 2.5 3.95 2.5 4.5V12.5C2.5 13.05 2.95 13.5 3.5 13.5H11.5C12.05 13.5 12.5 13.05 12.5 12.5V9.25" />
      <path d="M9.5 2.5H13.5V6.5" />
      <path d="M7.5 8.5L13.5 2.5" />
    </svg>
  );
}

export function PaginationBar({
  page = 1,
  totalPages = null,
  hasNext = false,
  busy = false,
  onPageChange,
}) {
  const canPrev = !busy && page > 1;
  const canNext = !busy && (totalPages ? page < totalPages : hasNext);

  return (
    <div
      className="adm-row-between"
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px solid #E3E9ED",
      }}
    >
      <button
        type="button"
        disabled={!canPrev}
        onClick={() => onPageChange(page - 1)}
        className="adm-btn adm-btn-secondary adm-btn-xs"
      >
        Anterior
      </button>
      <span className="adm-muted adm-tnum">
        {totalPages ? `Página ${page} de ${totalPages}` : `Página ${page}`}
      </span>
      <button
        type="button"
        disabled={!canNext}
        onClick={() => onPageChange(page + 1)}
        className="adm-btn adm-btn-secondary adm-btn-xs"
      >
        Próxima
      </button>
    </div>
  );
}

const TONE_CLASS = {
  default: "",
  primary: "adm-panel--primary",
  attention: "adm-panel--attention",
  directory: "adm-panel--directory",
  muted: "adm-panel--muted",
};

export default function PanelCard({
  id = undefined,
  title,
  subtitle = null,
  icon = null,
  tone = "default",
  actions = null,
  className = "",
  children,
}) {
  const toneClass = TONE_CLASS[tone] || "";
  return (
    <section id={id} className={`adm-panel ${toneClass} ${className}`.trim()}>
      <div className="adm-panel-bar">
        <div className="adm-panel-head-left">
          {icon ? <span className="adm-panel-icon">{icon}</span> : null}
          <h2 className="adm-panel-title">{title}</h2>
          {subtitle ? <span className="adm-panel-role">{subtitle}</span> : null}
        </div>
        {actions ? <div className="adm-row">{actions}</div> : null}
      </div>
      <div className="adm-panel-body">{children}</div>
    </section>
  );
}
