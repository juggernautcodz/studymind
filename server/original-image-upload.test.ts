import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import http from "node:http";
import { AppError } from "./lib/errors";
import {
  detectOriginalImageMimeType,
  ORIGINAL_IMAGE_MAX_BYTES,
  ORIGINAL_IMAGE_MAX_OCR_TEXT_LENGTH,
  originalImageObjectKey,
} from "./lib/original-image-upload-validation";
import { createOriginalImagesRouter } from "./original-images";
import {
  requireOwnedTopic,
  uploadOriginalImage,
} from "./original-image-upload-service";

const id = "123e4567-e89b-42d3-a456-426614174000";
const jpegDqt = Buffer.concat([
  Buffer.from("ffdb004300", "hex"),
  Buffer.alloc(64, 1),
]);
const jpegDht = Buffer.concat([
  Buffer.from("ffc4002600", "hex"),
  Buffer.from([1]),
  Buffer.alloc(15),
  Buffer.from([0]),
  Buffer.from([0x10, 1]),
  Buffer.alloc(15),
  Buffer.from([0]),
]);
function jpegFixture(width = 1, height = 1, scanComponent = 1, dht = jpegDht) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegDqt,
    dht,
    Buffer.from([
      0xff,
      0xc0,
      0,
      11,
      8,
      height >> 8,
      height & 0xff,
      width >> 8,
      width & 0xff,
      1,
      1,
      0x11,
      0,
    ]),
    Buffer.from([
      0xff,
      0xda,
      0,
      8,
      1,
      scanComponent,
      0,
      0,
      63,
      0,
      0,
      0xff,
      0xd9,
    ]),
  ]);
}
const jpeg = jpegFixture();
function multiScanJpeg(scanComponentIds: number[], frameMarker = 0xc0) {
  const frame = Buffer.from([
    0xff,
    frameMarker,
    0,
    17,
    8,
    0,
    1,
    0,
    1,
    3,
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
  ]);
  const scans = scanComponentIds.map((componentId) =>
    Buffer.from([0xff, 0xda, 0, 8, 1, componentId, 0, 0, 63, 0, 0]),
  );
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegDqt,
    jpegDht,
    frame,
    ...scans,
    Buffer.from([0xff, 0xd9]),
  ]);
}
const jpegMultiScan = multiScanJpeg([1, 2, 3]);
function jpegScan(
  componentIds: number[],
  spectralStart: number,
  spectralEnd: number,
  successiveHigh = 0,
  successiveLow = 0,
) {
  const length = 6 + componentIds.length * 2;
  return Buffer.from([
    0xff,
    0xda,
    length >> 8,
    length & 0xff,
    componentIds.length,
    ...componentIds.flatMap((componentId) => [componentId, 0]),
    spectralStart,
    spectralEnd,
    (successiveHigh << 4) | successiveLow,
    0,
  ]);
}
function progressiveJpeg(componentIds: number[], scans: Buffer[]) {
  const frameLength = 8 + componentIds.length * 3;
  const frame = Buffer.from([
    0xff,
    0xc2,
    frameLength >> 8,
    frameLength & 0xff,
    8,
    0,
    1,
    0,
    1,
    componentIds.length,
    ...componentIds.flatMap((componentId) => [componentId, 0x11, 0]),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegDqt,
    jpegDht,
    frame,
    ...scans,
    Buffer.from([0xff, 0xd9]),
  ]);
}
const jpegProgressive = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegDqt,
  jpegDht,
  Buffer.from([0xff, 0xc2, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
  Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0, 0, 0]),
  Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 1, 63, 0, 0, 0xff, 0xd9]),
]);
const jpegProgressiveRefined = progressiveJpeg(
  [1],
  [
    jpegScan([1], 0, 0, 0, 2),
    jpegScan([1], 1, 63, 0, 1),
    jpegScan([1], 0, 0, 2, 1),
    jpegScan([1], 1, 63, 1, 0),
  ],
);
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string | Buffer, data: Buffer) {
  const typeBytes = typeof type === "string" ? Buffer.from(type) : type;
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, typeBytes, data, crc]);
}
const png = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk("IDAT", Buffer.from("789c6360000000020001", "hex")),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const pngWithKnownAncillary = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
  pngChunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
  pngChunk("sRGB", Buffer.from([0])),
  pngChunk("pHYs", Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])),
  pngChunk("IDAT", Buffer.from("789c6360000000020001", "hex")),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const indexedIhdr = pngChunk(
  "IHDR",
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0]),
);
const pngWithPaletteAncillary = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  indexedIhdr,
  pngChunk("cHRM", Buffer.alloc(32)),
  pngChunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
  pngChunk("iCCP", Buffer.from([0x70, 0, 0, 0x78])),
  pngChunk("sBIT", Buffer.from([8, 8, 8])),
  pngChunk("PLTE", Buffer.from([0, 0, 0])),
  pngChunk("bKGD", Buffer.from([0])),
  pngChunk("hIST", Buffer.from([0, 1])),
  pngChunk("tRNS", Buffer.from([0xff])),
  pngChunk("sPLT", Buffer.from([0x70, 0, 8, 0, 0, 0, 0xff, 0, 1])),
  pngChunk("IDAT", Buffer.from("789c6360000000020001", "hex")),
  pngChunk("IEND", Buffer.alloc(0)),
]);
function webpChunk(type: string | Buffer, data: Buffer) {
  const typeBytes = typeof type === "string" ? Buffer.from(type) : type;
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return Buffer.concat([
    typeBytes,
    length,
    data,
    data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
}
function webpFile(...chunks: Buffer[]) {
  const payload = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from("RIFF"), size, payload]);
}
const vp8Payload = Buffer.from([0x30, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0, 0]);
const webp = webpFile(webpChunk("VP8 ", vp8Payload));
const webpLossless = webpFile(
  webpChunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0, 0])),
);
const webpExtended = webpFile(
  webpChunk("VP8X", Buffer.alloc(10)),
  webpChunk("VP8 ", vp8Payload),
);
const alphaVp8x = Buffer.from([0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webpAlpha = webpFile(
  webpChunk("VP8X", alphaVp8x),
  webpChunk("ALPH", Buffer.from([0, 0])),
  webpChunk("VP8 ", vp8Payload),
);
const webpCompressedAlpha = webpFile(
  webpChunk("VP8X", alphaVp8x),
  webpChunk("ALPH", Buffer.from([1, 0xaa, 0xbb])),
  webpChunk("VP8 ", vp8Payload),
);
function bmffBox(type: string | Buffer, data: Buffer) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length + 8);
  return Buffer.concat([
    size,
    typeof type === "string" ? Buffer.from(type) : type,
    data,
  ]);
}
function hevcProperties(primaryId: number, associatedProperties = [1, 2]) {
  const ispe = bmffBox(
    "ispe",
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1]),
  );
  const configuration = Buffer.alloc(23);
  configuration[0] = 1;
  configuration[13] = 0xf0;
  configuration[15] = 0xfc;
  configuration[16] = 0xfc;
  configuration[17] = 0xf8;
  configuration[18] = 0xf8;
  configuration[21] = 3;
  configuration[22] = 3;
  const parameterArray = (type: number) =>
    Buffer.from([type, 0, 1, 0, 4, type << 1, 1, 0, 0]);
  const hvcC = bmffBox(
    "hvcC",
    Buffer.concat([
      configuration,
      parameterArray(32),
      parameterArray(33),
      parameterArray(34),
    ]),
  );
  const ipco = bmffBox("ipco", Buffer.concat([ispe, hvcC]));
  const ipma = bmffBox(
    "ipma",
    Buffer.from([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      primaryId >> 8,
      primaryId & 0xff,
      associatedProperties.length,
      ...associatedProperties,
    ]),
  );
  return bmffBox("iprp", Buffer.concat([ipco, ipma]));
}
const hevcItemPayload = Buffer.from([0, 0, 0, 8, 38, 1, 0, 0, 0, 0, 0, 0]);
function bmff(
  brand: string,
  ids: {
    primary?: number;
    infe?: number;
    iloc?: number;
    pitmVersion?: number;
    associatedProperties?: number[];
    payload?: Buffer;
    dataReferenceIndex?: number;
    terminateInfeName?: boolean;
  } = {},
) {
  const primaryId = ids.primary ?? 1;
  const infeId = ids.infe ?? 1;
  const ilocId = ids.iloc ?? 1;
  const ftyp = bmffBox(
    "ftyp",
    Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from(brand)]),
  );
  const hdlr = bmffBox(
    "hdlr",
    Buffer.concat([Buffer.alloc(8), Buffer.from("pict"), Buffer.alloc(4)]),
  );
  const pitmVersion = ids.pitmVersion ?? 0;
  const pitm = bmffBox(
    "pitm",
    pitmVersion === 0
      ? Buffer.from([0, 0, 0, 0, primaryId >> 8, primaryId & 0xff])
      : Buffer.from([pitmVersion, 0, 0, 0, 0, 0, 0, primaryId]),
  );
  const infe = bmffBox(
    "infe",
    Buffer.concat([
      Buffer.from([2, 0, 0, 0, infeId >> 8, infeId & 0xff, 0, 0]),
      Buffer.from(ids.terminateInfeName === false ? "hvc1x" : "hvc1\0"),
    ]),
  );
  const iinf = bmffBox(
    "iinf",
    Buffer.concat([Buffer.alloc(4), Buffer.from([0, 1]), infe]),
  );
  const iprp = hevcProperties(primaryId, ids.associatedProperties);
  const payload = ids.payload ?? hevcItemPayload;
  const dataReferenceIndex = ids.dataReferenceIndex ?? 0;
  const makeIloc = (mdatOffset: number) =>
    bmffBox(
      "iloc",
      Buffer.from([
        0,
        0,
        0,
        0,
        0x44,
        0,
        0,
        1,
        ilocId >> 8,
        ilocId & 0xff,
        dataReferenceIndex >> 8,
        dataReferenceIndex & 0xff,
        0,
        1,
        mdatOffset >>> 24,
        mdatOffset >>> 16,
        mdatOffset >>> 8,
        mdatOffset,
        payload.length >>> 24,
        payload.length >>> 16,
        payload.length >>> 8,
        payload.length,
      ]),
    );
  const placeholderIloc = makeIloc(0);
  const mdatOffset =
    ftyp.length +
    bmffBox(
      "meta",
      Buffer.concat([Buffer.alloc(4), hdlr, pitm, iinf, placeholderIloc, iprp]),
    ).length +
    8;
  const iloc = makeIloc(mdatOffset);
  return Buffer.concat([
    ftyp,
    bmffBox(
      "meta",
      Buffer.concat([Buffer.alloc(4), hdlr, pitm, iinf, iloc, iprp]),
    ),
    bmffBox("mdat", payload),
  ]);
}
function pathologicalBmff() {
  const primaryId = 999;
  const ftyp = bmffBox(
    "ftyp",
    Buffer.concat([Buffer.from("heic"), Buffer.alloc(4), Buffer.from("heic")]),
  );
  const hdlr = bmffBox(
    "hdlr",
    Buffer.concat([Buffer.alloc(8), Buffer.from("pict"), Buffer.alloc(4)]),
  );
  const pitm = bmffBox(
    "pitm",
    Buffer.from([0, 0, 0, 0, primaryId >> 8, primaryId & 0xff]),
  );
  const infe = bmffBox(
    "infe",
    Buffer.concat([
      Buffer.from([2, 0, 0, 0, primaryId >> 8, primaryId & 0xff, 0, 0]),
      Buffer.from("hvc1\0"),
    ]),
  );
  const iinf = bmffBox(
    "iinf",
    Buffer.concat([Buffer.alloc(4), Buffer.from([0, 1]), infe]),
  );
  // Both counts are individually legal, but zero-width extent fields let this
  // compact input request 4,160 nested iterations and exhaust the shared,
  // byte-relative parser budget.
  const itemCount = 65;
  const items = Array.from({ length: itemCount }, (_, index) =>
    Buffer.from([0, index + 1, 0, 0, 0, 64]),
  );
  const iloc = bmffBox(
    "iloc",
    Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, itemCount]), ...items]),
  );
  return Buffer.concat([
    ftyp,
    bmffBox(
      "meta",
      Buffer.concat([
        Buffer.alloc(4),
        hdlr,
        pitm,
        iinf,
        iloc,
        hevcProperties(primaryId),
      ]),
    ),
    bmffBox("mdat", hevcItemPayload),
  ]);
}
const valid = [
  [jpeg, "image/jpeg"],
  [jpegMultiScan, "image/jpeg"],
  [jpegProgressive, "image/jpeg"],
  [jpegProgressiveRefined, "image/jpeg"],
  [png, "image/png"],
  [pngWithKnownAncillary, "image/png"],
  [pngWithPaletteAncillary, "image/png"],
  [webp, "image/webp"],
  [webpLossless, "image/webp"],
  [webpExtended, "image/webp"],
  [webpAlpha, "image/webp"],
  [webpCompressedAlpha, "image/webp"],
  [bmff("heic"), "image/heic"],
  [bmff("mif1"), "image/heif"],
] as const;

