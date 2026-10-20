import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), setLocale: vi.fn() }));

vi.unmock("@/components/locale-switcher");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/i18n/actions", () => ({ setLocale: mocks.setLocale }));

import { LocaleSwitcher } from "./locale-switcher";

describe("LocaleSwitcher", () => {
  it("saves the chosen locale and refreshes the page", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LocaleSwitcher />);

    await user.click(screen.getByRole("button", { name: "Language" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Español" }));

    expect(mocks.setLocale).toHaveBeenCalledWith("es");
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
});
