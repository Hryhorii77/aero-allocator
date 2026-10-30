import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PAYING_SHARE_OF_MEAN, SPIKE_RATIO, STEADY_BUCKET_HOURS } from "@/lib/fee-history";
import { paceConfidence, SOLID_FROM_HOURS, THIN_UNDER_HOURS } from "@/lib/gauge-yield";
import { Glossary, glossaryTerms } from "./glossary";

describe("Glossary", () => {
  it("explains every word the table uses, behind one closed-by-default summary", () => {
    const { container } = render(<Glossary />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("What do these words mean?"));
    for (const t of ["You earn / day", "thin, fair, solid pace", "spiky", "steady 5/6", "incentives, incentives (ending)", "Power flow", "CL100, volatile, stable"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("states the same numbers the code uses", () => {
    const text = glossaryTerms().map((g) => g.meaning).join(" ");
    expect(text).toContain(`under ${THIN_UNDER_HOURS} hours`);
    expect(text).toContain(`${SPIKE_RATIO} times`);
    expect(text).toContain(`${STEADY_BUCKET_HOURS} hours each`);
    expect(text).toContain(`${Math.round(PAYING_SHARE_OF_MEAN * 100)}% of the average`);
    // The thin/solid boundaries in the text are the ones paceConfidence applies.
    expect(paceConfidence(THIN_UNDER_HOURS - 0.1)).toBe("thin");
    expect(paceConfidence(THIN_UNDER_HOURS)).toBe("fair");
    expect(paceConfidence(SOLID_FROM_HOURS)).toBe("solid");
  });

  it("names the real flow window when it is known, and 24 hours otherwise", () => {
    expect(glossaryTerms(11.6).find((g) => g.term === "Power flow")?.meaning).toContain("last 12 hours");
    expect(glossaryTerms().find((g) => g.term === "Power flow")?.meaning).toContain("last 24 hours");
  });
});
