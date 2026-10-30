export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}
