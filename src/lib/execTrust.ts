import type { ExecTrust } from "./types";

/**
 * The question a console asks before Eugene's own account runs a program
 * that one other account can change (row 8, part 8c, call R8-EXEC-TRUST).
 * It says plainly what approving means: that account can then act as
 * Eugene, because whoever can change the program changes what Eugene runs.
 */
export function approvalQuestion(trust: ExecTrust): string {
  const slash = trust.path.lastIndexOf("/");
  const name = slash >= 0 ? trust.path.slice(slash + 1) : trust.path;
  const folder = slash > 0 ? trust.path.slice(0, slash) : "/";
  const who = trust.account ?? "its owner";
  return `Run ${name} from ${folder} as Eugene's account? Anyone who can change this file (${who}) can then act as Eugene.`;
}
