import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import messages from "../../messages/en";

function IntlWrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

/** The provider is a `wrapper`, so `rerender` keeps the intl context. */
export function renderWithIntl(ui: ReactElement) {
  return render(ui, { wrapper: IntlWrapper });
}
