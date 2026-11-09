import { describe, expect, test } from "bun:test";
import { cdCommand, expandPlaceholders, hasClipboardPlaceholder, toShellPath } from "./shell-path";

describe("toShellPath", () => {
  const cases: [string, string | undefined, string][] = [
    ["X:\\a\\b", "powershell", "X:\\a\\b"],
    ["x:/a/b", "pwsh", "X:\\a\\b"],
    ["/mnt/x/a", "cmd", "X:\\a"],
    ["/x/a", undefined, "X:\\a"],
    ["/x/a", "auto", "X:\\a"],
    ["/x/a", "custom", "X:\\a"],
    ["X:\\a\\b", "git-bash", "/x/a/b"],
    ["X:\\a\\b", "bash", "/x/a/b"],
    ["X:\\a\\b", "zsh", "/x/a/b"],
    ["X:\\a\\b", "fish", "/x/a/b"],
    ["X:\\a\\b", "sh", "/x/a/b"],
    ["X:\\a\\b", "wsl", "/mnt/x/a/b"],
    ["/x/a", "wsl", "/mnt/x/a"],
    ["X:\\a\\", "powershell", "X:\\a"],
    ["X:", "powershell", "X:\\"],
    ["X:", "wsl", "/mnt/x"],
    ["  X:\\a  ", "bash", "/x/a"],
    ["~", "powershell", "~"],
    ["~/p", "bash", "~/p"],
    ["/home/u", "wsl", "/home/u"],
    ["rel/dir", "cmd", "rel/dir"],
  ];
  for (const [p, s, out] of cases) test(`${p} ${s}`, () => expect(toShellPath(p, s)).toBe(out));
});

describe("cdCommand", () => {
  const cases: [string, string | undefined, string][] = [
    ["X:\\a", "cmd", 'cd /d "X:\\a"'],
    ["X:\\a", "powershell", "cd 'X:\\a'"],
    ["X:\\a", undefined, "cd 'X:\\a'"],
    ["X:\\it's", "pwsh", "cd 'X:\\it''s'"],
    ["X:\\a", "git-bash", "cd '/x/a'"],
    ["X:\\a", "wsl", "cd '/mnt/x/a'"],
    ["/home/it's", "bash", "cd '/home/it'\\''s'"],
    ["~", "zsh", "cd ~"],
    ["~/rest", "fish", "cd ~/'rest'"],
    ["~/it's", "sh", "cd ~/'it'\\''s'"],
  ];
  for (const [p, s, out] of cases) test(`${p} ${s}`, () => expect(cdCommand(p, s)).toBe(out));
});

describe("expandPlaceholders", () => {
  test("replaces defined values", () => {
    expect(expandPlaceholders("a {cwd} {clipboard}", { cwd: "C", clipboard: "V" })).toBe("a C V");
  });
  test("keeps undefined", () => {
    expect(expandPlaceholders("{cwd} {clipboard}", { cwd: "C" })).toBe("C {clipboard}");
  });
  test("no recursion, other braces untouched", () => {
    expect(expandPlaceholders("{cwd} {x}", { cwd: "{clipboard}", clipboard: "V" })).toBe("{clipboard} {x}");
  });
  test("hasClipboardPlaceholder", () => {
    expect(hasClipboardPlaceholder("a {clipboard}")).toBe(true);
    expect(hasClipboardPlaceholder("a {cwd}")).toBe(false);
  });
});
