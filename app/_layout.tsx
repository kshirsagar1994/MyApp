import { useEffect, useCallback } from 'react';
import { View } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

// Prevent splash from auto-hiding before we're ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // If this fails (e.g. splash already hidden), silently continue
});

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Primary: hide splash when the component mounts
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Safety net: also hide when the root View actually renders on screen.
  // This fires even if useEffect is delayed by navigation setup.
  const onLayoutRootView = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="+not-found" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </View>
  );
}
