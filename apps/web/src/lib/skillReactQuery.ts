import type { ProviderKind } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const skillQueryKeys = {
  all: ["skills"] as const,
  list: (cwd: string | null, provider: ProviderKind) => ["skills", "list", cwd, provider] as const,
};

const SKILL_LIST_STALE_TIME = 300_000; // 5 minutes

export function skillListQueryOptions(input: {
  cwd: string | null;
  provider: ProviderKind;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: skillQueryKeys.list(input.cwd, input.provider),
    queryFn: async () => {
      const api = ensureNativeApi();
      const result = await api.skills.list({
        cwd: input.cwd ?? undefined,
        provider: input.provider,
      });
      return { skills: [...result.skills] };
    },
    enabled: input.enabled ?? true,
    staleTime: SKILL_LIST_STALE_TIME,
  });
}
