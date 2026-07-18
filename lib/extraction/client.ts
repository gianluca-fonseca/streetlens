/**
 * The vision model client — OpenAI Responses API, over plain fetch.
 *
 * NO SDK ON PURPOSE. The repo has no `openai` dependency and this needs exactly
 * one endpoint with one request shape. A dependency would buy retries and typing
 * we are writing anyway (the retry policy here is specific: only 429/5xx, and
 * bounded because every attempt costs money), and would hide the request body —
 * which is the thing the cost breaker exists to police. Explicit is cheaper to
 * audit than convenient.
 *
 * `VisionClient` is an interface so the worker tests inject a fake and drive the
 * real extraction logic — breaker, escalation, refusal handling — without a
 * network or a bill.
 */

import { HTTP_MAX_RETRIES, openaiApiKey } from "./config";
import { SYSTEM_PROMPT, USER_INSTRUCTION } from "./prompt";
import { observationResponseFormat } from "./schema";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

export type VisionRequest = {
  model: string;
  /**
   * The image to send, as extractFrame prepared it: a base64 JPEG data URL of
   * the frame downscaled to 512 px, NOT the public storage URL. See
   * lib/extraction/downscale.ts — sending the original and asking for
   * `detail: "low"` is what stopped working.
   */
  imageUrl: string;
};

export type VisionUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Prefix tokens served from the prompt cache, when the provider reports them. */
  cachedTokens: number;
};

/**
 * One model answer, already sorted into the four outcomes the worker cares
 * about. `usage` is present even on refusal and truncation — those are billed
 * too, and a breaker that only counts successes is not a breaker.
 */
export type VisionResponse = {
  outcome: "completed" | "refusal" | "incomplete" | "unparsable";
  /** The raw JSON text, on `completed`. */
  text: string | null;
  /** Why, on refusal/incomplete/unparsable. */
  detail: string | null;
  usage: VisionUsage;
};

export interface VisionClient {
  extract(request: VisionRequest): Promise<VisionResponse>;
}

/** A transport failure that survived the retry policy. */
export class VisionTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "VisionTransportError";
  }
}

/* ------------------------------------------------------------------ *
 * Retry policy
 * ------------------------------------------------------------------ */

/**
 * Retryable: rate limits and server faults. A 400 is our bug and repeats.
 *
 * The exception is `insufficient_quota`, which arrives as a 429 like an ordinary
 * rate limit but is nothing of the sort: the account is out of money, and no
 * amount of backing off will change that. Retrying it just spends the pump's
 * wall clock to arrive at the same answer three times, and buries the real cause
 * ("check your billing") under a generic unavailable message.
 */
export function isRetryable(status: number, body: string): boolean {
  if (status === 429) return !/insufficient_quota/i.test(body);
  return status >= 500 && status <= 599;
}

/**
 * Exponential backoff with full jitter: 0..base*2^n, capped.
 *
 * Jittered rather than fixed because p-limit releases eight slots at once, so
 * un-jittered retries would resynchronize into the same burst that caused the
 * 429 in the first place.
 */
