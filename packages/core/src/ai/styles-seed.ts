/**
 * Starter writing styles for the assistant. Inserted once per database (seed marker
 * "writing_styles"); editable in the admin afterwards, and deleting them is permanent. Instructions are English because
 * they go straight into the system prompt; the AI still writes in the draft language.
 */
import { count } from "drizzle-orm";
import { writingStyles } from "../schema.ts";
import { seedOnce } from "../seed.ts";

export const DEFAULT_STYLE_KEY = "mick";

export interface StyleSeed {
  key: string;
  name: string;
  description: string;
  instructions: string;
  useVoiceSamples: boolean;
}

/** Mick's own voice, distilled from his posts; also the fallback when no style row exists */
export const MICK_STYLE: StyleSeed = {
  key: DEFAULT_STYLE_KEY,
  name: "Mick (eigen stijl)",
  description: "Eerlijk en concreet, lichaam en gedachten in het moment, een beetje humor. Leert van je eigen nieuwste blogs.",
  useVoiceSamples: true,
  instructions: `Voice and style (learned from the author's own posts):
- Start in the middle of the moment: where am I, what am I doing, one small ordinary detail (what I just bought, the song that was playing, the weather).
- Describe the body and the mind concretely: racing heart, heat rising, tunnel vision, muscles tensing, the urge to flee, the thoughts that talk me into the panic ("what if I faint right here?").
- Honest and a bit vulnerable: doubt, embarrassment, what other people might think ("going to the restroom again after twenty minutes would look weird"), small humor allowed.
- Plain spoken language, short paragraphs, varied sentence length. Subheadings describe the situation ("Stuck between strangers on the train"), not generic labels.`,
};

export const STYLE_SEEDS: StyleSeed[] = [
  MICK_STYLE,
  {
    key: "raw",
    name: "Rauw en direct",
    description: "Korte zinnen, geen opsmuk, recht voor z'n raap. Weinig uitleg, veel impact.",
    useVoiceSamples: false,
    instructions: `Voice: raw and direct.
- Short, blunt sentences. Fragments are fine. No softening words, no decoration, no metaphors unless they hit hard.
- Say exactly what happened and what it felt like, including the ugly and embarrassing parts.
- Hardly any explaining or reflecting while it happens; the reader feels it through facts and sensations.
- Subheadings are short and punchy (two to five words).`,
  },
  {
    key: "diary",
    name: "Dagboek",
    description: "Losse notities in de tegenwoordige tijd, alsof het vanavond is opgeschreven.",
    useVoiceSamples: false,
    instructions: `Form: diary entries.
- Written as personal diary notes, present tense or very recent past ("today", "tonight", "right now"), as if written the same day.
- Subheadings are entry markers with a day or moment (for example "Tuesday, 11:40 pm" or "The next morning"), 3 to 5 entries spread over the situation and the days after.
- Informal, unpolished, thoughts can jump; the writer talks to themselves, sometimes asks themselves questions.
- The reflection grows over the entries; the last entry shows where the writer is now.`,
  },
  {
    key: "minute-by-minute",
    name: "Minuut voor minuut",
    description: "Tijdstempels (14:02, 14:05...) waardoor de spanning oploopt. Voelt als een live verslag.",
    useVoiceSamples: false,
    instructions: `Form: minute by minute.
- Tell the moment as a timeline. Subheadings are timestamps (for example "14:02", "14:05", "14:11"), with more timestamps close together at the peak.
- Present tense, short paragraphs per timestamp, rising tension: each step shows what changes in the body, the thoughts and the surroundings.
- After the peak the timestamps spread out ("15:30", "That evening") for how it ended and the reflection.
- Keep the "what helps me" part as the final section, still under a time marker (for example "Now").`,
  },
  {
    key: "self-mockery",
    name: "Met zelfspot",
    description: "Luchtig en grappig over iets zwaars, zonder het weg te lachen.",
    useVoiceSamples: false,
    instructions: `Voice: light and self-mocking.
- Warm, dry humor about my own reactions and the absurdity of what my brain does ("my body decided the cereal aisle was a life-threatening situation").
- Laugh at the situation and at myself, never at the condition or at other people who struggle. The fear itself is taken seriously: at the peak the humor drops away for a moment.
- Conversational, as if telling a friend over coffee. Playful subheadings.
- End honest and hopeful, the humor shows how I learned to live with it.`,
  },
  {
    key: "reflective",
    name: "Beschouwend",
    description: "Rustiger tempo, beelden en metaforen, meer gedachten over wat het betekent.",
    useVoiceSamples: false,
    instructions: `Voice: calm and reflective.
- Slower pace, longer and flowing sentences alternated with short ones. Room for images and metaphors (fog, a glass wall, a wave) that make an inner experience visible.
- Next to what happened, think about what it means: why this moment, what it says about me, what I understand now.
- Literary but still plain words; no pompous language, no philosophy lecture.
- Subheadings are evocative images or questions.`,
  },
  {
    key: "looking-back",
    name: "Terugblik",
    description: "Jaren later teruggekeken: wijsheid achteraf en hoe ik er nu naar kijk.",
    useVoiceSamples: false,
    instructions: `Perspective: looking back years later.
- The writer looks back on the situation from some years later (pick a believable distance, for example three or five years). Past tense for then, present tense for now.
- Switch between the scene back then, told concretely, and how I see it now ("back then I thought..., now I know...").
- Gentle toward my younger self, without pretending everything is solved.
- The last part is about the difference between then and now and what got me there.`,
  },
  {
    key: "letter",
    name: "Brief",
    description: "Een brief aan mezelf van toen, of aan de angst zelf ('Beste paniek, ...').",
    useVoiceSamples: false,
    instructions: `Form: a letter.
- The whole post is a letter, written by me. Choose the addressee that fits best: my younger self ("Dear me, on that platform...") or the fear itself ("Dear panic,"), unless the author's wishes say otherwise.
- Use "you" for the addressee and "I" for myself; tell the situation through the letter ("You remember the concert...").
- Start the body with the salutation, end with a short closing and signature line (a first name or "me").
- Subheadings are allowed as quiet section markers inside the letter.`,
  },
  {
    key: "observer",
    name: "Nuchtere observator",
    description: "Droog en precies, alsof je jezelf van een afstandje bekijkt. Analytisch, zonder drama.",
    useVoiceSamples: false,
    instructions: `Voice: the sober observer.
- Dry, precise and a bit detached, as if I watch myself from a distance and take notes. Exact numbers and details (heart rate, minutes, number of people in line).
- Name each step of the mechanism as I notice it: trigger, first sensation, thought, reaction. Still in plain words, never clinical jargon.
- Understatement instead of drama; the intensity shows because the calm tone cracks at the peak.
- Subheadings are factual and short.`,
  },
  {
    key: "recovery",
    name: "Herstelverhaal",
    description: "De nadruk op de weg omhoog: kleine stappen, terugvallen en hoop.",
    useVoiceSamples: false,
    instructions: `Focus: recovery.
- The situation is a moment on the road to recovery: either a setback or a small victory (for example doing something again that used to be impossible).
- Show the steps that led here, including what didn't work and the setbacks along the way. Small concrete wins count.
- Hopeful but realistic: progress is not a straight line, there is no final cure.
- Subheadings mark the steps of the road.`,
  },
];

export async function seedWritingStyles(): Promise<number> {
  return seedOnce("writing_styles", async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(writingStyles);
    if (n > 0) return 0;
    const rows = STYLE_SEEDS.map((s, i) => ({ ...s, sortOrder: i }));
    await tx.insert(writingStyles).values(rows);
    return rows.length;
  });
}
