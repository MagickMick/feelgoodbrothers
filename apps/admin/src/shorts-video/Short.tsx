/**
 * The Short composition (1080x1920, 30 fps). Runs in the browser: in the admin preview
 * (@remotion/player) and for the MP4 export (@remotion/web-renderer).
 *
 * Only CSS that the web renderer supports is used: transforms, opacity, linear and
 * centered radial gradients, borders, box/text shadows, text stroke. No filters
 * (Safari), no backdrop-filter, no external fonts.
 */
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { DEFAULT_CTA, HOOK_SECONDS, shortTimeline, type ShortAssets, type ShortScene, type Storyboard, type Word } from "@fgb/core/shorts/types";
import { Effect } from "./Effects";
import { Captions } from "./Captions";

// a type alias (not an interface): Remotion needs props assignable to Record<string, unknown>
export type ShortProps = {
  storyboard: Storyboard;
  assets: ShortAssets;
  locale: "en" | "nl";
  siteHost: string;
  /** base URL for /media files (empty = same origin) */
  mediaBase?: string;
};

export const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
export const BRAND = "#f97316";
export const CREAM = "#fdf6ec";
export const INK = "#2b2118";

function SceneView({
  scene,
  imageUrl,
  audioUrl,
  words,
  index,
  frames,
  hook,
}: {
  scene: ShortScene;
  imageUrl: string | null;
  audioUrl: string | null;
  words: Word[];
  index: number;
  frames: number;
  hook: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / Math.max(1, frames - 1);

  // camera movement over the illustration (it is wider than the frame: 2:3 into 9:16)
  let scale = 1.08;
  let x = 0;
  let y = 0;
  switch (scene.motion) {
    case "zoom-in":
      scale = interpolate(t, [0, 1], [1.05, 1.22]);
      break;
    case "zoom-out":
      scale = interpolate(t, [0, 1], [1.22, 1.05]);
      break;
    case "pan-left":
      scale = 1.12;
      x = interpolate(t, [0, 1], [70, -70]);
      break;
    case "pan-right":
      scale = 1.12;
      x = interpolate(t, [0, 1], [-70, 70]);
      break;
    case "float":
      scale = 1.1;
      y = Math.sin((frame / fps) * 1.1) * 18;
      x = Math.cos((frame / fps) * 0.8) * 12;
      break;
  }
  if (scene.effect === "heartbeat") {
    const beat = (frame % Math.round(fps * 0.62)) / (fps * 0.62);
    scale *= 1 + Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.012;
  }

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const hookFrames = Math.round(HOOK_SECONDS * fps);
  const hookIn = spring({ frame, fps, config: { damping: 14 } });
  const hookOut = interpolate(frame, [hookFrames - 8, hookFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: CREAM, opacity: index === 0 ? 1 : fadeIn }}>
      {imageUrl ? (
        <Img
          src={imageUrl}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `translate(${x}px, ${y}px) scale(${scale})`,
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: "linear-gradient(160deg, #e8d5b7 0%, #c9b29b 100%)",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div style={{ fontFamily: FONT, fontSize: 54, color: INK, opacity: 0.6, textAlign: "center", padding: 80 }}>
            Scène {index + 1}
            <br />
            (nog geen illustratie)
          </div>
        </AbsoluteFill>
      )}
      {/* soft gradient for caption readability */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
      <Effect effect={scene.effect} frames={frames} />
      {audioUrl && <Audio src={audioUrl} />}
      <Captions words={words} />
      {index === 0 && hook && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 260 }}>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 800,
              fontSize: 84,
              lineHeight: 1.1,
              color: "#fff",
              textAlign: "center",
              padding: "0 70px",
              textShadow: "0 6px 24px rgba(0,0,0,0.55)",
              opacity: hookOut,
              transform: `translateY(${interpolate(hookIn, [0, 1], [-60, 0])}px) scale(${interpolate(hookIn, [0, 1], [0.9, 1])})`,
            }}
          >
            {hook}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/**
 * The address is already on the button: drop it from the end of the title, so older
 * scripts ("Read the full story on feelgoodbrothers.com") don't show it twice.
 * "on"/"op" stays, so title and button read as one sentence.
 */
export function endCardTitle(cta: string, siteHost: string, locale: "en" | "nl"): string {
  const host = siteHost.replace(/^www\./, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const title = cta.replace(new RegExp(`\\s*(?:https?://)?(?:www\\.)?${host}/?[.!]?\\s*$`, "i"), "").trim();
  return title || DEFAULT_CTA[locale];
}

function EndCard({ cta, siteHost, locale }: { cta: string; siteHost: string; locale: "en" | "nl" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12 } });
  const sub = interpolate(frame, [12, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: CREAM, justifyContent: "center", alignItems: "center", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: "radial-gradient(circle, rgba(249,115,22,0.18) 0%, rgba(249,115,22,0) 60%)" }} />
      <div style={{ textAlign: "center", padding: "0 80px", transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`, opacity: pop }}>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: 6, textTransform: "uppercase", color: BRAND }}>Feelgood Brothers</div>
        <div style={{ marginTop: 50, fontSize: 70, fontWeight: 800, lineHeight: 1.15, color: INK }}>{endCardTitle(cta, siteHost, locale)}</div>
        <div
          style={{
            marginTop: 70,
            display: "inline-block",
            padding: "26px 48px",
            borderRadius: 999,
            backgroundColor: BRAND,
            color: "#fff",
            fontSize: 56,
            fontWeight: 800,
          }}
        >
          {siteHost}
        </div>
        <div style={{ marginTop: 40, fontSize: 40, color: INK, opacity: sub * 0.7 }}>
          {locale === "nl" ? "Link in de beschrijving" : "Link in the description"}
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function Short({ storyboard, assets, locale, siteHost, mediaBase = "" }: ShortProps) {
  const timeline = shortTimeline(storyboard, assets);
  const media = (file: string) => `${mediaBase}/media/${file}`;
  return (
    <AbsoluteFill style={{ backgroundColor: CREAM }}>
      {storyboard.scenes.map((scene, i) => {
        const a = assets.scenes[i];
        const voiceOk = a && a.audioKey && a.narration === scene.narration;
        return (
          <Sequence key={i} from={timeline.starts[i]} durationInFrames={timeline.scenes[i]}>
            <SceneView
              scene={scene}
              index={i}
              frames={timeline.scenes[i]}
              hook={storyboard.hook}
              imageUrl={a?.imageKey ? media(`${a.imageKey}.webp`) : null}
              audioUrl={voiceOk ? media(`${a.audioKey}.mp3`) : null}
              words={voiceOk ? a.words : []}
            />
          </Sequence>
        );
      })}
      <Sequence from={timeline.endCardStart} durationInFrames={timeline.endCardFrames}>
        <EndCard cta={storyboard.cta} siteHost={siteHost} locale={locale} />
      </Sequence>
    </AbsoluteFill>
  );
}
