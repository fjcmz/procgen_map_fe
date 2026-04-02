export class IdUtil {
  private static readonly DEFAULT_SEPARATOR = '_';

  static id(...parts: unknown[]): string | null {
    if (!parts || parts.length === 0) return null;
    return parts.map(p => String(p)).join(IdUtil.DEFAULT_SEPARATOR);
  }

  static idCustom(separator: string, ...parts: unknown[]): string | null {
    if (!parts || parts.length === 0) return null;
    return parts.map(p => String(p)).join(separator);
  }
}
