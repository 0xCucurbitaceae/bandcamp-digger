import { Search, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function SearchBox({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-[6px] self-center rounded border border-border px-2 py-1 focus-within:border-subtext">
      <Search size={12} className="shrink-0 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        placeholder="Search"
        aria-label="Filter by artist, album, track or label"
        className="w-[150px] border-none bg-transparent text-xs text-text outline-none placeholder:text-faint"
      />
      {value && (
        <X size={12} onClick={() => onChange("")} className="shrink-0 cursor-pointer text-faint hover:text-text" />
      )}
    </div>
  );
}
