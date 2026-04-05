import { describe, expect, it } from "vitest";

import {
  simplifyRanLabel,
  simplifyShellCommand,
  workEntryPreview,
  workEntrySummary,
} from "./workLogEntry";

describe("workLogEntry command simplification", () => {
  it("unwraps quoted pwsh wrappers down to the direct command", () => {
    expect(
      simplifyShellCommand(
        '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -Command "pnpm typecheck"',
      ),
    ).toBe("pnpm typecheck");
  });

  it("unwraps nested pwsh and cmd wrappers", () => {
    expect(
      simplifyShellCommand(
        '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "cmd /c dir packages\\domain"',
      ),
    ).toBe("dir packages\\domain");
  });

  it("simplifies ran labels without keeping wrapper or duration noise", () => {
    expect(
      simplifyRanLabel(
        'Ran "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "ls packages" for 1s',
      ),
    ).toBe("Ran ls packages");
  });

  it("strips the outer pwsh command quotes around multiline python commands", () => {
    expect(
      simplifyShellCommand(
        [
          '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "python -c "from pathlib import Path',
          "text=Path('AGENTS.md').read_text().splitlines()",
          'print(text[0])"',
        ].join("\n"),
      ),
    ).toBe(
      [
        'python -c "from pathlib import Path',
        "text=Path('AGENTS.md').read_text().splitlines()",
        "print(text[0])",
      ].join("\n"),
    );
  });

  it("uses the simplified command in summaries for command entries", () => {
    expect(
      workEntrySummary({
        label: "Ran command for 4s",
        command: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "pnpm typecheck"',
        requestKind: "command",
        itemType: "command_execution",
      }),
    ).toBe("Ran pnpm typecheck");
  });

  it("uses the simplified command in previews", () => {
    expect(
      workEntryPreview({
        command:
          '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-ChildItem packages | Format-List"',
      }),
    ).toBe("Get-ChildItem packages | Format-List");
  });
});
