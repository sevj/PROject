/** Whatever is stored, a browser's storage can hold anything: what is not understood is ignored. */
export function parseCollapsedGroups(stored: string): number[] {
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((id): id is number => Number.isSafeInteger(id)) : [];
  } catch {
    return [];
  }
}

export function toggleCollapsedGroup(stored: string, parentId: number): string {
  const ids = parseCollapsedGroups(stored);
  return JSON.stringify(ids.includes(parentId) ? ids.filter((id) => id !== parentId) : [...ids, parentId]);
}
