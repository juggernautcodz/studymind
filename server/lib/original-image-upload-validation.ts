import { createHash } from "node:crypto";
import { z } from "zod";

export const ORIGINAL_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const ORIGINAL_IMAGE_MAX_OCR_TEXT_LENGTH = 250_000;

export const originalImageUploadParams = z.object({
  courseId: z.string().min(1).max(100),
  topicId: z.string().min(1).max(100),
});

export const uploadIdSchema = z
  .string()
  .uuid()
  .refine(
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
    "uploadId must be a UUID v4",
  );

export type OriginalImageMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif";

const MIME_EXTENSIONS: Record<OriginalImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function fourCc(value: string): number {
  return (
    ((value.charCodeAt(0) << 24) |
      (value.charCodeAt(1) << 16) |
      (value.charCodeAt(2) << 8) |
      value.charCodeAt(3)) >>>
    0
  );
}

function readFourCc(
  bytes: Buffer,
  offset: number,
  end = bytes.length,
): number | undefined {
  if (offset < 0 || offset + 4 > end) return undefined;
  for (let index = 0; index < 4; index++) {
    const byte = bytes[offset + index];
    if (byte < 0x20 || byte > 0x7e) return undefined;
  }
  return bytes.readUInt32BE(offset);
}

const PNG_CHUNKS = {
  IHDR: fourCc("IHDR"),
  PLTE: fourCc("PLTE"),
  IDAT: fourCc("IDAT"),
  IEND: fourCc("IEND"),
  cHRM: fourCc("cHRM"),
  gAMA: fourCc("gAMA"),
  iCCP: fourCc("iCCP"),
  sBIT: fourCc("sBIT"),
  sRGB: fourCc("sRGB"),
  bKGD: fourCc("bKGD"),
  hIST: fourCc("hIST"),
  tRNS: fourCc("tRNS"),
  pHYs: fourCc("pHYs"),
  sPLT: fourCc("sPLT"),
} as const;

const PNG_PRE_IDAT_ANCILLARY = new Set([
  PNG_CHUNKS.cHRM,
  PNG_CHUNKS.gAMA,
  PNG_CHUNKS.iCCP,
  PNG_CHUNKS.sBIT,
  PNG_CHUNKS.sRGB,
  PNG_CHUNKS.bKGD,
  PNG_CHUNKS.hIST,
  PNG_CHUNKS.tRNS,
  PNG_CHUNKS.pHYs,
  PNG_CHUNKS.sPLT,
]);

function findNullWithin(
  bytes: Buffer,
  start: number,
  end: number,
): number | undefined {
  const relative = bytes.subarray(start, end).indexOf(0);
  return relative < 0 ? undefined : start + relative;
}

