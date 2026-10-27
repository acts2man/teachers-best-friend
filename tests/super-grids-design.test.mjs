// Ricky's super grids (#app-ideas, 22 Oct 2026): design only, no code. This
// pins that the design answers every part of the request.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const path = "docs/design/super-grids.md";

test("the super-grid design covers every part of the request", () => {
  assert.ok(existsSync(path), path + " exists");
  const doc = readFileSync(path, "utf8");
  assert.match(doc, /\*\*Design only\. Nothing here is built\.\*\*/);
  for (const section of [
    "## 2. How clusters are worked out, framework by framework",
    "## 3. The class super grid",
    "## 4. The student super grid and its printable report",
    "## 5. The left menu",
    "## 6. What is and isn't possible",
    "## 8. Questions for Ricky (plain words)",
  ])
    assert.ok(doc.includes(section), "has: " + section);
  // The pieces Ricky named.
  assert.match(doc, /last\s+30 days/);
  assert.match(doc, /school year/i);
  assert.match(doc, /[Pp]re-teach/);
  assert.match(doc, /parent conference/i);
  assert.match(doc, /IEP/);
  assert.match(doc, /New assessment[\s\S]*Class insights[\s\S]*Student insights/);
  // Each framework in use, and the rules that would need a decision.
  for (const shape of ["CCSS.MATH.CONTENT.7.RP.A.1", "A-CED", "RL.7.1", "MA.7.AR.1.1", "7.4(A)"]) assert.ok(doc.includes(shape), "code shape " + shape);
  assert.match(doc, /prompt change/);
  assert.match(doc, /sync_workspace/);
});
