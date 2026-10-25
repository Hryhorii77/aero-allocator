import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AERO_LAUNCH_AT_MS } from "./launch";

const OWNER = "0x9b3F205E43dc9FcC1cc2Fe6d9dCD0357769A6Bae";
const NOW = Math.floor(AERO_LAUNCH_AT_MS / 1000) + 3 * 3600;

const account = vi.hoisted(() => ({ address: undefined as string | undefined }));
const read = vi.hoisted(() => ({ readContract: vi.fn(), readContracts: vi.fn() }));
vi.mock("wagmi", () => ({ useAccount: () => account }));
vi.mock("wagmi/actions", () => read);
vi.mock("@/lib/wagmi", () => ({ wagmiConfig: {} }));

import { SaeroPositions } from "./saero-positions";

const e18 = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

describe("SaeroPositions", () => {
  beforeEach(() => {
    account.address = undefined;
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    read.readContract.mockReset();
    read.readContracts.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("is hidden before the launch instant", async () => {
    vi.spyOn(Date, "now").mockReturnValue(AERO_LAUNCH_AT_MS - 1000);
    const { container } = render(<SaeroPositions />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("rejects text that isn't an address without reading the chain", async () => {
    render(<SaeroPositions />);
    fireEvent.change(await screen.findByLabelText(/address to read/i), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "read" }));
    expect(await screen.findByText(/isn.t an address/)).toBeInTheDocument();
    expect(read.readContract).not.toHaveBeenCalled();
  });

  it("flags a half-typed address as soon as you leave the box, marks it invalid, and clears when you fix it", async () => {
    render(<SaeroPositions />);
    const box = await screen.findByLabelText(/address to read/i);
    fireEvent.change(box, { target: { value: "0x1234" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(box);
    expect(screen.getByRole("alert")).toHaveTextContent(/starts with 0x and has 42 characters/);
    expect(box).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(box, { target: { value: OWNER } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "false");
  });

  it("does not nag about an empty box on blur", async () => {
    render(<SaeroPositions />);
    const box = await screen.findByLabelText(/address to read/i);
    fireEvent.blur(box);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows size, lock end, allocated share and the 47h countdown", async () => {
    read.readContract.mockImplementation(async (_cfg: unknown, { functionName }: { functionName: string }) =>
      functionName === "balanceOf" ? 1n : 169_200,
    );
    read.readContracts
      .mockResolvedValueOnce([7n])
      .mockResolvedValueOnce([
        { amount: e18(100), end: 1918425600, isPermanent: false },
        e18(98),
        [e18(100), 1918425600, NOW - 3600, false],
        ["0x0000000000000000000000000000000000000000", NOW - 3600, false, e18(50)],
        e18(50),
        e18(50),
      ]);
    render(<SaeroPositions />);
    fireEvent.change(await screen.findByLabelText(/address to read/i), { target: { value: OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "read" }));

    expect(await screen.findByText("#7")).toBeInTheDocument();
    expect(screen.getByText(/locked to 2030-10-17/)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/next allocation in 46h 00m/)).toBeInTheDocument();
  });

  it("offers a calendar reminder for when the wait ends, built in the browser", async () => {
    read.readContract.mockImplementation(async (_cfg: unknown, { functionName }: { functionName: string }) => (functionName === "balanceOf" ? 1n : 169_200));
    read.readContracts
      .mockResolvedValueOnce([7n])
      .mockResolvedValueOnce([
        { amount: e18(100), end: 1918425600, isPermanent: false },
        e18(98),
        [e18(100), 1918425600, NOW - 3600, false],
        ["0x0000000000000000000000000000000000000000", NOW - 3600, false, e18(50)],
        e18(50),
        e18(50),
      ]);
    let saved: Blob | null = null;
    const create = vi.fn((b: Blob) => ((saved = b), "blob:x"));
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<SaeroPositions />);
    fireEvent.change(await screen.findByLabelText(/address to read/i), { target: { value: OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "read" }));
    fireEvent.click(await screen.findByRole("button", { name: "remind me" }));
    expect(create).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(saved as unknown as Blob);
    });
    // ready at last allocation (NOW - 3600) + cooldown 169,200
    const readyAt = NOW - 3600 + 169_200;
    expect(text).toContain(`DTSTART:${new Date(readyAt * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    expect(text).toContain("sAERO #7 can be re-allocated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explains that each position has its own wait, and that an existing one can't be split", async () => {
    render(<SaeroPositions />);
    expect(await screen.findByText(/Want to move more often than every 47 hours/)).toBeInTheDocument();
    expect(screen.getByText(/The wait belongs to each position, not to your wallet/)).toHaveTextContent(/no way to split an existing position/);
  });

  it("says so when the address has no positions", async () => {
    read.readContract.mockImplementation(async (_cfg: unknown, { functionName }: { functionName: string }) =>
      functionName === "balanceOf" ? 0n : 169_200,
    );
    render(<SaeroPositions />);
    fireEvent.change(await screen.findByLabelText(/address to read/i), { target: { value: OWNER } });
    fireEvent.click(screen.getByRole("button", { name: "read" }));
    expect(await screen.findByText(/No sAERO positions at/)).toBeInTheDocument();
    expect(read.readContracts).not.toHaveBeenCalled();
  });

  it("reads the connected wallet with one click", async () => {
    account.address = OWNER;
    read.readContract.mockImplementation(async (_cfg: unknown, { functionName }: { functionName: string }) =>
      functionName === "balanceOf" ? 0n : 169_200,
    );
    render(<SaeroPositions />);
    fireEvent.click(await screen.findByRole("button", { name: "use my wallet" }));
    await waitFor(() => expect(read.readContract).toHaveBeenCalled());
    expect(read.readContract.mock.calls[0][1].args).toEqual([OWNER]);
  });
});
