import { useState } from "react";

export interface AudioInfo {
  /** null when the post has no read-aloud version yet */
  url: string | null;
  seconds: number | null;
  voice: string | null;
  createdAt: string | null;
  /** the saved text changed since the audio was made */
  stale: boolean;
  /** minutes of audio the saved text would give (estimate) */
  estimateMinutes: number;
  /** test mode: a silent file instead of a real voice (no OpenAI key or AI_PROVIDER=mock) */
  mock: boolean;
}

interface Props {
  postId: number;
  audio: AudioInfo;
  dirty: boolean;
  placeholdersOpen: number;
}

// gpt-4o-mini-tts: about $0.015 per minute of audio
const USD_PER_MINUTE = 0.015;

function duration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioPanel({ postId, audio, dirty, placeholdersOpen }: Props) {
  const [busy, setBusy] = useState<"" | "generate" | "delete">("");
  const [error, setError] = useState("");

  async function call(action: "generate" | "delete") {
    if (action === "delete" && !confirm("Voorlezing verwijderen? De speler verdwijnt dan van de blog.")) return;
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/ai/audio/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Er ging iets mis");
      setBusy("");
      window.location.href = `/posts/${postId}/?audio=${action === "delete" ? "deleted" : "made"}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }

  const cost = Math.max(0.01, audio.estimateMinutes * USD_PER_MINUTE).toFixed(2);
  const blocked = dirty ? "Sla de blog eerst op." : placeholdersOpen > 0 ? "Vul eerst de invulpunten [[…]] in." : "";

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">🔊 Voorlezen</h2>
      {audio.mock && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Testmodus: er komt een stil geluidsbestand, geen echte stem (geen OpenAI-key of AI_PROVIDER=mock).
        </p>
      )}
      {audio.url ? (
        <>
          <audio controls preload="none" src={audio.url} className="w-full" />
          <p className="text-xs text-gray-500">
            {duration(audio.seconds)} · stem {audio.voice} · gemaakt {audio.createdAt}
          </p>
          {audio.stale && (
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              De tekst is veranderd sinds deze voorlezing. Maak hem opnieuw als de wijziging belangrijk is.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-gray-600">
          Laat de blog voorlezen door een AI-stem. Bezoekers krijgen dan een speler bovenaan de blog.
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      {blocked && <p className="text-xs text-gray-500">{blocked}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={audio.url ? "btn-secondary" : "btn-primary w-full"}
          disabled={busy !== "" || Boolean(blocked)}
          onClick={() => call("generate")}
        >
          {busy === "generate"
            ? `Bezig… (± ${Math.max(15, audio.estimateMinutes * 8)} sec)`
            : audio.url
              ? "Opnieuw maken"
              : `Maak voorlezing (± ${audio.estimateMinutes} min, ± $${cost})`}
        </button>
        {audio.url && (
          <button type="button" className="text-sm text-red-600 hover:underline" disabled={busy !== ""} onClick={() => call("delete")}>
            {busy === "delete" ? "Verwijderen…" : "Verwijderen"}
          </button>
        )}
      </div>
    </div>
  );
}
