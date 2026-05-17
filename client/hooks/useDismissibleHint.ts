import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export function useDismissibleHint(key: string): {
  visible: boolean;
  dismiss: () => void;
} {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((val) => { if (val !== "1") setVisible(true); })
      .catch(() => {});
  }, [key]);

  const dismiss = useCallback(() => {
    setVisible(false);
    AsyncStorage.setItem(key, "1").catch(() => {});
  }, [key]);

  return { visible, dismiss };
}
