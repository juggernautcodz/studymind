import "react-native-get-random-values";
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from "react-native-reanimated";
import { registerRootComponent } from "expo";

import App from "@/App";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

registerRootComponent(App);
