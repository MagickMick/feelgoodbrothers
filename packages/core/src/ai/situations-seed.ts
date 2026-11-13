/**
 * Starter list of recognisable situations per category. Inserted once (when the
 * table is empty); editable in the admin afterwards.
 */
import { count } from "drizzle-orm";
import { getDb } from "../db.ts";
import { categories, situations } from "../schema.ts";

type Seed = [en: string, nl: string];

const SEED: Record<string, Seed[]> = {
  "panic-attacks": [
    ["Standing in a packed crowd at a concert", "Midden in een volle zaal bij een concert"],
    ["A crowded subway car at rush hour", "Een volle trein in de spits"],
    ["A long line at a busy grocery store checkout", "Een lange rij bij de kassa van een drukke supermarkt"],
    ["Giving a presentation or speaking up in a work meeting", "Een presentatie of vergadering op het werk"],
    ["Driving on the freeway at night or in heavy rain", "Op de snelweg in het donker of in de stromende regen"],
    ["Lying back in the dentist's chair", "In de stoel bij de tandarts"],
    ["A birthday party with lots of people in a small room", "Een verjaardag met veel mensen in een kleine kamer"],
    ["Waking up alone in the middle of the night", "Midden in de nacht alleen wakker worden"],
    ["The morning after a night out", "De ochtend na een avond stappen"],
    ["Sitting on a plane waiting for takeoff", "In het vliegtuig wachten tot het opstijgt"],
  ],
  anxiety: [
    ["Waiting for medical test results", "Wachten op de uitslag van een onderzoek"],
    ["A phone call you keep putting off", "Een telefoontje dat je steeds uitstelt"],
    ["The first day at a new job", "De eerste dag bij een nieuwe baan"],
    ["A party where you hardly know anyone", "Een feestje waar je bijna niemand kent"],
    ["Googling a physical symptom late at night", "'s Avonds laat een lichamelijke klacht googelen"],
    ["The Sunday evening dread before the work week", "Het zondagavondgevoel voor de werkweek"],
    ["A job interview", "Een sollicitatiegesprek"],
    ["A text message that stays unanswered", "Een appje dat onbeantwoord blijft"],
  ],
  derealization: [
    ["Under the bright lights of a supermarket", "Onder het felle licht in de supermarkt"],
    ["Looking in the mirror and not recognising yourself", "In de spiegel kijken en jezelf niet herkennen"],
    ["Driving a route you know by heart", "Een route rijden die je uit je hoofd kent"],
    ["At work after a night of bad sleep", "Op het werk na een nacht slecht slapen"],
    ["In the middle of a conversation with a friend", "Midden in een gesprek met een vriend"],
    ["Walking through a busy city center", "Door een drukke binnenstad lopen"],
  ],
  "high-sensitivity": [
    ["A crowded Christmas market", "Een drukke kerstmarkt"],
    ["A noisy open-plan office", "Een lawaaierige kantoortuin"],
    ["A long family dinner", "Een lang familiediner"],
    ["A shopping mall on a Saturday", "Een winkelcentrum op zaterdag"],
    ["A music festival", "Een festival"],
    ["A kids' birthday party", "Een kinderfeestje"],
  ],
  depression: [
    ["Trying to get out of bed on a workday", "Proberen op te staan op een werkdag"],
    ["Canceling plans with friends again", "Weer afzeggen bij vrienden"],
    ["When doing groceries feels impossible", "Als boodschappen doen onmogelijk voelt"],
    ["The holidays when everyone else seems happy", "De feestdagen terwijl iedereen vrolijk lijkt"],
    ["Telling someone about it for the first time", "Het voor het eerst aan iemand vertellen"],
    ["The first good day in weeks", "De eerste goede dag in weken"],
  ],
  mindfulness: [
    ["Using your senses to ground yourself during panic", "Je zintuigen gebruiken om te aarden tijdens paniek"],
    ["A walk outside after a stressful day", "Een wandeling buiten na een stressvolle dag"],
    ["Noticing an old thought pattern as it happens", "Een oud gedachtepatroon herkennen terwijl het gebeurt"],
  ],
  mindset: [
    ["Choosing not to avoid a situation that scares you", "Ervoor kiezen een enge situatie niet te vermijden"],
    ["Taking responsibility for a strong emotion", "Verantwoordelijkheid nemen voor een sterke emotie"],
  ],
  meditation: [["Meditating while your mind won't stop racing", "Mediteren terwijl je hoofd blijft malen"]],
  yoga: [["Your first yoga class", "Je eerste yogales"]],
  addiction: [
    ["Saying no to a drink at a party", "Nee zeggen tegen een drankje op een feest"],
    ["The first sober weekend", "Het eerste nuchtere weekend"],
  ],
};

export async function seedSituations(): Promise<number> {
  const db = getDb();
  const [{ n }] = await db.select({ n: count() }).from(situations);
  if (n > 0) return 0;
  const cats = await db.select().from(categories);
  const rows = Object.entries(SEED).flatMap(([slugEn, list]) => {
    const cat = cats.find((c) => c.slugEn === slugEn);
    return cat ? list.map(([labelEn, labelNl], i) => ({ categoryId: cat.id, labelEn, labelNl, sortOrder: i })) : [];
  });
  if (rows.length) await db.insert(situations).values(rows);
  return rows.length;
}
