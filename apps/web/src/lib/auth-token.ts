let accessToken: (() => Promise<string>) | undefined;

export function registerAccessToken(provider: () => Promise<string>) {
  accessToken = provider;
}

export async function authorizationHeaders(): Promise<Record<string, string>> {
  if (!accessToken) return {};
  return { Authorization: `Bearer ${await accessToken()}` };
}
