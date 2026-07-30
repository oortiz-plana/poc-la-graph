import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { openReadyApp, submitQuestion, waitForCompletedAnswer } from "./helpers";

const dependencyControl = process.env.E2E_DEPENDENCY_CONTROL === "1";
const composeDirectory = path.resolve(__dirname, "../../..");
const composeFiles = (
  process.env.E2E_COMPOSE_FILES ??
  "docker-compose.yml,docker-compose.synthetic.yml"
)
  .split(",")
  .map((file) => file.trim())
  .filter(Boolean)
  .flatMap((file) => ["-f", file]);

function compose(...args: string[]) {
  execFileSync("docker", ["compose", ...composeFiles, ...args], {
    cwd: composeDirectory,
    stdio: "inherit",
    timeout: 120_000,
  });
}

test.describe("Graphify dependency recovery", () => {
  test.skip(
    !dependencyControl,
    "Set E2E_DEPENDENCY_CONTROL=1 to authorize stopping and restarting Graphify.",
  );
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    if (dependencyControl) compose("up", "-d", "--wait", "graphify", "api", "web");
  });

  test("shows a safe failure and recovers when Graphify returns", async ({ page }) => {
    await openReadyApp(page);
    compose("stop", "graphify");

    await submitQuestion(page, "How are the web and API services connected?");
    const assistant = page
      .getByRole("article", { name: "Graphify Agent message" })
      .last();
    await expect(
      assistant.getByRole("alert").filter({
        hasText: /Graphify|knowledge service|unavailable|failed|timed out/i,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Retry answer" })).toBeVisible();

    compose("up", "-d", "--wait", "graphify");
    await page.getByRole("button", { name: "Retry answer" }).click();
    await waitForCompletedAnswer(page);
    await expect(page.getByRole("button", { name: "View sources" }).last()).toContainText(
      /Sources \([1-9]\d*\)/,
    );
  });
});