function mutateFourCc(bytes: Buffer, value: string, every = false) {
  const mutated = Buffer.from(bytes);
  const needle = Buffer.from(value);
  for (
    let offset = mutated.indexOf(needle);
    offset >= 0;
    offset = mutated.indexOf(needle, offset + 4)
  ) {
    mutated[offset] |= 0x80;
    if (!every) break;
  }
  return mutated;
}

function fakeDb(overrides: Record<string, unknown> = {}) {
  const image = {
    id,
    topicId: "topic",
    filename: "image.jpg",
    filepath: "key",
    ocrText: "text",
  };
  return {
    topic: { findFirst: async () => ({ id: "topic" }) },
    whiteboardImage: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => image,
    },
    ...overrides,
  } as any;
}
function input(bytes = jpeg) {
  return {
    userId: "user",
    courseId: "course",
    topicId: "topic",
    uploadId: id,
    ocrText: "text",
    bytes,
    mimeType: "image/jpeg" as const,
  };
}

async function withRouter(
  options: Parameters<typeof createOriginalImagesRouter>[0],
  run: (url: string) => Promise<void>,
) {
  const app = express();
  app.use("/api", createOriginalImagesRouter(options));
  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/courses/course/topics/topic/whiteboard-images`;
  try {
    await run(url);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function uploadForm(
  overrides: {
    uploadId?: string;
    ocrText?: string;
    image?: Blob;
    extraImage?: Blob;
    unknownField?: string;
  } = {},
) {
  const form = new FormData();
  form.set("uploadId", overrides.uploadId ?? id);
  form.set("ocrText", overrides.ocrText ?? "text");
  if (overrides.image)
    form.append("image", overrides.image, "secret-image.jpg");
  if (overrides.extraImage)
    form.append("image", overrides.extraImage, "duplicate-secret.jpg");
  if (overrides.unknownField) form.set("unexpected", overrides.unknownField);
  return form;
}

function routerFakes(calls: { storage: number; db: number }) {
  return {
    authenticate: (req: any, _res: any, next: () => void) => {
      req.user = { id: "user", email: "x@y.z" };
      next();
    },
    requireOwned: async () => {},
    db: fakeDb({
      whiteboardImage: {
        findUnique: async () => null,
        create: async () => {
          calls.db++;
          return {
            id,
            topicId: "topic",
            filename: "image.jpg",
            filepath: "opaque-key",
            ocrText: "text",
          };
        },
      },
    }),
    storage: {
      uploadBytes: async () => {
        calls.storage++;
      },
      deleteIfPresent: async () => {},
    } as any,
  };
}

test("router returns the minimal canonical upload body for new and replayed uploads", async () => {
  let stored: {
    id: string;
    topicId: string;
    filename: string;
    filepath: string;
    ocrText: string;
  } | null = null;
  let storageUploads = 0;
  const options = {
    authenticate: (req: any, _res: any, next: () => void) => {
      req.user = { id: "user", email: "x@y.z" };
      next();
    },
    requireOwned: async () => {},
    db: {
      whiteboardImage: {
        findUnique: async () => stored,
        create: async ({ data }: any) => {
          stored = data;
          return data;
        },
      },
    },
    storage: {
      uploadBytes: async () => {
        storageUploads++;
      },
      deleteIfPresent: async () => {},
    } as any,
  } as any;
  const expected = { whiteboardImage: { id, mimeType: "image/png" } };
  const prohibitedFields = [
    "topicId",
    "filename",
    "ocrText",
    "filepath",
    "key",
    "bucket",
    "provider",
    "originalFilename",
  ];

  await withRouter(options, async (url) => {
    for (const expectedStatus of [201, 200]) {
      const response = await fetch(url, {
        method: "POST",
        // The client filename is intentionally misleading: MIME comes from server validation.
        body: uploadForm({ image: new Blob([png], { type: "image/png" }) }),
      });
      const body = await response.json();
      assert.equal(response.status, expectedStatus);
      assert.deepEqual(body, expected);
      for (const field of prohibitedFields) {
        assert.equal(field in body, false);
        assert.equal(field in body.whiteboardImage, false);
      }
    }
  });
  assert.equal(storageUploads, 1);
});

test("recognizes only complete canonical permitted image types", () => {
  for (const [bytes, mime] of valid)
    assert.equal(detectOriginalImageMimeType(bytes), mime);
  for (const bytes of [
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("89504e47", "hex"),
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
    Buffer.from("524946460800000057454250", "hex"),
    bmff("avif"),
    bmff("avis"),
    bmff("xxxx"),
  ])
    assert.equal(detectOriginalImageMimeType(bytes), undefined);
});

test("rejects a PNG with a seven-byte IDAT zlib stream", () => {
  const sevenByteZlibStream = Buffer.from([0x78, 0x9c, 1, 2, 3, 4, 5]);
  const bytes = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk(
      "IHDR",
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
    ),
    pngChunk("IDAT", sevenByteZlibStream),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);

  assert.equal(detectOriginalImageMimeType(bytes), undefined);
});

test("rejects malformed or truncated structures for every permitted image family", () => {
  for (const [bytes] of valid) {
    assert.equal(
      detectOriginalImageMimeType(bytes.subarray(0, bytes.length - 1)),
      undefined,
    );
  }

  const ihdr = pngChunk(
    "IHDR",
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
  );
  const idat = pngChunk("IDAT", Buffer.from("789c6360000000020001", "hex"));
  const duplicateIhdrPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    ihdr,
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const splitIdatPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    idat,
    pngChunk("tEXt", Buffer.alloc(0)),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const lateGammaPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    idat,
    pngChunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const duplicateGammaPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
    pngChunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedGammaPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("gAMA", Buffer.from([1, 2, 3])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedPhysPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("pHYs", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 2])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const duplicatePhysPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("pHYs", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    pngChunk("pHYs", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 0])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const duplicateSrgbPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("sRGB", Buffer.from([0])),
    pngChunk("sRGB", Buffer.from([0])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedSrgbPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("sRGB", Buffer.from([4])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const headerOnlyIdatPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("IDAT", Buffer.from("789c", "hex")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const duplicateChrmPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("cHRM", Buffer.alloc(32)),
    pngChunk("cHRM", Buffer.alloc(32)),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const lateChrmPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    indexedIhdr,
    pngChunk("PLTE", Buffer.from([0, 0, 0])),
    pngChunk("cHRM", Buffer.alloc(32)),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedIccpPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("iCCP", Buffer.from("profile-without-null")),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const incompatibleIccpSrgbPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("iCCP", Buffer.from([0x70, 0, 0, 0x78])),
    pngChunk("sRGB", Buffer.from([0])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const invalidSbitPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("sBIT", Buffer.from([9])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const invalidBkgdPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    indexedIhdr,
    pngChunk("PLTE", Buffer.from([0, 0, 0])),
    pngChunk("bKGD", Buffer.from([1])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const histWithoutPalettePng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("hIST", Buffer.from([0, 1])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const trnsForAlphaPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    pngChunk("tRNS", Buffer.from([0, 0])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const duplicateSpltPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("sPLT", Buffer.from([0x70, 0, 8, 0, 0, 0, 0xff, 0, 1])),
    pngChunk("sPLT", Buffer.from([0x70, 0, 8, 0, 0, 0, 0xff, 0, 1])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedSpltPng = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    ihdr,
    pngChunk("sPLT", Buffer.from([0x70, 0, 4, 0, 0, 0, 0xff, 0, 1])),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const highBitPngType = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk(
      Buffer.from([0xc9, 0x48, 0x44, 0x52]),
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]),
    ),
    idat,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  const malformedScanJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xe1, 0x00, 0x10, 0xff,
    0xd9,
  ]);
  const zeroDimensionJpeg = jpegFixture(1, 0);
  const unknownScanComponentJpeg = jpegFixture(1, 1, 2);
  const uncoveredFrameComponentJpeg = multiScanJpeg([1, 2]);
  const duplicateSequentialScanJpeg = multiScanJpeg([1, 1, 2, 3]);
  const progressiveAcBeforeDcJpeg = progressiveJpeg(
    [1],
    [jpegScan([1], 1, 63), jpegScan([1], 0, 0)],
  );
  const progressiveAcBeforeAllDcJpeg = progressiveJpeg(
    [1, 2],
    [jpegScan([1], 0, 0), jpegScan([1], 1, 63), jpegScan([2], 0, 0)],
  );
  const progressiveDuplicateDcJpeg = progressiveJpeg(
    [1],
    [jpegScan([1], 0, 0), jpegScan([1], 0, 0)],
  );
  const progressiveOverlappingAcJpeg = progressiveJpeg(
    [1],
    [jpegScan([1], 0, 0), jpegScan([1], 1, 10), jpegScan([1], 5, 20)],
  );
  const progressiveBadRefinementJpeg = progressiveJpeg(
    [1],
    [jpegScan([1], 0, 0, 0, 2), jpegScan([1], 0, 0, 1, 0)],
  );
  const progressiveMultiComponentAcJpeg = progressiveJpeg(
    [1, 2],
    [jpegScan([1, 2], 0, 0), jpegScan([1, 2], 1, 63)],
  );
  const progressiveMissingDcJpeg = progressiveJpeg(
    [1, 2],
    [jpegScan([1], 0, 0), jpegScan([1], 1, 63)],
  );
  const oversubscribedDht = Buffer.from(jpegDht);
  oversubscribedDht[5] = 3;
  const completeTreeDht = Buffer.from(jpegDht);
  completeTreeDht[5] = 2;
  const vp8xOnlyWebp = Buffer.from(
    "524946461600000057454250565038580a000000000000000000000000",
    "hex",
  );
  const arbitraryVp8Webp = webpFile(webpChunk("VP8 ", Buffer.alloc(4)));
  const headerOnlyVp8Webp = webpFile(
    webpChunk("VP8 ", vp8Payload.subarray(0, 10)),
  );
  const headerOnlyVp8lWebp = webpFile(
    webpChunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0])),
  );
  const malformedVp8lWebp = webpFile(
    webpChunk("VP8L", Buffer.from([0x2f, 0, 0, 0, 0xe0])),
  );
  const lateVp8xWebp = webpFile(
    webpChunk("VP8 ", vp8Payload),
    webpChunk("VP8X", Buffer.alloc(10)),
  );
  const imageExceedsVp8xCanvas = webpFile(
    webpChunk("VP8X", Buffer.alloc(10)),
    webpChunk(
      "VP8 ",
      Buffer.from([0x30, 0, 0, 0x9d, 0x01, 0x2a, 2, 0, 1, 0, 0]),
    ),
  );
  const invalidAlphaControls = [0x02, 0x20, 0x40].map((control) =>
    webpFile(
      webpChunk("VP8X", alphaVp8x),
      webpChunk("ALPH", Buffer.from([control, 0])),
      webpChunk("VP8 ", vp8Payload),
    ),
  );
  const wrongSizedRawAlphaWebp = webpFile(
    webpChunk("VP8X", alphaVp8x),
    webpChunk("ALPH", Buffer.from([0, 0, 0])),
    webpChunk("VP8 ", vp8Payload),
  );
  const trivialCompressedAlphaWebp = webpFile(
    webpChunk("VP8X", alphaVp8x),
    webpChunk("ALPH", Buffer.from([1, 0])),
    webpChunk("VP8 ", vp8Payload),
  );
  const separatedAlphaWebp = webpFile(
    webpChunk("VP8X", alphaVp8x),
    webpChunk("ALPH", Buffer.from([0, 0])),
    webpChunk("JUNK", Buffer.from([0])),
    webpChunk("VP8 ", vp8Payload),
  );
  const alphaWithoutFlagWebp = webpFile(
    webpChunk("VP8X", Buffer.alloc(10)),
    webpChunk("ALPH", Buffer.from([0, 0])),
    webpChunk("VP8 ", vp8Payload),
  );
  const flagWithoutAlphaWebp = webpFile(
    webpChunk("VP8X", alphaVp8x),
    webpChunk("VP8 ", vp8Payload),
  );
  const animatedWebp = webpFile(
    webpChunk("VP8X", Buffer.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    webpChunk("ANIM", Buffer.alloc(6)),
    webpChunk("VP8 ", vp8Payload),
  );
  const mismatchedPrimaryExtentHeic = bmff("heic", {
    primary: 1,
    infe: 1,
    iloc: 2,
  });
  const mismatchedPrimaryInfoHeic = bmff("heic", {
    primary: 1,
    infe: 2,
    iloc: 1,
  });
  const unsupportedPitmVersionHeic = bmff("heic", { pitmVersion: 2 });
  const missingIspeAssociationHeic = bmff("heic", {
    associatedProperties: [2],
  });
  const missingHvccAssociationHeic = bmff("heic", {
    associatedProperties: [1],
  });
  const truncatedHevcPayloadHeic = bmff("heic", {
    payload: Buffer.from([0, 0, 0, 8, 38, 1]),
  });
  const invalidHevcPayloadHeic = bmff("heic", {
    payload: Buffer.from([0, 0, 0, 8, 0xff, 1, 0, 0, 0, 0, 0, 0]),
  });
  const externalDataReferenceHeic = bmff("heic", { dataReferenceIndex: 1 });
  const unterminatedInfeNameHeic = bmff("heic", { terminateInfeName: false });
  const malformedHvccHeic = Buffer.from(bmff("heic"));
  const hvccOffset = malformedHvccHeic.indexOf(Buffer.from("hvcC"));
  malformedHvccHeic[hvccOffset + 17] = 0;
  const zeroWidthIspeHeic = Buffer.from(bmff("heic"));
  const ispeOffset = zeroWidthIspeHeic.indexOf(Buffer.from("ispe"));
  zeroWidthIspeHeic[ispeOffset + 11] = 0;
  const truncatedPitmHeic = Buffer.from(bmff("heic"));
  const pitmOffset = truncatedPitmHeic.indexOf(Buffer.from("pitm"));
  truncatedPitmHeic.writeUInt32BE(12, pitmOffset - 4);
  const highBitBmffBrand = mutateFourCc(bmff("heic"), "heic", true);
  const highBitBmffItemType = mutateFourCc(bmff("heic"), "hvc1");
  const highBitWebpType = webpFile(
    webpChunk(Buffer.from([0xd6, 0x50, 0x38, 0x20]), vp8Payload),
  );

  for (const bytes of [
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    malformedScanJpeg,
    zeroDimensionJpeg,
    unknownScanComponentJpeg,
    uncoveredFrameComponentJpeg,
    duplicateSequentialScanJpeg,
    progressiveAcBeforeDcJpeg,
    progressiveAcBeforeAllDcJpeg,
    progressiveDuplicateDcJpeg,
    progressiveOverlappingAcJpeg,
    progressiveBadRefinementJpeg,
    progressiveMultiComponentAcJpeg,
    progressiveMissingDcJpeg,
    jpegFixture(1, 1, 1, oversubscribedDht),
    jpegFixture(1, 1, 1, completeTreeDht),
    duplicateIhdrPng,
    splitIdatPng,
    lateGammaPng,
    duplicateGammaPng,
    malformedGammaPng,
    malformedPhysPng,
    duplicatePhysPng,
    duplicateSrgbPng,
    malformedSrgbPng,
    headerOnlyIdatPng,
    duplicateChrmPng,
    lateChrmPng,
    malformedIccpPng,
    incompatibleIccpSrgbPng,
    invalidSbitPng,
    invalidBkgdPng,
    histWithoutPalettePng,
    trnsForAlphaPng,
    duplicateSpltPng,
    malformedSpltPng,
    highBitPngType,
    vp8xOnlyWebp,
    arbitraryVp8Webp,
    headerOnlyVp8Webp,
    headerOnlyVp8lWebp,
    malformedVp8lWebp,
    lateVp8xWebp,
    imageExceedsVp8xCanvas,
    wrongSizedRawAlphaWebp,
    trivialCompressedAlphaWebp,
    separatedAlphaWebp,
    alphaWithoutFlagWebp,
    flagWithoutAlphaWebp,
    ...invalidAlphaControls,
    animatedWebp,
    highBitWebpType,
    mismatchedPrimaryExtentHeic,
    mismatchedPrimaryInfoHeic,
    unsupportedPitmVersionHeic,
    missingIspeAssociationHeic,
    missingHvccAssociationHeic,
    truncatedHevcPayloadHeic,
    invalidHevcPayloadHeic,
    externalDataReferenceHeic,
    unterminatedInfeNameHeic,
    malformedHvccHeic,
    zeroWidthIspeHeic,
    truncatedPitmHeic,
    highBitBmffBrand,
    highBitBmffItemType,
  ]) {
    assert.equal(detectOriginalImageMimeType(bytes), undefined);
  }
});

test("rejects compact BMFF item/extent multiplication without pathological work", () => {
  const started = performance.now();
  assert.equal(detectOriginalImageMimeType(pathologicalBmff()), undefined);
  assert.ok(
    performance.now() - started < 1_000,
    "pathological BMFF validation exceeded its bounded-work budget",
  );
});

test("key is opaque, deterministic, and does not include identifying inputs", () => {
  const key = originalImageObjectKey(input());
  assert.match(key, /^original-images\/v1\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/);
  assert.equal(key.includes("user"), false);
  assert.equal(key.includes(id), false);
});

test("owned topic predicate binds topic, course, and both user ownerships", async () => {
  let args: any;
  await requireOwnedTopic(
    {
      topic: {
        findFirst: async (value: any) => {
          args = value;
          return { id: "topic" };
        },
      },
    } as any,
    "user",
    "course",
    "topic",
  );
  assert.deepEqual(args.where, {
    id: "topic",
    courseId: "course",
    userId: "user",
    course: { userId: "user" },
  });
  await assert.rejects(
    requireOwnedTopic(
      { topic: { findFirst: async () => null } } as any,
      "user",
      "course",
      "topic",
    ),
    (e: unknown) => e instanceof AppError && e.statusCode === 404,
  );
});

test("storage and database failures are sanitized, and ambiguous failures retain unproven keys", async () => {
  const secret = "bucket/path/original-name.jpg";
  await assert.rejects(
    uploadOriginalImage(input(), {
      db: fakeDb(),
      storage: {
        uploadBytes: async () => {
          throw new Error(secret);
        },
      } as any,
    }),
    (e: unknown) =>
      e instanceof AppError &&
      e.statusCode === 503 &&
      !e.message.includes(secret),
  );
  let deleted = 0;
  await assert.rejects(
    uploadOriginalImage(input(), {
      db: fakeDb({
        whiteboardImage: {
          findUnique: async () => null,
          findFirst: async () => null,
          create: async () => {
            throw new Error("database cause");
          },
        },
      }),
      storage: {
        uploadBytes: async () => {},
        deleteIfPresent: async () => {
          deleted++;
          throw new Error("cleanup cause");
        },
      } as any,
    }),
    (e: unknown) =>
      e instanceof AppError &&
      e.statusCode === 500 &&
      !e.message.includes("cause"),
  );
  assert.equal(deleted, 0);
});

test("idempotency replays match and conflicts differ", async () => {
  const request = input();
  const key = originalImageObjectKey(request);
  const matching = {
    id,
    topicId: "topic",
    filename: "image.jpg",
    filepath: key,
    ocrText: "text",
  };
  const replay = await uploadOriginalImage(request, {
    db: fakeDb({
      whiteboardImage: {
        findUnique: async () => matching,
        create: async () => matching,
      },
    }),
    storage: {} as any,
  });
  assert.equal(replay.replay, true);
  await assert.rejects(
    uploadOriginalImage(request, {
      db: fakeDb({
        whiteboardImage: {
          findUnique: async () => ({ ...matching, ocrText: "other" }),
          create: async () => matching,
        },
      }),
      storage: {} as any,
    }),
    (e: unknown) => e instanceof AppError && e.statusCode === 409,
  );
});

test("P2002 and ambiguous create failures never delete matching or conflicting winner keys", async () => {
  const request = input();
  const key = originalImageObjectKey(request);
  const matching = {
    id,
    topicId: "topic",
    filename: "image.jpg",
    filepath: key,
    ocrText: "text",
  };
  const conflicting = { ...matching, filepath: "winner-key", ocrText: "other" };

  for (const createError of [
    { code: "P2002" },
    new Error("connection dropped after commit"),
  ]) {
    for (const winner of [matching, conflicting]) {
      let uniqueReads = 0;
      let deleted = 0;
      const attempt = uploadOriginalImage(request, {
        db: fakeDb({
          whiteboardImage: {
            findUnique: async () => (++uniqueReads === 1 ? null : winner),
            create: async () => {
              throw createError;
            },
          },
        }),
        storage: {
          uploadBytes: async () => {},
          deleteIfPresent: async () => {
            deleted++;
          },
        } as any,
      });

      if (winner === matching) {
        const result = await attempt;
        assert.equal(result.replay, true);
        assert.equal(result.image, matching);
      } else {
        await assert.rejects(
          attempt,
          (error: unknown) =>
            error instanceof AppError && error.statusCode === 409,
        );
      }
      assert.equal(uniqueReads, 2);
      assert.equal(deleted, 0);
    }
  }
});

test("router authorizes and checks ownership before multipart parsing, and sanitizes storage errors", async () => {
  const order: string[] = [];
  const app = express();
  app.use(
    "/api",
    createOriginalImagesRouter({
      authenticate: (req, _res, next) => {
        order.push("auth");
        req.user = { id: "user", email: "x@y.z" };
        next();
      },
      requireOwned: async () => {
        order.push("owned");
      },
      db: fakeDb(),
      storage: {
        uploadBytes: async () => {
          throw new Error("bucket/secret/file.jpg");
        },
      } as any,
    }),
  );
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  const boundary = "test-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="uploadId"\r\n\r\n${id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="ocrText"\r\n\r\ntext\r\n--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="secret.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    jpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(
    `http://127.0.0.1:${port}/api/courses/course/topics/topic/whiteboard-images`,
    {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    },
  );
  const text = await response.text();
  server.close();
  assert.deepEqual(order, ["auth", "owned"]);
  assert.equal(response.status, 503);
  assert.equal(text.includes("bucket"), false);
  assert.equal(text.includes("secret.jpg"), false);
});

