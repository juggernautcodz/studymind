#!/usr/bin/env bash
set -e

echo "[1/6] Killing old Expo/Metro processes..."
pkill -f expo || true
pkill -f metro || true
pkill -f "react-native" || true
pkill -f tsserver || true

echo "[2/6] Clearing caches..."
rm -rf .expo || true
rm -rf /tmp/metro-* || true
rm -rf /tmp/haste-map-* || true
find .cache -mindepth 1 -maxdepth 1 ! -name dotslash -exec rm -rf {} + 2>/dev/null || true

echo "[3/6] Installing dependencies..."
npm install

echo "[4/6] Running Expo doctor..."
npx expo-doctor@latest

echo "[5/6] Starting Expo Go with tunnel and production API..."
EXPO_NO_PROMPT=1 \
EXPO_PUBLIC_API_URL=https://asset-manager-landrys424.replit.app \
npx expo start --tunnel --clear