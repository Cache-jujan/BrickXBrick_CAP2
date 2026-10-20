import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { FlowHeader } from "@/components/flow-header";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { COLORS } from "@/constants/expense-flow-colors";
import { dismissScan, fetchScan, type ReceiptScan } from "@/lib/receipt-scans";
import { useOpenScan } from "@/lib/use-open-scan";
import { useNetwork } from "@/lib/sync/network-context";

const POLL_MS = 2000;
// Past this the user is offered to type it in instead of waiting.
const SLOW_AFTER_S = 20;
const RED = "#C1121F";

// Shown after the upload: OCR is running on the server. Leaving this screen,
// or closing the app, doesn't stop it; the receipt waits under "Scanned
// receipts" on the Requests tab.
export default function ScanningScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { openReady, openManual } = useOpenScan();
  const [scan, setScan] = useState<ReceiptScan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { isOnline } = useNetwork();
  const [now, setNow] = useState(() => Date.now());
  const opened = useRef(false);

  // Poll only while this screen is focused; stop once the scan settles.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout>;
      async function poll() {
        try {
          const next = await fetchScan(id);
          if (cancelled) return;
          setScan(next);
          setLoadError(null);
          if (next.status !== "Scanning") return;
        } catch (err) {
          if (cancelled) return;
          // A dropped connection is common on site; keep trying quietly.
          setLoadError(err instanceof Error ? err.message : String(err));
        }
        timer = setTimeout(poll, POLL_MS);
      }
      poll();
      return () => { cancelled = true; clearTimeout(timer); };
    }, [id])
  );

  // Elapsed-seconds clock.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Ready while the user is watching: go straight to review.
  useEffect(() => {
    if (scan?.status === "Ready" && !opened.current) {
      opened.current = true;
      openReady(scan, { replace: true });
    }
  }, [scan, openReady]);

  const elapsed = scan ? Math.max(0, Math.round((now - new Date(scan.createdAt).getTime()) / 1000)) : 0;
  const failed = scan?.status === "Failed";
  const slow = scan?.status === "Scanning" && elapsed >= SLOW_AFTER_S;

  async function discard() {
    if (scan) await dismissScan(scan.scanID).catch(() => {});
    router.replace("/");
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlowHeader title="Reading receipt" caption="Step 1 of 3" onBack={() => router.replace("/")} />

      <View style={styles.container}>
        <View style={styles.card}>
          <Step state="done" label="Photo uploaded" />
          <Step
            state={failed ? "failed" : scan?.status === "Ready" ? "done" : "active"}
            label={failed ? "Couldn't read the receipt" : "Reading the details"}
            detail={scan?.status === "Scanning" ? `${elapsed}s` : undefined}
          />
          <Step state={scan?.status === "Ready" ? "done" : "waiting"} label="Ready to review" />
        </View>

        {failed ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{scan?.errorMessage ?? "Couldn't read this receipt."}</Text>
          </View>
        ) : (
          <View style={styles.notice}>
            <IconSymbol name="info.circle.fill" size={18} color={COLORS.muted} />
            <Text style={styles.noticeText}>
              Usually 5–15 seconds. You can leave this screen or close the app — we&apos;ll keep reading it. Find it under
              <Text style={styles.bold}> Scanned receipts</Text> on the Requests tab.
            </Text>
          </View>
        )}

        {slow && <Text style={styles.slowText}>Taking longer than usual. You can wait, or type the details in now.</Text>}
        {loadError && !failed && (
          <Text style={styles.slowText}>
            {isOnline
              ? "Can't reach the server right now. Still trying…"
              : "You're offline. Your receipt is already uploaded and keeps being read on the server; this screen updates when you're back online."}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        {(failed || slow) && scan && (
          <Pressable style={[styles.button, styles.primary]} onPress={() => openManual(scan, { replace: true })} accessibilityRole="button">
            <Text style={styles.primaryText}>Type it in instead</Text>
          </Pressable>
        )}
        {failed ? (
          <Pressable style={[styles.button, styles.secondary]} onPress={discard} accessibilityRole="button">
            <Text style={[styles.secondaryText, { color: RED }]}>Discard this receipt</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, styles.secondary]} onPress={() => router.replace("/")} accessibilityRole="button">
            <Text style={styles.secondaryText}>Back to Requests — keep reading</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function Step({ state, label, detail }: { state: "done" | "active" | "waiting" | "failed"; label: string; detail?: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        {state === "done" && <IconSymbol name="checkmark.seal.fill" size={20} color={COLORS.success} />}
        {state === "active" && <ActivityIndicator size="small" color={COLORS.primary} />}
        {state === "failed" && <IconSymbol name="exclamationmark.triangle.fill" size={20} color={RED} />}
        {state === "waiting" && <View style={styles.dot} />}
      </View>
      <Text style={[styles.stepLabel, state === "waiting" && styles.stepWaiting, state === "failed" && { color: RED }]}>{label}</Text>
      {detail && <Text style={styles.stepDetail}>{detail}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  container: { flex: 1, paddingHorizontal: 16, gap: 12 },
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, gap: 16 },
  step: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepIcon: { width: 24, alignItems: "center" },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: COLORS.border },
  stepLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: COLORS.heading },
  stepWaiting: { color: COLORS.muted, fontWeight: "600" },
  stepDetail: { fontSize: 13, color: COLORS.muted, fontVariant: ["tabular-nums"] },
  notice: { flexDirection: "row", gap: 8, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12 },
  noticeText: { flex: 1, fontSize: 13, color: COLORS.muted, lineHeight: 19 },
  bold: { fontWeight: "700", color: COLORS.heading },
  slowText: { fontSize: 13, color: "#B45309", textAlign: "center" },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: COLORS.bg },
  button: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primary: { backgroundColor: COLORS.primary },
  primaryText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  secondary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  secondaryText: { color: COLORS.heading, fontWeight: "700", fontSize: 15 },
});
