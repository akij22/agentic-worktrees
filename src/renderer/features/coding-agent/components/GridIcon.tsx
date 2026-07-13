type GridIconName = "branch" | "bot" | "clock" | "files" | "arrow";

export const GridIcon = ({ name }: { name: GridIconName }) => {
  const paths = {
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="19" r="2" />
        <path d="M6 7v4a4 4 0 0 0 4 4h6" />
        <path d="M18 7v4" />
      </>
    ),
    bot: (
      <>
        <rect x="4" y="7" width="16" height="12" rx="3" />
        <path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    files: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
        <path d="M14 3v6h6M8 13h8M8 17h5" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      {paths[name]}
    </svg>
  );
};
