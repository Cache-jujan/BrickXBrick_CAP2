import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { FlowHeader } from "@/components/flow-header";
import { API_URL, authHeaders } from "@/constants/api";
import { COLORS, FONT } from "@/constants/expense-flow-colors";
import { getSession, homeRouteFor, logout, setTermsAccepted } from "@/lib/auth";
import { loadLegalDocs } from "@/lib/cached-api";
import { savedAtLabel } from "@/lib/sync/offline-cache";
import { plainError } from "@/lib/sync/messages";
import { useLocale } from "@/lib/i18n-context";

type Section = { heading: string; paragraphs?: string[]; bullets?: string[] };
type LegalDoc = { id: string; title: string; sections: Section[] };
type Highlight = { id: string; icon: string; title: string; text: string };
type LegalData = { version: string; effectiveDate: string; highlights?: Highlight[]; documents: LegalDoc[] };

// Warm accents that match the web version of this screen.
const TINT = COLORS.primaryTint;
const TINT_INK = COLORS.primaryTintText;
const PAGE_BG = COLORS.bg;
const DANGER = COLORS.errorText;

const HIGHLIGHT_ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  account: "lock-outline",
  records: "fact-check",
  data: "storage",
  rights: "verified-user",
};

// "3. Your account" -> { num: "3", label: "Your account" }
function splitHeading(heading: string) {
  const m = /^(\d+)\.\s*(.*)$/.exec(heading);
  return m ? { num: m[1], label: m[2] } : { num: "", label: heading };
}

