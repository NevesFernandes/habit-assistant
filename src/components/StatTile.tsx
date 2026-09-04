// Shared by HabitsView, CategoriesView, and Dashboard — was duplicated
// verbatim in the first two before Dashboard (§17 in Roadmap.md) made a
// third copy the point where extracting it stopped being optional.
export default function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-base font-medium">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
