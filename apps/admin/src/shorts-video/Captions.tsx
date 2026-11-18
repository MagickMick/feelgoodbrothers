/** Big word-by-word captions: 2-4 words at a time, the spoken word in brand orange. */
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Word } from "@fgb/core/shorts/types";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BRAND = "#f97316";

/** split the words into short caption chunks, breaking after punctuation */
export function chunkWords(words: Word[], max = 4): Word[][] {
  const chunks: Word[][] = [];
  let current: Word[] = [];
  for (const w of words) {
    current.push(w);
    if (current.length >= max || /[.,!?;:…]$/.test(w.w)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function Captions({ words }: { words: Word[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (!words.length) return null;
  const chunks = chunkWords(words);
  const index = chunks.findIndex((c, i) => t >= c[0].start && (i === chunks.length - 1 || t < chunks[i + 1][0].start));
  if (index === -1) return null;
  const chunk = chunks[index];
  const shownAt = Math.round(chunk[0].start * fps);
  const pop = spring({ frame: frame - shownAt, fps, config: { damping: 13, stiffness: 180 } });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 380 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          padding: "0 70px",
          transform: `scale(${interpolate(pop, [0, 1], [0.86, 1])})`,
        }}
      >
        {chunk.map((w, i) => {
          const active = t >= w.start && t < w.end + 0.05;
          return (
            <span
              key={i}
              style={{
                fontFamily: FONT,
                fontWeight: 800,
                fontSize: 88,
                lineHeight: 1.15,
                margin: "0 14px",
                color: active ? BRAND : "#ffffff",
                WebkitTextStroke: "3px rgba(0,0,0,0.55)",
                paintOrder: "stroke fill",
                textShadow: "0 6px 18px rgba(0,0,0,0.55)",
                transform: `scale(${active ? 1.08 : 1})`,
              }}
            >
              {w.w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
