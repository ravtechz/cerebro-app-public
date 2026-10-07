import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useStore } from './src/store/useStore';
import { FONTS } from './src/theme/fonts';
import { useStyles, useTheme } from './src/theme/useStyles';
import type { Theme } from './src/theme/tokens';

export default function App() {
  const [fontsLoaded] = useFonts(FONTS);
  const [showSettings, setShowSettings] = useState(false);
  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const theme = useTheme();
  const styles = useStyles(makeStyles);

  useEffect(() => {
    void init();
  }, [init]);

  const booted = fontsLoaded && ready;

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        {booted ? (
          showSettings ? (
            <SettingsScreen onClose={() => setShowSettings(false)} />
          ) : (
            <HomeScreen onOpenSettings={() => setShowSettings(true)} />
          )
        ) : (
          <View style={styles.splash}>
            <ActivityIndicator color={theme.color.accent} />
          </View>
        )}
      </View>
      {/* The splash shows before settings are read, so this is synthwave's dark
          bar until the stored theme lands — one frame, and never wrong after. */}
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.color.bg },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
