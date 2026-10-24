/**
 * Root layout: fonts, the on-device database, app state and the navigation
 * stack. Everything here works offline and without any credentials.
 */
import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from '@/state/AppProvider';
import { DATABASE_NAME, initDatabase } from '@/state/database';
import { ErrorState } from '@/ui/components/feedback';
import { colors } from '@/ui/theme';
import { useReducedMotion } from '@/ui/useReducedMotion';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  const reduceMotion = useReducedMotion();
  // If fonts fail to load we carry on with the system font rather than blocking the app.
  const fontsSettled = fontsLoaded || !!fontError;

  useEffect(() => {
    if (fontsSettled) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsSettled]);

  if (!fontsSettled) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase}>
        <AppProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: reduceMotion ? 'none' : 'default',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="quests" />
            <Stack.Screen name="activity/[id]" />
            <Stack.Screen name="adventure/[id]" />
          </Stack>
        </AppProvider>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}

/** Shown by Expo Router if anything above throws (for example, the database fails to open). */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <ErrorState message={`Huddle couldn’t start: ${error.message}`} onRetry={retry} />
    </View>
  );
}
