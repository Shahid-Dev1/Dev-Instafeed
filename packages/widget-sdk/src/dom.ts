type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

/**
 * Minimal element builder. Text is only ever set via textContent and attributes via setAttribute,
 * so merchant/provider data can never inject markup or scripts.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: (Node | string | null | false)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== false) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

/** Only https URLs reach src/href attributes; anything else (javascript:, data:, http:) is dropped. */
export function safeUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u).protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}
