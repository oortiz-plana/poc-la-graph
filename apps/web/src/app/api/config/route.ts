export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    projectId:
      process.env.GRAPHIFY_PROJECT_ID ??
      process.env.NEXT_PUBLIC_GRAPHIFY_PROJECT_ID ??
      "sample-project",
  });
}
