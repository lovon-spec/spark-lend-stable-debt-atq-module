# SparkLend Stable Debt ATQ module

Returns SparkLend historical non-transferable stable-debt accounting token representing the reserve's legacy stable-rate debt bookkeeping; not a stablecoin contracts on Ethereum, including historical reserve contracts. It does not return their underlying assets, aTokens or the other debt-token category. The existence of a tagged accounting contract does not imply outstanding balances, enabled borrowing or any particular collateral parameter.

## Source

The Ethereum deployment is selected from [Messari's SparkLend decentralized-network deployment catalog](https://github.com/messari/subgraphs/blob/2711ac91ef119f321f65b339e10a57f9aa74f9d8/deployment/deployment.json) and its [Graph Explorer subgraph](https://thegraph.com/explorer/subgraphs/GbKdmBe4ycCYCQLQSjqGg6UHYoYfbyJyq5WrG35pv1si?view=About&chain=arbitrum-one). The module queries deployment `QmTVumjhubXWP8MeDx5g114MRX99E4Gie5mFqVurttF99X` directly, using the caller's Graph API key as a Bearer header.

All markets are read in ascending `id` order using `id_gt` pagination at one indexed block hash. `Market.id` is the aToken market address, `inputToken` identifies the underlying asset, and `outputToken` identifies the market aToken and `_sToken` identifies the selected debt-accounting contract. The protocol ID is SparkLend's PoolAddressesProviderRegistry, not its PoolAddressesProvider. Addresses and associations come from the query, not a static output list. Query, snapshot, metadata or naming conflicts fail the whole call; no partial output is returned and no market is silently skipped. No activity, supply or borrowing-state filter is applied.

[Spark's Pool documentation](https://docs.spark.finance/dev/sparklend/core-contracts/pool) explains its reserve accounting contracts. [The provider documentation](https://docs.spark.finance/dev/sparklend/core-contracts/pooladdressesprovider) describes Sky governance and the provider's role. [The official address registry](https://github.com/sparkdotfi/spark-address-registry/blob/98091964e0ef9f74bb2b6da3646f8e6d16448588/src/SparkLend.sol) documents deployed SparkLend infrastructure and token addresses. Public notes distinguish Spark/Sky from Aave as the upstream protocol code and identify the underlying asset's issuer or protocol.

## Run

Install and build using Yarn:

```sh
yarn install --frozen-lockfile
yarn build
yarn test
```

Import the compiled `dist/main.mjs` and call `await returnTags("1", graphApiKey)`. Only chain `"1"` is supported. The sole exported asynchronous function has exactly two arguments; all retrieval and formatting logic is in `src/main.mts`.

The tags have the five Address Tags fields: Contract Address (`eip155:1:<address>`), Public Name Tag, Project Name (`Spark`), UI/Website Link and Public Note. Descriptive project associations are metadata, not hardcoded output addresses. Names are plain text, at most 50 characters and checked for collisions. No balance, interest-rate, peg or redemption guarantee is made.
