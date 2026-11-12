/**
 * Prompts for the writing assistant + parsing of its output.
 *
 * The AI writes a DRAFT in the first person that Mick then rewrites into a real
 * story before publishing. The style rules below are distilled from Mick's own posts.
 */
import type { AiSessionParams, Locale } from "../schema.ts";

export const PLACEHOLDER_RE = /\[\[[^\]]*\]\]/g;

export function countPlaceholders(text: string): number {
  return (text.match(PLACEHOLDER_RE) ?? []).length;
}

const LENGTH_WORDS: Record<AiSessionParams["length"], string> = {
  short: "about 500 words",
  medium: "about 800 words",
  long: "about 1200 words",
};

const OUTPUT_FORMAT = `Output format (exactly this, nothing before or after):
TITLE: <title, max 65 characters, personal and specific, no clickbait>
DESCRIPTION: <meta description, 120-160 characters, first person, says what the story is about>
SLUG: <short-url-slug-in-the-target-language>
HERO_ALT: <one sentence describing a fitting photo, for alt text and finding a stock photo>
---
<the blog post in Markdown: start directly with the story (no H1, no title repeated), use ## for 3-5 subheadings>`;

const STYLE = `You write first-person blog drafts for Feelgood Brothers, a blog where people share honest, personal experiences with mental health challenges (panic attacks, anxiety, derealization, high sensitivity, depression).

The author will rewrite your draft into their own real story before publishing, so write a strong, believable starting point, not a finished piece.

Voice and style (learned from the author's own posts):
- First person ("I"), one person, one concrete situation. Start in the middle of the moment: where am I, what am I doing, one small ordinary detail (what I just bought, the song that was playing, the weather).
- Describe the body and the mind concretely: racing heart, heat rising, tunnel vision, muscles tensing, the urge to flee, the thoughts that talk me into the panic ("what if I faint right here?").
- Honest and a bit vulnerable: doubt, embarrassment, what other people might think ("going to the restroom again after twenty minutes would look weird"), small humor allowed.
- Imperfect coping: what I tried, what partly worked, what didn't. Never a miracle fix.
- Plain spoken language, short paragraphs, varied sentence length. Subheadings describe the situation ("Stuck between strangers on the train"), not generic labels.
- No clinical jargon, no diagnosis talk, no bullet-point advice lists, no "In conclusion", no motivational clichés ("you've got this!", "remember, you are not alone" as a closing line), no em dashes.

Structure (use it as a flow, not as literal headings):
1. The moment: where, when, what I was doing.
2. The build-up: first signals in body and mind, what I see and hear around me.
3. The peak: the panic or feeling at its strongest.
4. How it ended: what I did, how it played out, imperfect.
5. Afterwards: how I felt, what others noticed or didn't, reflection.
6. What helps me: personal, specific (breathing, focusing on senses, accepting the feeling), clearly my own experience, not advice for the reader. Seeking professional help may come up naturally as part of my story.

Safety (always):
- No medical or medication advice, no dosages, no promises of a cure.
- Never describe methods of self-harm or suicide. If the topic touches on dark thoughts, focus on the feeling, on hope and on reaching out for help.
- The site already shows a note under every post recommending professional help; you don't need to add one.`;

const CONTEXT: Record<Locale, string> = {
  en: `Write the draft in American English for a US audience. Use American settings and details naturally (subway, freeway, Target, Walmart, a concert at an arena, a doctor's office, dollars, miles).`,
  nl: `Write the draft in Dutch (natural, informal Dutch as people actually write online, "ik" form). Use Dutch settings and details naturally (NS-trein, Albert Heijn, Jumbo, snelweg, huisarts, festival, verjaardag in de kring, euro's, kilometers).`,
};

export interface VoiceSample {
  title: string;
  body: string;
}

function trimWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  return words.length <= max ? text : `${words.slice(0, max).join(" ")} …`;
}

