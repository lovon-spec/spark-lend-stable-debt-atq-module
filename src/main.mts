import fetch from "node-fetch";
import type { ContractTag, ITagService } from "atq-types";

// One token role per module. No activity, balance or reserve-state filter:
// deployed historical accounting tokens remain correctly attributable.
const ROLE = "_sToken";
const ROLE_LABEL = "Stable Debt";
const ROLE_NOTE = "historical non-transferable stable-debt accounting token representing the reserve's legacy stable-rate debt bookkeeping; not a stablecoin";
const DEPLOYMENT = "QmTVumjhubXWP8MeDx5g114MRX99E4Gie5mFqVurttF99X";
const REGISTRY = "0x03cfa0c4622ff84e50e75062683f44c9587e6cc1";
const PAGE = 1000, DEADLINE_MS = 180_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/, ZERO = "0x" + "0".repeat(40);
const META_QUERY = "query { _meta { deployment hasIndexingErrors block { number hash } } }";
const MARKETS_QUERY = "query Markets($block: Block_height!, $last: ID!) {" +
  " _meta(block: $block) { deployment hasIndexingErrors block { number hash } }" +
  " markets(block: $block, first: 1000, orderBy: id, orderDirection: asc, where: {id_gt: $last}) {" +
  " id inputToken { id name symbol } " + ROLE + " { id name symbol } " +
  (String(ROLE) === "outputToken" ? "" : " outputToken {id} ") + " protocol {id} } }";
