import { useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { Short, type ShortProps } from "@/shorts-video/Short";
import {
  EFFECTS,
  FPS,
  HEIGHT,
  MAX_SCENES,
  MIN_SCENES,
  MOTIONS,
  WIDTH,
  emptySceneAssets,
  isShortReady,
  sceneStatus,
  shortTimeline,
  type ShortAssets,
  type ShortScene,
  type Storyboard,
} from "@fgb/core/shorts/types";

interface ShortData {
  id: number;
  locale: "en" | "nl";
  storyboard: Storyboard;
  assets: ShortAssets;
  error: string | null;
}

interface Props {
  short: ShortData;
  postId: number;
  postTitle: string;
  costHint: string;
  mock: boolean;
  siteHost: string;
}

const MOTION_LABELS: Record<string, string> = {
  "zoom-in": "Inzoomen",
  "zoom-out": "Uitzoomen",
  "pan-left": "Naar links",
  "pan-right": "Naar rechts",
  float: "Zweven",
};
const EFFECT_LABELS: Record<string, string> = {
  none: "Geen",
  heartbeat: "Hartslag (paniek)",
  tunnel: "Tunnelvisie",
  rain: "Regen",
  particles: "Zwevende lichtjes",
  breathe: "Ademcirkel",
};

type Busy = "" | "saving" | "script" | "generate" | `scene-${number}` | "render" | "delete";

async function api(body: Record<string, unknown>) {
  const res = await fetch("/api/ai/shorts/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

function CopyField({ label, value, rows = 1 }: { label: string; value: string; rows?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <button
          type="button"
          className="text-xs text-brand-700 hover:underline"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "✓ Gekopieerd" : "Kopieer"}
        </button>
      </div>
      {rows > 1 ? (
        <textarea className="input text-sm" rows={rows} readOnly value={value} />
      ) : (
        <input className="input text-sm" readOnly value={value} />
      )}
    </div>
  );
}

export default function ShortStudio({ short: initial, postId, postTitle, costHint, mock, siteHost }: Props) {
  const [short, setShort] = useState<ShortData>(initial);
  const [sb, setSb] = useState<Storyboard>(initial.storyboard);
  // for each edited scene: the index of the saved scene it came from (-1 = new)
  const [sceneMap, setSceneMap] = useState<number[]>(initial.storyboard.scenes.map((_, i) => i));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState(initial.error ?? "");
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // the preview always shows the edited storyboard with the latest assets
  const assets = useMemo<ShortAssets>(
    () => ({ scenes: sceneMap.map((j) => (j >= 0 && short.assets.scenes[j]) || emptySceneAssets()) }),
    [sceneMap, short.assets],
  );
  const timeline = useMemo(() => shortTimeline(sb, assets), [sb, assets]);
  // text-only edits (hook, end card, captions highlight, YouTube copy) keep all images and voices
  const ready = isShortReady(sb, assets);
  const inputProps: ShortProps = { storyboard: sb, assets, locale: short.locale, siteHost };
  const statuses = sb.scenes.map((s, i) => sceneStatus(s, assets.scenes[i] ?? emptySceneAssets()));
  const missing = statuses.filter((s) => !s.imageReady).length + statuses.filter((s) => !s.voiceReady).length;
  const canRender = typeof window !== "undefined" && "VideoEncoder" in window;

  function edit(next: Storyboard) {
    setSb(next);
    setDirty(true);
  }
  function editScene(i: number, patch: Partial<ShortScene>) {
    edit({ ...sb, scenes: sb.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }

  function applyResult(json: { short?: ShortData; error?: string }, keepEdits = false) {
    if (json.short) {
      setShort(json.short);
      if (!keepEdits) {
        setSb(json.short.storyboard);
        setSceneMap(json.short.storyboard.scenes.map((_, i) => i));
        setDirty(false);
      }
    }
  }

  async function run(kind: Busy, body: Record<string, unknown>, opts: { confirmText?: string; keepEdits?: boolean } = {}) {
    if (opts.confirmText && !confirm(opts.confirmText)) return false;
    setBusy(kind);
    setError("");
    try {
      const { ok, json } = await api(body);
      applyResult(json, opts.keepEdits || !ok); // a failed save must not throw away the edits
      if (!ok) setError(json.error ?? "Er ging iets mis");
      return ok;
    } catch {
      setError("Geen verbinding met de server.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function save() {
    return run("saving", { action: "storyboard", id: short.id, storyboard: sb, sceneMap });
  }

  async function saveThen(kind: Busy, body: Record<string, unknown>) {
    if (dirty && !(await save())) return;
    await run(kind, body);
  }

  async function render() {
    if (dirty && !(await save())) return;
    setBusy("render");
    setError("");
    setProgress(0);
    abortRef.current = new AbortController();
    try {
      const { renderMediaOnWeb } = await import("@remotion/web-renderer");
      const result = await renderMediaOnWeb({
        composition: { id: "short", component: Short, durationInFrames: timeline.total, fps: FPS, width: WIDTH, height: HEIGHT, defaultProps: inputProps },
        inputProps,
        container: "mp4",
        videoCodec: "h264",
        videoBitrate: "high",
        signal: abortRef.current.signal,
        onProgress: ({ progress: p }) => setProgress(p),
      });
      const blob = await result.getBlob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `feelgoodbrothers-short-${short.id}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(`Renderen mislukt: ${(err as Error).message}`);
    } finally {
      setBusy("");
      abortRef.current = null;
    }
  }

  const seconds = Math.round(timeline.total / FPS);
  const yt = sb.youtube;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3" inert={busy !== ""}>
        {mock && (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            Testmodus: geen OpenAI-key of AI_PROVIDER=mock. Je krijgt een vast testscript, gekleurde vlakken en stille audio.
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">1. Script</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={busy !== ""}
                onClick={() => run("script", { action: "script", id: short.id }, { confirmText: "Een heel nieuw script laten schrijven? Je wijzigingen en de gemaakte beelden en stem van deze short vervallen." })}
              >
                {busy === "script" ? "Schrijven…" : "↻ Nieuw script"}
              </button>
              <button type="button" className="btn-primary text-sm" disabled={!dirty || busy !== ""} onClick={save}>
                {busy === "saving" ? "Opslaan…" : dirty ? "Wijzigingen opslaan" : "Opgeslagen"}
              </button>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="hook">Hook (groot in beeld bij de start)</label>
            <input id="hook" className="input" value={sb.hook} maxLength={80} onChange={(e) => edit({ ...sb, hook: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="character">Hoofdpersoon (Engels, gaat mee in elke illustratie)</label>
            <input id="character" className="input" value={sb.character} onChange={(e) => edit({ ...sb, character: e.target.value })} />
            <p className="mt-1 text-xs text-gray-500">Pas je dit aan, maak dan alle illustraties opnieuw zodat de persoon overal hetzelfde is.</p>
          </div>
        </div>

        {sb.scenes.map((scene, i) => {
          const a = assets.scenes[i];
          const st = statuses[i];
          return (
            <div key={i} className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Scène {i + 1}</h3>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`badge ${st.imageReady ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                    {st.imageReady ? "✓ illustratie" : a?.imageKey ? "illustratie verouderd" : "geen illustratie"}
                  </span>
                  <span className={`badge ${st.voiceReady ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                    {st.voiceReady ? `✓ stem ${a.seconds.toFixed(1)}s` : a?.audioKey ? "stem verouderd" : "geen stem"}
                  </span>
                  {sb.scenes.length > MIN_SCENES && (
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      disabled={busy !== ""}
                      onClick={() => {
                        if (!confirm(`Scène ${i + 1} verwijderen?`)) return;
                        setSceneMap((m) => m.filter((_, j) => j !== i));
                        edit({ ...sb, scenes: sb.scenes.filter((_, j) => j !== i) });
                      }}
                    >
                      Verwijderen
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[110px_1fr]">
                <div className="aspect-[2/3] w-[110px] overflow-hidden rounded-md bg-gray-100">
                  {a?.imageKey && <img src={`/media/${a.imageKey}.webp`} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="label" htmlFor={`n${i}`}>Wat de stem zegt</label>
                    <textarea id={`n${i}`} className="input" rows={2} value={scene.narration} onChange={(e) => editScene(i, { narration: e.target.value })} />
                  </div>
                  <div>
                    <label className="label" htmlFor={`p${i}`}>Beeldbeschrijving (Engels)</label>
                    <textarea id={`p${i}`} className="input text-sm" rows={2} value={scene.imagePrompt} onChange={(e) => editScene(i, { imagePrompt: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select className="input text-sm" value={scene.motion} onChange={(e) => editScene(i, { motion: e.target.value as ShortScene["motion"] })} aria-label="Beweging">
                      {MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
                    </select>
                    <select className="input text-sm" value={scene.effect} onChange={(e) => editScene(i, { effect: e.target.value as ShortScene["effect"] })} aria-label="Effect">
                      {EFFECTS.map((m) => <option key={m} value={m}>{EFFECT_LABELS[m]}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <button type="button" className="text-brand-700 hover:underline disabled:text-gray-400" disabled={busy !== ""}
                      onClick={() => saveThen(`scene-${i}`, { action: "generate", id: short.id, scene: i, part: "image", force: true })}>
                      {busy === `scene-${i}` ? "Bezig…" : "🎨 Nieuwe illustratie"}
                    </button>
                    <button type="button" className="text-brand-700 hover:underline disabled:text-gray-400" disabled={busy !== ""}
                      onClick={() => saveThen(`scene-${i}`, { action: "generate", id: short.id, scene: i, part: "voice", force: true })}>
                      🎙️ Stem opnieuw
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {sb.scenes.length < MAX_SCENES && (
          <button
            type="button"
            className="btn-secondary w-full border-dashed"
            disabled={busy !== ""}
            onClick={() => {
              setSceneMap((m) => [...m, -1]);
              edit({ ...sb, scenes: [...sb.scenes, { narration: "", imagePrompt: "", motion: "zoom-in", effect: "none" }] });
            }}
          >
            + Scène toevoegen
          </button>
        )}

        <div className="card space-y-3">
          <h2 className="font-semibold">Eindkaart en YouTube</h2>
          <div>
            <label className="label" htmlFor="cta">Tekst op de eindkaart</label>
            <input id="cta" className="input" value={sb.cta} onChange={(e) => edit({ ...sb, cta: e.target.value })} />
            <p className="mt-1 text-xs text-gray-500">
              Hook, eindkaart en YouTube-tekst aanpassen kost niets: beelden en stem blijven gewoon staan. Alleen een gewijzigde vertelling of beeldbeschrijving moet opnieuw gemaakt worden.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="yt-title">YouTube-titel</label>
            <input id="yt-title" className="input" value={yt.title} maxLength={100} onChange={(e) => edit({ ...sb, youtube: { ...yt, title: e.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="yt-desc">Beschrijving</label>
            <textarea id="yt-desc" className="input text-sm" rows={5} value={yt.description} onChange={(e) => edit({ ...sb, youtube: { ...yt, description: e.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="yt-tags">Hashtags</label>
            <input
              id="yt-tags"
              className="input"
              value={yt.hashtags.join(" ")}
              onChange={(e) => edit({ ...sb, youtube: { ...yt, hashtags: e.target.value.split(/\s+/) } })}
            />
          </div>
        </div>
      </div>

      {/* preview + export */}
      <div className="lg:col-span-2">
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="card space-y-3">
            <h2 className="font-semibold">2. Beelden en stem</h2>
            {missing > 0 ? (
              <>
                <p className="text-sm text-gray-600">
                  Nog te maken: {statuses.filter((s) => !s.imageReady).length} illustratie(s) en {statuses.filter((s) => !s.voiceReady).length} stem(men). Kosten {costHint}.
                </p>
                <button type="button" className="btn-primary w-full" disabled={busy !== ""} onClick={() => saveThen("generate", { action: "generate", id: short.id })}>
                  {busy === "generate" ? "Bezig… (± 1–2 min)" : dirty ? "Opslaan en maken" : "✨ Maak beelden en stem"}
                </button>
              </>
            ) : (
              <p className="text-sm text-green-700">✓ Alle illustraties en stemmen zijn klaar.</p>
            )}
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">3. Preview</h2>
              <span className="text-xs text-gray-500">{seconds} sec · 1080×1920</span>
            </div>
            <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-lg bg-black">
              <Player
                component={Short}
                inputProps={inputProps}
                durationInFrames={timeline.total}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                fps={FPS}
                controls
                acknowledgeRemotionLicense
                style={{ width: "100%", aspectRatio: `${WIDTH} / ${HEIGHT}` }}
              />
            </div>
            {busy === "render" ? (
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded bg-gray-100">
                  <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>MP4 maken in je browser… {Math.round(progress * 100)}%</span>
                  <button type="button" className="text-red-600 hover:underline" onClick={() => abortRef.current?.abort()}>Annuleren</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-primary w-full" disabled={!ready || !canRender || busy !== ""} onClick={render}>
                {dirty ? "Opslaan en ⬇ Download MP4" : "⬇ Download MP4"}
              </button>
            )}
            <p className="text-xs text-gray-500">
              {!canRender
                ? "Je browser kan geen video maken (WebCodecs ontbreekt). Gebruik Chrome."
                : !ready
                  ? "Maak eerst de beelden en stem die nog ontbreken (stap 2)."
                  : "De video wordt op je eigen computer gemaakt; laat dit tabblad open tot hij klaar is."}
            </p>
          </div>

          <div className="card space-y-3">
            <h2 className="font-semibold">4. Op YouTube zetten</h2>
            <CopyField label="Titel" value={yt.title} />
            <CopyField label="Beschrijving" value={`${yt.description}\n\n${yt.hashtags.join(" ")}`} rows={5} />
            <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600">
              <li>YouTube Studio → Maken → Video's uploaden → kies de MP4. Verticaal en korter dan 3 min wordt vanzelf een Short.</li>
              <li>Plak titel en beschrijving. Kies "Nee, niet voor kinderen".</li>
              <li>Bij "Aangepaste content": de illustraties zijn duidelijk getekend, dus meestal "Nee". Twijfel je, kies "Ja".</li>
            </ol>
          </div>

          <div className="flex items-center justify-between text-sm">
            <a href={`/posts/${postId}/`} className="text-gray-500 hover:text-gray-800">← {postTitle}</a>
            <button
              type="button"
              className="text-red-600 hover:underline"
              disabled={busy !== ""}
              onClick={async () => {
                if (await run("delete", { action: "delete", id: short.id }, { confirmText: "Deze short verwijderen, met alle beelden en stemmen?" })) {
                  window.location.href = "/shorts/";
                }
              }}
            >
              Short verwijderen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
