import { useEffect, useState } from "react";

interface Props {
  /** real decoded peaks for this track, once computed — null until then */
  peaks: number[] | null;
  progress: number; // 0..1, meaningless unless this track is the loaded/current one
  /** true once `progress` is actually driven by real playback (this track loaded + duration known) */
  hasRealProgress: boolean;
  disabled: boolean;
  onScrub: (fraction: number) => void;
}

export default function Scrobbler({ peaks, progress, hasRealProgress, disabled, onScrub }: Props) {
  // Give instant visual feedback on click — real `progress` lags behind until
  // playback actually loads/seeks, so track the clicked spot locally until it does.
  const [optimistic, setOptimistic] = useState<number | null>(null);
  useEffect(() => {
    if (hasRealProgress) setOptimistic(null);
  }, [hasRealProgress]);
  const displayProgress = optimistic ?? progress;

  return (
    <div
      onClick={(e) => {
        if (disabled) return;
        const r = e.currentTarget.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        setOptimistic(fraction);
        onScrub(fraction);
      }}
      title="Click to play from here"
      className="relative h-[18px] w-[72px]"
      style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.3 : 1 }}
    >
      {peaks ? (
        <div className="flex h-full items-end gap-[1px]">
          {peaks.map((h, i) => {
            const barFraction = (i + 0.5) / peaks.length;
            return (
              <div
                key={i}
                className="min-w-0 flex-1"
                style={{ height: `${Math.max(h * 100, 8)}%`, background: barFraction <= displayProgress ? "#1da0c3" : "#57534e" }}
              />
            );
          })}
        </div>
      ) : (
        <>
          <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#57534e]" />
          <div
            className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 bg-accent"
            style={{ width: `${displayProgress * 100}%` }}
          />
        </>
      )}
    </div>
  );
}
