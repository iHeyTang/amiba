import { PROFILE_AVATARS } from "./avatars";

export const AVATAR_BATCH_SIZE = 12;

/** Each batch is unique and excludes the immediately preceding batch. */
export function nextAvatarBatch(previousIds: readonly string[]) {
  const previous = new Set(previousIds);
  const candidates = PROFILE_AVATARS.filter(
    (avatar) => !previous.has(avatar.id),
  );
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[other]] = [
      candidates[other],
      candidates[index],
    ];
  }
  return candidates.slice(0, AVATAR_BATCH_SIZE);
}
