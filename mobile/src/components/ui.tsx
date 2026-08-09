import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Centred, max-width column so the layout survives tablets and web. */
export function Column({ style, ...rest }: ViewProps) {
  return <View style={[styles.column, style]} {...rest} />;
}

export function Card({ style, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, style]}
      {...rest}
    />
  );
}

export function ListRow({
  title,
  subtitle,
  meta,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.border, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
      ]}>
      <View style={styles.rowBody}>
        <ThemedText type="default" numberOfLines={2}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {meta ? (
        <ThemedText type="small" themeColor="textSecondary">
          {meta}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        ›
      </ThemedText>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  busy?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: isPrimary ? theme.tint : 'transparent',
          borderColor: isPrimary ? theme.tint : theme.border,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      {busy ? (
        <ActivityIndicator color={isPrimary ? theme.tintText : theme.text} />
      ) : (
        <ThemedText style={{ color: isPrimary ? theme.tintText : theme.text, fontWeight: '600' }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function Field({ label, style, ...rest }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'error' | 'info'; children: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.banner,
        {
          borderColor: tone === 'error' ? theme.danger : theme.border,
          backgroundColor: theme.backgroundElement,
        },
      ]}>
      <ThemedText type="small" themeColor={tone === 'error' ? 'danger' : 'textSecondary'}>
        {children}
      </ThemedText>
    </View>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  return (
    <Centered>
      <ActivityIndicator />
      {label ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
          {label}
        </ThemedText>
      ) : null}
    </Centered>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: Spacing.half },
  button: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  field: { gap: Spacing.one },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: Spacing.three,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
});