// Terms of Use + Privacy Notice (Data Privacy Act, RA 10173).
//   /terms?accept=1  shown right after sign-in until the current version is
//                    accepted; no back button, the app can't be used until then
//   /terms           read-only, opened from Settings
// The text comes from the backend (GET /api/legal), the same as on the web.
export default function TermsScreen() {
  const { t, formatDate, intlLocale } = useLocale();
  const { accept } = useLocalSearchParams<{ accept?: string }>();
  const mustAccept = accept === "1";
  const session = getSession();

  const [data, setData] = useState<LegalData | null>(null);
  const [docId, setDocId] = useState("terms");
  const [loadError, setLoadError] = useState("");
  // Set when the text on screen is the copy saved on this phone.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const readerY = useRef(0);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const result = await loadLegalDocs<LegalData>(async () => {
        const res = await fetch(`${API_URL}/api/legal`);
        if (!res.ok) throw new Error(`Failed to load the terms (${res.status})`);
        return (await res.json()) as LegalData;
      });
      setData(result.data);
      setSavedAt(result.fromCache ? result.savedAt : null);
    } catch {
      setLoadError(t("legal.load_error_net"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the load callback must stay stable; a language change must not refetch
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!session) return <Redirect href="/login" />;

  function switchDoc(id: string) {
    setDocId(id);
    scrollRef.current?.scrollTo({ y: Math.max(0, readerY.current - 8), animated: true });
  }

  async function handleAccept() {
    if (!checked || !data || !session) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/legal/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ version: data.version }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // The terms changed while this screen was open: show the new version.
        setChecked(false);
        await load();
        throw new Error(body.error || t("legal.err_updated"));
      }
      if (!res.ok) throw new Error(body.error || t("legal.accept_error"));
      setTermsAccepted(data.version);
      router.replace(homeRouteFor(session.user.role));
    } catch (err) {
      setError(plainError(err, t("legal.accept_error"), t));
    } finally {
      setBusy(false);
    }
  }

  function handleSignOut() {
    logout();
    router.replace("/login");
  }

  const doc = data?.documents.find((d) => d.id === docId) ?? data?.documents[0];
  const docIndex = data && doc ? data.documents.indexOf(doc) : -1;
  const nextDoc = data && docIndex >= 0 ? data.documents[docIndex + 1] : undefined;
  const firstName = session.user.name?.split(" ")[0];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", ...(mustAccept ? [] : (["bottom"] as const))]}>
      <FlowHeader
        title={mustAccept ? t("legal.before_continue") : t("account.terms_privacy")}
        caption={mustAccept ? t("legal.eyebrow") : undefined}
        hideBack={mustAccept}
      />

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          {mustAccept && firstName ? <Text style={styles.eyebrow}>{t("legal.welcome_upper", { name: firstName.toUpperCase() })}</Text> : null}
          <Text style={styles.heroTitle}>{mustAccept ? t("legal.title") : t("account.terms_privacy")}</Text>
          <Text style={styles.lede}>
            {mustAccept
              ? "Brick x Brick holds company records and your personal data, so we need your agreement first. You'll only be asked again if the terms change."
              : "How Brick x Brick may be used, and how your personal data is handled under the Data Privacy Act (RA 10173)."}
          </Text>
          {data ? (
            <View style={styles.metaRow}>
              <View style={styles.chip}>
                <Text style={styles.chipText}>{t("legal.version", { version: data.version })}</Text>
              </View>
              <Text style={styles.meta}>{t("legal.effective", { date: formatDate(`${data.effectiveDate}T00:00:00`, { year: "numeric", month: "long", day: "numeric" }) })}</Text>
            </View>
          ) : null}
        </View>

        {savedAt ? (
          <Text style={styles.savedNote}>{t("legal.offline_saved", { when: savedAtLabel(savedAt, new Date(), t, intlLocale) })}</Text>
        ) : null}

        {loadError ? (
          <View style={styles.errorCard}>
            <Text style={styles.error}>{loadError}</Text>
            <Pressable onPress={load} style={styles.secondaryButton} accessibilityRole="button">
              <Text style={styles.secondaryText}>{t("common.try_again")}</Text>
            </Pressable>
          </View>
        ) : null}

        {!data && !loadError ? <ActivityIndicator color={COLORS.primary} style={styles.loading} /> : null}

        {data && doc ? (
          <>
            {data.highlights?.length ? (
              <View style={styles.glance}>
                <Text style={styles.overline}>{t("legal.glance_upper")}</Text>
                {data.highlights.map((h) => (
                  <View key={h.id} style={styles.glanceCard}>
                    <View style={styles.glanceIcon}>
                      <MaterialIcons name={HIGHLIGHT_ICONS[h.icon] ?? "description"} size={20} color={TINT_INK} />
                    </View>
                    <View style={styles.glanceTextWrap}>
                      <Text style={styles.glanceTitle}>{h.title}</Text>
                      <Text style={styles.glanceText}>{h.text}</Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.note}>{t("legal.glance_note")}</Text>
              </View>
            ) : null}

            <View
              onLayout={(e) => {
                readerY.current = e.nativeEvent.layout.y;
              }}
              style={styles.segment}
              accessibilityRole="tablist"
            >
              {data.documents.map((d) => {
                const active = d.id === doc.id;
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => switchDoc(d.id)}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{d.title}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.docCard}>
              <Text style={styles.docTitle}>{doc.title}</Text>
              {doc.sections.map((s, i) => {
                const { num, label } = splitHeading(s.heading);
                return (
                  <View key={s.heading} style={[styles.section, i > 0 && styles.sectionDivider]}>
                    <View style={styles.headingRow}>
                      {num ? (
                        <View style={styles.numBadge}>
                          <Text style={styles.numText}>{num}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.heading}>{label}</Text>
                    </View>
                    {(s.paragraphs ?? []).map((p, j) => (
                      <Text key={`p${j}`} style={styles.body}>
                        {p}
                      </Text>
                    ))}
                    {(s.bullets ?? []).map((b, j) => (
                      <View key={`b${j}`} style={styles.bulletRow}>
                        <View style={styles.bulletDot} />
                        <Text style={[styles.body, styles.bulletText]}>{b}</Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>

            {nextDoc ? (
              <Pressable
                onPress={() => switchDoc(nextDoc.id)}
                style={({ pressed }) => [styles.nextCard, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <View>
                  <Text style={styles.nextLabel}>{t("common.next")}</Text>
                  <Text style={styles.nextTitle}>{nextDoc.title}</Text>
                </View>
                <MaterialIcons name="arrow-forward" size={20} color={TINT_INK} />
              </Pressable>
            ) : (
              <Text style={styles.endNote}>{t("legal.end_note", { title: doc.title })}</Text>
            )}
          </>
        ) : null}
      </ScrollView>

      {mustAccept && data ? (
        <SafeAreaView edges={["bottom"]} style={styles.acceptBar}>
          {error ? <Text style={[styles.error, styles.barError]}>{error}</Text> : null}
          <Pressable
            onPress={() => setChecked((v) => !v)}
            style={[styles.checkRow, checked && styles.checkRowOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
          >
            <View style={[styles.checkbox, checked && styles.checkboxOn]}>
              {checked ? <MaterialIcons name="check" size={16} color="#FFFFFF" /> : null}
            </View>
            <Text style={styles.checkLabel}>
              I have read and agree to the <Text style={styles.bold}>Terms of Use</Text>, and I acknowledge the{" "}
              <Text style={styles.bold}>Privacy Notice</Text>.
            </Text>
          </Pressable>

          <Pressable
            onPress={handleAccept}
            disabled={!checked || busy}
            style={({ pressed }) => [styles.primaryButton, (!checked || busy) && styles.disabled, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryText}>{t("legal.agree_continue")}</Text>
                <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
              </>
            )}
          </Pressable>
          <Pressable onPress={handleSignOut} hitSlop={8} accessibilityRole="button" style={styles.signOut}>
            <Text style={styles.signOutText}>{t("account.logout")}</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: PAGE_BG },
  content: { padding: 16, paddingBottom: 32, gap: 16 },
  loading: { marginTop: 24 },

  hero: { gap: 8, paddingTop: 4 },
  eyebrow: { fontSize: 12, fontFamily: FONT.bold, letterSpacing: 1, color: TINT_INK },
  heroTitle: { fontSize: 24, fontFamily: FONT.extrabold, color: COLORS.heading, letterSpacing: -0.3 },
  lede: { fontSize: 15, fontFamily: FONT.regular, lineHeight: 22, color: COLORS.muted },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: { fontSize: 12, fontFamily: FONT.semibold, color: COLORS.muted },
  meta: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted },

  glance: { gap: 10 },
  overline: { fontSize: 12, fontFamily: FONT.bold, letterSpacing: 1, color: COLORS.muted },
  glanceCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  glanceIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: TINT,
    alignItems: "center",
    justifyContent: "center",
  },
  glanceTextWrap: { flex: 1, gap: 2 },
  glanceTitle: { fontSize: 15, fontFamily: FONT.bold, color: COLORS.heading },
  glanceText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 19, color: COLORS.muted },
  note: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },

  segment: {
    flexDirection: "row",
    padding: 4,
    gap: 4,
    borderRadius: 12,
    backgroundColor: COLORS.border,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  segmentItemActive: {
    backgroundColor: COLORS.card,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 14, fontFamily: FONT.semibold, color: COLORS.muted },
  segmentTextActive: { color: COLORS.heading },

  docCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
  },
  docTitle: { fontSize: 20, fontFamily: FONT.extrabold, color: COLORS.heading, marginBottom: 6 },
  section: { gap: 8, paddingTop: 14 },
  sectionDivider: { marginTop: 14, borderTopWidth: 1, borderTopColor: COLORS.border },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  numBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: TINT,
    alignItems: "center",
    justifyContent: "center",
  },
  numText: { fontSize: 12, fontFamily: FONT.extrabold, color: TINT_INK },
  heading: { flex: 1, fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  body: { fontSize: 14.5, fontFamily: FONT.regular, lineHeight: 22, color: COLORS.heading },
  bulletRow: { flexDirection: "row", gap: 10, paddingRight: 4 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginTop: 8 },
  bulletText: { flex: 1 },

  nextCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  nextLabel: { fontSize: 12, fontFamily: FONT.regular, color: COLORS.muted },
  nextTitle: { fontSize: 16, fontFamily: FONT.bold, color: COLORS.heading },
  endNote: { fontSize: 13, fontFamily: FONT.regular, color: COLORS.muted, textAlign: "center" },

  savedNote: { backgroundColor: COLORS.amberBannerFill, borderRadius: 10, color: COLORS.amberBannerText, fontFamily: FONT.medium, fontSize: 12, marginBottom: 10, padding: 10 },
  errorCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 12,
  },
  error: { color: DANGER, fontSize: 14, fontFamily: FONT.regular },

  acceptBar: {
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  barError: { textAlign: "center" },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: PAGE_BG,
  },
  checkRowOn: { borderColor: COLORS.primary, backgroundColor: TINT },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkLabel: { flex: 1, fontSize: 13.5, fontFamily: FONT.regular, lineHeight: 19, color: COLORS.heading },
  bold: { fontFamily: FONT.bold },
  primaryButton: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontFamily: FONT.bold },
  disabled: { opacity: 0.45 },
  signOut: { alignSelf: "center", paddingVertical: 6, marginBottom: 4 },
  signOutText: { color: COLORS.muted, fontSize: 14, fontFamily: FONT.semibold },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: COLORS.card,
  },
  secondaryText: { color: COLORS.heading, fontSize: 15, fontFamily: FONT.semibold },
});
