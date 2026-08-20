import { CURATED_ICON_NAMES } from "../lib/icons";
import CategoryIcon from "./CategoryIcon";

interface IconPickerProps {
  value: string;
  onChange: (iconName: string) => void;
}

export default function IconPicker({ value, onChange }: IconPickerProps) {
  return (
    <div className="grid max-h-48 grid-cols-6 gap-2 overflow-y-auto rounded-md bg-slate-900 p-2">
      {CURATED_ICON_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onChange(name)}
          aria-label={name}
          aria-pressed={value === name}
          className={`flex items-center justify-center rounded-md p-2 ${
            value === name ? "bg-violet-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
          }`}
        >
          <CategoryIcon name={name} className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
