import { expect, test } from "@playwright/test";
import { openReadyApp, submitQuestion, waitForCompletedAnswer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await openReadyApp(page);
});

test("streams a grounded answer and exposes citations and graph evidence", async ({
  page,
}) => {
  const chatResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/chat" &&
      response.request().method() === "POST",
  );
  await submitQuestion(
    page,
    "How does the Knowledge Chat Web connect to the Knowledge Agent API?",
  );

  // A tool or writing status is the user-facing representation of streamed
  // Graphify activity. Protocol assertions below remain authoritative on very
  // fast machines where the transient status can disappear between render polls.
  const activity = page.getByText(
    /Searching Graphify|Writing an evidence-grounded answer/,
  );
  await activity.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

  const response = await chatResponse;
  expect(response.ok()).toBe(true);
  const assistant = await waitForCompletedAnswer(page);
  await expect(assistant.getByRole("button", { name: "View sources" })).toContainText(
    /Sources \([1-9]\d*\)/,
  );

  const stream = await response.text();
  const searchingAt = stream.indexOf('"activity":"searching"');
  const deltaAt = stream.indexOf('"type":"text-delta"');
  const citationAt = stream.indexOf('"type":"data-citation"');
  const completionAt = stream.indexOf('"type":"data-result"');
  expect(searchingAt).toBeGreaterThanOrEqual(0);
  expect(deltaAt).toBeGreaterThan(searchingAt);
  expect(citationAt).toBeGreaterThan(deltaAt);
  expect(completionAt).toBeGreaterThan(citationAt);
  expect(stream).toContain("data: [DONE]");

  await assistant.getByRole("button", { name: "View sources" }).click();
  const drawer = page.getByRole("dialog", { name: "Answer evidence" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: /Sources \([1-9]\d*\)/ })).toBeVisible();
  await expect(drawer).toContainText("Graphify knowledge graph");
  await expect(drawer).toContainText(/Relationship: [A-Z][A-Z0-9_]*/);
  await expect(drawer.getByRole("heading", { name: /Nodes \([1-9]\d*\)/ })).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: /Relationships \([1-9]\d*\)/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Close evidence" }).click();
  await expect(drawer).toBeHidden();
});

test("keeps the durable conversation after a reload", async ({ page }) => {
  const question = "What does Graphify expose through MCP?";
  await submitQuestion(page, question);
  await waitForCompletedAnswer(page);

  await page.reload();
  await expect(page.getByText("API connected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "You message" }).filter({ hasText: question }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Graphify Agent message" }),
  ).not.toHaveCount(0);
});

test("resets conversation history after confirmation", async ({ page }) => {
  await submitQuestion(page, "What services are represented in this graph?");
  await waitForCompletedAnswer(page);

  await page.getByRole("button", { name: "Reset conversation" }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Reset conversation?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Reset conversation" }).click();

  await expect(page.getByRole("region", { name: "Conversation" })).toContainText(
    "Explore your connected knowledge",
  );
  await expect(page.getByRole("article", { name: "You message" })).toHaveCount(0);
  await expect(page.getByLabel("Ask a question")).toBeFocused();
});
