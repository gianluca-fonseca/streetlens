/**
 * The strict JSON schema the vision model is forced to fill.
 *
 * DERIVED from RUBRIC_ITEM_KEYS / RUBRIC_ITEM_RESPONSE_TYPES rather than written
 * out by hand. Hand-writing it would mean the rubric lives in two places, and
 * the first time an item is added the model would keep answering the old shape
 * while zod rejected every response — a failure that looks like a model problem
 * and is not. Adding an item to lib/capture/types.ts updates this automatically.
 *
 * `strict: true` on the Responses API guarantees the shape, so the model cannot
 * omit an item, invent one, or return prose. It does NOT guarantee the semantics
 * (a 7 where the rubric allows 0-4 is still possible in principle), so
 * lib/capture/schemas.ts re-validates everything on the way in. Two layers,
 * because only one of them is ours.
 */

import {
  CAPTURE_SCHEMA_VERSION,
  RUBRIC_ITEM_KEYS,
  RUBRIC_ITEM_RESPONSE_TYPES,
  type RubricItemKey,
} from "@/lib/capture/types";

/** A JSON Schema fragment. Loose by design — this is wire format, not a type. */
type JsonSchema = Record<string, unknown>;

/**
 * The value schema for one item, by response type.
 *
 * Every value is nullable because "not assessable from this frame" is a real
 * answer the rubric wants (types.ts is explicit that null is not a zero). Under
 * `strict`, nullability must be expressed as a type union — an omitted field is
 * not permitted, so without this the model would be forced to invent a number
 * for a crossing that is behind the camera.
 */
function itemValueSchema(key: RubricItemKey): JsonSchema {
  switch (RUBRIC_ITEM_RESPONSE_TYPES[key]) {
    case "boolean":
      return {
        type: ["integer", "null"],
        enum: [0, 1, null],
        description: "1 = present/yes, 0 = absent/no, null = not assessable from this frame.",
      };
    case "scale_0_4":
      return {
        type: ["integer", "null"],
        enum: [0, 1, 2, 3, 4, null],
        description:
          "0-4 against the rubric anchors in the system prompt (4 is best), null = not assessable from this frame.",
      };
    case "percent":
      return {
        type: ["number", "null"],
        description: "0-100 percent, null = not assessable from this frame.",
      };
  }
}

function itemSchema(key: RubricItemKey): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence"],
    properties: {
      value: itemValueSchema(key),
      confidence: {
        type: "number",
        description:
          "0..1, your own certainty in this value for this frame. Be honest: a low number is useful, a confident guess is not.",
      },
    },
  };
}

/** The full response schema: exactly the 15 items, plus quality and provenance. */
export function buildObservationJsonSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const key of RUBRIC_ITEM_KEYS) {
    properties[key] = itemSchema(key);
  }

  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "items", "frameQuality"],
    properties: {
      schemaVersion: {
        type: "string",
        enum: [CAPTURE_SCHEMA_VERSION],
      },
      items: {
        type: "object",
        additionalProperties: false,
        // strict mode requires EVERY property to be listed as required.
        required: [...RUBRIC_ITEM_KEYS],
        properties,
      },
      frameQuality: {
        type: "object",
        additionalProperties: false,
        required: ["usable", "reason"],
        properties: {
          usable: {
            type: "boolean",
            description:
              "false when the frame cannot be scored at all: motion blur, lens flare, an obstruction filling the shot, or no street visible.",
          },
          reason: {
            type: ["string", "null"],
            description:
              'Short machine-ish reason when usable is false, e.g. "motion_blur". null when usable.',
          },
        },
      },
    },
  };
}

/**
 * The `text.format` block for a Responses API call.
 *
 * `model` is deliberately absent from the schema: it is provenance we already
 * know (we chose it), and asking the model to report its own id invites it to
 * confabulate one. The worker stamps it after parsing.
 */
export function observationResponseFormat() {
  return {
    type: "json_schema" as const,
    name: "street_audit_observation",
    strict: true,
    schema: buildObservationJsonSchema(),
  };
}
