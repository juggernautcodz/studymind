import { I18n } from "i18n-js";
import * as Localization from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager } from "react-native";

const en = require("./locales/en.json");
const es = require("./locales/es.json");
const fr = require("./locales/fr.json");
const de = require("./locales/de.json");
const pt = require("./locales/pt.json");
const it = require("./locales/it.json");
const zh = require("./locales/zh.json");
const ja = require("./locales/ja.json");
const ko = require("./locales/ko.json");
const ar = require("./locales/ar.json");
const hi = require("./locales/hi.json");
const ru = require("./locales/ru.json");

const LANGUAGE_STORAGE_KEY = "@studymind_language";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिंदी" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const i18n = new I18n({
  en,
  es,
  fr,
  de,
  pt,
  it,
  zh,
  ja,
  ko,
  ar,
  hi,
  ru,
});

i18n.defaultLocale = "en";
i18n.enableFallback = true;

function getDeviceLanguage(): LanguageCode {
  const deviceLocale = Localization.getLocales()[0]?.languageCode || "en";
  const supportedCodes = SUPPORTED_LANGUAGES.map((l) => l.code);

  if (supportedCodes.includes(deviceLocale as LanguageCode)) {
    return deviceLocale as LanguageCode;
  }

  return "en";
}

export async function initializeLanguage(): Promise<LanguageCode> {
  try {
    const savedLanguage = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (
      savedLanguage &&
      SUPPORTED_LANGUAGES.some((l) => l.code === savedLanguage)
    ) {
      i18n.locale = savedLanguage;
      const shouldBeRTL = savedLanguage === "ar";
      if (I18nManager.isRTL !== shouldBeRTL) {
        I18nManager.forceRTL(shouldBeRTL);
        I18nManager.allowRTL(shouldBeRTL);
      }
      return savedLanguage as LanguageCode;
    }
  } catch (error) {
    console.log("Error loading saved language:", error);
  }

  const deviceLang = getDeviceLanguage();
  i18n.locale = deviceLang;
  const shouldBeRTL = deviceLang === "ar";
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.forceRTL(shouldBeRTL);
    I18nManager.allowRTL(shouldBeRTL);
  }
  return deviceLang;
}

export async function setLanguage(languageCode: LanguageCode): Promise<void> {
  i18n.locale = languageCode;
  const shouldBeRTL = languageCode === "ar";
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.forceRTL(shouldBeRTL);
    I18nManager.allowRTL(shouldBeRTL);
  }
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode);
  } catch (error) {
    console.log("Error saving language preference:", error);
  }
}

export function getCurrentLanguage(): LanguageCode {
  return i18n.locale as LanguageCode;
}

export function t(key: string, options?: object): string {
  return i18n.t(key, options);
}

export function isRTL(): boolean {
  return i18n.locale === "ar";
}

export { i18n };
