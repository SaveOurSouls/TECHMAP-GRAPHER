import type { TemplateAsset } from "./component-template-api";

export const MAXIMUM_TEMPLATE_ASSET_BYTES = 10 * 1024 * 1024;
export const TEMPLATE_ASSET_MEDIA_TYPES: readonly TemplateAsset["mediaType"][] = [
  "image/png",
];

export function isTemplateAssetMediaType(value: string): value is TemplateAsset["mediaType"] {
  return TEMPLATE_ASSET_MEDIA_TYPES.includes(value as TemplateAsset["mediaType"]);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function readTemplateAsset(file: File): Promise<{
  fileName: string;
  mediaType: TemplateAsset["mediaType"];
  contentBase64: string;
}> {
  if (!isTemplateAssetMediaType(file.type)) {
    throw new Error("Поддерживаются изображения PNG.");
  }
  if (file.size <= 0 || file.size > MAXIMUM_TEMPLATE_ASSET_BYTES) {
    throw new Error("Размер изображения должен быть от 1 байта до 10 МиБ.");
  }
  return {
    fileName: file.name,
    mediaType: file.type,
    contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
  };
}
