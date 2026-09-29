/** jest-dom matchers (`toBeInTheDocument`, `toBeDisabled`, ...) plus a DOM
 * reset between tests, so one test's rendered tree cannot be found by the
 * next one's queries. */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { clearConfigTrios } from "./src/lib/configTrio";

afterEach(() => {
  cleanup();
  // The config editor shares one read of a component's schema and
  // document across the sections of a page for a few seconds; between
  // tests that would hand one test's fixture to the next.
  clearConfigTrios();
});
