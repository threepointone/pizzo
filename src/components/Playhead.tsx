import { useEffect, useRef } from "react";
import { engine } from "../audio/engine";

/**
 * A moving now-line driven by the transport. Self-contained: it runs its own
 * requestAnimationFrame loop and mutates its own style, so the parent subtree
 * doesn't re-render 60×/second. The parent must be `position: relative`.
 */
export function Playhead({ bars, playing }: { bars: number; playing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!playing || bars <= 0) {
      el.style.opacity = "0";
      return;
    }
    let raf = 0;
    const tick = () => {
      el.style.left = `${engine.songProgress(bars) * 100}%`;
      el.style.opacity = "1";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, bars]);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-kumo-accent z-10 transition-opacity"
      style={{ opacity: 0, left: "0%" }}
    />
  );
}
