import type { ReactNode } from "react";

export function CompletionControl({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex shrink-0 items-center">{children}</div>;
}

export function YesNoCheckbox({
  checked,
  onChange,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  /** §29: set on a future day, where completion can't be changed. `title` says why. */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <CompletionControl>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        title={title}
        className={`h-4 w-4 ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
      />
    </CompletionControl>
  );
}