export function backoffMs(attempt: number, rand: () => number): number {
  const base = 500;
  const capped = Math.min(base * 2 ** attempt, 8_000);
  return Math.floor(rand() * capped);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ *
 * Response parsing
 * ------------------------------------------------------------------ */

type ResponsesApiPayload = {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: {
    type?: string;
    content?: { type?: string; text?: string; refusal?: string }[];
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
};

function readUsage(payload: ResponsesApiPayload): VisionUsage {
  return {
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    cachedTokens: payload.usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Sort a raw Responses payload into an outcome.
 *
 * Exported for the tests, which need to prove that a refusal and a truncation
 * are distinguished from a good answer WITHOUT going near the network.
 */
export function parseVisionPayload(payload: ResponsesApiPayload): VisionResponse {
  const usage = readUsage(payload);

  // A refusal is a successful, billed response that contains no answer. It must
  // never be mistaken for a parse failure: the model understood and declined.
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal" && part.refusal) {
        return { outcome: "refusal", text: null, detail: part.refusal, usage };
      }
    }
  }

  if (payload.status === "incomplete") {
    return {
      outcome: "incomplete",
      text: null,
      detail: payload.incomplete_details?.reason ?? "incomplete",
      usage,
    };
  }

  const text = (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");

  if (!text) {
    return {
      outcome: "unparsable",
      text: null,
      detail: payload.error?.message ?? `no output_text (status ${payload.status ?? "unknown"})`,
      usage,
    };
  }

  return { outcome: "completed", text, detail: null, usage };
}

/* ------------------------------------------------------------------ *
 * The live client
 * ------------------------------------------------------------------ */

export type OpenAiVisionClientOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Injectable for deterministic backoff in tests. */
  rand?: () => number;
  sleepImpl?: (ms: number) => Promise<void>;
};

/**
 * Build the request body.
 *
 * Exported so a test can assert the two things that cost money: that
 * `detail: "low"` is actually sent, and that the cached prefix rides in
 * `instructions` (first position, byte-identical every call) rather than being
 * interpolated into the per-frame turn.
 *
 * Whatever `imageUrl` holds goes through verbatim. Bounding it is extractFrame's
 * job, not this function's.
 */
export function buildRequestBody(request: VisionRequest): Record<string, unknown> {
  return {
    model: request.model,
    // The static, cacheable prefix. First in the payload, and never templated.
    instructions: SYSTEM_PROMPT,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: USER_INSTRUCTION },
          {
            type: "input_image",
            image_url: request.imageUrl,
            // Belt, not braces. This hint has been measured being ignored (a
            // 200, a normal answer, full-resolution billing), so the braces are
            // the 512 px image we send it with — and the breaker in extract.ts,
            // which asserts what we were actually billed either way.
            detail: "low",
          },
        ],
      },
    ],
    text: { format: observationResponseFormat() },
    // NO `temperature`. The gpt-5 reasoning models reject it outright
    // ("Unsupported parameter: 'temperature' is not supported with this model")
    // and 400 the whole request, so sending it would fail every single call.
    // Determinism would have been nice for comparing re-runs; the strict schema
    // is what actually constrains the answer.
    store: false,
  };
}

export function createOpenAiVisionClient(
  options: OpenAiVisionClientOptions = {},
): VisionClient {
  const doFetch = options.fetchImpl ?? fetch;
  const rand = options.rand ?? Math.random;
  const doSleep = options.sleepImpl ?? sleep;

  return {
    async extract(request) {
      const apiKey = options.apiKey ?? openaiApiKey();
      if (!apiKey) throw new VisionTransportError("OPENAI_API_KEY is not configured");

      let lastError = "";
      let lastStatus: number | undefined;

      for (let attempt = 0; attempt < HTTP_MAX_RETRIES; attempt++) {
        if (attempt > 0) await doSleep(backoffMs(attempt, rand));

        let response: Response;
        try {
          response = await doFetch(RESPONSES_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(buildRequestBody(request)),
          });
        } catch (err) {
          // A network fault is retryable; a bad request is not, and would have
          // come back as a 4xx rather than a throw.
          lastError = err instanceof Error ? err.message : String(err);
          continue;
        }

        if (response.ok) {
          const payload = (await response.json()) as ResponsesApiPayload;
          return parseVisionPayload(payload);
        }

        lastStatus = response.status;
        lastError = await response.text().catch(() => response.statusText);
        if (!isRetryable(response.status, lastError)) {
          throw new VisionTransportError(
            `openai ${response.status}: ${lastError.slice(0, 500)}`,
            response.status,
          );
        }
      }

      throw new VisionTransportError(
        `openai unavailable after ${HTTP_MAX_RETRIES} attempts: ${lastError.slice(0, 500)}`,
        lastStatus,
      );
    },
  };
}
