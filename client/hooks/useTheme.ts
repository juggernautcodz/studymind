import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/useColorScheme";

export function useTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const resolvedScheme = colorScheme === "dark" ? "dark" : "light";
  const theme = Colors[resolvedScheme];

  return {
    theme,
    isDark,
  };
}
