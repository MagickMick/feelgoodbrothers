/**
 * Shorts: shared types and pure helpers. No Node imports here: the admin's browser
 * code (preview + render) imports this file too.
 */

export const MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "float"] as const;
export const EFFECTS = ["none", "heartbeat", "tunnel", "rain", "particles", "breathe"] as const;
export type Motion = (typeof MOTIONS)[number];
export type Effect = (typeof EFFECTS)[number];

export const MIN_SCENES = 3;
export const MAX_SCENES = 7;
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** silence after each scene's narration */
export const SCENE_PAD_SECONDS = 0.35;
export const END_CARD_SECONDS = 3;
/** the hook is shown over the first scene for this long */
export const HOOK_SECONDS = 2.4;

export interface ShortScene {
  narration: string;
  imagePrompt: string;
  motion: Motion;
  effect: Effect;
  emphasis: string[];
}

export interface Storyboard {
  hook: string;
  /** fixed description of the main character, added to every image prompt */
  character: string;
  scenes: ShortScene[];
  cta: string;
  youtube: { title: string; description: string; hashtags: string[] };
}

export interface Word {
  w: string;
  /** seconds from the start of the scene */
  start: number;
  end: number;
}

export interface SceneAssets {
  imageKey: string | null;
  /** the prompt the image was made with (to see when it's outdated) */
  imagePrompt: string;
  audioKey: string | null;
  /** the narration the voice was made with */
  narration: string;
  seconds: number;
  words: Word[];
}

export interface ShortAssets {
  scenes: SceneAssets[];
}

export function emptySceneAssets(): SceneAssets {
  return { imageKey: null, imagePrompt: "", audioKey: null, narration: "", seconds: 0, words: [] };
}

/** align assets with the storyboard (scenes added/removed while editing) */
export function alignAssets(storyboard: Storyboard, assets: ShortAssets | null | undefined): ShortAssets {
  return { scenes: storyboard.scenes.map((_, i) => assets?.scenes?.[i] ?? emptySceneAssets()) };
}

export function sceneStatus(scene: ShortScene, a: SceneAssets) {
  const imageReady = Boolean(a.imageKey) && a.imagePrompt === scene.imagePrompt;
  const voiceReady = Boolean(a.audioKey) && a.narration === scene.narration && a.seconds > 0;
  return { imageReady, voiceReady, ready: imageReady && voiceReady };
}

export function isShortReady(storyboard: Storyboard, assets: ShortAssets): boolean {
  return storyboard.scenes.every((s, i) => sceneStatus(s, assets.scenes[i] ?? emptySceneAssets()).ready);
}

/** frames per scene and in total; scenes without voice get an estimate from their word count */
export function shortTimeline(storyboard: Storyboard, assets: ShortAssets, fps = FPS) {
  const scenes = storyboard.scenes.map((s, i) => {
    const a = assets.scenes[i];
    const words = s.narration.split(/\s+/).filter(Boolean).length;
    const seconds = a && a.seconds > 0 && a.narration === s.narration ? a.seconds : Math.max(2, words / 2.6);
    return Math.ceil((seconds + SCENE_PAD_SECONDS) * fps);
  });
  const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((n, f) => n + f, 0));
  const endCardFrames = Math.round(END_CARD_SECONDS * fps);
  const scenesTotal = scenes.reduce((n, f) => n + f, 0);
  return { scenes, starts, endCardFrames, endCardStart: scenesTotal, total: scenesTotal + endCardFrames };
}

/** spread words over a duration by length when no real timestamps are available */
export function estimateWords(text: string, seconds: number): Word[] {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = (w: string) => w.length + 2 + (/[.,!?;:…]$/.test(w) ? 4 : 0);
  const total = words.reduce((n, w) => n + weight(w), 0) || 1;
  let t = 0;
  return words.map((w) => {
    const d = (weight(w) / total) * seconds;
    const word = { w, start: t, end: t + d };
    t += d;
    return word;
  });
}

const clean = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * Validate and repair a storyboard (from the AI or from the editor form).
 * Throws an Error with a Dutch message when it can't be used.
 */
export function normalizeStoryboard(raw: unknown, opts: { strict?: boolean } = {}): Storyboard {
  const r = (raw ?? {}) as Record<string, unknown>;
  const scenesRaw = Array.isArray(r.scenes) ? r.scenes : [];
  if (opts.strict) {
    // editor saves: never drop a scene silently (its assets are matched by position)
    if (scenesRaw.length > MAX_SCENES) throw new Error(`Maximaal ${MAX_SCENES} scènes.`);
    scenesRaw.forEach((x, i) => {
      const s = (x ?? {}) as Record<string, unknown>;
      if (!clean(s.narration, 400) || !clean(s.imagePrompt, 600)) {
        throw new Error(`Vul bij scène ${i + 1} zowel de tekst voor de stem als de beeldbeschrijving in.`);
      }
    });
  }
  const scenes: ShortScene[] = scenesRaw
    .map((x) => {
      const s = (x ?? {}) as Record<string, unknown>;
      const motion = MOTIONS.includes(s.motion as Motion) ? (s.motion as Motion) : "zoom-in";
      const effect = EFFECTS.includes(s.effect as Effect) ? (s.effect as Effect) : "none";
      return {
        narration: clean(s.narration, 400),
        imagePrompt: clean(s.imagePrompt, 600),
        motion,
        effect,
        emphasis: (Array.isArray(s.emphasis) ? s.emphasis : []).map((e) => clean(e, 40)).filter(Boolean).slice(0, 4),
      };
    })
    .filter((s) => s.narration && s.imagePrompt)
    .slice(0, MAX_SCENES);
  if (scenes.length < MIN_SCENES) throw new Error(`Het script heeft te weinig bruikbare scènes (minimaal ${MIN_SCENES}).`);
  const yt = (r.youtube ?? {}) as Record<string, unknown>;
  const hashtags = (Array.isArray(yt.hashtags) ? yt.hashtags : String(yt.hashtags ?? "").split(/[\s,]+/))
    .map((h) => clean(h, 40).replace(/^#*/, ""))
    .filter(Boolean)
    .slice(0, 8)
    .map((h) => `#${h.replace(/\s+/g, "")}`);
  return {
    hook: clean(r.hook, 80),
    character: clean(r.character, 300),
    scenes,
    cta: clean(r.cta, 120),
    youtube: { title: clean(yt.title, 100), description: String(yt.description ?? "").trim().slice(0, 4500), hashtags },
  };
}

/** find and parse the JSON object in a model answer (tolerates code fences and text around it) */
export function parseStoryboardJson(text: string): Storyboard {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("De AI gaf geen bruikbaar script terug. Probeer het opnieuw.");
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Het script van de AI was geen geldige JSON. Probeer het opnieuw.");
  }
  return normalizeStoryboard(data);
}
