import type { CSSProperties } from "react";

export type IconName =
  | "dashboard" | "kanban" | "users" | "doc" | "cart" | "truck"
  | "chart" | "folder" | "shield" | "settings" | "bell" | "search"
  | "plus" | "filter" | "sort" | "lock" | "mail" | "arrow-up"
  | "arrow-down" | "check" | "target" | "tag" | "paperclip"
  | "download" | "edit" | "trash" | "eye" | "pin" | "arrow-right"
  | "phone" | "calendar" | "globe" | "image" | "plane" | "logout"
  | "menu" | "x" | "dots";

type Props = {
  name: IconName;
  className?: string;
  style?: CSSProperties;
  width?: number | string;
  height?: number | string;
};

export function Icon({ name, className, style, width, height }: Props) {
  return (
    <svg
      className={className}
      style={style}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}
