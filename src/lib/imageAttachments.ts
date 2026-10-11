/**
 * Image attachments for the playground -- the pure half.
 *
 * The contract (`MessageContent`) takes inline base64 PNG or JPEG data
 * URLs with hard limits: four images per request, 5 MiB decoded each,
 * 10 MiB decoded total, 16 million pixels each, maximum dimension
 * 8192, and remote URLs are never fetched. Everything here mirrors
 * those limits on the client so the refusal names the file and the
 * number BEFORE a multi-megabyte body crosses the wire and comes back
 * as a 400 about nothing in particular.
 *
 * **Dimensions are read off the file's own header** -- PNG IHDR, JPEG
 * SOF -- rather than by decoding the image. That keeps every check a
 * pure function of bytes, testable without a browser (jsdom cannot
 * decode images), and free: nothing allocates 16 million pixels to
 * learn the file has 17.
 */

import type { ImageContentPart, MessageContentPart } from "./types";

/** The contract's own numbers, named once. */
export const MAX_IMAGES_PER_REQUEST = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_IMAGE_DIMENSION = 8192;

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];

export function isImageMime(type: string): type is ImageMime {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type);
}

export interface ImageAttachment {
  name: string;
  mime: ImageMime;
  /** The file's own bytes -- what "decoded" means in the contract's
   * limits, since the wire form is these bytes base64-encoded. */
  size: number;
  width: number;
  height: number;
  /** `data:<mime>;base64,...`, the only URL form the gateway accepts. */
  dataUrl: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

function readU32(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readU16(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG: the eight-byte signature, then the IHDR chunk, whose first two
 * fields are width and height -- fixed offsets, by specification. */
export function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  for (const [i, expected] of PNG_SIGNATURE.entries()) {
    if (bytes[i] !== expected) return null;
  }
  // Bytes 12-15 must spell IHDR; a PNG whose first chunk is not IHDR
  // is not a PNG the specification allows.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  if (width === null || height === null || width === 0 || height === 0) return null;
  return { width, height };
}

/** Every JPEG SOF marker: C0-CF except C4 (Huffman tables), C8 (JPG
 * extension) and CC (arithmetic conditioning), which carry no frame. */
function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** JPEG: walk the marker stream to the first start-of-frame, which
 * carries height then width. Segment lengths include their own two
 * bytes, so a malformed length that fails to advance is a broken file
 * rather than a loop. */
export function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    // Padding and restart markers have no length field.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end / scan data: no SOF seen
    const length = readU16(bytes, offset + 2);
    if (length === null || length < 2) return null;
    if (isSofMarker(marker)) {
      const height = readU16(bytes, offset + 5);
      const width = readU16(bytes, offset + 7);
      if (height === null || width === null || height === 0 || width === 0) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageDimensions(mime: ImageMime, bytes: Uint8Array): ImageDimensions | null {
  return mime === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
}

/**
 * Whether one image can ride a request, and if not, why -- the same
 * shape `checkAttachment` gives text files. Only the PER-IMAGE limits
 * live here; the count and the total are properties of the request and
 * are checked where the request is assembled.
 */
export function checkImageAttachment(name: string, mime: string, bytes: Uint8Array): string | null {
  if (!isImageMime(mime)) {
    return `${name}: only PNG and JPEG images can be attached.`;
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    const mb = (bytes.length / 1_048_576).toFixed(1);
    return `${name} is ${mb} MB; images stop at 5 MB each.`;
  }
  const dims = imageDimensions(mime, bytes);
  if (dims === null) {
    return `${name} does not read as a valid ${mime === "image/png" ? "PNG" : "JPEG"} file.`;
  }
  if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
    return `${name} is ${dims.width}×${dims.height}; the longest side stops at ${MAX_IMAGE_DIMENSION} pixels.`;
  }
  if (dims.width * dims.height > MAX_IMAGE_PIXELS) {
    return `${name} is ${dims.width}×${dims.height} = ${((dims.width * dims.height) / 1e6).toFixed(1)} megapixels; images stop at 16.`;
  }
  return null;
}

/** The request-level limits: how many, and how much altogether. */
export function checkImageSet(images: ReadonlyArray<{ size: number }>): string | null {
  if (images.length > MAX_IMAGES_PER_REQUEST) {
    return `${images.length} images attached; a request carries at most ${MAX_IMAGES_PER_REQUEST}.`;
  }
  const total = images.reduce((sum, image) => sum + image.size, 0);
  if (total > MAX_TOTAL_IMAGE_BYTES) {
    return `The images total ${(total / 1_048_576).toFixed(1)} MB; a request stops at 10 MB of images.`;
  }
  return null;
}

/** Base64 without the call-stack limit `String.fromCharCode(...whole)`
 * hits on a megabyte file. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function toDataUrl(mime: ImageMime, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export function toImagePart(image: ImageAttachment): ImageContentPart {
  return { type: "image_url", image_url: { url: image.dataUrl } };
}

/**
 * Text plus images, as the wire carries them.
 *
 * **A message with no images stays a plain string**, so every request
 * the playground could send before this existed is byte-for-byte
 * unchanged -- the same rule `buildChatRequest` follows for the
 * sampling fields. With images, the text (which already has any text
 * attachments inlined) becomes the first part and the images follow in
 * the order they were attached.
 */
export function buildMessageContent(
  text: string,
  images: ReadonlyArray<ImageAttachment>,
): string | MessageContentPart[] {
  if (images.length === 0) return text;
  const parts: MessageContentPart[] = [];
  if (text !== "") parts.push({ type: "text", text });
  for (const image of images) parts.push(toImagePart(image));
  return parts;
}
