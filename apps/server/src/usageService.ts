import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Effect, Layer, ServiceMap } from "effect";
import { UsageError, type UsageProviderSnapshot, type UsageProgressLine } from "@t3tools/contracts";
import { ServerSettingsService } from "./serverSettings";
import { claudeSubscriptionLabel } from "./provider/Layers/ClaudeProvider";

const CLAUDE_CRED_PATH = path.join(os.homedir(), ".claude", ".credentials.json");
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_REFRESH_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const CODEX_AUTH_PATHS = [
  path.join(os.homedir(), ".config", "codex", "auth.json"),
  path.join(os.homedir(), ".codex", "auth.json"),
];

const SESSION_PERIOD_MS = 5 * 60 * 60 * 1000;
const WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function httpJson(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const resp = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const responseHeaders: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const body = await resp.json().catch(() => null);
    return { status: resp.status, body, headers: responseHeaders };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch a URL with an optional single token-refresh retry on 401/403.
 * Skips the retry if a proactive refresh already occurred (`didRefresh`).
 */
async function fetchWithAuthRetry<T>(opts: {
  url: string;
  buildHeaders: (token: string) => Record<string, string>;
  token: string;
  didRefresh: boolean;
  refreshToken: () => Promise<string | null>;
  parse: (resp: { status: number; body: unknown; headers: Record<string, string> }) => T;
}): Promise<T | null> {
  const resp = await httpJson(opts.url, {
    method: "GET",
    headers: opts.buildHeaders(opts.token),
    timeoutMs: 10_000,
  });

  if ((resp.status === 401 || resp.status === 403) && !opts.didRefresh) {
    const refreshed = await opts.refreshToken();
    if (!refreshed) return null;
    const retryResp = await httpJson(opts.url, {
      method: "GET",
      headers: opts.buildHeaders(refreshed),
      timeoutMs: 10_000,
    });
    if (retryResp.status < 200 || retryResp.status >= 300) return null;
    return opts.parse(retryResp);
  }

  if (resp.status < 200 || resp.status >= 300) return null;
  return opts.parse(resp);
}

function buildPercentLine(
  label: string,
  used: number,
  resetsAt: string | undefined,
  periodDurationMs: number,
): UsageProgressLine {
  return {
    label,
    used,
    limit: 100,
    format: { kind: "percent" },
    resetsAt,
    periodDurationMs,
  };
}

interface ClaudeOAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

async function loadClaudeCredentials(): Promise<{
  oauth: ClaudeOAuth;
  fullData: Record<string, unknown>;
} | null> {
  const data = (await readJsonFile(CLAUDE_CRED_PATH)) as Record<string, unknown> | null;
  if (!data) return null;
  const oauth = data.claudeAiOauth as ClaudeOAuth | undefined;
  if (!oauth?.accessToken) return null;
  return { oauth, fullData: data };
}

function claudeNeedsRefresh(oauth: ClaudeOAuth): boolean {
  if (!oauth.expiresAt) return false;
  return Date.now() >= oauth.expiresAt - REFRESH_BUFFER_MS;
}

async function refreshClaudeToken(
  oauth: ClaudeOAuth,
  fullData: Record<string, unknown>,
): Promise<string | null> {
  if (!oauth.refreshToken) return null;
  try {
    const resp = await httpJson(CLAUDE_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: CLAUDE_CLIENT_ID,
        scope: CLAUDE_SCOPES,
      }),
    });
    if (resp.status < 200 || resp.status >= 300) return null;
    const body = resp.body as Record<string, unknown>;
    const newToken = body.access_token as string | undefined;
    if (!newToken) return null;

    oauth.accessToken = newToken;
    if (body.refresh_token) oauth.refreshToken = body.refresh_token as string;
    if (typeof body.expires_in === "number") {
      oauth.expiresAt = Date.now() + (body.expires_in as number) * 1000;
    }
    fullData.claudeAiOauth = oauth;
    await fs.writeFile(CLAUDE_CRED_PATH, JSON.stringify(fullData), "utf-8").catch(() => {});
    return newToken;
  } catch {
    return null;
  }
}

