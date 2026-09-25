export type SourceKindDto =
  | "LECTURE_AUDIO"
  | "LECTURE_TRANSCRIPT"
  | "DOCUMENT"
  | "PDF"
  | "WHITEBOARD_IMAGE"
  | "MANUAL_TEXT"
  | "VIDEO"
  | "URL";

export interface SourceLocatorDto {
  label: string | null;
  pageNumber: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  charStart: number | null;
  charEnd: number | null;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface SourceLockCitationDto {
  id: string;
  source: {
    id: string;
    kind: SourceKindDto;
    title: string;
  };
  revision: {
    id: string;
    number: number;
    contentHash: string;
  };
  segment: {
    id: string;
    position: number;
    locator: SourceLocatorDto;
    supportingExcerpt: string;
  };
  generation: {
    id: string;
    operation: string;
    provider: string | null;
    model: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
}
