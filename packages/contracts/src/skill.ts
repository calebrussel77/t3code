import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const SkillListInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
  provider: Schema.optional(Schema.Literals(["codex", "claudeAgent"])),
});
export type SkillListInput = typeof SkillListInput.Type;

export const ClaudeSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.Literals(["personal", "project"])),
});
export type ClaudeSkill = typeof ClaudeSkill.Type;

export const SkillListResult = Schema.Struct({
  skills: Schema.Array(ClaudeSkill),
});
export type SkillListResult = typeof SkillListResult.Type;

export class SkillListError extends Schema.TaggedErrorClass<SkillListError>()("SkillListError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {}