export function buildSystemPrompt(locale: Locale, voiceSamples: VoiceSample[], placeholders: boolean): string {
  const samples = voiceSamples.length
    ? `\n\nExamples of the author's own posts. Match this tone, rhythm and level of honesty (do not copy their content):\n${voiceSamples
        .map((s, i) => `<example_${i + 1} title="${s.title.replace(/"/g, "'")}">\n${trimWords(s.body, 450)}\n</example_${i + 1}>`)
        .join("\n")}`
    : "";
  const ph = placeholders
    ? `\n\nPlaceholders: in 3 to 6 places where a real personal detail would make the story more authentic, insert a placeholder in double square brackets that asks the author for it, written in the draft language, for example [[${locale === "nl" ? "Jouw detail: welk liedje werd er gespeeld?" : "Your detail: which song was playing?"}]]. Keep the surrounding sentence readable.`
    : "\n\nDo not use placeholders.";
  return `${STYLE}\n\n${CONTEXT[locale]}${ph}\n\n${OUTPUT_FORMAT}${samples}`;
}

export interface GenerateInput {
  locale: Locale;
  categoryNames: string[];
  situation: string;
  params: AiSessionParams;
}

/** first user message of a session */
export function buildGenerateMessage({ categoryNames, situation, params }: GenerateInput): string {
  const lines = [
    `Write a draft blog post.`,
    `Topic / category: ${categoryNames.join(", ") || "mental health"}.`,
    `Situation: ${situation || "choose a recognisable everyday situation that fits the topic"}.`,
    params.persona ? `The person: ${params.persona}.` : `The person: choose a believable person (age, life phase, job) and keep it consistent; don't state it like a profile, let it show.`,
    params.helps ? `What helps this person: ${params.helps}.` : "",
    `Length: ${LENGTH_WORDS[params.length]}.`,
    params.wishes ? `Extra wishes from the author: ${params.wishes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** follow-up chat turns: always return the complete revised draft */
export function buildReviseMessage(feedback: string): string {
  return `${feedback}\n\n(Apply this feedback and return the complete revised draft in the same output format. The feedback may be written in Dutch or English; keep writing the draft in its original language.)`;
}

export function buildTranslateSystem(target: Locale): string {
  const to = target === "nl" ? "Dutch" : "American English";
  return `You translate first-person blog posts for Feelgood Brothers, a mental health experience blog. Translate into ${to}.
- Keep the personal voice, the honesty and the rhythm; it must read as if originally written in ${to}, not as a translation.
- Adapt everyday local references so they feel natural for the reader (${target === "nl" ? "subway → metro/trein, Target/Walmart → Albert Heijn/Jumbo, miles → kilometers, dollars → euro's" : "NS-trein → train/subway, Albert Heijn/Jumbo → Target/grocery store, kilometers → miles, euro's → dollars"}), but never change what happened.
- Keep the Markdown structure (## headings, lists, links). Keep any [[...]] placeholders, translated.

${OUTPUT_FORMAT}`;
}

export function buildTranslateMessage(p: { title: string; description: string; body: string }): string {
  return `TITLE: ${p.title}\nDESCRIPTION: ${p.description}\n---\n${p.body}`;
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------
export interface ParsedDraft {
  title: string;
  description: string;
  slug: string;
  heroAlt: string;
  body: string;
  /** true once the "---" separator has been seen */
  complete: boolean;
}

/** parse model output; works on partial (streaming) text too */
export function parseDraft(raw: string): ParsedDraft {
  const text = raw.replace(/\r\n/g, "\n").replace(/^```(?:markdown)?\n/, "").replace(/\n```\s*$/, "");
  const sep = text.search(/^---\s*$/m);
  const head = sep === -1 ? text : text.slice(0, sep);
  const body = sep === -1 ? "" : text.slice(sep).replace(/^---\s*\n?/, "");
  const field = (name: string) => {
    const m = new RegExp(`^${name}:\\s*(.*)$`, "mi").exec(head);
    return m ? m[1].trim() : "";
  };
  // if the model ignored the format entirely, treat everything as body
  const hasHeader = /^(TITLE|DESCRIPTION):/im.test(head);
  return {
    title: field("TITLE"),
    description: field("DESCRIPTION"),
    slug: field("SLUG"),
    heroAlt: field("HERO_ALT"),
    body: (hasHeader ? body : text).trim(),
    complete: sep !== -1 || !hasHeader,
  };
}
