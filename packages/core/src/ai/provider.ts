/**
 * Provider-neutral streaming chat for the writing assistant.
 * OpenAI and Claude are interchangeable; "mock" returns canned text for local testing.
 */
import type { AiMessage } from "../schema.ts";

export type AiProviderName = "openai" | "anthropic" | "mock";

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StreamChatInput {
  system: string;
  messages: AiMessage[];
  maxTokens: number;
}

export interface AiStream {
  /** text deltas as they arrive */
  text: AsyncGenerator<string>;
  /** resolves after the stream is fully consumed */
  usage: Promise<AiUsage>;
}

/** user-facing error (Dutch, shown in the admin) */
export class AiError extends Error {}

export const PROVIDER_LABELS: Record<AiProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Claude",
  mock: "Test (geen echte AI)",
};

export function modelFor(provider: AiProviderName): string {
  if (provider === "openai") return process.env.OPENAI_MODEL || "gpt-6.1-terra";
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  return "mock";
}

/** providers that have a key configured (mock is offered when nothing else is, or when chosen explicitly) */
export function availableProviders(): AiProviderName[] {
  const list: AiProviderName[] = [];
  if (process.env.OPENAI_API_KEY) list.push("openai");
  if (process.env.ANTHROPIC_API_KEY) list.push("anthropic");
  if (list.length === 0 || process.env.AI_PROVIDER === "mock") list.push("mock");
  return list;
}

export function defaultProvider(): AiProviderName {
  const available = availableProviders();
  const wanted = process.env.AI_PROVIDER as AiProviderName | undefined;
  if (wanted && available.includes(wanted)) return wanted;
  return available[0];
}

export async function streamChat(provider: AiProviderName, input: StreamChatInput): Promise<AiStream> {
  if (!availableProviders().includes(provider)) {
    throw new AiError(`${PROVIDER_LABELS[provider]} is niet ingesteld (API-key ontbreekt in .env).`);
  }
  if (provider === "openai") return (await import("./openai.ts")).streamOpenAI(input, modelFor("openai"));
  if (provider === "anthropic") return (await import("./anthropic.ts")).streamAnthropic(input, modelFor("anthropic"));
  return (await import("./mock.ts")).streamMock(input);
}

/** helper: turn a producer into { text, usage } */
export function makeStream(
  produce: (emit: (chunk: string) => void) => Promise<AiUsage>,
): AiStream {
  const queue: string[] = [];
  let done = false;
  let failure: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const usage = produce((chunk) => {
    queue.push(chunk);
    notify();
  }).then(
    (u) => {
      done = true;
      notify();
      return u;
    },
    (err) => {
      failure = err;
      done = true;
      notify();
      throw err;
    },
  );
  usage.catch(() => undefined); // surfaced through the generator instead
  async function* text() {
    while (true) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (done) {
        if (failure) throw failure;
        return;
      }
      await new Promise<void>((r) => (wake = r));
    }
  }
  return { text: text(), usage };
}