function crc32(bytes: Buffer, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasPngStructure(bytes: Buffer): boolean {
  try {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE))
      return false;
    let offset = 8;
    let sawIhdr = false;
    let sawIdat = false;
    let sawPlte = false;
    let idatEnded = false;
    const seenKnownChunks = new Set<number>();
    const suggestedPaletteNames = new Set<string>();
    const zlibHeader: number[] = [];
    let idatLength = 0;
    let colorType: number | undefined;
    let bitDepth: number | undefined;
    let paletteEntries = 0;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) return false;
      const length = bytes.readUInt32BE(offset);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunkEnd = dataEnd + 4;
      if (dataEnd < dataStart || chunkEnd < dataEnd || chunkEnd > bytes.length)
        return false;
      const type = readFourCc(bytes, offset + 4, dataStart);
      if (type === undefined) return false;
      for (let index = offset + 4; index < dataStart; index++) {
        const byte = bytes[index];
        if (!((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)))
          return false;
      }
      if (
        (bytes[offset + 6] & 0x20) !== 0 ||
        crc32(bytes, offset + 4, dataEnd) !== bytes.readUInt32BE(dataEnd)
      )
        return false;
      if (!sawIhdr) {
        if (type !== PNG_CHUNKS.IHDR || length !== 13) return false;
        const width = bytes.readUInt32BE(dataStart);
        const height = bytes.readUInt32BE(dataStart + 4);
        const depth = bytes[dataStart + 8];
        const color = bytes[dataStart + 9];
        const validDepth =
          (color === 0 && [1, 2, 4, 8, 16].includes(depth)) ||
          (color === 2 && [8, 16].includes(depth)) ||
          (color === 3 && [1, 2, 4, 8].includes(depth)) ||
          ((color === 4 || color === 6) && [8, 16].includes(depth));
        if (
          !width ||
          !height ||
          !validDepth ||
          bytes[dataStart + 10] !== 0 ||
          bytes[dataStart + 11] !== 0 ||
          bytes[dataStart + 12] > 1
        )
          return false;
        colorType = color;
        bitDepth = depth;
        sawIhdr = true;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.IHDR) {
        return false;
      } else if (type === PNG_CHUNKS.PLTE) {
        if (
          sawPlte ||
          sawIdat ||
          colorType === 0 ||
          colorType === 4 ||
          length === 0 ||
          length > 768 ||
          length % 3 !== 0
        )
          return false;
        if (
          colorType === 3 &&
          bitDepth !== undefined &&
          length / 3 > 2 ** bitDepth
        )
          return false;
        sawPlte = true;
        paletteEntries = length / 3;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.cHRM) {
        if (seenKnownChunks.has(type) || sawPlte || sawIdat || length !== 32)
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.gAMA) {
        if (
          seenKnownChunks.has(type) ||
          sawPlte ||
          sawIdat ||
          length !== 4 ||
          bytes.readUInt32BE(dataStart) === 0
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.iCCP) {
        const separator = findNullWithin(bytes, dataStart, dataEnd);
        if (
          seenKnownChunks.has(type) ||
          sawPlte ||
          sawIdat ||
          seenKnownChunks.has(PNG_CHUNKS.sRGB) ||
          length < 4 ||
          separator === undefined ||
          separator === dataStart ||
          separator - dataStart > 79 ||
          separator + 2 >= dataEnd ||
          bytes[separator + 1] !== 0
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.sBIT) {
        const expectedLength =
          colorType === 0
            ? 1
            : colorType === 2 || colorType === 3
              ? 3
              : colorType === 4
                ? 2
                : colorType === 6
                  ? 4
                  : 0;
        const maximum = colorType === 3 ? 8 : (bitDepth ?? 0);
        if (
          seenKnownChunks.has(type) ||
          sawPlte ||
          sawIdat ||
          length !== expectedLength
        )
          return false;
        for (let index = dataStart; index < dataEnd; index++)
          if (bytes[index] === 0 || bytes[index] > maximum) return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.pHYs) {
        if (
          seenKnownChunks.has(type) ||
          sawIdat ||
          length !== 9 ||
          bytes[dataEnd - 1] > 1
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.sRGB) {
        if (
          seenKnownChunks.has(type) ||
          seenKnownChunks.has(PNG_CHUNKS.iCCP) ||
          sawPlte ||
          sawIdat ||
          length !== 1 ||
          bytes[dataStart] > 3
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.bKGD) {
        const expectedLength =
          colorType === 0 || colorType === 4
            ? 2
            : colorType === 2 || colorType === 6
              ? 6
              : colorType === 3
                ? 1
                : 0;
        if (
          seenKnownChunks.has(type) ||
          sawIdat ||
          length !== expectedLength ||
          (colorType === 3 && (!sawPlte || bytes[dataStart] >= paletteEntries))
        )
          return false;
        const maximum =
          bitDepth === 16
            ? 0xffff
            : bitDepth === undefined
              ? 0
              : 2 ** bitDepth - 1;
        if (
          (colorType === 0 || colorType === 4) &&
          bytes.readUInt16BE(dataStart) > maximum
        )
          return false;
        if (
          (colorType === 2 || colorType === 6) &&
          [0, 2, 4].some(
            (delta) => bytes.readUInt16BE(dataStart + delta) > maximum,
          )
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.hIST) {
        if (
          seenKnownChunks.has(type) ||
          sawIdat ||
          !sawPlte ||
          length !== paletteEntries * 2
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.tRNS) {
        if (
          seenKnownChunks.has(type) ||
          sawIdat ||
          colorType === 4 ||
          colorType === 6
        )
          return false;
        const maximum =
          bitDepth === 16
            ? 0xffff
            : bitDepth === undefined
              ? 0
              : 2 ** bitDepth - 1;
        if (
          colorType === 0 &&
          (length !== 2 || bytes.readUInt16BE(dataStart) > maximum)
        )
          return false;
        if (
          colorType === 2 &&
          (length !== 6 ||
            [0, 2, 4].some(
              (delta) => bytes.readUInt16BE(dataStart + delta) > maximum,
            ))
        )
          return false;
        if (
          colorType === 3 &&
          (!sawPlte || length < 1 || length > paletteEntries)
        )
          return false;
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.sPLT) {
        const separator = findNullWithin(bytes, dataStart, dataEnd);
        if (
          sawIdat ||
          length < 9 ||
          separator === undefined ||
          separator === dataStart ||
          separator - dataStart > 79 ||
          separator + 1 >= dataEnd
        )
          return false;
        const name = bytes.toString("latin1", dataStart, separator);
        const sampleDepth = bytes[separator + 1];
        const entrySize = sampleDepth === 8 ? 6 : sampleDepth === 16 ? 10 : 0;
        if (
          !entrySize ||
          suggestedPaletteNames.has(name) ||
          dataEnd - separator - 2 === 0 ||
          (dataEnd - separator - 2) % entrySize !== 0
        )
          return false;
        suggestedPaletteNames.add(name);
        seenKnownChunks.add(type);
      } else if (type === PNG_CHUNKS.IDAT) {
        if (!length || idatEnded || (colorType === 3 && !sawPlte)) return false;
        for (
          let index = dataStart;
          index < dataEnd && zlibHeader.length < 2;
          index++
        )
          zlibHeader.push(bytes[index]);
        idatLength += length;
        sawIdat = true;
      } else if (type === PNG_CHUNKS.IEND) {
        if (
          length !== 0 ||
          !sawIdat ||
          chunkEnd !== bytes.length ||
          zlibHeader.length !== 2 ||
          idatLength < 8
        )
          return false;
        const [cmf, flg] = zlibHeader;
        return (
          (cmf & 0x0f) === 8 &&
          cmf >> 4 <= 7 &&
          ((cmf << 8) | flg) % 31 === 0 &&
          (flg & 0x20) === 0
        );
      } else {
        // PNG requires these known ancillary chunks before the first IDAT.
        if (sawIdat && PNG_PRE_IDAT_ANCILLARY.has(type)) return false;
        if (sawIdat) idatEnded = true;
        // Unknown critical chunks cannot be interpreted safely. Ancillary chunks
        // remain permitted because their first type byte is lowercase.
        if ((bytes[offset + 4] & 0x20) === 0) return false;
      }
      offset = chunkEnd;
    }
  } catch {
    /* malformed byte sequences must be rejected, never surfaced */
  }
  return false;
}

function hasJpegStructure(bytes: Buffer): boolean {
  if (bytes.length < 23 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  let inScan = false;
  let frameMarker: number | undefined;
  let frameComponents: Map<number, number> | undefined;
  const quantizationTables = new Set<number>();
  const huffmanTables = new Set<string>();
  const scannedFrameComponents = new Set<number>();
  const progressiveDcApproximation = new Map<number, number>();
  const progressiveAcApproximation = new Map<
    number,
    Array<number | undefined>
  >();
  let sawScan = false;
  let iterations = 0;
  while (offset < bytes.length) {
    if (++iterations > bytes.length) return false;
    if (inScan) {
      if (bytes[offset++] !== 0xff) continue;
    } else if (bytes[offset++] !== 0xff) {
      return false;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length || frameComponents === undefined || !sawScan)
        return false;
      return frameMarker === 0xc2
        ? [...frameComponents.keys()].every((componentId) =>
            progressiveDcApproximation.has(componentId),
          )
        : scannedFrameComponents.size === frameComponents.size &&
            [...frameComponents.keys()].every((componentId) =>
              scannedFrameComponents.has(componentId),
            );
    }
    if (inScan && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)))
      continue;
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      return false;
    inScan = false;
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    const dataStart = offset + 2;
    const dataEnd = offset + length;

    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (![0xc0, 0xc1, 0xc2].includes(marker) || frameComponents) return false;
      if (length < 11) return false;
      const precision = bytes[dataStart];
      const height = bytes.readUInt16BE(dataStart + 1);
      const width = bytes.readUInt16BE(dataStart + 3);
      const componentCount = bytes[dataStart + 5];
      if (
        ![8, 12].includes(precision) ||
        (marker === 0xc0 && precision !== 8) ||
        !width ||
        !height ||
        componentCount < 1 ||
        componentCount > 4 ||
        length !== 8 + 3 * componentCount
      )
        return false;
      const components = new Map<number, number>();
      for (let index = 0; index < componentCount; index++) {
        const componentOffset = dataStart + 6 + index * 3;
        const componentId = bytes[componentOffset];
        const sampling = bytes[componentOffset + 1];
        const quantizationTable = bytes[componentOffset + 2];
        if (
          components.has(componentId) ||
          sampling >> 4 < 1 ||
          sampling >> 4 > 4 ||
          (sampling & 15) < 1 ||
          (sampling & 15) > 4 ||
          quantizationTable > 3
        )
          return false;
        components.set(componentId, quantizationTable);
      }
      frameMarker = marker;
      frameComponents = components;
    } else if (marker === 0xdb) {
      for (let tableOffset = dataStart; tableOffset < dataEnd; ) {
        const definition = bytes[tableOffset++];
        const precision = definition >> 4;
        const tableId = definition & 15;
        const tableBytes = precision === 0 ? 64 : precision === 1 ? 128 : 0;
        if (!tableBytes || tableId > 3 || tableOffset + tableBytes > dataEnd)
          return false;
        quantizationTables.add(tableId);
        tableOffset += tableBytes;
      }
    } else if (marker === 0xc4) {
      for (let tableOffset = dataStart; tableOffset < dataEnd; ) {
        if (tableOffset + 17 > dataEnd) return false;
        const definition = bytes[tableOffset++];
        const tableClass = definition >> 4;
        const tableId = definition & 15;
        if (tableClass > 1 || tableId > 3) return false;
        let symbolCount = 0;
        let availableCodes = 1;
        for (let index = 0; index < 16; index++) {
          const codesAtLength = bytes[tableOffset + index];
          availableCodes = availableCodes * 2 - codesAtLength;
          if (availableCodes < 0) return false;
          symbolCount += codesAtLength;
        }
        // JPEG reserves the all-ones code, so a completely filled prefix tree is
        // not a legal DHT even when it is not arithmetically oversubscribed.
        if (availableCodes === 0) return false;
        tableOffset += 16;
        if (
          symbolCount === 0 ||
          symbolCount > 256 ||
          tableOffset + symbolCount > dataEnd
        )
          return false;
        for (
          let index = tableOffset;
          index < tableOffset + symbolCount;
          index++
        ) {
          const symbol = bytes[index];
          if (tableClass === 0 && symbol > 15) return false;
          if (
            tableClass === 1 &&
            (symbol & 15) === 0 &&
            symbol >> 4 !== 0 &&
            symbol >> 4 !== 15
          )
            return false;
        }
        huffmanTables.add(`${tableClass}:${tableId}`);
        tableOffset += symbolCount;
      }
    } else if (marker === 0xda) {
      if (!frameComponents || length < 8) return false;
      const componentCount = bytes[dataStart];
      if (
        componentCount < 1 ||
        componentCount > frameComponents.size ||
        length !== 6 + 2 * componentCount
      )
        return false;
      const scanComponents = new Set<number>();
      for (let index = 0; index < componentCount; index++) {
        const componentOffset = dataStart + 1 + index * 2;
        const componentId = bytes[componentOffset];
        const tables = bytes[componentOffset + 1];
        if (
          !frameComponents.has(componentId) ||
          scanComponents.has(componentId) ||
          tables >> 4 > 3 ||
          (tables & 15) > 3
        )
          return false;
        if (frameMarker !== 0xc2 && scannedFrameComponents.has(componentId))
          return false;
        const quantizationTable = frameComponents.get(componentId);
        if (
          quantizationTable === undefined ||
          !quantizationTables.has(quantizationTable)
        )
          return false;
        scanComponents.add(componentId);
        scannedFrameComponents.add(componentId);
      }
      const spectralStart = bytes[dataEnd - 3];
      const spectralEnd = bytes[dataEnd - 2];
      const approximation = bytes[dataEnd - 1];
      if (
        spectralStart > spectralEnd ||
        spectralEnd > 63 ||
        approximation >> 4 > 13 ||
        (approximation & 15) > 13
      )
        return false;
      if (
        frameMarker === 0xc0 &&
        (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0)
      )
        return false;
      if (
        frameMarker === 0xc1 &&
        (spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0)
      )
        return false;
      if (frameMarker === 0xc2) {
        const successiveHigh = approximation >> 4;
        const successiveLow = approximation & 15;
        if (
          (spectralStart === 0 && spectralEnd !== 0) ||
          (spectralStart > 0 && componentCount !== 1)
        )
          return false;
        if (successiveHigh !== 0 && successiveHigh !== successiveLow + 1)
          return false;
        if (spectralStart === 0) {
          for (const componentId of scanComponents) {
            const previous = progressiveDcApproximation.get(componentId);
            if (successiveHigh === 0) {
              if (previous !== undefined) return false;
            } else if (previous !== successiveHigh) {
              return false;
            }
            progressiveDcApproximation.set(componentId, successiveLow);
          }
        } else {
          const componentId = scanComponents.values().next().value as number;
          if (
            !progressiveDcApproximation.has(componentId) ||
            [...frameComponents.keys()].some(
              (id) => !progressiveDcApproximation.has(id),
            )
          )
            return false;
          let coefficients = progressiveAcApproximation.get(componentId);
          if (!coefficients) {
            coefficients = Array<number | undefined>(64);
            progressiveAcApproximation.set(componentId, coefficients);
          }
          for (
            let coefficient = spectralStart;
            coefficient <= spectralEnd;
            coefficient++
          ) {
            const previous = coefficients[coefficient];
            if (
              successiveHigh === 0
                ? previous !== undefined
                : previous !== successiveHigh
            )
              return false;
          }
          for (
            let coefficient = spectralStart;
            coefficient <= spectralEnd;
            coefficient++
          )
            coefficients[coefficient] = successiveLow;
        }
      }
      for (let index = 0; index < componentCount; index++) {
        const tables = bytes[dataStart + 2 + index * 2];
        if (spectralStart === 0 && !huffmanTables.has(`0:${tables >> 4}`))
          return false;
        if (spectralEnd > 0 && !huffmanTables.has(`1:${tables & 15}`))
          return false;
      }
      sawScan = true;
    }
    offset += length;
    if (marker === 0xda) inScan = true;
  }
  return false;
}

