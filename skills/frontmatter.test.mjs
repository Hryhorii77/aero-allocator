import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `npx skills add` skips a SKILL.md whose front matter is not valid YAML. A plain (unquoted) value cannot contain ": " or " #", and our
// descriptions are full sentences, so they must be quoted. (PR #114 once shipped two unquoted ones; the installer silently skipped them.)
const FILES = ["SKILL.md", "skills/saero-allocator-automator/SKILL.md", "skills/veaero-to-saero-upgrade/SKILL.md"];
const root = join(import.meta.dirname, "..");

describe.each(FILES)("%s front matter", (file) => {
  const text = readFileSync(join(root, file), "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);

  it("exists with a name and a description", () => {
    expect(match, "no front matter block").not.toBeNull();
    expect(match[1]).toMatch(/^name: [a-z0-9-]+$/m);
    expect(match[1]).toMatch(/^description: .+$/m);
  });

  it("quotes any value that a plain YAML scalar could not hold", () => {
    for (const line of match[1].split("\n")) {
      const kv = line.match(/^([a-z]+): (.+)$/); // top-level keys only; nested ones are indented
      if (!kv) continue;
      const value = kv[2];
      const quoted = /^".*"$/.test(value) || /^'.*'$/.test(value);
      if (!quoted) expect(value, `${file}: ${kv[1]} needs quotes`).not.toMatch(/: | #/);
    }
  });
});
