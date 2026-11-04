import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export const PencilIcon = () => (
  <Icon>
    <path d="M10.5 3 13 5.5 5.5 13H3v-2.5z" />
  </Icon>
);

export const OpenIcon = () => (
  <Icon>
    <path d="M5 11 11.5 4.5M6 4h6v6" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M13 8H3.5M7.5 4 3.5 8l4 4" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
);

export const StarIcon = ({ filled }: { filled: boolean }) => (
  <Icon>
    <path d="m8 2.5 1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.8l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" fill={filled ? "currentColor" : "none"} strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);
