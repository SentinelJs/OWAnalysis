---
name: ow-meta
description: Analyze current Overwatch hero rates and recommend meta picks from Blizzard's public rates endpoint. Use when the user asks for Overwatch map, role, tier, hero-rate, winrate, pickrate, banrate, or meta-pick analysis, especially when GPT Actions cannot call overwatch.blizzard.com directly and Codex should run a local CLI with browser-like headers.
---

# OW Meta

Use the bundled CLI to fetch Overwatch hero rates from Blizzard's rates endpoint and preprocess them into hero-level data. The CLI sends a browser-like `User-Agent`, so prefer it over direct GPT Actions when Blizzard blocks action calls.

## Quick Start

Run the bundled script from this skill directory:

```bash
node scripts/ow_meta_cli.js meta --map eichenwalde --role support --tiers high --top 5
```

For the user's current repo version, the same CLI may exist as:

```bash
node ow_meta_cli.js meta --map eichenwalde --role support --tiers high --top 5
```

## Commands

- `maps`: list supported map slugs, English names, Korean names, and modes.
- `rates`: fetch raw API rows and preprocess them into hero objects grouped by hero name.
- `meta`: fetch rates, filter by role, compute averages, score heroes, and return top recommendations.

Prefer JSON output for downstream reasoning:

```bash
node scripts/ow_meta_cli.js meta --map "왕의 길" --role 딜러 --tiers high --format json
```

Use text output only for quick human-readable summaries:

```bash
node scripts/ow_meta_cli.js meta --map all-maps --role tank --tier All --format text
```

## Data Flow

The CLI mirrors the original `getMapData` preprocessing:

1. Call `https://overwatch.blizzard.com/ko-kr/rates/data/` with query params:
   `input=PC`, `map=<slug>`, `region=Asia`, `role=All`, `rq=2`, `tier=<tier>`.
2. Include headers:
   `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36`
   and `Accept: application/json`.
3. Read `rates.rates` from the JSON response.
4. For each `hero_data`, extract:
   `id`, `cells.name`, `cells.winrate`, `cells.pickrate`, `cells.banrate`,
   `hero.role`, `hero.subrole`, `hero.portrait`, and `hero.color`.
5. Group records by hero name and append one `rates[]` entry per requested tier.
6. Compute average winrate, pickrate, and banrate across selected tiers.
7. Filter roles from `hero.role`, not from the API `role` query. The API role query should stay `All`.

## Analysis Defaults

- If the user asks for high-rank meta, use `--tiers high`, which means `Diamond,Master,Grandmaster`.
- If the user asks for overall/current all-rank rates, use `--tier All`.
- If the user asks for a single rank, use `--tier <Rank>`.
- If the user does not specify a map, use `all-maps`.
- If the user does not specify region/platform, use `Asia` and `PC`.

Role aliases:

- Tank: `tank`, `탱`, `탱커`, `돌격`
- Damage: `damage`, `dps`, `딜`, `딜러`, `공격`
- Support: `support`, `힐`, `힐러`, `지원`, `지원가`

## Meta Scoring

`meta` ranks heroes by a lightweight score based on average pickrate, winrate above or below 50%, and a small banrate signal. Treat the score as a sorting heuristic, then explain recommendations using the actual averages.

In final answers, include:

- map and tier set used
- role filter used
- top 3-5 heroes
- winrate, pickrate, banrate
- a short reason such as high pickrate, positive winrate, or often banned

If the API fails, report the HTTP status/message and suggest retrying or using cached/local data only if available.

## Map Reference

For detailed map slugs and aliases, read `references/maps.md` only when needed.