function hasWebpStructure(bytes: Buffer): boolean {
  if (
    bytes.length < 20 ||
    readFourCc(bytes, 0) !== fourCc("RIFF") ||
    readFourCc(bytes, 8) !== fourCc("WEBP")
  )
    return false;
  const declaredSize = bytes.readUInt32LE(4);
  if (declaredSize !== bytes.length - 8 || declaredSize < 12) return false;
  let offset = 12;
  let imageChunks = 0;
  let sawExtendedHeader = false;
  let sawAlpha = false;
  let sawIccp = false;
  let sawExif = false;
  let sawXmp = false;
  let extendedFlags = 0;
  let canvasWidth: number | undefined;
  let canvasHeight: number | undefined;
  let imageWidth: number | undefined;
  let imageHeight: number | undefined;
  let imageHasAlpha = false;
  let previousType: number | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    const type = readFourCc(bytes, offset);
    const length = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (type === undefined || length === 0 || end > bytes.length) return false;
    if (type === fourCc("VP8X")) {
      if (sawExtendedHeader || offset !== 12 || length !== 10) return false;
      extendedFlags = bytes[offset + 8];
      if (
        (extendedFlags & 0xc1) !== 0 ||
        (extendedFlags & 0x02) !== 0 ||
        bytes[offset + 9] !== 0 ||
        bytes[offset + 10] !== 0 ||
        bytes[offset + 11] !== 0
      )
        return false;
      canvasWidth = bytes.readUIntLE(offset + 12, 3) + 1;
      canvasHeight = bytes.readUIntLE(offset + 15, 3) + 1;
      sawExtendedHeader = true;
    } else if (type === fourCc("ALPH")) {
      if (
        !sawExtendedHeader ||
        sawAlpha ||
        imageChunks ||
        canvasWidth === undefined ||
        canvasHeight === undefined ||
        !(extendedFlags & 0x10)
      )
        return false;
      const control = bytes[offset + 8];
      const compressionMethod = control & 3;
      if (
        (control & 0xc0) !== 0 ||
        compressionMethod > 1 ||
        ((control >> 4) & 3) > 1
      )
        return false;
      if (
        compressionMethod === 0
          ? length !== 1 + canvasWidth * canvasHeight
          : length < 3
      )
        return false;
      sawAlpha = true;
    } else if (type === fourCc("ICCP")) {
      if (!sawExtendedHeader || sawIccp || imageChunks) return false;
      sawIccp = true;
    } else if (type === fourCc("EXIF") || type === fourCc("XMP ")) {
      if (
        !sawExtendedHeader ||
        imageChunks !== 1 ||
        (type === fourCc("EXIF") ? sawExif : sawXmp)
      )
        return false;
      if (type === fourCc("EXIF")) sawExif = true;
      else sawXmp = true;
    } else if (type === fourCc("ANIM") || type === fourCc("ANMF")) {
      // Animated WebP remains intentionally unsupported by this upload path.
      return false;
    } else if (type === fourCc("VP8 ")) {
      imageChunks++;
      if (
        imageChunks > 1 ||
        (!sawExtendedHeader && offset !== 12) ||
        (sawAlpha && previousType !== fourCc("ALPH")) ||
        length < 11
      )
        return false;
      const payload = offset + 8;
      const frameTag =
        bytes[payload] | (bytes[payload + 1] << 8) | (bytes[payload + 2] << 16);
      const firstPartitionLength = frameTag >>> 5;
      if (
        (frameTag & 1) !== 0 ||
        (frameTag & 0x10) === 0 ||
        firstPartitionLength === 0 ||
        firstPartitionLength > length - 10 ||
        bytes[payload + 3] !== 0x9d ||
        bytes[payload + 4] !== 0x01 ||
        bytes[payload + 5] !== 0x2a
      )
        return false;
      imageWidth = bytes.readUInt16LE(payload + 6) & 0x3fff;
      imageHeight = bytes.readUInt16LE(payload + 8) & 0x3fff;
      if (!imageWidth || !imageHeight) return false;
    } else if (type === fourCc("VP8L")) {
      imageChunks++;
      if (
        imageChunks > 1 ||
        sawAlpha ||
        (!sawExtendedHeader && offset !== 12) ||
        length < 6
      )
        return false;
      const payload = offset + 8;
      const bits = bytes.readUInt32LE(payload + 1);
      if (bytes[payload] !== 0x2f || bits >>> 29 !== 0) return false;
      imageWidth = (bits & 0x3fff) + 1;
      imageHeight = ((bits >>> 14) & 0x3fff) + 1;
      imageHasAlpha = Boolean(bits & 0x10000000);
    }
    if (length % 2 && (end >= bytes.length || bytes[end] !== 0)) return false;
    previousType = type;
    offset = end + (length % 2);
  }
  if (imageChunks !== 1 || offset !== bytes.length) return false;
  if (!sawExtendedHeader) return !sawAlpha && !sawIccp && !sawExif && !sawXmp;
  if (
    imageWidth === undefined ||
    imageHeight === undefined ||
    canvasWidth === undefined ||
    canvasHeight === undefined ||
    imageWidth > canvasWidth ||
    imageHeight > canvasHeight
  )
    return false;
  return (
    Boolean(extendedFlags & 0x10) === (sawAlpha || imageHasAlpha) &&
    Boolean(extendedFlags & 0x20) === sawIccp &&
    Boolean(extendedFlags & 0x08) === sawExif &&
    Boolean(extendedFlags & 0x04) === sawXmp
  );
}

