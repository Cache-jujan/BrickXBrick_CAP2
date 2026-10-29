# English–Bisaya localization

## Architecture

The web and mobile clients use one checked-in message catalog at `shared/i18n/messages.json`. Each locale is a flat key/value map (`en`, `ceb` and `fil`), and parameterized messages use named placeholders such as `{count}`. The application selects a locale in React state and calls `t(key, values)` while rendering. Switching locale changes state immediately; neither client reloads a page or clears the current session.

```text
Toggle / settings
      │
      ├─ Web LocaleProvider ── localStorage (brickxbrick.locale.v1)
      │         └─ React rerender; document lang follows the chosen locale
      │
      └─ Mobile LocaleProvider ── existing SQLite app_kv table
                └─ React rerender; works offline and survives app restarts

                         shared/i18n/messages.json
```

The web provider is mounted above the router so the selected locale applies across navigation and can be changed on the sign-in screen. The mobile provider is mounted above Expo Router. Mobile reads and writes the existing SQLite key/value table through `initDb`, `kvGet`, and `kvSet`, so no additional storage package or network request is needed. Expo SDK 57 also documents SQLite-backed key/value storage as an alternative to adding AsyncStorage: [Expo SQLite, SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/). Metro is configured to include the repository-level `shared` catalog in the mobile bundle; see [Expo Metro configuration, SDK 57](https://docs.expo.dev/versions/v57.0.0/config/metro/).

Preferences are currently device-local. A browser preference does not automatically follow an account to another browser or to the mobile app. If account-wide sync is later required, add a user-owned preferred-locale field and an authenticated preference endpoint; make the server value canonical when online and retain the local setting as the offline/startup cache. That backend/profile change is intentionally not part of this implementation.

## Stack and setup

The website is React 18 with Vite. Its provider and toggle are in `frontend/src/i18n/`; browser storage is built in. Mobile is Expo Router / React Native on Expo SDK 57 and already depends on `expo-sqlite`; its provider is `mobile/lib/i18n-context.tsx`. The dictionary is shared by both apps.

**No new package installation is required.** Install the existing lockfiles as usual (`npm ci` in `frontend/` and `mobile/`). The mobile bundle imports the shared JSON from outside `mobile/`; `mobile/metro.config.js` adds `../shared` to `watchFolders` while preserving the existing SQLite web configuration.

## Using the catalog

Add a stable namespaced key to both locale maps. Keep English as the source copy and place a natural, locally reviewed Cebuano phrase in `ceb`:

```json
{
  "en": { "mobile.project_count": "{count} projects" },
  "ceb": { "mobile.project_count": "{count} ka proyekto" }
}
```

In a component, call the same hook on either platform:

```jsx
const { locale, toggleLanguage, t } = useLocale();

<button type="button" onClick={toggleLanguage} aria-pressed={locale === "ceb"}>
  {t(locale === "ceb" ? "language.english_action" : "language.translate")}
</button>
<p>{t("mobile.project_count", { count })}</p>
```

The native equivalent uses `Pressable` with `accessibilityRole="switch"` and `accessibilityState={{ checked: locale === "ceb" }}`. Unknown keys intentionally fall back to their English entry, then the key itself, so a missing Bisaya value cannot blank a screen. Keep HTML accessibility labels, native accessibility labels, placeholders, validation copy, and button text in the same catalog as visible labels.

The production providers are in [`frontend/src/i18n/LocaleProvider.jsx`](../frontend/src/i18n/LocaleProvider.jsx) and [`mobile/lib/i18n-context.tsx`](../mobile/lib/i18n-context.tsx). Their core persistence pattern is:

```jsx
// Web: state is shared across routes; localStorage restores it after refresh.
const [locale, setLocale] = useState(() => {
  try { return localStorage.getItem("brickxbrick.locale.v1") === "ceb" ? "ceb" : "en"; }
  catch { return "en"; }
});
const setLanguage = (next) => {
  const safe = next === "ceb" ? "ceb" : "en";
  setLocale(safe);                 // rerender now; no reload
  try { localStorage.setItem("brickxbrick.locale.v1", safe); } catch { /* session-only */ }
};
```

```tsx
// Mobile: use the existing SQLite app_kv helpers; no network is needed.
const [locale, setLocale] = useState<AppLocale>(() => {
  try { initDb(); return kvGet("language") === "ceb" ? "ceb" : "en"; }
  catch { return "en"; }
});
const setLanguage = (next: AppLocale) => {
  setLocale(next);                  // rerender now; no navigation reset
  try { initDb(); kvSet("language", next); } catch { /* session-only */ }
};
```

For either provider, the context value exposes `locale`, `setLanguage`, `toggleLanguage`, and `t`. The web toggle implementation is [`frontend/src/i18n/LanguageToggle.jsx`](../frontend/src/i18n/LanguageToggle.jsx); every control calls the same context action. On the web the language switch is a globe button beside the notification bell in the top bar (`variant="icon"`, changes at once) and text links on the sign-in card (`variant="inline"`). On mobile it lives in Settings → Language, plus a globe button on the sign-in screen only, where Settings cannot be reached yet; both mobile surfaces share `mobile/lib/use-language-choice.ts`, which asks for confirmation before applying a change. The Cebuano language is shown by the name "Cebuano" (catalog key `language.bisaya`).

The catalog is a reviewable source of truth, not a machine-translation cache. A Cebuano reviewer can correct a phrase by changing only its value under `ceb`, without altering English copy or component logic. If machine-generated suggestions are introduced later, keep them in a separate unapproved file and layer reviewed overrides after them; never overwrite approved Cebuano strings from an automatic refresh.

## Translation and privacy boundaries

This implementation has no recurring translation API cost and makes no external translation request. It uses bundled, manually editable strings for application UI. The web does **not** inject Google Translate Element, and neither app sends screen contents to a free translation proxy. Those shortcuts are not a safe default for this application: translating a live React DOM outside React can be undone by rerenders and can desynchronize displayed/accessibility text, while a proxy may expose project, expense, vendor, or user-submitted content to an unapproved third party.

If a later requirement is to translate genuinely dynamic **public, non-sensitive** text, place a `TranslationAdapter` behind the application backend rather than scraping or mutating the browser DOM. Require an allowlisted source, target `ceb`, and text category; exclude names, comments, receipt OCR, legal/financial content, and identifiers; keep provider credentials server-side; enforce input limits, authentication, rate limits, and an explicit fallback to source text; cache by source hash + source/target locale; and allow reviewed overrides to take precedence over machine suggestions. A free public proxy is suitable only for a disposable prototype with synthetic data, not production. Use Google Translate only where its current product terms/data processing are acceptable, and prefer it for public content outside the authenticated React application. Any paid/hosted provider needs budget approval.

Keep database content distinct from UI copy. Translate finite application-owned values (for example, status codes and fixed error templates) by mapping their stable codes to catalog keys. Do not translate project names, vendor names, product descriptions, comments, receipt text, legal clauses, monetary values, or identifiers at render time. These values may be user-authored, contractually meaningful, or required to match source records. Legal/financial text should only receive a separate Bisaya version after qualified human review and an approval process.

## Coverage in this change

The toggle and persistence are installed at the application level. Current catalog usage localizes the web sign-in form, sidebar, header/breadcrumbs, and dashboard. Mobile localizes sign-in, settings, purchaser tabs, requests, expenses, Site Manager bottom navigation, and the Site Manager task dashboard. Other routes currently retain their English hard-coded copy until those components are migrated to `useLocale()` and their labels are added to both catalogs; they stay usable and fall back to English. Machine translation of arbitrary dynamic content is not implemented by design.

The Cebuano entries in this first pass are conversational draft UI copy and should be reviewed by a native Cebuano speaker before treating the app as a complete or legally authoritative Bisaya localization.