interface Meta { deployment: string; hasIndexingErrors: boolean; block: { number: number; hash: string | null } }
interface Token { id: unknown; name: unknown; symbol: unknown }
interface RawMarket { id: unknown; inputToken: Token | null; outputToken?: Token | null; _vToken?: Token | null; _sToken?: Token | null; protocol: {id: unknown} | null }
function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value) || value.toLowerCase() === ZERO)
    throw Error("Invalid " + field + " address in SparkLend response.");
  return value.toLowerCase();
}
function plain(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw Error("Invalid " + field + ".");
  const result = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[`*_\[\]<>\\|]/g, " ").replace(/\s+/g, " ").trim();
  if (!result) throw Error("Empty sanitized " + field + ".");
  return result;
}
function checkMeta(value: unknown, number?: number, hash?: string): Meta {
  const meta = value as Meta | null;
  if (!meta || meta.deployment !== DEPLOYMENT || meta.hasIndexingErrors !== false ||
      !Number.isSafeInteger(meta.block?.number) || meta.block.number <= 0 ||
      (meta.block.hash !== null && (typeof meta.block.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(meta.block.hash))) ||
      (number !== undefined && meta.block.number !== number) ||
      (hash !== undefined && meta.block.hash !== null && meta.block.hash !== hash))
    throw Error("Invalid, inconsistent or errored SparkLend indexing metadata.");
  return meta;
}
// Descriptive issuer/protocol associations only; output addresses and each
// underlying association are always retrieved from the indexed market.
function projects(symbol: string, name: string): string[] {
  const known: Readonly<Record<string, string[]>> = {
    WSTETH: ["Lido"], USDC: ["Circle"], WEETH: ["ether.fi"], WBTC: ["Wrapped Bitcoin (WBTC)"],
    DAI: ["Sky (formerly MakerDAO)"], RLUSD: ["Ripple"], WETH: ["Ethereum"],
    SUSDS: ["Sky"], USDG: ["Paxos", "Global Dollar Network"], PYUSD: ["PayPal", "Paxos"],
    SDAI: ["Sky (formerly MakerDAO)"], GNO: ["Gnosis"], RSETH: ["Kelp DAO"],
    RETH: ["Rocket Pool"], LBTC: ["Lombard"], EZETH: ["Renzo"],
    CBBTC: ["Coinbase"], USDS: ["Sky"], TBTC: ["Threshold Network"], USDT: ["Tether"],
  };
  return known[symbol.toUpperCase()] ?? [name];
}
export async function returnTags(chainId: string, apiKey: string): Promise<ContractTag[]> {
  if (chainId !== "1") throw Error("Unsupported Chain ID: " + String(chainId) + ".");
  if (typeof apiKey !== "string" || !apiKey.trim() || /\s/.test(apiKey))
    throw Error("A nonempty Graph API key without whitespace is required.");
  const endpoint = "https://gateway.thegraph.com/api/deployments/id/" + DEPLOYMENT, deadline = Date.now() + DEADLINE_MS;
  async function query(document: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error("SparkLend query deadline exceeded; no partial result returned.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.min(30_000, remaining));
    try {
      const response = await fetch(endpoint, {method: "POST", redirect: "error", size: 16_000_000,
        headers: {"content-type": "application/json", authorization: "Bearer " + apiKey},
        body: JSON.stringify({query: document, variables}), signal: controller.signal});
      if (!response.ok) throw Error("Graph gateway HTTP error.");
      const payload = await response.json() as {data?: Record<string, unknown>; errors?: unknown};
      if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length))
        throw Error("Graph returned query errors; no partial result returned.");
      if (!payload.data || typeof payload.data !== "object") throw Error("Graph returned no query data.");
      return payload.data;
    } catch {
      // Provider-supplied errors are not reflected: they can contain secrets.
      throw Error("Unable to retrieve complete SparkLend " + ROLE_LABEL + " data.");
    } finally {clearTimeout(timer);}
  }
  const head = checkMeta((await query(META_QUERY, {}))._meta);
  if (!head.block.hash) throw Error("Graph did not identify an indexed snapshot hash.");
  const tags = new Map<string, ContractTag>(), names = new Map<string, string>(), block = {hash: head.block.hash};
  let cursor = "";
  while (true) {
    const result = await query(MARKETS_QUERY, {block, last: cursor});
    checkMeta(result._meta, head.block.number, head.block.hash);
    const rows = result.markets as RawMarket[];
    if (!Array.isArray(rows) || rows.length > PAGE) throw Error("Invalid SparkLend market page.");
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || row.id <= cursor) throw Error("Market cursor did not advance in strict order.");
      cursor = row.id;
      const asset = address(row.inputToken?.id, "underlying asset"), contract = address(row[ROLE]?.id, ROLE_LABEL);
      const providerRegistry = address(row.protocol?.id, "provider registry");
      // Messari Market.id is the reserve's aToken, not its underlying asset.
      if (providerRegistry !== REGISTRY || row.id.toLowerCase() !== address(row.outputToken?.id, "market aToken"))
        throw Error("Inconsistent SparkLend market identity.");
      const symbol = plain(row.inputToken?.symbol, "asset symbol"), assetName = plain(row.inputToken?.name, "asset name");
      const indexedName = plain(row[ROLE]?.name, "accounting token name"), indexedSymbol = plain(row[ROLE]?.symbol, "accounting token symbol");
      const prefix = "SparkLend ", suffix = " " + ROLE_LABEL;
      const label = prefix + (prefix.length + symbol.length + suffix.length <= 50 ? symbol : symbol.slice(0, 47 - prefix.length - suffix.length) + "...") + suffix;
      const priorName = names.get(label.toLowerCase());
      if (priorName && priorName !== contract) throw Error("Ambiguous SparkLend public name tags.");
      names.set(label.toLowerCase(), contract);
      const associated = [...new Set(["Spark", "Sky", "Aave (upstream protocol code)", ...projects(symbol, assetName)])];
      const tag: ContractTag = {
        "Contract Address": "eip155:1:" + contract,
        "Public Name Tag": label,
        "Project Name": "Spark",
        "UI/Website Link": "https://app.spark.fi/",
        "Public Note": associated.join("; ") + ". SparkLend " + ROLE_NOTE + " on Ethereum for " + assetName + " (" + symbol + "), underlying " + asset +
          ". Indexed accounting identity: " + indexedName + " (" + indexedSymbol + "). Includes historical reserve accounting contracts; does not imply new borrowing is enabled or any balance is outstanding. Provider registry " + providerRegistry + ".",
      };
      const prior = tags.get(contract);
      if (prior && JSON.stringify(prior) !== JSON.stringify(tag)) throw Error("Conflicting SparkLend token associations.");
      tags.set(contract, tag);
    }
    if (rows.length < PAGE) break;
  }
  if (!tags.size) throw Error("SparkLend deployment returned no " + ROLE_LABEL + " tokens.");
  const service: ITagService = {returnTags: async () => [...tags.values()]};
  return service.returnTags(chainId, apiKey);
}
