// Shrinks a receipt photo before upload. A full-resolution phone photo is
// 3-6 MB, which is the slowest and most failure-prone step on prepaid data.
// 1600px on the long edge is still plenty for OCR to read thermal print.
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const LONG_EDGE = 1600;
const JPEG_QUALITY = 0.6;

export type CompressedImage = { uri: string; mimeType: "image/jpeg"; width: number; height: number };

// width/height are the picker's reported size; 0 or missing means unknown,
// in which case the image is only re-encoded, not resized.
export async function compressReceiptImage(uri: string, width?: number, height?: number): Promise<CompressedImage> {
  const context = ImageManipulator.manipulate(uri);
  if (width && height && Math.max(width, height) > LONG_EDGE) {
    // Setting one side keeps the aspect ratio.
    context.resize(width >= height ? { width: LONG_EDGE, height: null } : { width: null, height: LONG_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri, mimeType: "image/jpeg", width: saved.width, height: saved.height };
}

const AVATAR_EDGE = 512;

// A profile picture only needs to look sharp in a small circle: 512px, JPEG.
export async function compressAvatarImage(uri: string, width?: number, height?: number): Promise<CompressedImage> {
  const context = ImageManipulator.manipulate(uri);
  if (width && height && Math.max(width, height) > AVATAR_EDGE) {
    context.resize(width >= height ? { width: AVATAR_EDGE, height: null } : { width: null, height: AVATAR_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return { uri: saved.uri, mimeType: "image/jpeg", width: saved.width, height: saved.height };
}
