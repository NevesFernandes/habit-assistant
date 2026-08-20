import { ICON_REGISTRY, DEFAULT_ICON_NAME } from "../lib/icons";

interface CategoryIconProps {
  name: string | undefined;
  className?: string;
}

// Falls back to the default icon for unrecognized names rather than crashing or
// rendering blank — covers pre-existing Drive data with emoji-shaped icon values
// from before this feature, since driveClient.ts has no schema migration layer.
export default function CategoryIcon({ name, className = "h-4 w-4" }: CategoryIconProps) {
  const Icon = (name && ICON_REGISTRY[name]) || ICON_REGISTRY[DEFAULT_ICON_NAME];
  return <Icon className={className} aria-hidden />;
}
