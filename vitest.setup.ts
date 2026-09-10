/** jest-dom matchers (`toBeInTheDocument`, `toBeDisabled`, ...) plus a DOM
 * reset between tests, so one test's rendered tree cannot be found by the
 * next one's queries. */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
