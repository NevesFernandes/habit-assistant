import type { ReactNode } from "react";

export function CompletionControl({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex shrink-0 items-center">{children}</div>;
}

export function YesNoCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <CompletionControl>
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4" />
    </CompletionControl>
  );
}
