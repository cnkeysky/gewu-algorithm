import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";

export type TextLayoutHandle = { disconnect: () => void };

/**
 * Measure presentation text without making layout a prerequisite for rendering.
 * CSS remains the source of truth; the measured result only stabilizes effects
 * and exposes line metadata to the UI.
 */
export function observeTextLayout(element: HTMLElement): TextLayoutHandle {
  let frame = 0;
  const measure = () => {
    frame = 0;
    const width = element.clientWidth;
    if (!width || typeof document === "undefined") return;
    try {
      const styles = getComputedStyle(element);
      const font = styles.font;
      const lineHeight = Number.parseFloat(styles.lineHeight) || Number.parseFloat(styles.fontSize) * 1.5;
      const prepared = prepareWithSegments(element.textContent ?? "", font, { whiteSpace: "pre-wrap" });
      const result = layoutWithLines(prepared, width, lineHeight);
      element.dataset.layoutLines = String(result.lineCount);
      element.style.setProperty("--measured-text-height", `${result.height}px`);
      element.classList.add("text-layout-ready");
    } catch {
      element.removeAttribute("data-layout-lines");
      element.classList.remove("text-layout-ready");
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : undefined;
  observer?.observe(element);
  schedule();
  return { disconnect: () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); } };
}

