export function normalize(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}
