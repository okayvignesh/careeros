import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StyleProp, TextInputProps, TextStyle, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';

type TextVariant = 'eyebrow' | 'title' | 'heading' | 'body' | 'muted' | 'label' | 'mono';

const textStyles: Record<TextVariant, TextStyle> = {
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.fgSubtle,
  },
  title: { fontSize: fontSize.xxl, fontWeight: '700', letterSpacing: -0.5, color: colors.fg },
  heading: { fontSize: fontSize.lg, fontWeight: '600', color: colors.fg },
  body: { fontSize: fontSize.base, fontWeight: '400', color: colors.fg },
  muted: { fontSize: fontSize.sm, fontWeight: '400', color: colors.fgMuted },
  label: { fontSize: fontSize.sm, fontWeight: '500', color: colors.fgSubtle },
  mono: {
    fontSize: fontSize.sm,
    color: colors.fgMuted,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
};

export function AppText({
  variant = 'body',
  color,
  style,
  children,
  numberOfLines,
}: {
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text
      style={[textStyles[variant], color ? { color } : null, style]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { borderColor: tone, backgroundColor: `${tone}22` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.buttonPrimary : null,
        variant === 'secondary' ? styles.buttonSecondary : null,
        variant === 'ghost' ? styles.buttonGhost : null,
        fullWidth ? styles.buttonFull : null,
        pressed && !isDisabled ? styles.buttonPressed : null,
        isDisabled ? styles.buttonDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.accentFg : colors.fg}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === 'primary' ? styles.buttonLabelPrimary : null,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  style,
  ...inputProps
}: TextInputProps & { label?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={styles.field}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <TextInput
        placeholderTextColor={colors.fgFaint}
        style={[styles.input, style]}
        {...inputProps}
      />
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kvRow}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="muted" style={styles.kvValue}>
        {value}
      </AppText>
    </View>
  );
}

export function Screen({
  eyebrow,
  title,
  subtitle,
  children,
  scroll = true,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const header = (
    <View style={styles.header}>
      {eyebrow ? <AppText variant="eyebrow">{eyebrow}</AppText> : null}
      {title ? <AppText variant="title">{title}</AppText> : null}
      {subtitle ? <AppText variant="muted">{subtitle}</AppText> : null}
    </View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={styles.scrollContent}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

export function LoadingScreen() {
  return (
    <SafeAreaView style={styles.center}>
      <ActivityIndicator color={colors.accent} />
    </SafeAreaView>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <Card style={styles.stateCard}>
      <ActivityIndicator color={colors.accent} />
      <AppText variant="muted">{label}</AppText>
    </Card>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={styles.stateCard}>
      <AppText variant="heading" color={colors.danger}>
        Something went wrong
      </AppText>
      <AppText variant="muted" style={styles.stateText}>
        {message}
      </AppText>
      {onRetry ? <Button label="Retry" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return (
    <Card style={styles.stateCard}>
      <AppText variant="muted" style={styles.stateText}>
        {message}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: spacing.xl, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
  header: { gap: spacing.xs },
  card: {
    backgroundColor: colors.bgElev1,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600', letterSpacing: 0.4 },
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: {
    backgroundColor: colors.bgElev2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonFull: { alignSelf: 'stretch' },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.fg },
  buttonLabelPrimary: { color: colors.accentFg },
  field: { gap: spacing.sm },
  input: {
    backgroundColor: colors.bgElev2,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.fg,
    fontSize: fontSize.base,
  },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  kvValue: { flexShrink: 1, textAlign: 'right' },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateCard: { alignItems: 'flex-start', gap: spacing.md },
  stateText: { lineHeight: 20 },
});
