# OWAnalysis
오버워치 메타 분석기?

## Requirements

- Node.js 18 이상

## OW Meta CLI

Blizzard hero rates endpoint를 브라우저형 `User-Agent`로 호출하고, 맵/역할군/티어 기준 메타픽을 계산합니다.

```bash
node ow_meta_cli.js maps --format text
node ow_meta_cli.js rates --map all-maps --tier All
node ow_meta_cli.js meta --map eichenwalde --role support --tiers high --top 5 --format text
node ow_meta_cli.js meta --map "왕의 길" --role 딜러 --tier All --top 3
```

주요 옵션:

- `--map`: `all-maps`, `eichenwalde`, `kings-row`, `왕의 길` 등
- `--role`: `all`, `tank`, `damage`, `support`, `탱커`, `딜러`, `지원가`
- `--tier`: `All`, `Bronze`, `Silver`, `Gold`, `Platinum`, `Diamond`, `Master`, `Grandmaster`
- `--tiers`: `high`는 `Diamond,Master,Grandmaster`, `all-ranks`는 전체 랭크 티어

## Codex Skill로 설치

이 저장소에는 배포용 skill 파일이 `skills/ow-meta`에 들어 있습니다. 다른 사람이 이 repo를 받은 뒤 아래처럼 설치할 수 있습니다.

복사 설치:

```bash
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/ow-meta
cp -R skills/ow-meta ~/.codex/skills/ow-meta
```

개발용 symlink 설치:

```bash
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/ow-meta
ln -s "$(pwd)/skills/ow-meta" ~/.codex/skills/ow-meta
```

설치 후 Codex를 재시작하면 `$ow-meta` skill로 사용할 수 있습니다.

예시 요청:

```text
Use $ow-meta to recommend support meta picks on Eichenwalde.
Use $ow-meta to analyze 딜러 메타픽 for 왕의 길.
```
