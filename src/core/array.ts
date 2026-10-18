/** Removes the first element `=== item` in place, preserving order. Returns whether it was found. */
export function removeItem<T>(arr: T[], item: T): boolean {
  const i = arr.indexOf(item);
  if (i < 0) return false;
  for (let j = i; j < arr.length - 1; j++) arr[j] = arr[j + 1];
  arr.length -= 1;
  return true;
}
