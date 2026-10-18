export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
export const ATTACHMENT_MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export function attachmentMime(name: string) { return ATTACHMENT_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? null; }
