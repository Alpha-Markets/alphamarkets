import { NotImplementedError, OrionisError } from "./errors.js";

/// GET helper for the endpoints the chain cannot serve (history, statistics). Throws
/// `NotImplementedError` when the client was built without `apiUrl`, so a missing API is a clear
/// configuration message rather than a failed fetch to `undefined`.
export function createApiGet(apiUrl: string | undefined) {
  return async function apiGet<T>(method: string, path: string): Promise<T> {
    if (!apiUrl) {
      throw new NotImplementedError(
        method,
        "requires `apiUrl` in the Orionis constructor config, pointing at services/api",
      );
    }
    const response = await fetch(`${apiUrl}${path}`);
    if (!response.ok) throw new OrionisError(`${method}: services/api returned ${response.status}`);
    return (await response.json()) as T;
  };
}
