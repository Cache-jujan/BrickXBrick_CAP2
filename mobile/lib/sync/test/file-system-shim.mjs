// Test stand-in for "expo-file-system/legacy": records calls, and lets a test
// decide what exists and how the upload answers.
export const FileSystemUploadType = { MULTIPART: 1 };

export const fs = {
  existing: new Set(),
  uploads: [],
  deleted: [],
  // (url, path) => ({ status, body }) | throws
  uploadHandler: async () => ({ status: 201, body: JSON.stringify({ photoUrl: "https://r2/tasks/x/p.jpg" }) }),
  reset() {
    this.existing = new Set();
    this.uploads = [];
    this.deleted = [];
    this.uploadHandler = async () => ({ status: 201, body: JSON.stringify({ photoUrl: "https://r2/tasks/x/p.jpg" }) });
  },
};

export async function getInfoAsync(path) {
  return { exists: fs.existing.has(path) };
}
export async function uploadAsync(url, path, options) {
  fs.uploads.push({ url, path, options });
  return fs.uploadHandler(url, path, options);
}
export async function deleteAsync(path) {
  fs.deleted.push(path);
  fs.existing.delete(path);
}
