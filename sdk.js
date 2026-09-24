/**
 * survival-oracle-sdk — Inteligencia de supervivencia de tokens Solana en 2 líneas.
 *
 * Envuelve el pago x402 (USDC en Base) para que CUALQUIER bot consulte el oráculo
 * sin manejar el flujo 402→pagar→reintentar a mano. Objetivo: ser el camino de
 * MENOR fricción — más fácil usarnos que no usarnos. Así se vuelve uno el default.
 *
 *   import { SurvivalOracle } from "survival-oracle-sdk";
 *   const oracle = new SurvivalOracle(wallet);          // wallet firmante x402
 *   const { survival_prob, lift_vs_base } = await oracle.score(mint, feats);
 *
 * El moat: la probabilidad viene de un modelo calibrado sobre 40k+ lanzamientos
 * FORWARD-medidos (AUC 0.718). Un competidor no puede comprar el pasado.
 */
import { wrapFetchWithPayment } from "x402-fetch";

const DEFAULT_BASE = "https://exitguard-x402.onrender.com";

export class SurvivalOracle {
  /**
   * @param {object} wallet  cuenta firmante compatible con x402 (viem/solana signer)
   * @param {object} [opts]
   * @param {string} [opts.base]     URL del oráculo
   * @param {number} [opts.timeoutMs]
   */
  constructor(wallet, opts = {}) {
    if (!wallet) throw new Error("SurvivalOracle: falta la wallet firmante (x402)");
    this.base = opts.base || DEFAULT_BASE;
    this.timeoutMs = opts.timeoutMs || 15000;
    // fetch con pago automático x402: intercepta 402, paga USDC, reintenta
    this._fetch = wrapFetchWithPayment(fetch, wallet);
  }

  async _get(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const r = await this._fetch(`${this.base}${path}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`oráculo HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Probabilidad calibrada de que un token SOBREVIVA (gradúe). Paga $0.02 USDC.
   * @param {string} mint
   * @param {{devBuy:number, serial?:number, vsol?:number}} feats  señales al nacer
   * @returns {Promise<{survival_prob:number, lift_vs_base:number, score:number, band:string, model:string}>}
   */
  async score(mint, feats = {}) {
    const db = Number(feats.devBuy || 0);
    const se = Number(feats.serial || 0);
    const vs = Number(feats.vsol || 30);
    const q = `?dev_buy=${db}&serial=${se}&vsol=${vs}&mint=${encodeURIComponent(mint)}`;
    return this._get(`/survival-score${q}`);
  }

  /**
   * ¿Se puede VENDER el token a un tamaño dado? Paga $0.01 USDC. Detecta honeypots.
   * @param {string} mint
   * @param {number} [sol=1]  tamaño de la posición en SOL
   */
  async canSell(mint, sol = 1) {
    return this._get(`/exit-check?mint=${encodeURIComponent(mint)}&sol=${sol}`);
  }

  /**
   * Decisión combinada lista para un bot: seguro de comprar sí/no + por qué.
   * Un solo await. Compone score (supervivencia) + canSell (liquidez de salida).
   */
  async safeToBuy(mint, feats = {}, sol = 1) {
    const [s, x] = await Promise.all([this.score(mint, feats), this.canSell(mint, sol)]);
    const ok = (s.lift_vs_base >= 1.0) && x.sellable && (x.verdict !== "TRAMPA");
    return {
      safe: ok,
      survival_prob: s.survival_prob,
      lift_vs_base: s.lift_vs_base,
      sellable: x.sellable,
      exit_verdict: x.verdict,
      razon: ok ? "supervivencia sobre la base y salida vendible"
                : `bloqueado: ${!x.sellable ? "no vendible" : x.verdict === "TRAMPA" ? "trampa de salida" : "supervivencia bajo la base"}`,
    };
  }
}

export default SurvivalOracle;
