import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { BASE_USDC, TIP_ADDRESS, TipJar, parseTipAmount } from "./tip-jar";

function renderJar() {
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={new QueryClient()}>
        <div>
          <TipJar />
          <button>outside</button>
        </div>
      </QueryClientProvider>
    </WagmiProvider>,
  );
}

describe("TipJar", () => {
  it("is closed until clicked, then shows the Base USDC address and basescan link", async () => {
    const user = userEvent.setup();
    renderJar();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /tip/i }));
    expect(screen.getByRole("dialog", { name: /tip the developer/i })).toBeInTheDocument();
    expect(screen.getByText(TIP_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/usdc on base/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /basescan/i })).toHaveAttribute(
      "href",
      `https://basescan.org/address/${TIP_ADDRESS}`,
    );
  });

  it("copies the address", async () => {
    const user = userEvent.setup();
    renderJar();
    await user.click(screen.getByRole("button", { name: /tip/i }));
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: /copy address/i }));
    expect(writeText).toHaveBeenCalledWith(TIP_ADDRESS);
    expect(await screen.findByText("copied")).toBeInTheDocument();
  });

  it("offers no send amounts without a connected wallet", async () => {
    const user = userEvent.setup();
    renderJar();
    await user.click(screen.getByRole("button", { name: /tip/i }));
    expect(screen.queryByRole("button", { name: /^\$5$/ })).not.toBeInTheDocument();
  });

  it("closes on Escape and on an outside click", async () => {
    const user = userEvent.setup();
    renderJar();
    await user.click(screen.getByRole("button", { name: /tip/i }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /tip/i }));
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pays the known USDC contract on Base", () => {
    expect(BASE_USDC).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(TIP_ADDRESS.toLowerCase()).toBe("0x9b3f205e43dc9fcc1cc2fe6d9dcd0357769a6bae");
  });

  it("accepts a free amount in USD up to USDC's six decimals, and rejects the rest", () => {
    expect(parseTipAmount("2.5")).toBe("2.5");
    expect(parseTipAmount(" $10 ")).toBe("10");
    expect(parseTipAmount("0.000001")).toBe("0.000001");
    for (const bad of ["", "0", "-1", "abc", "1e3", "1.1234567", "100001", "1,5"]) {
      expect(parseTipAmount(bad)).toBeNull();
    }
  });
});
