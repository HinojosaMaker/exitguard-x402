# ExitGuard — pre-trade on-chain safety oracles for AI agents (x402)

Machine-payable oracles that answer the questions a trading agent must ask **before** it buys:
**can I get back out, and is the exit drying up right now?** Paid per call in **USDC on Base** via [x402](https://x402.org). No account, no API key — your agent pays a few cents and gets a verifiable fact, not a guess.

**Live:** `https://exitguard-oracle.onrender.com` · discoverable on the open [402index](https://402index.io).

## Why it exists
97% of freshly launched Solana tokens can't actually be sold at size — the quoted price is not a fill. Every other tool shows you the price. ExitGuard measures the **executable round-trip** and tells you the exact dollar size at which a token becomes a trap, and whether liquidity is being pulled *this minute*.

## Oracles (USDC on Base, per call)

| Endpoint | Price | What it measures |
|---|---|---|
| `GET /escape-curve?mint&sol_usd` | $0.03 | Max USD size a token stays sellable (executable round-trip at rising sizes). **Unique.** |
| `GET /liquidity-decay?mint&sol` | $0.04 | Rug **in progress**: is exit liquidity drying up right now (time derivative). **Unique.** |
| `GET /solana-gate?mint&sol` | $0.01 | GO/NO-GO fusing exit liquidity + on-chain rug check. |
| `GET /exit-check?mint&sol` | $0.01 | Executable exit liquidity via Jupiter round-trip. |
| `GET /rug-solana?mint` | $0.02 | Mint/freeze authority + top-holder concentration, read from chain. |
| `GET /survival-score?dev_buy&serial&vsol` | $0.02 | Probability a new token survives (forward-measured, AUC 0.718). |
| `GET /carry-scan?min_oi_usd&max_horas` | $0.02 | Operable market-neutral funding carry on Hyperliquid. |
| `GET /safe-to-sign?calldata&hook` | $0.03 | Pre-signature audit: drainer calldata + Uniswap V4 hook class. |

Discovery: `GET /.well-known/x402.json` · free health: `GET /health`

## Use it (HTTP + x402)
Any x402 client works. Unpaid requests return `402` with the payment challenge (body + `PAYMENT-REQUIRED` header); pay in USDC on Base and retry.

```bash
curl "https://exitguard-oracle.onrender.com/escape-curve?mint=<MINT>&sol_usd=200"
# -> 402 Payment Required (challenge). Pay with your x402 wallet, retry, get the verdict.
```

## Use it as an MCP tool (no npm)
Install straight from this repo — exposes every oracle as an MCP tool your agent can discover:

```json
{
  "mcpServers": {
    "exitguard": { "command": "npx", "args": ["-y", "github:HinojosaMaker/exitguard-x402"] }
  }
}
```

## Honest scope
These oracles remove the **measurable** ways to lose (traps, rugs-in-progress, dead liquidity). They do **not** predict price direction — minute-to-minute direction on memecoins is a coin flip (measured). ExitGuard is an **anti-ruin layer**, not a buy signal.

Payments settle to a Base wallet via a public x402 facilitator. MIT.
