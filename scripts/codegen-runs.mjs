// Additive protocol snapshots travel with VENDORED.json during staged rollouts.
// Regeneration is offline and independent of the older aggregate SPECS_REF.
import { writeFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";

const input = new URL("../contracts/run-operations.json", import.meta.url);
const output = new URL("../src/generated/run-operations.ts", import.meta.url);
writeFileSync(output, astToString(await openapiTS(input)));
