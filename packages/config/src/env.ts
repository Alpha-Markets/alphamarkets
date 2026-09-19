/// Loads `.env` for local dev using Node's built-in loader (no dotenv dependency needed,
/// Node >= 20.6). Silently does nothing if the file is absent — a deployed environment
/// (e.g. Railway) sets real environment variables directly, no `.env` file present.
export function loadDotEnv(path = "../../.env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // no .env file at this path — rely on variables already set in the environment.
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
