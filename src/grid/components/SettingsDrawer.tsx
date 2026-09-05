import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDrawer({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50">
      <div onClick={onClose} className="flex-1" />
      <div className="flex h-full w-[344px] flex-col bg-bg border-l border-border">
        <div className="flex items-center justify-between px-[26px] pb-[18px] pt-[26px]">
          <div className="text-sm font-semibold">Settings</div>
          <X size={14} onClick={onClose} className="cursor-pointer text-subtext hover:text-text" />
        </div>
        <div className="h-px bg-border mx-[26px]" />
        <div className="flex flex-col overflow-y-auto px-[26px]">
          <div className="flex flex-col gap-2 border-b border-border py-[22px]">
            <div className="text-[11px] uppercase tracking-wider text-faint">Playback</div>
            <div className="text-xs leading-[1.55] text-[#5f5d59]">
              Autoplay and continuous play across tabs — coming later.
            </div>
          </div>
          <div className="flex flex-col gap-2 py-[22px]">
            <div className="text-[11px] uppercase tracking-wider text-faint">Grid</div>
            <div className="text-xs leading-[1.55] text-[#5f5d59]">Sort order and card size — coming later.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
