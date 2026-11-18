// What happens to a Purchase Order PDF once it is made: save it on the phone, open it, share it.
// The PDF lives in this app's cache (written from base64, so the share sheet can always read it, also in
// Expo Go). "Download" copies it to a folder the person picks (Android) or hands it to Files (iPhone).
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export type PoFile = {
  poNumber: string;
  /** The copy in the app's cache. Always readable by this app and the share sheet. */
  cacheUri: string;
  base64: string;
  /** Where "Download" saved it (a content:// address on Android); null until downloaded. */
  savedUri: string | null;
};

/** Writes the PDF's bytes into the app's cache under the PO's own name ("PO-2026-001.pdf"). */
export async function writePoToCache(poNumber: string, base64: string): Promise<PoFile> {
  const cacheUri = `${FileSystem.cacheDirectory}${poNumber}.pdf`;
  await FileSystem.writeAsStringAsync(cacheUri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return { poNumber, cacheUri, base64, savedUri: null };
}

// The folder the person picked for downloads, remembered until the app closes so a second PO does not ask again.
let downloadFolder: string | null = null;

async function pickFolder(): Promise<string | null> {
  const picked = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  downloadFolder = picked.granted ? picked.directoryUri : null;
  return downloadFolder;
}

/**
 * Saves the PDF on the phone. Android: into a folder the person picks once (Downloads is the usual choice).
 * iPhone: the share sheet, whose "Save to Files" does the same.
 * @returns where it was saved, or null if the person backed out of the folder picker.
 */
export async function downloadPo(file: PoFile): Promise<string | null> {
  if (Platform.OS !== "android") {
    await sharePo(file);
    return file.cacheUri;
  }
  const saf = FileSystem.StorageAccessFramework;
  const save = async (folder: string) => {
    const uri = await saf.createFileAsync(folder, file.poNumber, "application/pdf");
    await FileSystem.writeAsStringAsync(uri, file.base64, { encoding: FileSystem.EncodingType.Base64 });
    return uri;
  };
  const folder = downloadFolder ?? (await pickFolder());
  if (!folder) return null;
  try {
    return await save(folder);
  } catch {
    // The remembered folder is gone or no longer allowed: ask once more.
    const again = await pickFolder();
    return again ? save(again) : null;
  }
}

/** Opens the PDF in whatever PDF viewer the phone has. Throws when there is none. */
export async function openPo(file: PoFile): Promise<void> {
  if (Platform.OS !== "android") {
    await Print.printAsync({ uri: file.cacheUri }); // a full-screen preview of the PDF
    return;
  }
  const data = file.savedUri?.startsWith("content://") ? file.savedUri : await FileSystem.getContentUriAsync(file.cacheUri);
  // flags 1 = FLAG_GRANT_READ_URI_PERMISSION: lets the viewer read the file.
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data, flags: 1, type: "application/pdf" });
}

/** The phone's share sheet (WhatsApp, email, Drive, print...). */
export async function sharePo(file: PoFile, dialogTitle?: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.cacheUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: dialogTitle ?? file.poNumber });
  } else {
    await Print.printAsync({ uri: file.cacheUri });
  }
}
