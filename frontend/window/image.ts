// Turns a chosen picture into a PNG or JPG Steam accepts; the pure first half is tested in tests/image.test.ts, the
// browser half through tests/e2e.mjs.
import type { ArtSlot } from "./model.ts";

export type ImageKind = "png" | "jpg" | "gif" | "webp" | "bmp" | "ico" | "avif" | "tiff";

/** Extensions only, because Steam's file window shows nothing for a type like "image/png". */
export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.ico,.avif";

export const IMAGE_MIME: Record<ImageKind, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    avif: "image/avif",
    tiff: "image/tiff",
};

/** Same limit as the backend's for a picture file. */
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** Largest size a slot's picture is scaled down to, about twice what Steam shows the slot at. */
export const SLOT_MAX: Record<ArtSlot, { width: number; height: number }> = {
    portrait: { width: 1200, height: 1800 },
    hero: { width: 3840, height: 2160 },
    logo: { width: 2560, height: 1440 },
    wide: { width: 1920, height: 1080 },
    icon: { width: 256, height: 256 },
};

const ascii = (bytes: Uint8Array, from: number, length: number): string => String.fromCharCode(...bytes.subarray(from, from + length));

/** The image kind by signature, or undefined when it is not a known image. */
export function kindOf(bytes: Uint8Array): ImageKind | undefined {
    if (bytes.length < 12) return undefined;
    const b = bytes;
    if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
    const head = ascii(b, 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "gif";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
    if (ascii(b, 4, 4) === "ftyp" && (ascii(b, 8, 4) === "avif" || ascii(b, 8, 4) === "avis")) return "avif";
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b[4]! + b[5]! * 256 > 0) return "ico";
    if ((ascii(b, 0, 2) === "II" && b[2] === 42 && b[3] === 0) || (ascii(b, 0, 2) === "MM" && b[2] === 0 && b[3] === 42)) return "tiff";
    // "BM" alone is too weak a signature, so the header size that follows must be a valid bitmap one.
    if (ascii(b, 0, 2) === "BM" && bytes.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(b[14]! + b[15]! * 256 + b[16]! * 65536 + b[17]! * 16777216)) return "bmp";
    return undefined;
}

/** A size that fits in `max` with the same proportions, never larger than the picture itself. */
export function fit(width: number, height: number, max: { width: number; height: number }): { width: number; height: number } {
    const scale = Math.min(1, max.width / width, max.height / height);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type ImagePlan = { keep: true } | { keep: false; width: number; height: number; type: "png" | "jpg" };

/**
 * Keeps a fitting PNG or JPG (icon: PNG only) byte for byte, otherwise redraws it as PNG, or as JPG for an opaque
 * photo-like source (JPG, WebP, AVIF) outside the logo and icon slots, where a PNG would be far larger for no gain.
 */
export function planImage(kind: ImageKind, width: number, height: number, slot: ArtSlot, opaque: boolean): ImagePlan {
    const size = fit(width, height, SLOT_MAX[slot]);
    const fits = size.width === width && size.height === height;
    if (fits && (kind === "png" || (kind === "jpg" && slot !== "icon"))) return { keep: true };
    const photo = kind === "jpg" || ((kind === "webp" || kind === "avif") && opaque);
    return { keep: false, ...size, type: photo && slot !== "logo" && slot !== "icon" ? "jpg" : "png" };
}

/** Size of the clear logo a "No Logo" game gets: half of Steam's 1280 x 720 logo template, so it looks ordinary to Steam. */
export const NO_LOGO_SIZE = { width: 640, height: 360 };

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A fully see-through 8-bit RGBA PNG, built byte by byte so no picture file ships with the plugin. */
export async function clearPng(width: number, height: number): Promise<Uint8Array> {
    const chunk = (kind: string, body: Uint8Array): Uint8Array => {
        const out = new Uint8Array(12 + body.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, body.length);
        for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i);
        out.set(body, 8);
        view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
        return out;
    };
    const head = new Uint8Array(13);
    const view = new DataView(head.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    head.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, red green blue alpha, no interlace
    // Each row is a filter byte (0: none) plus four zero bytes a pixel, which is black and fully see-through.
    const rows = await deflate(new Uint8Array(height * (1 + width * 4)));
    const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", rows), chunk("IEND", new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

export function bytesOfBase64(base64: string): Uint8Array | undefined {
    try {
        const text = atob(base64);
        const out = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
        return out;
    } catch {
        return undefined;
    }
}

export function base64OfBytes(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

// ---------- from here on: a browser ----------

export type Prepared = { base64: string; ext: "png" | "jpg"; error?: undefined } | { error: string };

type Drawable = { width: number; height: number; source: CanvasImageSource; done(): void };

/** Decodes the picture (first frame if animated), or gives undefined when it cannot be read. */
async function decode(bytes: Uint8Array, kind: ImageKind): Promise<Drawable | undefined> {
    const blob = new Blob([bytes as BlobPart], { type: IMAGE_MIME[kind] });
    try {
        const bitmap = await createImageBitmap(blob);
        return { width: bitmap.width, height: bitmap.height, source: bitmap, done: () => bitmap.close() };
    } catch {
        /* an <img> reads a few files createImageBitmap does not */
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        if (!img.naturalWidth || !img.naturalHeight) return undefined;
        return { width: img.naturalWidth, height: img.naturalHeight, source: img, done: () => URL.revokeObjectURL(url) };
    } catch {
        URL.revokeObjectURL(url);
        return undefined;
    }
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return ctx ? { canvas, ctx } : undefined;
}

function isOpaque(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return false;
    return true;
}

function encode(canvas: HTMLCanvasElement, type: "png" | "jpg"): Promise<Uint8Array | undefined> {
    return new Promise((resolve) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) return resolve(undefined);
                void blob.arrayBuffer().then(
                    (buffer) => resolve(new Uint8Array(buffer)),
                    () => resolve(undefined),
                );
            },
            type === "jpg" ? "image/jpeg" : "image/png",
            type === "jpg" ? 0.92 : undefined,
        );
    });
}

/** The picture as Steam takes it for `slot`, kept as is or redrawn, or an error of "unsupported" or "too-large". */
export async function prepareImage(base64: string, slot: ArtSlot): Promise<Prepared> {
    const bytes = bytesOfBase64(base64);
    const kind = bytes && kindOf(bytes);
    if (!bytes || !kind) return { error: "unsupported" };
    if (bytes.length > MAX_IMAGE_BYTES) return { error: "too-large" };
    const picture = await decode(bytes, kind);
    if (!picture) return { error: "unsupported" };
    try {
        // Keeping the bytes depends on size alone, so opacity is only checked for a picture that is redrawn.
        const first = planImage(kind, picture.width, picture.height, slot, false);
        if (first.keep) return { base64, ext: kind === "jpg" ? "jpg" : "png" };
        const drawn = canvasOf(first.width, first.height);
        if (!drawn) return { error: "unsupported" };
        drawn.ctx.imageSmoothingQuality = "high";
        drawn.ctx.drawImage(picture.source, 0, 0, first.width, first.height);
        const plan = planImage(kind, picture.width, picture.height, slot, isOpaque(drawn.ctx, first.width, first.height));
        if (plan.keep) return { base64, ext: kind === "jpg" ? "jpg" : "png" };
        const out = await encode(drawn.canvas, plan.type);
        if (!out) return { error: "unsupported" };
        if (out.length > MAX_IMAGE_BYTES) return { error: "too-large" };
        return { base64: base64OfBytes(out), ext: plan.type };
    } finally {
        picture.done();
    }
}
