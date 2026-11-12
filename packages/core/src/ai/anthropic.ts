import Anthropic from "@anthropic-ai/sdk";
import { AiError, makeStream, type AiStream, type StreamChatInput } from "./provider.ts";

let client: Anthropic | null = null;

// models that support the server-side refusal fallback (`fallbacks: "default"`)
const FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-fable-5-1",
  "claude-fable-5-2",
]);

function friendly(err: unknown): AiError {
  if (err instanceof Anthropic.AuthenticationError) return new AiError("Claude: de API-key is ongeldig.");
  if (err instanceof Anthropic.RateLimitError) return new AiError("Claude: limiet bereikt of tegoed op. Probeer het later opnieuw.");
  if (err instanceof Anthropic.NotFoundError) return new AiError("Claude: het ingestelde model bestaat niet (ANTHROPIC_MODEL).");
  if (err instanceof Anthropic.BadRequestError) return new AiError(`Claude: ongeldige aanvraag: ${err.message}`);
  if (err instanceof Anthropic.APIError) return new AiError(`Claude-fout (${err.status ?? "?"}): ${err.message}`);
  return new AiError("Kon Claude niet bereiken.");
}

export function streamAnthropic(input: StreamChatInput, model: string): AiStream {
  client ??= new Anthropic();
  return makeStream(async (emit) => {
    try {
      const stream = client!.beta.messages.stream({
        model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        // writing a draft is not a hard reasoning task: keep thinking light
        output_config: { effort: "medium" },
        ...(FALLBACK_MODELS.has(model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          emit(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        throw new AiError("Claude wilde dit verzoek niet uitvoeren. Formuleer het onderwerp anders.");
      }
      return {
        model: final.model,
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      };
    } catch (err) {
      throw err instanceof AiError ? err : friendly(err);
    }
  });
}
