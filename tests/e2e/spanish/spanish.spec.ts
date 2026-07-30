import { expect, test } from "@playwright/test";
import {
  openReadyApp,
  submitQuestion,
  waitForCompletedAnswer,
} from "../specs/helpers";

test.skip(
  process.env.E2E_REAL_GRAPHIFY !== "1",
  "Set E2E_REAL_GRAPHIFY=1 against a running real four-law graph.",
);

test("streams a cited Spanish answer from the configured graph", async ({
  page,
}) => {
  await openReadyApp(page);
  await submitQuestion(
    page,
    "¿Qué establece la Ley 100 de 1993 sobre el sistema general de pensiones?",
  );
  const assistant = await waitForCompletedAnswer(page);
  await expect(assistant).toContainText(
    /Ley 100 de 1993|evidencia|información|pensiones/i,
  );
  await expect(assistant.getByRole("button", { name: "View sources" })).toContainText(
    /Sources \([1-9]\d*\)/,
  );
  await assistant.getByRole("button", { name: "View sources" }).click();
  await expect(page.getByRole("dialog", { name: "Answer evidence" })).toContainText(
    /ley-100-de-1993\.md/i,
  );
});
