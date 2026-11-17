/** Overlay effects per scene, built from plain divs and gradients (web-renderer safe). */
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Effect as EffectName } from "@fgb/core/shorts/types";

function Heartbeat() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const period = fps * 0.62; // ~97 bpm
  const phase = (frame % period) / period;
  // double "lub-dub" pulse
  const pulse = Math.max(0, Math.sin(phase * Math.PI * 4)) * (phase < 0.5 ? 1 : 0);
  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(circle, rgba(120,0,0,0) 45%, rgba(150,10,10,0.55) 100%)",
        opacity: 0.35 + pulse * 0.55,
      }}
    />
  );
}

function Tunnel({ frames }: { frames: number }) {
  const frame = useCurrentFrame();
  const closing = interpolate(frame, [0, frames], [70, 38], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{ background: `radial-gradient(circle, rgba(0,0,0,0) ${closing - 18}%, rgba(0,0,0,0.88) ${closing + 12}%)` }}
    />
  );
}

function Rain() {
  const frame = useCurrentFrame();
  const drops = Array.from({ length: 70 }, (_, i) => i);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundColor: "rgba(40,60,80,0.18)" }} />
      {drops.map((i) => {
        const x = random(`rx${i}`) * 1200 - 60;
        const speed = 38 + random(`rs${i}`) * 26;
        const len = 50 + random(`rl${i}`) * 70;
        const y = ((random(`ry${i}`) * 2100 + frame * speed) % 2200) - 200;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: 3,
              height: len,
              borderRadius: 2,
              backgroundColor: "rgba(255,255,255,0.45)",
              transform: "rotate(12deg)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function Particles() {
  const frame = useCurrentFrame();
  const dots = Array.from({ length: 36 }, (_, i) => i);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {dots.map((i) => {
        const size = 8 + random(`ps${i}`) * 18;
        const x = random(`px${i}`) * 1080 + Math.sin(frame / 30 + i) * 20;
        const y = 1920 - ((random(`py${i}`) * 1920 + frame * (1.2 + random(`pv${i}`) * 1.8)) % 2000);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: size,
              backgroundColor: "rgba(255,244,214,0.75)",
              boxShadow: "0 0 18px rgba(255,220,160,0.8)",
              opacity: 0.35 + 0.5 * Math.abs(Math.sin(frame / 25 + i)),
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function Breathe() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // 4 s in, 4 s out
  const s = 0.72 + 0.32 * (0.5 - 0.5 * Math.cos((frame / fps) * ((2 * Math.PI) / 8)));
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          width: 560,
          height: 560,
          borderRadius: 560,
          border: "8px solid rgba(255,255,255,0.8)",
          backgroundColor: "rgba(255,255,255,0.12)",
          boxShadow: "0 0 60px rgba(255,255,255,0.45)",
          transform: `translateY(-180px) scale(${s})`,
        }}
      />
    </AbsoluteFill>
  );
}

export function Effect({ effect, frames }: { effect: EffectName; frames: number }) {
  switch (effect) {
    case "heartbeat":
      return <Heartbeat />;
    case "tunnel":
      return <Tunnel frames={frames} />;
    case "rain":
      return <Rain />;
    case "particles":
      return <Particles />;
    case "breathe":
      return <Breathe />;
    default:
      return null;
  }
}
