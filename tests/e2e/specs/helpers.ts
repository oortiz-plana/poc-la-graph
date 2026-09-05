import { expect, type Page } from "@playwright/test";

export async function openReadyApp(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Graphify Knowledge Agent" }),
  ).toBeVisible();
  await expect(page.getByText("API connected", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("sample-project", { exact: true })).toBeVisible();
}

export async function submitQuestion(page: Page, question: string) {
  const composer = page.getByLabel("Ask a question");
  await composer.fill(question);
  await composer.press("Enter");
  await expect(
    page.getByRole("article", { name: "You message" }).last(),
  ).toContainText(question);
}

export async function waitForCompletedAnswer(page: Page) {
  const assistant = page
    .getByRole("article", { name: "Graphify Agent message" })
    .last();
  await expect(assistant.getByText(/Confidence:/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(assistant.getByRole("button", { name: "View sources" })).toBeVisible();
  return assistant;
}

export async function openPlsqlConsole(page: Page) {
  await openReadyApp(page);
  await page.goto("/plsql");
  await expect(
    page.getByRole("heading", { name: "PL/SQL analysis" }),
  ).toBeVisible();
  await expect(page.getByLabel("Search PL/SQL objects")).toBeVisible();
}

export async function searchPlsqlObjects(page: Page, query: string) {
  await page.getByLabel("Search PL/SQL objects").fill(query);
  await page.getByRole("button", { name: "Search objects" }).click();
}
