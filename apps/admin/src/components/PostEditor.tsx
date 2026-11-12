import { useMemo, useRef, useState } from "react";
import { marked } from "marked";

export interface EditorPost {
  id?: number;
  locale: "en" | "nl";
  title: string;
  slug: string;
  description: string;
  body: string;
  heroId: number | null;
  heroUrl: string | null;
  heroAlt: string;
  authorId: number | null;
  kind: "team" | "guest";
  guestName: string;
  guestEmail: string;
  /** YYYY-MM-DD */
  guestConsentDate: string;
  guestNote: string;
  categoryIds: number[];
  status: "draft" | "scheduled" | "published";
  publishAtLocal: string;
  isLive: boolean;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  noindex: boolean;
  translationGroup?: string;
}

interface Props {
  post: EditorPost;
  authors: { id: number; name: string }[];
  categories: { id: number; nameEn: string; nameNl: string }[];
  errors: Record<string, string>;
  siteUrl: string;
  hasTranslation: boolean;
}

const BRAND = " | Feelgood Brothers";

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wordCount(md: string): number {
  const t = md.replace(/[#>*_`~\-\[\]()!]/g, " ").trim();
  return t ? t.split(/\s+/).length : 0;
}

function Counter({ value, min, max }: { value: number; min: number; max: number }) {
  const cls = value === 0 ? "text-gray-400" : value < min || value > max ? "text-amber-600" : "text-green-600";
  return (
    <span className={`text-xs ${cls}`}>
      {value} / {min}-{max} tekens
    </span>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="field-error">{msg}</p> : null;
}

async function uploadFile(file: File, alt = ""): Promise<{ id: number; url: string; key: string }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("alt", alt);
  const res = await fetch("/api/upload/", { method: "POST", body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Upload mislukt");
  return json;
}

export default function PostEditor({ post, authors, categories, errors, siteUrl, hasTranslation }: Props) {
  const [title, setTitle] = useState(post.title);
  const [slug, setSlug] = useState(post.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(post.id));
  const [description, setDescription] = useState(post.description);
  const [body, setBody] = useState(post.body);
  const [heroId, setHeroId] = useState<number | null>(post.heroId);
  const [heroUrl, setHeroUrl] = useState<string | null>(post.heroUrl);
  const [heroAlt, setHeroAlt] = useState(post.heroAlt);
  const [categoryIds, setCategoryIds] = useState<number[]>(post.categoryIds);
  const [kind, setKind] = useState<"team" | "guest">(post.kind);
  const [guestName, setGuestName] = useState(post.guestName);
  const [publishAt, setPublishAt] = useState(post.publishAtLocal);
  const [seoTitle, setSeoTitle] = useState(post.seoTitle);
  const [metaDescription, setMetaDescription] = useState(post.metaDescription);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inlineFileRef = useRef<HTMLInputElement>(null);

  const locale = post.locale;
  const path = locale === "en" ? `/blog/${slug}/` : `/nl/blog/${slug}/`;
  const effectiveTitle = (seoTitle || title).trim();
  const fullTitle = effectiveTitle.toLowerCase().includes("feelgood brothers") ? effectiveTitle : effectiveTitle + BRAND;
  const effectiveDescription = (metaDescription || description).trim();
  const words = wordCount(body);
  const previewHtml = useMemo(() => (tab === "preview" ? (marked.parse(body, { async: false }) as string) : ""), [body, tab]);

  const checks: { ok: boolean; text: string }[] = [
    { ok: fullTitle.length >= 30 && fullTitle.length <= 65, text: `SEO-titel 30-65 tekens (nu ${fullTitle.length})` },
    {
      ok: effectiveDescription.length >= 120 && effectiveDescription.length <= 160,
      text: `Meta description 120-160 tekens (nu ${effectiveDescription.length})`,
    },
    { ok: Boolean(heroId), text: "Hoofdafbeelding gekozen" },
    { ok: heroAlt.trim().length >= 10, text: "Alt-tekst bij de hoofdafbeelding" },
    { ok: categoryIds.length > 0, text: "Minstens 1 categorie" },
    kind === "guest"
      ? { ok: guestName.trim().length > 0, text: "Voornaam of pseudoniem van de gastschrijver" }
      : { ok: true, text: "Auteur gekozen" },
    { ok: words >= 600, text: `Minstens 600 woorden (nu ${words})` },
    { ok: /^##\s/m.test(body), text: "Tussenkoppen (##) gebruikt" },
    { ok: slug.length > 0 && slug.length <= 75, text: "Korte, leesbare slug" },
    { ok: hasTranslation, text: `Vertaling (${locale === "en" ? "NL" : "EN"}) gekoppeld` },
  ];

  function markDirty() {
    if (!dirty) {
      setDirty(true);
      window.onbeforeunload = () => true;
    }
  }

  function insert(before: string, after = "", placeholder = "") {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + selected + after + value.slice(e);
    setBody(next);
    markDirty();
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  }

  function linePrefix(prefix: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, value } = ta;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    setBody(next);
    markDirty();
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(s + prefix.length, s + prefix.length);
    });
  }

  async function onHeroFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const res = await uploadFile(file, heroAlt || title);
      setHeroId(res.id);
      setHeroUrl(res.url);
      if (!heroAlt) setHeroAlt(title);
      markDirty();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function onInlineFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const res = await uploadFile(file);
      insert(`\n![`, `](${res.url})\n`, "beschrijving van de afbeelding");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploading(false);
      if (inlineFileRef.current) inlineFileRef.current.value = "";
    }
  }

  const toolbar: [string, string, () => void][] = [
    ["H2", "Tussenkop", () => linePrefix("## ")],
    ["H3", "Kleine kop", () => linePrefix("### ")],
    ["B", "Vet", () => insert("**", "**", "vette tekst")],
    ["I", "Cursief", () => insert("_", "_", "cursief")],
    ["Link", "Link", () => insert("[", "](https://)", "linktekst")],
    ["• Lijst", "Opsomming", () => linePrefix("- ")],
    ["1. Lijst", "Genummerde lijst", () => linePrefix("1. ")],
    ["❝ Quote", "Citaat", () => linePrefix("> ")],
  ];

  return (
    <form
      method="post"
      className="grid gap-6 lg:grid-cols-3"
      onChange={markDirty}
      onSubmit={() => {
        window.onbeforeunload = null;
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="heroId" value={heroId ?? ""} />
      {post.translationGroup && <input type="hidden" name="translationGroup" value={post.translationGroup} />}

      {/* main column */}
      <div className="space-y-6 lg:col-span-2">
        <div className="card space-y-4">
          <div>
            <label className="label" htmlFor="title">Titel</label>
            <input
              id="title"
              name="title"
              className="input text-lg"
              value={title}
              required
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
            <FieldError msg={errors.title} />
          </div>
          <div>
            <label className="label" htmlFor="slug">Slug (URL)</label>
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <span className="whitespace-nowrap">{locale === "en" ? "/blog/" : "/nl/blog/"}</span>
              <input
                id="slug"
                name="slug"
                className="input"
                value={slug}
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugTouched(true);
                }}
              />
              <span>/</span>
            </div>
            {post.isLive && slug !== post.slug && (
              <p className="mt-1 text-xs text-amber-700">
                Let op: de URL verandert. Er wordt automatisch een 301-redirect gemaakt vanaf de oude URL.
              </p>
            )}
            <FieldError msg={errors.slug} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="description">Korte omschrijving (intro op kaarten + meta description)</label>
              <Counter value={description.length} min={120} max={160} />
            </div>
            <textarea
              id="description"
              name="description"
              className="input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <FieldError msg={errors.description} />
          </div>
        </div>

        {/* body */}
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-gray-100 pb-3">
            <button type="button" onClick={() => setTab("write")} className={`rounded px-3 py-1 text-sm ${tab === "write" ? "bg-gray-900 text-white" : "hover:bg-gray-100"}`}>Schrijven</button>
            <button type="button" onClick={() => setTab("preview")} className={`rounded px-3 py-1 text-sm ${tab === "preview" ? "bg-gray-900 text-white" : "hover:bg-gray-100"}`}>Preview</button>
            <span className="mx-2 h-5 w-px bg-gray-200" />
            {tab === "write" &&
              toolbar.map(([label, t, fn]) => (
                <button key={label} type="button" title={t} onClick={fn} className="rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100">
                  {label}
                </button>
              ))}
            {tab === "write" && (
              <label className="cursor-pointer rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100">
                🖼 Afbeelding
                <input ref={inlineFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onInlineFile(e.target.files?.[0])} />
              </label>
            )}
            <span className="ml-auto text-xs text-gray-500">{words} woorden · ~{Math.max(1, Math.round(words / 220))} min</span>
          </div>
          <textarea
            ref={textareaRef}
            name="body"
            className={`input min-h-[60vh] font-mono text-[15px] leading-relaxed ${tab === "write" ? "" : "hidden"}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Begin met een persoonlijke intro...\n\n## Tussenkop\n\nGebruik ## voor tussenkoppen, **vet** en _cursief_."}
          />
          {tab === "preview" && (
            <div className="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          )}
          <FieldError msg={errors.body} />
        </div>

        {/* SEO */}
        <div className="card space-y-4">
          <h2 className="font-semibold">SEO</h2>
          <div className="rounded-md border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Google preview</p>
            <p className="mt-1 truncate text-sm text-gray-700">{siteUrl.replace(/^https?:\/\//, "")}{path}</p>
            <p className="truncate text-xl text-[#1a0dab]">{fullTitle || "Titel van je blog"}</p>
            <p className="line-clamp-2 text-sm text-gray-600">{effectiveDescription || "Omschrijving van je blog..."}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="seoTitle">SEO-titel (optioneel, anders de titel)</label>
              <Counter value={fullTitle.length} min={30} max={65} />
            </div>
            <input id="seoTitle" name="seoTitle" className="input" value={seoTitle} placeholder={title} onChange={(e) => setSeoTitle(e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="metaDescription">Meta description (optioneel, anders de omschrijving)</label>
              <Counter value={effectiveDescription.length} min={120} max={160} />
            </div>
            <textarea id="metaDescription" name="metaDescription" className="input" rows={2} value={metaDescription} placeholder={description} onChange={(e) => setMetaDescription(e.target.value)} />
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-gray-600">Geavanceerd</summary>
            <div className="mt-3 space-y-3">
              <div>
                <label className="label" htmlFor="canonicalUrl">Canonical URL (alleen als deze tekst ook ergens anders staat)</label>
                <input id="canonicalUrl" name="canonicalUrl" className="input" defaultValue={post.canonicalUrl} placeholder={siteUrl + path} />
                <FieldError msg={errors.canonicalUrl} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="noindex" defaultChecked={post.noindex} className="rounded border-gray-300" />
                Niet laten indexeren door Google (noindex)
              </label>
            </div>
          </details>
        </div>
      </div>

      {/* sidebar */}
      <div className="space-y-6">
        <div className="card space-y-3 lg:sticky lg:top-4">
          <h2 className="font-semibold">Publiceren</h2>
          <div>
            <label className="label" htmlFor="publishAt">Publicatiedatum (NL-tijd)</label>
            <input id="publishAt" name="publishAt" type="datetime-local" className="input" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
            <p className="mt-1 text-xs text-gray-500">Leeg + "Publiceren" = nu live. Datum in de toekomst + "Inplannen" = gaat automatisch live.</p>
            <FieldError msg={errors.publishAt} />
          </div>
          {Object.keys(errors).length > 0 && (
            <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">Niet opgeslagen: controleer de rood gemarkeerde velden.</p>
          )}
          <div className="flex flex-col gap-2">
            <button type="submit" name="action" value="publish" className="btn-primary">
              {post.isLive ? "Bijwerken" : "Nu publiceren"}
            </button>
            <button type="submit" name="action" value="schedule" className="btn-secondary">Inplannen</button>
            <button type="submit" name="action" value="draft" className="btn-secondary">
              {post.isLive ? "Offline halen (concept)" : "Opslaan als concept"}
            </button>
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Type blog</h2>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["team", "Feelgood Brothers", "Eigen verhaal, met auteursprofiel"],
                ["guest", "Gastblog", "Verhaal uit de community"],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={`cursor-pointer rounded-md border p-2 text-sm ${kind === value ? "border-brand-500 bg-brand-50" : "border-gray-300"}`}
              >
                <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="sr-only" />
                <span className="block font-medium">{label}</span>
                <span className="block text-xs text-gray-500">{hint}</span>
              </label>
            ))}
          </div>
          {kind === "guest" && (
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="guestName">Voornaam of pseudoniem (enige wat zichtbaar is)</label>
                <input id="guestName" name="guestName" className="input" maxLength={40} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="bv. Joyce" />
                <FieldError msg={errors.guestName} />
              </div>
              <details open={Boolean(post.guestEmail || post.guestConsentDate || post.guestNote || errors.guestEmail)}>
                <summary className="cursor-pointer text-sm text-gray-600">Intern (nooit zichtbaar op de site)</summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="label" htmlFor="guestEmail">E-mail van de schrijver</label>
                    <input id="guestEmail" name="guestEmail" type="email" className="input" defaultValue={post.guestEmail} />
                    <FieldError msg={errors.guestEmail} />
                  </div>
                  <div>
                    <label className="label" htmlFor="guestConsentDate">Toestemming om te publiceren ontvangen op</label>
                    <input id="guestConsentDate" name="guestConsentDate" type="date" className="input" defaultValue={post.guestConsentDate} />
                  </div>
                  <div>
                    <label className="label" htmlFor="guestNote">Notitie</label>
                    <textarea id="guestNote" name="guestNote" rows={2} className="input" defaultValue={post.guestNote} placeholder="bv. ingestuurd via mail, wil geen foto" />
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Hoofdafbeelding</h2>
          {heroUrl ? (
            <img src={heroUrl} alt={heroAlt} className="aspect-[3/2] w-full rounded-md object-cover" />
          ) : (
            <div className="flex aspect-[3/2] w-full items-center justify-center rounded-md bg-gray-100 text-sm text-gray-500">Geen afbeelding</div>
          )}
          <label className="btn-secondary w-full cursor-pointer">
            {uploading ? "Uploaden…" : heroUrl ? "Andere afbeelding" : "Afbeelding uploaden"}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden" disabled={uploading} onChange={(e) => onHeroFile(e.target.files?.[0])} />
          </label>
          {uploadError && <p className="field-error">{uploadError}</p>}
          <FieldError msg={errors.heroId} />
          <div>
            <label className="label" htmlFor="heroAlt">Alt-tekst (wat staat er op de foto?)</label>
            <input id="heroAlt" name="heroAlt" className="input" value={heroAlt} onChange={(e) => setHeroAlt(e.target.value)} />
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Details</h2>
          {kind === "team" && (
          <div>
            <label className="label" htmlFor="authorId">Auteur</label>
            <select id="authorId" name="authorId" className="input" defaultValue={post.authorId ?? ""}>
              <option value="">— geen —</option>
              {authors.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <a href="/authors/new/" className="mt-1 inline-block text-xs text-brand-600 hover:underline">+ nieuwe auteur</a>
          </div>
          )}
          <div>
            <p className="label">Categorieën</p>
            <div className="grid grid-cols-2 gap-1">
              {categories.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="categoryIds"
                    value={c.id}
                    checked={categoryIds.includes(c.id)}
                    onChange={(e) =>
                      setCategoryIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))
                    }
                    className="rounded border-gray-300"
                  />
                  {locale === "nl" ? c.nameNl : c.nameEn}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold">SEO-checklist</h2>
          <ul className="space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.text} className={c.ok ? "text-green-700" : "text-amber-700"}>
                {c.ok ? "✓" : "○"} {c.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </form>
  );
}