test("router rejects unauthenticated requests before multipart parsing", async () => {
  let ownershipChecks = 0;
  const calls = { storage: 0, db: 0 };
  await withRouter(
    {
      ...routerFakes(calls),
      authenticate: (_req, res) => {
        res.status(401).json({ error: "Authentication required" });
      },
      requireOwned: async () => {
        ownershipChecks++;
      },
    },
    async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "multipart/form-data" },
        body: "deliberately malformed multipart body",
      });
      assert.equal(response.status, 401);
    },
  );
  assert.equal(ownershipChecks, 0);
  assert.deepEqual(calls, { storage: 0, db: 0 });
});

test("foreign course and foreign topic return the same non-enumerating 404 before multipart parsing", async () => {
  const ownershipArguments: string[][] = [];
  const calls = { storage: 0, db: 0 };
  await withRouter(
    {
      ...routerFakes(calls),
      requireOwned: async (userId, courseId, topicId) => {
        ownershipArguments.push([userId, courseId, topicId]);
        throw new AppError(404, "NOT_FOUND", "Topic not found");
      },
    },
    async (url) => {
      const urls = [
        url.replace("/courses/course/", "/courses/foreign-course/"),
        url.replace("/topics/topic/", "/topics/foreign-topic/"),
      ];
      const bodies: string[] = [];
      for (const target of urls) {
        const response = await fetch(target, {
          method: "POST",
          headers: { "content-type": "multipart/form-data" },
          body: "malformed",
        });
        assert.equal(response.status, 404);
        bodies.push(await response.text());
      }
      assert.equal(bodies[0], bodies[1]);
      assert.equal(bodies[0].includes("foreign"), false);
    },
  );
  assert.deepEqual(ownershipArguments, [
    ["user", "foreign-course", "topic"],
    ["user", "course", "foreign-topic"],
  ]);
  assert.deepEqual(calls, { storage: 0, db: 0 });
});

