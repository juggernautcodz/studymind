import React, { useState } from "react";
import { View, StyleSheet, Image, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

export default function LoginScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { login, signup } = useAuth();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!email || !password) {
      setError("Please fill in all fields");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (!isLogin && !name) {
      setError("Please enter your name");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsLoading(true);
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await signup(email, password, name);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setError("Authentication failed. Please try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError("");
    Haptics.selectionAsync();
  };

  return (
    <KeyboardAwareScrollViewCompat
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing["4xl"],
          paddingBottom: insets.bottom + Spacing["2xl"],
        },
      ]}
    >
      <View style={styles.header}>
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <ThemedText type="h1" style={styles.title}>
          StudyMind
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.subtitle, { color: theme.textSecondary }]}
        >
          Transform your lectures into study materials
        </ThemedText>
      </View>

      <View style={[styles.form, { backgroundColor: theme.backgroundDefault, borderWidth: 1, borderColor: theme.border }]}>
        <ThemedText type="h2" style={styles.formTitle}>
          {isLogin ? "Welcome Back" : "Create Account"}
        </ThemedText>

        {!isLogin ? (
          <Input
            label="Name"
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            leftIcon="user"
            autoCapitalize="words"
            testID="input-name"
          />
        ) : null}

        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          leftIcon="mail"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          testID="input-email"
        />

        <Input
          label="Password"
          placeholder="Enter password"
          value={password}
          onChangeText={setPassword}
          leftIcon="lock"
          rightIcon={showPassword ? "eye-off" : "eye"}
          onRightIconPress={() => setShowPassword(!showPassword)}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          testID="input-password"
        />

        {error ? (
          <ThemedText
            type="small"
            style={[styles.error, { color: theme.error }]}
          >
            {error}
          </ThemedText>
        ) : null}

        <Button
          onPress={handleSubmit}
          disabled={isLoading}
          style={styles.submitButton}
        >
          {isLoading
            ? "Please wait..."
            : isLogin
              ? "Sign In"
              : "Create Account"}
        </Button>

        {isLogin ? (
          <Pressable
            onPress={() => navigation.navigate("ForgotPassword")}
            style={styles.forgotContainer}
          >
            <ThemedText type="small" style={{ color: theme.link }}>
              Forgot Password?
            </ThemedText>
          </Pressable>
        ) : null}

        <Pressable onPress={toggleMode} style={styles.toggleContainer}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </ThemedText>
          <ThemedText type="link">{isLogin ? "Sign Up" : "Sign In"}</ThemedText>
        </Pressable>

      </View>
    </KeyboardAwareScrollViewCompat>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing["3xl"],
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {
    textAlign: "center",
  },
  form: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.xl,
  },
  formTitle: {
    marginBottom: Spacing["2xl"],
    textAlign: "center",
  },
  error: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  submitButton: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  forgotContainer: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  toggleContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
});
