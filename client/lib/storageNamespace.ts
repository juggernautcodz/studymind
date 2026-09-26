export function scopedStorageKey(
  key: string,
  userId: string | null,
  globalKeys: ReadonlySet<string>,
): string {
  if (globalKeys.has(key)) return key;
  return userId ? `${userId}:${key}` : key;
}