test("router rejects MIME and signature mismatch before storage or database access", async () => {
  const calls = { storage: 0, db: 0 };
  await withRouter(routerFakes(calls), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      body: uploadForm({ image: new Blob([png], { type: "image/jpeg" }) }),
    });
    assert.equal(response.status, 400);
  });
  assert.deepEqual(calls, { storage: 0, db: 0 });
});

test("router rejects missing, duplicate, and unknown multipart fields without storage or database access", async () => {
  const calls = { storage: 0, db: 0 };
  await withRouter(routerFakes(calls), async (url) => {
    for (const form of [
      uploadForm(),
      uploadForm({
        image: new Blob([jpeg], { type: "image/jpeg" }),
        extraImage: new Blob([jpeg], { type: "image/jpeg" }),
      }),
      uploadForm({
        image: new Blob([jpeg], { type: "image/jpeg" }),
        unknownField: "bucket/secret/field",
      }),
    ]) {
      const response = await fetch(url, { method: "POST", body: form });
      const body = await response.text();
      assert.equal(response.status, 400);
      assert.equal(body.includes("bucket/secret"), false);
      assert.equal(body.includes("secret-image.jpg"), false);
    }
  });
  assert.deepEqual(calls, { storage: 0, db: 0 });
});

test("router accepts an image at exactly the 20 MiB boundary", async () => {
  const calls = { storage: 0, db: 0 };
  const boundaryJpeg = Buffer.alloc(ORIGINAL_IMAGE_MAX_BYTES);
  jpeg.subarray(0, jpeg.length - 2).copy(boundaryJpeg);
  boundaryJpeg.set([0xff, 0xd9], boundaryJpeg.length - 2);
  await withRouter(routerFakes(calls), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      body: uploadForm({
        image: new Blob([boundaryJpeg], { type: "image/jpeg" }),
      }),
    });
    assert.equal(response.status, 201);
  });
  assert.deepEqual(calls, { storage: 1, db: 1 });
});

