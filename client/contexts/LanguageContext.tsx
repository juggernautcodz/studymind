import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { Alert, I18nManager } from "react-native";
import * as Updates from "expo-updates";
import {
  initializeLanguage,
  setLanguage as setI18nLanguage,
  getCurrentLanguage,
  t as translate,
  SUPPORTED_LANGUAGES,
  LanguageCode,
  isRTL,
} from "@/i18n";

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => Promise<void>;
  t: (key: string, options?: object) => string;
  isRTL: boolean;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<LanguageCode>("en");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadLanguage() {
      const savedLanguage = await initializeLanguage();
      setLanguageState(savedLanguage);
      setIsLoading(false);
    }
    loadLanguage();
  }, []);

  const setLanguage = useCallback(async (code: LanguageCode) => {
    const previousLanguage = language;
    await setI18nLanguage(code);
    setLanguageState(code);

    const wasRTL = previousLanguage === "ar";
    const willBeRTL = code === "ar";

    if (wasRTL !== willBeRTL) {
      // Apply RTL/LTR change and reload the app so layout direction takes effect
      I18nManager.forceRTL(willBeRTL);
      I18nManager.allowRTL(willBeRTL);

      try {
        // In Expo Go / production builds, reload the bundle
        await Updates.reloadAsync();
      } catch {
        // If reloadAsync is unavailable (dev client), show an alert instead
        Alert.alert(
          "Restart Required",
          willBeRTL
            ? "Arabic (RTL) layout requires an app restart to display correctly."
            : "Please restart the app for the layout direction to update correctly.",
          [{ text: "OK" }],
        );
      }
    }
  }, [language]);

  const t = useCallback(
    (key: string, options?: object) => {
      return translate(key, options);
    },
    [language],
  );

  const rtl = language === "ar";

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, t, isRTL: rtl, isLoading }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}

export { SUPPORTED_LANGUAGES, LanguageCode };
