import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import Constants from "expo-constants";

import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { getSession, logout } from "@/lib/auth";
import { useExpenseDraft } from "@/lib/expense-draft-context";
import { COLORS } from "@/constants/expense-flow-colors";

const DANGER = "#C1121F";

// Shared by Purchasers and Site Managers. This is the only place to log out.
export default function SettingsScreen() {
  const { reset } = useExpenseDraft();
  const session = getSession();
  if (!session) return <Redirect href="/login" />;

  const { name, email, role } = session.user;
  const version = Constants.expoConfig?.version ?? "—";

  function confirmLogout() {
    Alert.alert("Log out?", "You'll need to sign in again to continue.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          // Clear any half-finished expense so it can't leak to the next user.
          reset();
          logout();
          // Drop every screen under us so Back can't return to a signed-in page.
          if (router.canDismiss()) router.dismissAll();
          router.replace("/login");
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <IconSymbol name="person.crop.circle" size={44} color={COLORS.muted} />
            <View style={styles.profileText}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.email} numberOfLines={1}>{email}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Row label="Role" value={role} />
          <Row label="App version" value={version} />
        </View>

        <Pressable
          onPress={confirmLogout}
          style={({ pressed }) => [styles.logout, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
        >
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 16 },
  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  profileText: { flex: 1 },
  name: { fontSize: 17, fontWeight: "800", color: COLORS.heading },
  email: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { fontSize: 14, color: COLORS.muted },
  rowValue: { fontSize: 14, fontWeight: "600", color: COLORS.heading },
  logout: { borderWidth: 1, borderColor: DANGER, borderRadius: 14, paddingVertical: 14, alignItems: "center", backgroundColor: COLORS.card },
  logoutText: { color: DANGER, fontSize: 15, fontWeight: "700" },
});
