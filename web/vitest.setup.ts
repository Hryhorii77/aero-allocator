import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's own auto-cleanup only self-registers when it detects Jest/Vitest
// globals (`globals: true` in config) — this project imports
// describe/it/expect explicitly instead, so without this, unmounted DOM
// from one test leaks into the next within the same file and produces
// spurious "found multiple elements" failures.
afterEach(cleanup);