async function fetchClaudeUsage(): Promise<UsageProviderSnapshot | null> {
  const creds = await loadClaudeCredentials();
  if (!creds) return null;

  let accessToken = creds.oauth.accessToken;
  let didRefresh = false;
  if (claudeNeedsRefresh(creds.oauth)) {
    const refreshed = await refreshClaudeToken(creds.oauth, creds.fullData);
    if (refreshed) {
      accessToken = refreshed;
      didRefresh = true;
    }
  }

  return fetchWithAuthRetry({
    url: CLAUDE_USAGE_URL,
    buildHeaders: (token) => ({
      Authorization: `Bearer ${token.trim()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": "oauth-2025-04-20",
    }),
    token: accessToken,
    didRefresh,
    refreshToken: () => refreshClaudeToken(creds.oauth, creds.fullData),
    parse: (resp) => parseClaudeUsageResponse(resp.body as Record<string, unknown>, creds.oauth),
  });
}

function parseResetAt(value: string | number | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  return new Date(value * 1000).toISOString();
}

function parseClaudeUsageResponse(
  data: Record<string, unknown>,
  oauth: ClaudeOAuth,
): UsageProviderSnapshot {
  const lines: UsageProgressLine[] = [];
  const fiveHour = data.five_hour as
    | { utilization?: number; resets_at?: string | number }
    | undefined;
  const sevenDay = data.seven_day as
    | { utilization?: number; resets_at?: string | number }
    | undefined;

  if (fiveHour && typeof fiveHour.utilization === "number") {
    lines.push(
      buildPercentLine(
        "Session",
        fiveHour.utilization,
        parseResetAt(fiveHour.resets_at),
        SESSION_PERIOD_MS,
      ),
    );
  }
  if (sevenDay && typeof sevenDay.utilization === "number") {
    lines.push(
      buildPercentLine(
        "Weekly",
        sevenDay.utilization,
        parseResetAt(sevenDay.resets_at),
        WEEKLY_PERIOD_MS,
      ),
    );
  }

  let plan = claudeSubscriptionLabel(oauth.subscriptionType) ?? null;
  if (plan && oauth.rateLimitTier) {
    const tierMatch = String(oauth.rateLimitTier).match(/(\d+)x/);
    if (tierMatch) plan = `${plan} ${tierMatch[1]}x`;
  }

  return {
    providerId: "claude",
    displayName: "Claude",
    plan: plan ?? undefined,
    lines,
    fetchedAt: new Date().toISOString(),
  };
}

interface CodexAuth {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  OPENAI_API_KEY?: string;
  last_refresh?: string;
}

async function loadCodexAuth(
  customHomePath?: string,
): Promise<{ auth: CodexAuth; authPath: string | null } | null> {
  const paths = customHomePath ? [path.join(customHomePath, "auth.json")] : CODEX_AUTH_PATHS;

  for (const authPath of paths) {
    const data = (await readJsonFile(authPath)) as CodexAuth | null;
    if (data?.tokens?.access_token) {
      return { auth: data, authPath };
    }
  }
  return null;
}

function codexNeedsRefresh(auth: CodexAuth): boolean {
  if (!auth.last_refresh) return true;
  const lastMs = Date.parse(auth.last_refresh);
  if (!Number.isFinite(lastMs)) return true;
  return Date.now() - lastMs > CODEX_REFRESH_AGE_MS;
}

async function refreshCodexToken(auth: CodexAuth, authPath: string | null): Promise<string | null> {
  if (!auth.tokens?.refresh_token) return null;
  try {
    const resp = await httpJson(CODEX_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=refresh_token&client_id=${encodeURIComponent(CODEX_CLIENT_ID)}&refresh_token=${encodeURIComponent(auth.tokens.refresh_token)}`,
    });
    if (resp.status < 200 || resp.status >= 300) return null;
    const body = resp.body as Record<string, unknown>;
    const newToken = body.access_token as string | undefined;
    if (!newToken) return null;

    auth.tokens.access_token = newToken;
    if (body.refresh_token) auth.tokens.refresh_token = body.refresh_token as string;
    if (body.id_token && auth.tokens) {
      (auth.tokens as Record<string, unknown>).id_token = body.id_token;
    }
    auth.last_refresh = new Date().toISOString();

    if (authPath) {
      await fs.writeFile(authPath, JSON.stringify(auth, null, 2), "utf-8").catch(() => {});
    }
    return newToken;
  } catch {
    return null;
  }
}

async function fetchCodexUsage(customHomePath?: string): Promise<UsageProviderSnapshot | null> {
  const authState = await loadCodexAuth(customHomePath);
  if (!authState?.auth.tokens?.access_token) return null;

  const { auth, authPath } = authState;
  let accessToken = auth.tokens!.access_token!;
  const accountId = auth.tokens!.account_id;
  let didRefresh = false;

  if (codexNeedsRefresh(auth)) {
    const refreshed = await refreshCodexToken(auth, authPath);
    if (refreshed) {
      accessToken = refreshed;
      didRefresh = true;
    }
  }

  const extraHeaders: Record<string, string> = {};
  if (accountId) extraHeaders["ChatGPT-Account-Id"] = accountId;

  return fetchWithAuthRetry({
    url: CODEX_USAGE_URL,
    buildHeaders: (token) => ({
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...extraHeaders,
    }),
    token: accessToken,
    didRefresh,
    refreshToken: () => refreshCodexToken(auth, authPath),
    parse: (resp) => parseCodexUsageResponse(resp),
  });
}

function parseCodexUsageResponse(resp: {
  body: unknown;
  headers: Record<string, string>;
}): UsageProviderSnapshot {
  const data = resp.body as Record<string, unknown>;
  const lines: UsageProgressLine[] = [];

  const nowSec = Math.floor(Date.now() / 1000);
  const rateLimit = data.rate_limit as Record<string, unknown> | undefined;
  const primaryWindow = rateLimit?.primary_window as Record<string, unknown> | undefined;
  const secondaryWindow = rateLimit?.secondary_window as Record<string, unknown> | undefined;

  const headerPrimary = parsePercent(resp.headers["x-codex-primary-used-percent"]);
  const headerSecondary = parsePercent(resp.headers["x-codex-secondary-used-percent"]);

  const sessionUsed = headerPrimary ?? (primaryWindow?.used_percent as number | undefined);
  if (typeof sessionUsed === "number") {
    lines.push(
      buildPercentLine(
        "Session",
        sessionUsed,
        getResetIso(nowSec, primaryWindow),
        SESSION_PERIOD_MS,
      ),
    );
  }

  const weeklyUsed = headerSecondary ?? (secondaryWindow?.used_percent as number | undefined);
  if (typeof weeklyUsed === "number") {
    lines.push(
      buildPercentLine(
        "Weekly",
        weeklyUsed,
        getResetIso(nowSec, secondaryWindow),
        WEEKLY_PERIOD_MS,
      ),
    );
  }

  return {
    providerId: "codex",
    displayName: "Codex",
    plan: data.plan_type
      ? (claudeSubscriptionLabel(data.plan_type as string) ?? undefined)
      : undefined,
    lines,
    fetchedAt: new Date().toISOString(),
  };
}

function parsePercent(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getResetIso(
  nowSec: number,
  window: Record<string, unknown> | undefined,
): string | undefined {
  if (!window) return undefined;
  if (typeof window.reset_at === "number") {
    return new Date((window.reset_at as number) * 1000).toISOString();
  }
  if (typeof window.reset_after_seconds === "number") {
    return new Date((nowSec + (window.reset_after_seconds as number)) * 1000).toISOString();
  }
  return undefined;
}

export interface UsageServiceShape {
  readonly getSnapshots: Effect.Effect<
    { readonly providers: readonly UsageProviderSnapshot[] },
    UsageError
  >;
}

export class UsageService extends ServiceMap.Service<UsageService, UsageServiceShape>()(
  "t3/usage/UsageService",
) {}

const makeUsageService = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;

  return {
    getSnapshots: Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(() => new UsageError({ message: "Failed to read server settings" })),
      );

      const codexHomePath = settings.providers.codex.homePath || undefined;

      const results = yield* Effect.tryPromise({
        try: () => Promise.allSettled([fetchClaudeUsage(), fetchCodexUsage(codexHomePath)]),
        catch: () => new UsageError({ message: "Failed to fetch usage data" }),
      });

      const providers: UsageProviderSnapshot[] = [];
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          providers.push(result.value);
        }
      }
      return { providers };
    }),
  } satisfies UsageServiceShape;
});

export const UsageServiceLive = Layer.effect(UsageService, makeUsageService);
