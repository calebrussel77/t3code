import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Usage progress line — mirrors the OpenUsage MetricLine "progress" shape
// ---------------------------------------------------------------------------

export const UsageProgressFormat = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("percent") }),
  Schema.Struct({ kind: Schema.Literal("dollars") }),
  Schema.Struct({
    kind: Schema.Literal("count"),
    suffix: Schema.String,
  }),
]);
export type UsageProgressFormat = typeof UsageProgressFormat.Type;

export const UsageProgressLine = Schema.Struct({
  label: Schema.String,
  used: Schema.Number,
  limit: Schema.Number,
  format: UsageProgressFormat,
  resetsAt: Schema.optional(Schema.String),
  periodDurationMs: Schema.optional(Schema.Number),
});
export type UsageProgressLine = typeof UsageProgressLine.Type;

// ---------------------------------------------------------------------------
// Provider usage snapshot
// ---------------------------------------------------------------------------

export const UsageProviderSnapshot = Schema.Struct({
  providerId: Schema.String,
  displayName: Schema.String,
  plan: Schema.optional(Schema.String),
  lines: Schema.Array(UsageProgressLine),
  fetchedAt: Schema.String,
});
export type UsageProviderSnapshot = typeof UsageProviderSnapshot.Type;

// ---------------------------------------------------------------------------
// RPC result
// ---------------------------------------------------------------------------

export const UsageResult = Schema.Struct({
  providers: Schema.Array(UsageProviderSnapshot),
});
export type UsageResult = typeof UsageResult.Type;

export class UsageError extends Schema.TaggedErrorClass<UsageError>()("UsageError", {
  message: Schema.String,
}) {}
