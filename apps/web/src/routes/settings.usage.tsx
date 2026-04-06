import { createFileRoute } from "@tanstack/react-router";

import { UsagePanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/usage")({
  component: UsagePanel,
});
