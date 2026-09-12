import { useEffect, useState } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";
import { PROFILE_AVATARS } from "./avatars";

export const PROFILE_STORAGE_KEY = "settings.personal.profile";
export interface PersonalProfile {
  nickname: string;
  avatar: string;
}
export const DEFAULT_PROFILE: PersonalProfile = {
  nickname: "",
  avatar: PROFILE_AVATARS[0].id,
};

export function normalizeProfile(value: unknown): PersonalProfile {
  const raw = (
    value && typeof value === "object" ? value : {}
  ) as Partial<PersonalProfile>;
  return {
    nickname:
      typeof raw.nickname === "string" ? raw.nickname.trim().slice(0, 32) : "",
    avatar:
      typeof raw.avatar === "string" &&
      (PROFILE_AVATARS.some((item) => item.id === raw.avatar) ||
        (raw.avatar.length <= 1500000 &&
          /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
            raw.avatar,
          )))
        ? raw.avatar
        : DEFAULT_PROFILE.avatar,
  };
}

export function profileAvatarSrc(avatar: string) {
  return PROFILE_AVATARS.find((item) => item.id === avatar)?.src ?? avatar;
}

export function usePersonalProfile() {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let active = true;
    let changed = false;
    const storage = getPlatform().storage;
    const unsubscribe = storage.watch([PROFILE_STORAGE_KEY], (changes) => {
      if (active && changes[PROFILE_STORAGE_KEY]) {
        changed = true;
        setProfile(normalizeProfile(changes[PROFILE_STORAGE_KEY].newValue));
      }
    });
    void storage
      .get([PROFILE_STORAGE_KEY])
      .then((result) => {
        if (active && !changed)
          setProfile(normalizeProfile(result[PROFILE_STORAGE_KEY]));
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const save = async (next: PersonalProfile) => {
    const normalized = normalizeProfile(next);
    await getPlatform().storage.set({ [PROFILE_STORAGE_KEY]: normalized });
    setProfile(normalized);
    return normalized;
  };
  return { profile, ready, loadError, save };
}

/** Decode before storing, strip metadata, and cap the persisted avatar size. */
export async function readUploadedAvatar(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  ) {
    throw new Error("invalid-image");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    if (!edge) throw new Error("invalid-image");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("invalid-image");
    context.drawImage(
      image,
      (image.naturalWidth - edge) / 2,
      (image.naturalHeight - edge) / 2,
      edge,
      edge,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
