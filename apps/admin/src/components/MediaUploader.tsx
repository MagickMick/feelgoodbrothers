import { useState } from "react";

export default function MediaUploader() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload/", { method: "POST", body: fd });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload mislukt");
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <label className="btn-primary cursor-pointer">
        {busy ? "Uploaden…" : "+ Afbeeldingen uploaden"}
        <input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={(e) => onFiles(e.target.files)} />
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
