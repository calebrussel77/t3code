import { Schema } from "effect";
import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
} from "@t3tools/contracts/settings";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";

export const MIN_FONT_SIZE_PX = 10;
export const MAX_FONT_SIZE_PX = 24;
const DEFAULT_RENDERED_UI_FONT_SIZE_PX = 16;

export type AppearanceSettings = Pick<
  ClientSettings,
  "uiFontFamily" | "codeFontFamily" | "uiFontSizePx" | "codeFontSizePx"
>;

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  uiFontFamily: DEFAULT_CLIENT_SETTINGS.uiFontFamily,
  codeFontFamily: DEFAULT_CLIENT_SETTINGS.codeFontFamily,
  uiFontSizePx: DEFAULT_CLIENT_SETTINGS.uiFontSizePx,
  codeFontSizePx: DEFAULT_CLIENT_SETTINGS.codeFontSizePx,
};

export function pickAppearanceSettings(settings: AppearanceSettings): AppearanceSettings {
  return {
    uiFontFamily: settings.uiFontFamily,
    codeFontFamily: settings.codeFontFamily,
    uiFontSizePx: settings.uiFontSizePx,
    codeFontSizePx: settings.codeFontSizePx,
  };
}

export function sanitizeFontFamily(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function sanitizeFontSizePx(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value * 2) / 2;
  return Math.min(Math.max(rounded, MIN_FONT_SIZE_PX), MAX_FONT_SIZE_PX);
}

export function formatFontSizeInputValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function applyAppearanceSettings(settings: AppearanceSettings): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const sanitizedUiFontSizePx = sanitizeFontSizePx(
    settings.uiFontSizePx,
    DEFAULT_APPEARANCE_SETTINGS.uiFontSizePx,
  );
  const sanitizedCodeFontSizePx = sanitizeFontSizePx(
    settings.codeFontSizePx,
    DEFAULT_APPEARANCE_SETTINGS.codeFontSizePx,
  );
  root.style.setProperty(
    "--app-ui-font-family",
    sanitizeFontFamily(settings.uiFontFamily, DEFAULT_APPEARANCE_SETTINGS.uiFontFamily),
  );
  root.style.setProperty(
    "--app-code-font-family",
    sanitizeFontFamily(settings.codeFontFamily, DEFAULT_APPEARANCE_SETTINGS.codeFontFamily),
  );
  root.style.setProperty("--app-ui-font-size", `${sanitizedUiFontSizePx}px`);
  root.style.setProperty(
    "--app-ui-font-scale",
    String(sanitizedUiFontSizePx / DEFAULT_APPEARANCE_SETTINGS.uiFontSizePx),
  );
  root.style.setProperty("--app-code-font-size", `${sanitizedCodeFontSizePx}px`);
  root.style.setProperty("--app-rendered-ui-font-size", `${DEFAULT_RENDERED_UI_FONT_SIZE_PX}px`);
}

export function loadPersistedAppearanceSettings(): AppearanceSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APPEARANCE_SETTINGS;
  }

  try {
    const raw = localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_APPEARANCE_SETTINGS;
    }

    const decoded = Schema.decodeUnknownSync(ClientSettingsSchema)(JSON.parse(raw));
    return pickAppearanceSettings(decoded);
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
}
