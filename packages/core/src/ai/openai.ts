import OpenAI from "openai";
import { AiError, makeStream, type AiStream, type StreamChatInput } from "./provider.ts";

let client: OpenAI | null = null;

function friendly(err: unknown): AiError {
  if (err instanceof OpenAI.AuthenticationError) return new AiError("OpenAI: de API-key is ongeldig.");
  if (err instanceof OpenAI.RateLimitError) return new AiError("OpenAI: limiet bereikt of tegoed op. Probeer het later opnieuw.");
  if (err instanceof OpenAI.NotFoundError) return new AiError("OpenAI: het ingestelde model bestaat niet of je hebt er geen toegang toe (OPENAI_MODEL).");
  if (err instanceof OpenAI.APIError) return new AiError(`OpenAI-fout (${err.status ?? "?"}): ${err.message}`);
  return new AiError("Kon OpenAI niet bereiken.");
}

export function streamOpenAI(input: StreamChatInput, model: string): AiStream {
  client ??= new OpenAI();
  return makeStream(async (emit) => {
    try {
      const stream = client!.responses.stream({
        model,
        instructions: input.system,
        input: input.messages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: input.maxTokens,
      });
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") emit(event.delta);
      }
      const final = await stream.finalResponse();
      return {
        model,
        inputTokens: final.usage?.input_tokens ?? 0,
        outputTokens: final.usage?.output_tokens ?? 0,
      };
    } catch (err) {
      throw err instanceof AiError ? err : friendly(err);
    }
  });
}
