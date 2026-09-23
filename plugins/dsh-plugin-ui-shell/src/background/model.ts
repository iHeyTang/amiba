import { z } from "zod";
export const MAX_BACKGROUND_BYTES = 64 * 1024 * 1024;
export const BACKGROUND_CHUNK_BYTES = 256 * 1024;
export const assetIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}\.(png|jpg|webp|mp4|webm)$/);
export const backgroundConfigSchema = z.strictObject({
  enabled: z.boolean(),
  assetId: assetIdSchema.nullable(),
  posterId: assetIdSchema.nullable(),
  motion: z.enum(["play", "pause"]),
  fit: z.enum(["cover", "contain"]),
  dim: z.number().min(0).max(0.65),
  blur: z.number().min(0).max(20),
  glass: z.enum(["balanced", "strong"]),
}).transform(config => ({ ...config, fit: "cover" as const, glass: "balanced" as const }));
export type BackgroundConfig = z.input<typeof backgroundConfigSchema>;
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  enabled: false,
  assetId: null,
  posterId: null,
  motion: "play",
  fit: "cover",
  dim: 0.15,
  blur: 0,
  glass: "balanced",
};
export interface BackgroundSnapshot {
  revision: number;
  config: BackgroundConfig;
}
export interface BackgroundAsset {
  id: string;
  mime: string;
  bytes: number;
}
export interface BackgroundApi {
  get(): Promise<BackgroundSnapshot>;
  configure(
    config: BackgroundConfig,
    revision: number,
  ): Promise<BackgroundSnapshot>;
  beginUpload(bytes: number): Promise<string>;
  upload(id: string, offset: number, data: string): Promise<number>;
  finishUpload(id: string): Promise<BackgroundAsset>;
  asset(
    id: string,
    offset: number,
  ): Promise<{ data: string; mime: string; bytes: number }>;
}
export function isVideo(id: string | null) {
  return !!id && /\.(mp4|webm)$/.test(id);
}
