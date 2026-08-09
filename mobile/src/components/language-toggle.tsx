import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContent } from '@/lib/content';
import { LANGUAGES } from '@/lib/types';

/**
 * Gujarati / Lipi / English. Persisted per device, and read by every screen
 * that renders verse text — including, later, the practice screen.
 */
export function LanguageToggle() {
  const theme = useTheme();
  const { language, setLanguage } = useContent();

  return (
    <View style={[styles.group, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
      {LANGUAGES.map((option) => {
        const selected = option.value === language;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Show ${option.label}`}
            onPress={() => setLanguage(option.value)}
            style={[styles.option, selected && { backgroundColor: theme.tint }]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.tintText : theme.textSecondary }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
  },
});
