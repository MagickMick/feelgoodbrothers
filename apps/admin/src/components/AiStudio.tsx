import { useEffect, useMemo, useRef, useState } from "react";
import { renderPreview } from "@/lib/safeMarkdown";
import { countPlaceholders, parseDraft } from "@fgb/core/ai/prompts";

interface Category {
  id: number;
  nameEn: string;
  nameNl: string;
}
interface Situation {
  id: number;
  categoryId: number;
  labelEn: string;
  labelNl: string;
}
interface Provider {
  id: string;
  label: string;
  model: string;
}
interface Resume {
  sessionId: number;
  locale: "en" | "nl";
  categoryIds: number[];
  situationLabel: string;
  lastDraft: string;
  feedback: string[];
  postId: number | null;
  provider: string;
}

interface Props {
  categories: Category[];
  situations: Situation[];
  providers: Provider[];
  defaultProvider: string;
  resume: Resume | null;
}

const ERROR_MARKER = "\u0000AI_ERROR:";

type Length = "short" | "medium" | "long";

export default function AiStudio({ categories, situations, providers, defaultProvider, resume }: Props) {
  // form
  const [locale, setLocale] = useState<"en" | "nl">(resume?.locale ?? "en");
  const [categoryIds, setCategoryIds] = useState<number[]>(resume?.categoryIds ?? []);
  const [situationChoice, setSituationChoice] = useState<string>("random"); // "random" | "custom" | id
  const [situationText, setSituationText] = useState("");
  const [persona, setPersona] = useState("");
  const [length, setLength] = useState<Length>("medium");
  const [helps, setHelps] = useState("");
  const [wishes, setWishes] = useState("");
  const [placeholders, setPlaceholders] = useState(true);
  const [provider, setProvider] = useState(resume?.provider ?? defaultProvider);

  // session
  const [sessionId, setSessionId] = useState<number | null>(resume?.sessionId ?? null);
  const [situationLabel, setSituationLabel] = useState(resume?.situationLabel ?? "");
  const [raw, setRaw] = useState(resume?.lastDraft ?? "");
  const [feedbackLog, setFeedbackLog] = useState<string[]>(resume?.feedback ?? []);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"" | "generating" | "revising" | "saving">("");
  const [error, setError] = useState("");
  const [savedPostId, setSavedPostId] = useState<number | null>(resume?.postId ?? null);
  const abortRef = useRef<AbortController | null>(null);

  const draft = useMemo(() => parseDraft(raw), [raw]);
  // sanitized preview, built in the browser only (see lib/safeMarkdown.ts)
  const [html, setHtml] = useState("");
  useEffect(() => setHtml(renderPreview(draft.body, { highlightPlaceholders: true })), [draft.body]);
  const words = draft.body ? draft.body.split(/\s+/).filter(Boolean).length : 0;
  const openPlaceholders = countPlaceholders(draft.body);

  const situationOptions = situations.filter((s) => categoryIds.includes(s.categoryId));
  const catName = (c: Category) => (locale === "nl" ? c.nameNl : c.nameEn);
  const sitName = (s: Situation) => (locale === "nl" ? s.labelNl : s.labelEn);

  async function streamTurn(id: number, fb: string | null) {
    abortRef.current = new AbortController();
    const res = await fetch("/api/ai/turn/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: id, feedback: fb, provider }),
      signal: abortRef.current.signal,
    });
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? "De AI-aanvraag is mislukt");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    setRaw("");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const errAt = text.indexOf(ERROR_MARKER);
      if (errAt !== -1) {
        const msg = text.slice(errAt + ERROR_MARKER.length);
        setRaw(text.slice(0, errAt));
        throw new Error(msg || "Er ging iets mis bij de AI");
      }
      setRaw(text);
    }
  }

  async function generate() {
    setError("");
    if (categoryIds.length === 0) {
      setError("Kies minstens één categorie.");
      return;
    }
    if (situationChoice === "custom" && !situationText.trim()) {
      setError("Beschrijf de situatie, of kies er een uit de lijst.");
      return;
    }
    setBusy("generating");
    setSavedPostId(null);
    setFeedbackLog([]);
    try {
      const res = await fetch("/api/ai/session/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale,
          categoryIds,
          situationId: situationChoice === "custom" ? null : situationChoice,
          situationText: situationChoice === "custom" ? situationText : "",
          persona,
          length,
          helps,
          wishes,
          placeholders,
          provider,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kon geen sessie starten");
      setSessionId(json.sessionId);
      const picked = situations.find((s) => s.id === Number(json.situationId));
      setSituationLabel(
        situationChoice === "custom" ? situationText : json.situationLabel || (picked ? sitName(picked) : ""),
      );
      window.history.replaceState(null, "", `/ai/?session=${json.sessionId}`);
      await streamTurn(json.sessionId, null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function revise(text?: string) {
    const fb = (text ?? feedback).trim();
    if (!sessionId || !fb) return;
    setError("");
    setBusy("revising");
    const previous = raw;
    try {
      setFeedbackLog((l) => [...l, fb]);
      setFeedback("");
      await streamTurn(sessionId, fb);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
        setRaw(previous);
        setFeedbackLog((l) => l.slice(0, -1));
        setFeedback(fb);
      }
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!sessionId) return;
    setBusy("saving");
    setError("");
    try {
      const res = await fetch("/api/ai/save/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Opslaan mislukt");
      window.location.href = `/posts/${json.postId}/`;
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  }

  function startOver() {
    abortRef.current?.abort();
    setSessionId(null);
    setRaw("");
    setFeedbackLog([]);
    setSavedPostId(null);
    setError("");
    window.history.replaceState(null, "", "/ai/");
  }

  // instructions may be Dutch; the AI keeps writing in the draft's language
  const quick = [
    "Korter",
    "Meer over de lichamelijke klachten",
    "Minder zoetsappig, eerlijker",
    "Andere titel",
    "Meer gedachten in het moment zelf",
  ];

  const hasDraft = Boolean(raw);
  const locked = Boolean(sessionId && hasDraft);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* form */}
      <div className="space-y-4 lg:col-span-2">
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Nieuwe opzet</h2>
            {locked && (
              <button type="button" onClick={startOver} className="text-sm text-brand-600 hover:underline">
                + Nieuwe opzet
              </button>
            )}
          </div>

          <fieldset disabled={locked || busy !== ""} className="space-y-4 disabled:opacity-60">
            <div className="flex gap-2">
              {(["en", "nl"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={`rounded-full border px-3 py-1 text-sm ${locale === l ? "border-brand-500 bg-brand-50" : "border-gray-300"}`}
                >
                  {l === "en" ? "🇺🇸 Engels (VS)" : "🇳🇱 Nederlands"}
                </button>
              ))}
            </div>

            <div>
              <p className="label">Categorie</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <label
                    key={c.id}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-sm ${categoryIds.includes(c.id) ? "border-brand-500 bg-brand-50" : "border-gray-300"}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={categoryIds.includes(c.id)}
                      onChange={(e) => {
                        setCategoryIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)));
                        setSituationChoice("random");
                      }}
                    />
                    {catName(c)}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="situation">Situatie</label>
              <select id="situation" className="input" value={situationChoice} onChange={(e) => setSituationChoice(e.target.value)}>
                <option value="random">🎲 Willekeurig (bij voorkeur nog niet gebruikt)</option>
                {situationOptions.map((s) => (
                  <option key={s.id} value={s.id}>{sitName(s)}</option>
                ))}
                <option value="custom">✏️ Eigen situatie beschrijven…</option>
              </select>
              {situationChoice === "custom" && (
                <textarea
                  className="input mt-2"
                  rows={2}
                  value={situationText}
                  onChange={(e) => setSituationText(e.target.value)}
                  placeholder={locale === "nl" ? "bv. paniek in de wachtkamer bij de huisarts" : "e.g. panic in the waiting room at the doctor's office"}
                />
              )}
              <a href="/situations/" className="mt-1 inline-block text-xs text-gray-500 hover:text-brand-600">Situaties beheren</a>
            </div>

            <div>
              <label className="label" htmlFor="persona">Wie (optioneel)</label>
              <input
                id="persona"
                className="input"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="bv. moeder van 34, werkt in de zorg (leeg = AI kiest)"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="length">Lengte</label>
                <select id="length" className="input" value={length} onChange={(e) => setLength(e.target.value as Length)}>
                  <option value="short">Kort (±500 woorden)</option>
                  <option value="medium">Middel (±800)</option>
                  <option value="long">Lang (±1200)</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="provider">AI</label>
                <select id="provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="helps">Wat helpt deze persoon (optioneel)</label>
              <input id="helps" className="input" value={helps} onChange={(e) => setHelps(e.target.value)} placeholder="bv. voeten op de grond voelen, ademhaling tellen" />
            </div>

            <div>
              <label className="label" htmlFor="wishes">Extra wensen (optioneel)</label>
              <textarea
                id="wishes"
                className="input"
                rows={3}
                value={wishes}
                onChange={(e) => setWishes(e.target.value)}
                placeholder="bv. eindig hoopvol maar niet zoetsappig; de persoon schaamt zich tegenover een collega"
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={placeholders} onChange={(e) => setPlaceholders(e.target.checked)} className="mt-0.5 rounded border-gray-300" />
              <span>
                Invulpunten toevoegen <span className="text-gray-500">([[Jouw detail: …]] op plekken waar jouw echte ervaring hoort)</span>
              </span>
            </label>
          </fieldset>

          {!locked && (
            <button type="button" onClick={generate} disabled={busy !== ""} className="btn-primary w-full">
              {busy === "generating" ? "Bezig met schrijven…" : "✨ Genereer opzet"}
            </button>
          )}
        </div>

        {/* chat */}
        {locked && (
          <div className="card space-y-3">
            <h2 className="font-semibold">Bijsturen</h2>
            {feedbackLog.length > 0 && (
              <ul className="space-y-1 text-sm">
                {feedbackLog.map((f, i) => (
                  <li key={i} className="rounded-md bg-gray-50 px-3 py-1.5 text-gray-700">💬 {f}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-1">
              {quick.map((q) => (
                <button key={q} type="button" disabled={busy !== ""} onClick={() => revise(q)} className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs hover:bg-gray-50">
                  {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                revise();
              }}
              className="flex gap-2"
            >
              <textarea
                className="input"
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    revise();
                  }
                }}
                placeholder="Wat moet er anders? bv. 'laat haar in de rij een vriendin zien'"
                disabled={busy !== ""}
              />
              <button className="btn-secondary self-end" disabled={busy !== "" || !feedback.trim()}>
                {busy === "revising" ? "…" : "Stuur"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* preview */}
      <div className="lg:col-span-3">
        <div className="card min-h-[60vh]">
          {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {!hasDraft && !busy && (
            <div className="flex h-[50vh] flex-col items-center justify-center text-center text-gray-500">
              <p className="text-4xl">✍️</p>
              <p className="mt-3 max-w-sm text-sm">
                Kies een categorie en situatie en klik op "Genereer opzet". Je krijgt een concept in de ik-vorm dat je daarna zelf echt maakt.
              </p>
            </div>
          )}
          {(hasDraft || busy === "generating") && (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {situationLabel && <span className="badge bg-gray-100 text-gray-700">📍 {situationLabel}</span>}
                <span>{words} woorden</span>
                {openPlaceholders > 0 && <span className="badge bg-amber-100 text-amber-800">{openPlaceholders} invulpunten</span>}
                {busy && <span className="animate-pulse text-brand-600">AI schrijft…</span>}
              </div>
              <h1 className="text-2xl font-semibold">{draft.title || (busy ? "…" : "")}</h1>
              {draft.description && <p className="mt-2 text-sm text-gray-600">{draft.description}</p>}
              {draft.heroAlt && <p className="mt-1 text-xs text-gray-400">📷 Foto-idee: {draft.heroAlt}</p>}
              <div
                className="prose prose-lg mt-6 max-w-none [&_p]:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          )}
          {locked && draft.complete && !busy && (
            <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
              {savedPostId ? (
                <a href={`/posts/${savedPostId}/`} className="btn-primary">Open het concept in de editor →</a>
              ) : (
                <button type="button" onClick={save} disabled={busy !== ""} className="btn-primary">
                  {busy === "saving" ? "Opslaan…" : "Opslaan als concept →"}
                </button>
              )}
              <button type="button" onClick={generate} className="btn-secondary" disabled={busy !== ""}>
                Opnieuw genereren
              </button>
              <p className="text-xs text-gray-500">
                Opslaan maakt een concept (niet live). In de editor maak je het je eigen, kies je een foto en plan je het in.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
