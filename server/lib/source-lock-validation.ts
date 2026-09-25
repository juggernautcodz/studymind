import { z } from "zod";

export const sourceKindSchema = z.enum([
  "LECTURE_AUDIO",
  "LECTURE_TRANSCRIPT",
  "DOCUMENT",
  "PDF",
  "WHITEBOARD_IMAGE",
  "MANUAL_TEXT",
  "VIDEO",
  "URL",
]);

const optionalId = z.string().min(1).max(100).optional();

export const sourceRouteParams = z.object({
  courseId: z.string().min(1).max(100),
});

export const sourceDetailRouteParams = sourceRouteParams.extend({
  sourceId: z.string().min(1).max(100),
});

const generationMetadataSchema = z.object({
  operation: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(200).optional(),
});

const sourceSegmentSchema = z
  .object({
    content: z.string().min(1).max(20_000),
    locatorLabel: z.string().trim().min(1).max(200).optional(),
    pageNumber: z.number().int().positive().optional(),
    startSeconds: z.number().finite().nonnegative().optional(),
    endSeconds: z.number().finite().nonnegative().optional(),
    charStart: z.number().int().nonnegative().optional(),
    charEnd: z.number().int().nonnegative().optional(),
    regionX: z.number().finite().min(0).max(1).optional(),
    regionY: z.number().finite().min(0).max(1).optional(),
    regionWidth: z.number().finite().positive().max(1).optional(),
    regionHeight: z.number().finite().positive().max(1).optional(),
  })
  .superRefine((segment, ctx) => {
    if (
      segment.startSeconds !== undefined &&
      segment.endSeconds !== undefined &&
      segment.endSeconds < segment.startSeconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endSeconds"],
        message: "endSeconds must be greater than or equal to startSeconds",
      });
    }

    if (
      segment.charStart !== undefined &&
      segment.charEnd !== undefined &&
      segment.charEnd < segment.charStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["charEnd"],
        message: "charEnd must be greater than or equal to charStart",
      });
    }

    const regionValues = [
      segment.regionX,
      segment.regionY,
      segment.regionWidth,
      segment.regionHeight,
    ];
    const regionValueCount = regionValues.filter(
      (value) => value !== undefined,
    ).length;
    if (regionValueCount !== 0 && regionValueCount !== regionValues.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regionX"],
        message: "Image regions require x, y, width, and height",
      });
    }
    if (
      segment.regionX !== undefined &&
      segment.regionWidth !== undefined &&
      segment.regionX + segment.regionWidth > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regionWidth"],
        message: "Image region exceeds normalized width",
      });
    }
    if (
      segment.regionY !== undefined &&
      segment.regionHeight !== undefined &&
      segment.regionY + segment.regionHeight > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regionHeight"],
        message: "Image region exceeds normalized height",
      });
    }
  });

const sourceSegmentsSchema = z
  .array(sourceSegmentSchema)
  .min(1)
  .max(500)
  .superRefine((segments, ctx) => {
    const totalCharacters = segments.reduce(
      (total, segment) => total + segment.content.length,
      0,
    );
    if (totalCharacters > 250_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Combined segment content exceeds 250000 characters",
      });
    }
  });

export const createSourceBody = z
  .object({
    kind: sourceKindSchema,
    title: z.string().trim().min(1).max(200),
    topicId: optionalId,
    recordingId: optionalId,
    whiteboardImageId: optionalId,
    originUri: z.string().trim().min(1).max(2048).optional(),
    mimeType: z.string().trim().min(1).max(200).optional(),
    segments: sourceSegmentsSchema,
    generation: generationMetadataSchema.optional(),
  })
  .superRefine((source, ctx) => {
    if (source.recordingId && source.whiteboardImageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["whiteboardImageId"],
        message:
          "A source cannot reference both a recording and a whiteboard image",
      });
    }
  });

export const createSourceRevisionBody = z.object({
  segments: sourceSegmentsSchema,
  generation: generationMetadataSchema.optional(),
});

export const sourceRevisionQuery = z.object({
  revision: z.coerce.number().int().positive().optional(),
});

export type CreateSourceInput = z.infer<typeof createSourceBody>;
export type CreateSourceRevisionInput = z.infer<
  typeof createSourceRevisionBody
>;
