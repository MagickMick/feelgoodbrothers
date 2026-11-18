import { useState } from "react";

interface Props {
  postId: number;
  shorts: { id: number; label: string; ready: boolean }[];
  dirty: boolean;
  placeholdersOpen: number;
}

/** editor sidebar: the shorts of this post and a button to make a new one */
export default function ShortsPanel({ postId, shorts, dirty, placeholdersOpen }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = dirty ? "Sla de blog eerst op." : placeholdersOpen > 0 ? "Vul eerst de invulpunten [[…]] in." : "";

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ai/shorts/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", postId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Er ging iets mis");
      setBusy(false);
      window.location.href = `/shorts/${json.id}/`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold">🎬 Shorts</h2>
      <p className="text-sm text-gray-600">Maak van deze blog een korte verticale animatievideo voor YouTube Shorts of Reels.</p>
      {shorts.length > 0 && (
        <ul className="space-y-1 text-sm">
          {shorts.map((s) => (
            <li key={s.id}>
              <a href={`/shorts/${s.id}/`} className="text-brand-700 hover:underline">{s.label}</a>{" "}
              <span className={`text-xs ${s.ready ? "text-green-700" : "text-amber-700"}`}>{s.ready ? "klaar" : "nog maken"}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field-error">{error}</p>}
      {blocked && <p className="text-xs text-gray-500">{blocked}</p>}
      <button type="button" className="btn-secondary w-full" disabled={busy || Boolean(blocked)} onClick={create}>
        {busy ? "Script schrijven… (± 20 sec)" : "🎬 Maak short"}
      </button>
    </div>
  );
}