interface BmffBox {
  type: number;
  dataStart: number;
  end: number;
}
interface BmffExtent {
  offset: number;
  length: number;
}

const BMFF_MAX_BOXES = 4_096;
const BMFF_MAX_ITEMS = 1_024;
const BMFF_MAX_EXTENTS_PER_ITEM = 1_024;
const BMFF_MAX_TOTAL_EXTENTS = 4_096;
const BMFF_MAX_BRANDS = 256;
const BMFF_MAX_ITERATIONS = 16_384;
const BMFF_MAX_ALLOCATIONS = 4_096;

class BmffBudget {
  private iterations: number;
  private allocations: number;

  constructor(byteLength: number) {
    // The fixed ceilings stop compact, zero-width iloc fields from expanding into
    // attacker-controlled work. The byte-relative ceilings also keep work linear
    // for small malformed inputs.
    this.iterations = Math.min(BMFF_MAX_ITERATIONS, byteLength + 64);
    this.allocations = Math.min(
      BMFF_MAX_ALLOCATIONS,
      Math.floor(byteLength / 4) + 16,
    );
  }

  consumeIteration(count = 1): boolean {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.iterations)
      return false;
    this.iterations -= count;
    return true;
  }

  consumeAllocation(count = 1): boolean {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.allocations)
      return false;
    this.allocations -= count;
    return true;
  }
}

