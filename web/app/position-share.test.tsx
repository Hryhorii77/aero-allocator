import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PositionShare } from "./position-share";

describe("PositionShare", () => {
  it("builds nothing until pressed, then says what the link holds and links only the rounded power", async () => {
    render(<PositionShare power={9734.6} />);
    expect(screen.queryByRole("link", { name: "open card" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "share card" }));
    expect(screen.getByText(/not your address, not the position/)).toBeInTheDocument();
    const href = screen.getByRole("link", { name: "open card" }).getAttribute("href")!;
    expect(href).toMatch(/\/api\/share\?vp=9700$/);
    expect(href).not.toMatch(/9734|0x|tokenId/);
  });

  it("shows nothing for a position the card can't take", () => {
    const { container } = render(<PositionShare power={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
