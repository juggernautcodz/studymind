import React, { Component, ComponentType, PropsWithChildren } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { ErrorFallback, ErrorFallbackProps } from "@/components/ErrorFallback";

export type ErrorBoundaryProps = PropsWithChildren<{
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, stackTrace: string) => void;
}>;

type ErrorBoundaryState = { error: Error | null };

// Error boundary must use class component — functional components cannot implement
// componentDidCatch or getDerivedStateFromError.
// https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static defaultProps: {
    FallbackComponent: ComponentType<ErrorFallbackProps>;
  } = {
    FallbackComponent: ErrorFallback,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    const appVersion = Constants.expoConfig?.version ?? "unknown";
    const platform = Platform.OS;
    const osVersion = Platform.Version;

    console.error(
      `[ErrorBoundary] Unhandled render error\n` +
      `App: ${appVersion} | Platform: ${platform} ${osVersion}\n` +
      `Error: ${error.message}\n` +
      `Stack: ${error.stack ?? "(none)"}\n` +
      `Component stack: ${info.componentStack}`,
    );

    if (typeof this.props.onError === "function") {
      this.props.onError(error, info.componentStack);
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render() {
    const { FallbackComponent } = this.props;

    return this.state.error && FallbackComponent ? (
      <FallbackComponent
        error={this.state.error}
        resetError={this.resetError}
      />
    ) : (
      this.props.children
    );
  }
}