function readBmffInteger(
  bytes: Buffer,
  offset: number,
  size: number,
): number | undefined {
  if (size < 0 || size > 8 || offset < 0 || offset + size > bytes.length)
    return undefined;
  let value = 0n;
  for (let index = 0; index < size; index++)
    value = (value << 8n) | BigInt(bytes[offset + index]);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

function readBmffBoxInteger(
  bytes: Buffer,
  offset: number,
  size: number,
  end: number,
): number | undefined {
  if (offset + size > end) return undefined;
  return readBmffInteger(bytes, offset, size);
}

function parseBmffBoxes(
  bytes: Buffer,
  start: number,
  end: number,
  budget: BmffBudget,
): BmffBox[] | undefined {
  try {
    const boxes: BmffBox[] = [];
    for (let offset = start; offset < end; ) {
      if (
        boxes.length >= BMFF_MAX_BOXES ||
        !budget.consumeIteration() ||
        !budget.consumeAllocation()
      )
        return undefined;
      if (offset + 8 > end) return undefined;
      let size = bytes.readUInt32BE(offset);
      let header = 8;
      if (size === 1) {
        const large = readBmffInteger(bytes, offset + 8, 8);
        if (large === undefined || large < 16) return undefined;
        size = large;
        header = 16;
      }
      if (size === 0 || size < header || size > end - offset) return undefined;
      const type = readFourCc(bytes, offset + 4, offset + 8);
      if (type === undefined) return undefined;
      boxes.push({ type, dataStart: offset + header, end: offset + size });
      offset += size;
    }
    return boxes;
  } catch {
    return undefined;
  }
}

function readPrimaryIlocExtent(
  bytes: Buffer,
  box: BmffBox,
  mdat: BmffBox,
  primaryId: number,
  budget: BmffBudget,
): BmffExtent | undefined {
  try {
    if (box.end - box.dataStart < 8) return undefined;
    const version = bytes[box.dataStart];
    let offset = box.dataStart + 4;
    if (version > 2 || bytes.readUIntBE(box.dataStart + 1, 3) !== 0)
      return undefined;
    const first = bytes[offset++];
    const second = bytes[offset++];
    const offsetSize = first >> 4;
    const lengthSize = first & 15;
    const baseOffsetSize = second >> 4;
    const indexSize = version === 0 ? 0 : second & 15;
    if (offsetSize > 8 || lengthSize > 8 || baseOffsetSize > 8 || indexSize > 8)
      return undefined;
    const countSize = version === 2 ? 4 : 2;
    const count = readBmffBoxInteger(bytes, offset, countSize, box.end);
    offset += countSize;
    if (
      count === undefined ||
      count > BMFF_MAX_ITEMS ||
      !budget.consumeAllocation(count)
    )
      return undefined;
    let totalExtents = 0;
    let primaryExtent: BmffExtent | undefined;
    const itemIds = new Set<number>();
    for (let item = 0; item < count; item++) {
      if (!budget.consumeIteration()) return undefined;
      const itemIdSize = version === 2 ? 4 : 2;
      const itemId = readBmffBoxInteger(bytes, offset, itemIdSize, box.end);
      offset += itemIdSize;
      if (itemId === undefined || itemIds.has(itemId)) return undefined;
      itemIds.add(itemId);
      let constructionMethod = 0;
      if (version > 0) {
        const rawMethod = readBmffBoxInteger(bytes, offset, 2, box.end);
        offset += 2;
        if (
          rawMethod === undefined ||
          (rawMethod & 0xfff0) !== 0 ||
          (rawMethod & 15) > 2
        )
          return undefined;
        constructionMethod = rawMethod & 15;
      }
      const dataReferenceIndex = readBmffBoxInteger(bytes, offset, 2, box.end);
      offset += 2;
      if (dataReferenceIndex === undefined || dataReferenceIndex !== 0)
        return undefined;
      const base = readBmffBoxInteger(bytes, offset, baseOffsetSize, box.end);
      offset += baseOffsetSize;
      const extentCount = readBmffBoxInteger(bytes, offset, 2, box.end);
      offset += 2;
      if (
        base === undefined ||
        extentCount === undefined ||
        extentCount > BMFF_MAX_EXTENTS_PER_ITEM
      )
        return undefined;
      if (extentCount > BMFF_MAX_TOTAL_EXTENTS - totalExtents) return undefined;
      totalExtents += extentCount;
      const isPrimary = itemId === primaryId;
      if (isPrimary) {
        // Supporting one contiguous primary coded item keeps payload validation
        // bounded without pretending to implement BMFF data references/assembly.
        if (primaryExtent || constructionMethod !== 0 || extentCount !== 1)
          return undefined;
      }
      for (let extent = 0; extent < extentCount; extent++) {
        if (!budget.consumeIteration()) return undefined;
        if (indexSize) {
          if (
            readBmffBoxInteger(bytes, offset, indexSize, box.end) === undefined
          )
            return undefined;
          offset += indexSize;
        }
        const relative = readBmffBoxInteger(bytes, offset, offsetSize, box.end);
        offset += offsetSize;
        const length = readBmffBoxInteger(bytes, offset, lengthSize, box.end);
        offset += lengthSize;
        if (
          relative === undefined ||
          length === undefined ||
          relative > Number.MAX_SAFE_INTEGER - base
        )
          return undefined;
        const absolute = base + relative;
        if (isPrimary) {
          if (
            length === 0 ||
            absolute < mdat.dataStart ||
            absolute > mdat.end ||
            length > mdat.end - absolute
          )
            return undefined;
          primaryExtent = { offset: absolute, length };
        }
      }
    }
    return offset === box.end ? primaryExtent : undefined;
  } catch {
    return undefined;
  }
}

function readInfeIdentity(
  bytes: Buffer,
  box: BmffBox,
): { itemId: number; itemType: number } | undefined {
  const version = bytes[box.dataStart];
  if (bytes.readUIntBE(box.dataStart + 1, 3) !== 0) return undefined;
  if (version === 2 && box.end - box.dataStart >= 13) {
    const itemType = readFourCc(bytes, box.dataStart + 8, box.end);
    return itemType === undefined ||
      findNullWithin(bytes, box.dataStart + 12, box.end) === undefined
      ? undefined
      : { itemId: bytes.readUInt16BE(box.dataStart + 4), itemType };
  }
  if (version === 3 && box.end - box.dataStart >= 15) {
    const itemType = readFourCc(bytes, box.dataStart + 10, box.end);
    return itemType === undefined ||
      findNullWithin(bytes, box.dataStart + 14, box.end) === undefined
      ? undefined
      : { itemId: bytes.readUInt32BE(box.dataStart + 4), itemType };
  }
  return undefined;
}

function readHevcConfiguration(
  bytes: Buffer,
  box: BmffBox,
  budget: BmffBudget,
): number | undefined {
  const length = box.end - box.dataStart;
  if (length < 23 || bytes[box.dataStart] !== 1) return undefined;
  if (
    (bytes[box.dataStart + 13] & 0xf0) !== 0xf0 ||
    (bytes[box.dataStart + 15] & 0xfc) !== 0xfc ||
    (bytes[box.dataStart + 16] & 0xfc) !== 0xfc ||
    (bytes[box.dataStart + 17] & 0xe0) !== 0xe0 ||
    (bytes[box.dataStart + 18] & 0xe0) !== 0xe0
  )
    return undefined;
  const nalLengthSize = (bytes[box.dataStart + 21] & 3) + 1;
  const arrayCount = bytes[box.dataStart + 22];
  if (arrayCount === 0 || !budget.consumeIteration(arrayCount))
    return undefined;
  let offset = box.dataStart + 23;
  const parameterSetTypes = new Set<number>();
  for (let array = 0; array < arrayCount; array++) {
    if (offset + 3 > box.end) return undefined;
    const arrayHeader = bytes[offset++];
    if ((arrayHeader & 0x40) !== 0) return undefined;
    const nalType = arrayHeader & 0x3f;
    const nalCount = bytes.readUInt16BE(offset);
    offset += 2;
    if (
      nalCount === 0 ||
      nalCount > BMFF_MAX_ITEMS ||
      !budget.consumeIteration(nalCount)
    )
      return undefined;
    for (let index = 0; index < nalCount; index++) {
      if (offset + 2 > box.end) return undefined;
      const nalLength = bytes.readUInt16BE(offset);
      offset += 2;
      if (
        nalLength < 2 ||
        nalLength > box.end - offset ||
        ((bytes[offset] >> 1) & 0x3f) !== nalType ||
        (bytes[offset] & 0x80) !== 0 ||
        (bytes[offset + 1] & 7) === 0
      )
        return undefined;
      offset += nalLength;
    }
    parameterSetTypes.add(nalType);
  }
  return offset === box.end &&
    parameterSetTypes.has(32) &&
    parameterSetTypes.has(33) &&
    parameterSetTypes.has(34)
    ? nalLengthSize
    : undefined;
}

function readHevcPropertyLengthSize(
  bytes: Buffer,
  iprp: BmffBox,
  primaryId: number,
  budget: BmffBudget,
): number | undefined {
  const children = parseBmffBoxes(bytes, iprp.dataStart, iprp.end, budget);
  if (!children) return undefined;
  const ipcoBoxes = children.filter((box) => box.type === fourCc("ipco"));
  const ipmaBoxes = children.filter((box) => box.type === fourCc("ipma"));
  if (ipcoBoxes.length !== 1 || ipmaBoxes.length !== 1) return undefined;
  const properties = parseBmffBoxes(
    bytes,
    ipcoBoxes[0].dataStart,
    ipcoBoxes[0].end,
    budget,
  );
  if (!properties || properties.length === 0) return undefined;
  let ispeIndex: number | undefined;
  let hvccIndex: number | undefined;
  let nalLengthSize: number | undefined;
  for (let index = 0; index < properties.length; index++) {
    const property = properties[index];
    if (property.type === fourCc("ispe")) {
      if (
        ispeIndex !== undefined ||
        property.end - property.dataStart !== 12 ||
        bytes.readUInt32BE(property.dataStart) !== 0 ||
        bytes.readUInt32BE(property.dataStart + 4) === 0 ||
        bytes.readUInt32BE(property.dataStart + 8) === 0
      )
        return undefined;
      ispeIndex = index + 1;
    } else if (property.type === fourCc("hvcC")) {
      if (hvccIndex !== undefined) return undefined;
      nalLengthSize = readHevcConfiguration(bytes, property, budget);
      if (nalLengthSize === undefined) return undefined;
      hvccIndex = index + 1;
    }
  }
  if (
    ispeIndex === undefined ||
    hvccIndex === undefined ||
    nalLengthSize === undefined
  )
    return undefined;

  const ipma = ipmaBoxes[0];
  if (ipma.end - ipma.dataStart < 8) return undefined;
  const version = bytes[ipma.dataStart];
  const flags =
    ((bytes[ipma.dataStart + 1] << 16) |
      (bytes[ipma.dataStart + 2] << 8) |
      bytes[ipma.dataStart + 3]) >>>
    0;
  if (version > 1 || (flags & ~1) !== 0) return undefined;
  let offset = ipma.dataStart + 4;
  const entryCount = readBmffBoxInteger(bytes, offset, 4, ipma.end);
  offset += 4;
  if (
    entryCount === undefined ||
    entryCount > BMFF_MAX_ITEMS ||
    !budget.consumeIteration(entryCount)
  )
    return undefined;
  let primaryAssociations: Set<number> | undefined;
  for (let entry = 0; entry < entryCount; entry++) {
    const itemIdSize = version < 1 ? 2 : 4;
    const itemId = readBmffBoxInteger(bytes, offset, itemIdSize, ipma.end);
    offset += itemIdSize;
    const associationCount = readBmffBoxInteger(bytes, offset, 1, ipma.end);
    offset += 1;
    if (
      itemId === undefined ||
      associationCount === undefined ||
      !budget.consumeIteration(associationCount)
    )
      return undefined;
    const associations = new Set<number>();
    for (let association = 0; association < associationCount; association++) {
      const raw = readBmffBoxInteger(
        bytes,
        offset,
        flags & 1 ? 2 : 1,
        ipma.end,
      );
      offset += flags & 1 ? 2 : 1;
      if (raw === undefined) return undefined;
      const propertyIndex = raw & (flags & 1 ? 0x7fff : 0x7f);
      if (
        propertyIndex === 0 ||
        propertyIndex > properties.length ||
        associations.has(propertyIndex)
      )
        return undefined;
      associations.add(propertyIndex);
    }
    if (itemId === primaryId) {
      if (primaryAssociations) return undefined;
      primaryAssociations = associations;
    }
  }
  return offset === ipma.end &&
    primaryAssociations?.has(ispeIndex) &&
    primaryAssociations.has(hvccIndex)
    ? nalLengthSize
    : undefined;
}

function hasPlausibleHevcPayload(
  bytes: Buffer,
  extent: BmffExtent,
  nalLengthSize: number,
  budget: BmffBudget,
): boolean {
  if (extent.length < nalLengthSize + 8) return false;
  const end = extent.offset + extent.length;
  let offset = extent.offset;
  let sawVclNal = false;
  let nalCount = 0;
  while (offset < end) {
    if (++nalCount > BMFF_MAX_ITEMS || !budget.consumeIteration()) return false;
    const nalLength = readBmffBoxInteger(bytes, offset, nalLengthSize, end);
    offset += nalLengthSize;
    if (nalLength === undefined || nalLength < 2 || nalLength > end - offset)
      return false;
    const first = bytes[offset];
    const second = bytes[offset + 1];
    const nalType = (first >> 1) & 0x3f;
    if ((first & 0x80) !== 0 || nalType > 47 || (second & 7) === 0)
      return false;
    if (nalType <= 31) sawVclNal = true;
    offset += nalLength;
  }
  return offset === end && sawVclNal;
}

function hasHeifStructure(bytes: Buffer): { brands: number[] } | undefined {
  try {
    const budget = new BmffBudget(bytes.length);
    const boxes = parseBmffBoxes(bytes, 0, bytes.length, budget);
    const ftyp = boxes?.[0];
    if (
      !boxes ||
      !ftyp ||
      ftyp.type !== fourCc("ftyp") ||
      ftyp.end - ftyp.dataStart < 8 ||
      (ftyp.end - ftyp.dataStart) % 4 !== 0
    )
      return undefined;
    const brandCount = (ftyp.end - ftyp.dataStart - 4) / 4;
    if (
      brandCount > BMFF_MAX_BRANDS ||
      !budget.consumeAllocation(brandCount) ||
      !budget.consumeIteration(brandCount)
    )
      return undefined;
    const majorBrand = readFourCc(bytes, ftyp.dataStart, ftyp.end);
    if (majorBrand === undefined) return undefined;
    const brands = [majorBrand];
    for (let offset = ftyp.dataStart + 8; offset < ftyp.end; offset += 4) {
      const brand = readFourCc(bytes, offset, ftyp.end);
      if (brand === undefined) return undefined;
      brands.push(brand);
    }
    const metas = boxes.filter((box) => box.type === fourCc("meta"));
    const mdats = boxes.filter(
      (box) => box.type === fourCc("mdat") && box.end > box.dataStart,
    );
    if (metas.length !== 1 || mdats.length !== 1) return undefined;
    const meta = metas[0];
    const mdat = mdats[0];
    if (
      meta.end - meta.dataStart < 4 ||
      bytes.readUInt32BE(meta.dataStart) !== 0
    )
      return undefined;
    const children = parseBmffBoxes(
      bytes,
      meta.dataStart + 4,
      meta.end,
      budget,
    );
    if (!children) return undefined;
    const oneChild = (type: number) => {
      const matches = children.filter((box) => box.type === type);
      return matches.length === 1 ? matches[0] : undefined;
    };
    const hdlr = oneChild(fourCc("hdlr"));
    const pitm = oneChild(fourCc("pitm"));
    const iloc = oneChild(fourCc("iloc"));
    const iinf = oneChild(fourCc("iinf"));
    const iprp = oneChild(fourCc("iprp"));
    if (
      !hdlr ||
      !pitm ||
      !iloc ||
      !iinf ||
      !iprp ||
      hdlr.end - hdlr.dataStart < 12 ||
      bytes.readUInt32BE(hdlr.dataStart) !== 0 ||
      readFourCc(bytes, hdlr.dataStart + 8, hdlr.end) !== fourCc("pict")
    )
      return undefined;
    const pitmVersion = bytes[pitm.dataStart];
    const primaryIdSize = pitmVersion === 0 ? 2 : pitmVersion === 1 ? 4 : 0;
    if (
      !primaryIdSize ||
      pitm.end - pitm.dataStart !== 4 + primaryIdSize ||
      bytes.readUIntBE(pitm.dataStart + 1, 3) !== 0
    )
      return undefined;
    const primaryId = readBmffBoxInteger(
      bytes,
      pitm.dataStart + 4,
      primaryIdSize,
      pitm.end,
    );
    const iinfVersion = bytes[iinf.dataStart];
    const iinfCountSize = iinfVersion === 0 ? 2 : iinfVersion === 1 ? 4 : 0;
    if (
      !iinfCountSize ||
      iinf.end - iinf.dataStart < 4 + iinfCountSize ||
      bytes.readUIntBE(iinf.dataStart + 1, 3) !== 0
    )
      return undefined;
    const infeCount = readBmffBoxInteger(
      bytes,
      iinf.dataStart + 4,
      iinfCountSize,
      iinf.end,
    );
    const infeBoxes = iinfCountSize
      ? parseBmffBoxes(
          bytes,
          iinf.dataStart + 4 + iinfCountSize,
          iinf.end,
          budget,
        )
      : undefined;
    if (
      primaryId === undefined ||
      primaryId === 0 ||
      infeCount === undefined ||
      infeCount !== infeBoxes?.length ||
      infeBoxes.some((box) => box.type !== fourCc("infe")) ||
      infeCount > BMFF_MAX_ITEMS ||
      !budget.consumeIteration(infeCount)
    )
      return undefined;
    const compatibleTypes = new Set([fourCc("hvc1"), fourCc("hev1")]);
    const primaryEntries = infeBoxes
      .filter((box) => box.type === fourCc("infe"))
      .map((box) => readInfeIdentity(bytes, box))
      .filter(
        (identity): identity is { itemId: number; itemType: number } =>
          identity !== undefined && identity.itemId === primaryId,
      );
    if (
      primaryEntries.length !== 1 ||
      !compatibleTypes.has(primaryEntries[0].itemType)
    )
      return undefined;
    const extent = readPrimaryIlocExtent(bytes, iloc, mdat, primaryId, budget);
    const nalLengthSize = readHevcPropertyLengthSize(
      bytes,
      iprp,
      primaryId,
      budget,
    );
    if (
      !extent ||
      nalLengthSize === undefined ||
      !hasPlausibleHevcPayload(bytes, extent, nalLengthSize, budget)
    )
      return undefined;
    return { brands };
  } catch {
    return undefined;
  }
}

export function detectOriginalImageMimeType(
  bytes: Buffer,
): OriginalImageMimeType | undefined {
  if (hasJpegStructure(bytes)) return "image/jpeg";
  if (hasPngStructure(bytes)) return "image/png";
  if (hasWebpStructure(bytes)) return "image/webp";

  const brands = hasHeifStructure(bytes)?.brands;
  if (
    !brands ||
    brands.includes(fourCc("avif")) ||
    brands.includes(fourCc("avis"))
  )
    return undefined;
  if (
    brands.some((brand) =>
      [fourCc("heic"), fourCc("heix"), fourCc("hevc"), fourCc("hevx")].includes(
        brand,
      ),
    )
  )
    return "image/heic";
  if (brands.some((brand) => [fourCc("mif1"), fourCc("msf1")].includes(brand)))
    return "image/heif";
  return undefined;
}

export function originalImageExtension(
  mimeType: OriginalImageMimeType,
): string {
  return MIME_EXTENSIONS[mimeType];
}

export function originalImageObjectKey(input: {
  userId: string;
  courseId: string;
  topicId: string;
  uploadId: string;
  bytes: Buffer;
  mimeType: OriginalImageMimeType;
}): string {
  const digest = createHash("sha256")
    .update(input.userId)
    .update("\0")
    .update(input.courseId)
    .update("\0")
    .update(input.topicId)
    .update("\0")
    .update(input.uploadId)
    .update("\0")
    .update(input.bytes)
    .digest("hex");
  return `original-images/v1/${digest.slice(0, 2)}/${digest}.${originalImageExtension(input.mimeType)}`;
}
