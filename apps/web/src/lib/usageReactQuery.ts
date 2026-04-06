import { queryOptions } from "@tanstack/react-query";
import { getWsRpcClient } from "../wsRpcClient";

export const usageQueryKeys = {
  all: ["usage"] as const,
  snapshots: () => ["usage", "snapshots"] as const,
};

export function usageSnapshotsQueryOptions() {
  return queryOptions({
    queryKey: usageQueryKeys.snapshots(),
    queryFn: async () => {
      const result = await getWsRpcClient().usage.getSnapshots();
      return result.providers;
    },
    staleTime: 0,
    refetchOnMount: "always" as const,
  });
}