test("router rejects 20 MiB plus one byte with a sanitized 413 before storage or database access", async () => {
  const calls = { storage: 0, db: 0 };
  const oversizedJpeg = Buffer.alloc(ORIGINAL_IMAGE_MAX_BYTES + 1);
  jpeg.subarray(0, jpeg.length - 2).copy(oversizedJpeg);
  oversizedJpeg.set([0xff, 0xd9], oversizedJpeg.length - 2);
  await withRouter(routerFakes(calls), async (url) => {
    const response = await fetch(url, {
      method: "POST",
      body: uploadForm({
        image: new Blob([oversizedJpeg], { type: "image/jpeg" }),
      }),
    });
    const body = await response.text();
    assert.equal(response.status, 413);
    assert.equal(body.includes("secret-image.jpg"), false);
    assert.equal(body.includes("MulterError"), false);
  });
  assert.deepEqual(calls, { storage: 0, db: 0 });
});

test("router rejects invalid UUIDs and OCR text above the exact limit before storage or database access", async () => {
  const calls = { storage: 0, db: 0 };
  await withRouter(routerFakes(calls), async (url) => {
    for (const form of [
      uploadForm({
        uploadId: "not-a-uuid",
        image: new Blob([jpeg], { type: "image/jpeg" }),
      }),
      uploadForm({
        ocrText: "x".repeat(ORIGINAL_IMAGE_MAX_OCR_TEXT_LENGTH + 1),
        image: new Blob([jpeg], { type: "image/jpeg" }),
      }),
    ]) {
      const response = await fetch(url, { method: "POST", body: form });
      assert.equal(response.status, 400);
    }
  });
  assert.deepEqual(calls, { storage: 0, db: 0 });
});

test("declared size and OCR boundaries are 20 MiB and 250000 characters, and upload ids must be v4", () => {
  assert.equal(ORIGINAL_IMAGE_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(ORIGINAL_IMAGE_MAX_OCR_TEXT_LENGTH, 250_000);
  assert.equal(id[14], "4");
});
