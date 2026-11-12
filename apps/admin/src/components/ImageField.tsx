import { useState } from "react";

interface Props {
  name: string;
  initialId: number | null;
  initialUrl: string | null;
  round?: boolean;
}

/** small image picker that uploads immediately and stores the media id in a hidden input */
export default function ImageField({ name, initialId, initialUrl, round = false }: Props) {
  const [id, setId] = useState(initialId);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload mislukt");
      setId(json.id);
      setUrl(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <input type="hidden" name={name} value={id ?? ""} />
      {url ? (
        <img src={url} alt="" className={`h-20 w-20 object-cover ${round ? "rounded-full" : "rounded-md"}`} />
      ) : (
        <div className={`h-20 w-20 bg-gray-100 ${round ? "rounded-full" : "rounded-md"}`} />
      )}
      <label className="btn-secondary cursor-pointer">
        {busy ? "Uploaden…" : url ? "Wijzigen" : "Uploaden"}
        <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {url && (
        <button type="button" className="text-sm text-gray-500 hover:text-red-600" onClick={() => { setId(null); setUrl(null); }}>
          Verwijderen
        </button>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
