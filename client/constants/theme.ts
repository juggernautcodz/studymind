import { Platform } from "react-native";

const primaryBlue = "#2B4C7E";
const primaryBlueLight = "#4A6FA5";
const secondaryTerracotta = "#8B5E3C";
const backgroundSoft = "#F8F9FA";
const surfaceWhite = "#FFFFFF";
const textPrimary = "#1A1A1A";
const textSecondary = "#6B7280";
const border = "#E5E7EB";
const success = "#10B981";
const warning = "#F59E0B";
const error = "#EF4444";
const info = "#3B82F6";

export const Colors = {
  light: {
    text: textPrimary,
    textSecondary: textSecondary,
    buttonText: "#FFFFFF",
    tabIconDefault: textSecondary,
    tabIconSelected: primaryBlue,
    link: primaryBlue,
    linkLight: primaryBlueLight,
    accent: secondaryTerracotta,
    backgroundRoot: backgroundSoft,
    backgroundDefault: surfaceWhite,
    backgroundSecondary: "#F0F1F3",
    backgroundTertiary: "#E8E9EB",
    border: border,
    success: success,
    warning: warning,
    error: error,
    info: info,
    card: surfaceWhite,
    inputBackground: surfaceWhite,
    inputBorder: border,
    placeholder: textSecondary,
  },
  dark: {
    text: "#F1F5F9",
    textSecondary: "#94A3B8",
    buttonText: "#FFFFFF",
    tabIconDefault: "#94A3B8",
    tabIconSelected: "#9F67FF",
    link: "#7C3AED",
    linkLight: "#9F67FF",
    accent: "#06B6D4",
    backgroundRoot: "#0A0A0F",
    backgroundDefault: "#12121A",
    backgroundSecondary: "#1A1A27",
    backgroundTertiary: "#2A2A3F",
    border: "#2A2A3F",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#3B82F6",
    card: "#1A1A27",
    inputBackground: "#1A1A27",
    inputBorder: "#2A2A3F",
    placeholder: "#94A3B8",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  "6xl": 64,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
  full: 9999,
};

export const Typography = {
  display: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700" as const,
  },
  h1: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "600" as const,
  },
  h3: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500" as const,
  },
  link: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

export const Shadows = {
  sm: {
    elevation: 1,
  },
  md: {
    elevation: 2,
  },
  lg: {
    elevation: 4,
  },
};
