export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    keycloak: {
      url: process.env.KEYCLOAK_URL ?? "http://localhost:8080",
      realm: process.env.KEYCLOAK_REALM ?? "graphify",
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? "graphify-web",
    },
    uploadLimits: {
      maxFileBytes: Number(process.env.UPLOAD_MAX_FILE_BYTES ?? 2097152),
      maxFiles: Number(process.env.UPLOAD_MAX_FILES ?? 100),
      maxTotalBytes: Number(process.env.UPLOAD_MAX_TOTAL_BYTES ?? 33554432),
    },
  });
}
