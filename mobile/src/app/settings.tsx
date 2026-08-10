import { Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Column } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type ThemePreference, useThemePreference } from '@/lib/theme-preference';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export default function SettingsScreen() {
  const { preference, setPreference } = useThemePreference();

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <Column style={styles.body}>
        <Card>
          <ThemedText type="smallBold">Appearance</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            System matches the phone&apos;s own light/dark setting.
          </ThemedText>
          <View style={styles.segmented}>
            {OPTIONS.map((option) => (
              <ThemeOption
                key={option.value}
                label={option.label}
                selected={preference === option.value}
                onPress={() => setPreference(option.value)}
              />
            ))}
          </View>
        </Card>
      </Column>
    </>
  );
}

function ThemeOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.option,
        {
          backgroundColor: selected ? theme.tint : 'transparent',
          borderColor: selected ? theme.tint : theme.border,
        },
      ]}>
      <ThemedText
        type="small"
        style={{ color: selected ? theme.tintText : theme.text, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: Spacing.three, gap: Spacing.three },
  segmented: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
