/** canned streaming output for local testing without an API key */
import { makeStream, type AiStream, type StreamChatInput } from "./provider.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function streamMock(input: StreamChatInput): AiStream {
  const last = input.messages[input.messages.length - 1]?.content ?? "";
  const revision = input.messages.length > 1;
  const nl = /Write the draft in Dutch/.test(input.system) || /Translate .* into Dutch/.test(input.system);
  const text = nl
    ? `TITLE: ${revision ? "Paniek in de rij bij de supermarkt (herzien)" : "Paniek in de rij bij de supermarkt"}
DESCRIPTION: Een persoonlijk verhaal over een paniekaanval in een lange rij bij de supermarkt, en wat mij hielp om er doorheen te komen zonder weg te rennen.
SLUG: paniek-in-de-rij-bij-de-supermarkt
HERO_ALT: Lange rij bij de kassa van een drukke supermarkt
---
Het was zaterdagmiddag en de Albert Heijn was afgeladen. [[Jouw detail: wat lag er in je mandje?]]

## Vast in de rij

Er stonden zeker acht mensen voor me. Mijn hartslag ging omhoog.

## Wat mij hielp

Ik voelde mijn voeten op de grond en telde mijn ademhaling.${revision ? `\n\n_(aangepast op verzoek: ${last.slice(0, 60)})_` : ""}`
    : `TITLE: ${revision ? "Panic in the grocery store line (revised)" : "Panic in the grocery store line"}
DESCRIPTION: A personal story about a panic attack in a long line at a busy grocery store, and what helped me get through it without running out.
SLUG: panic-in-the-grocery-store-line
HERO_ALT: Long line at the checkout of a busy grocery store
---
It was Saturday afternoon and Target was packed. [[Your detail: what was in your cart?]]

## Stuck in line

There were at least eight people ahead of me. My heart started racing.

## What helped me

I felt my feet on the floor and counted my breaths.${revision ? `\n\n_(revised on request: ${last.slice(0, 60)})_` : ""}`;
  return makeStream(async (emit) => {
    for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) {
      emit(piece);
      await sleep(15);
    }
    return { model: "mock", inputTokens: Math.round(input.system.length / 4), outputTokens: Math.round(text.length / 4) };
  });
}
