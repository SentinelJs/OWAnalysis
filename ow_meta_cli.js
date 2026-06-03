#!/usr/bin/env node

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const BASE_URL = 'https://overwatch.blizzard.com/ko-kr/rates/data/'
const DEFAULTS = {
  input: 'PC',
  map: 'all-maps',
  region: 'Asia',
  role: 'All',
  rq: '2',
  tiers: ['All'],
  top: 5,
  format: 'json'
}

const TIERS = ['All', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster']
const HIGH_TIERS = ['Diamond', 'Master', 'Grandmaster']
const ALL_RANK_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster']

const MAP_GROUPS = {
  control: [
    ['all-maps', 'All Maps', '전체 맵'],
    ['antarctic-peninsula', 'Antarctic Peninsula', '남극 반도'],
    ['nepal', 'Nepal', '네팔'],
    ['lijiang-tower', 'Lijiang Tower', '리장 타워'],
    ['busan', 'Busan', '부산'],
    ['samoa', 'Samoa', '사모아'],
    ['oasis', 'Oasis', '오아시스'],
    ['ilios', 'Ilios', '일리오스']
  ],
  escort: [
    ['route-66', 'Route 66', '66번 국도'],
    ['watchpoint-gibraltar', 'Watchpoint: Gibraltar', '감시 기지 지브롤터'],
    ['dorado', 'Dorado', '도라도'],
    ['rialto', 'Rialto', '리알토'],
    ['shambali-monastery', 'Shambali Monastery', '샴발리 수도원'],
    ['circuit-royal', 'Circuit Royal', '서킷 로얄'],
    ['junkertown', 'Junkertown', '쓰레기촌'],
    ['havana', 'Havana', '하바나']
  ],
  flashpoint: [
    ['new-junk-city', 'New Junk City', '뉴 정크 시티'],
    ['suravasa', 'Suravasa', '수라바사'],
    ['aatlis', 'Aatlis', '아틀리스']
  ],
  hybrid: [
    ['numbani', 'Numbani', '눔바니'],
    ['midtown', 'Midtown', '미드타운'],
    ['blizzard-world', 'Blizzard World', '블리자드 월드'],
    ['eichenwalde', 'Eichenwalde', '아이헨발데'],
    ['kings-row', "King's Row", '왕의 길'],
    ['paraiso', 'Paraiso', '파라이수'],
    ['hollywood', 'Hollywood', '할리우드']
  ],
  push: [
    ['new-queen-street', 'New Queen Street', '뉴 퀸 스트리트'],
    ['runasapi', 'Runasapi', '루나사피'],
    ['esperanca', 'Esperanca', '이스페란사'],
    ['colosseo', 'Colosseo', '콜로세오']
  ]
}

const MAPS = Object.entries(MAP_GROUPS).flatMap(([mode, maps]) =>
  maps.map(([slug, name, korean]) => ({ mode, slug, name, korean }))
)

const ROLE_ALIASES = new Map([
  ['all', null],
  ['all-roles', null],
  ['전체', null],
  ['전체역할', null],
  ['tank', 'TANK'],
  ['tanks', 'TANK'],
  ['탱', 'TANK'],
  ['탱커', 'TANK'],
  ['돌격', 'TANK'],
  ['damage', 'DAMAGE'],
  ['dps', 'DAMAGE'],
  ['딜', 'DAMAGE'],
  ['딜러', 'DAMAGE'],
  ['공격', 'DAMAGE'],
  ['support', 'SUPPORT'],
  ['supports', 'SUPPORT'],
  ['heal', 'SUPPORT'],
  ['healer', 'SUPPORT'],
  ['힐', 'SUPPORT'],
  ['힐러', 'SUPPORT'],
  ['지원', 'SUPPORT'],
  ['지원가', 'SUPPORT']
])

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[':]/g, '')
    .replace(/&/g, 'and')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-')
}

function compactKorean(value) {
  return String(value || '').replace(/\s+/g, '')
}

function buildMapAliases() {
  const aliases = new Map()
  for (const map of MAPS) {
    for (const candidate of [map.slug, map.name, map.korean, compactKorean(map.korean)]) {
      aliases.set(normalizeKey(candidate), map.slug)
    }
  }
  aliases.set('all', 'all-maps')
  aliases.set('allmaps', 'all-maps')
  aliases.set('all-map', 'all-maps')
  aliases.set('전체맵', 'all-maps')
  aliases.set('전체-맵', 'all-maps')
  aliases.set('왕의길', 'kings-row')
  aliases.set('route66', 'route-66')
  aliases.set('watchpoint-gibraltar', 'watchpoint-gibraltar')
  aliases.set('gibraltar', 'watchpoint-gibraltar')
  aliases.set('지브롤터', 'watchpoint-gibraltar')
  aliases.set('esperança', 'esperanca')
  return aliases
}

const MAP_ALIASES = buildMapAliases()

function printHelp() {
  console.log(`OW Meta CLI

Usage:
  node ow_meta_cli.js maps
  node ow_meta_cli.js rates --map eichenwalde --tier All
  node ow_meta_cli.js meta --map "왕의 길" --role damage --tiers high --top 5

Commands:
  maps    Print supported map names and slugs.
  rates   Fetch and preprocess hero rates, grouped by hero.
  meta    Recommend meta picks by map, role, and tier set.

Options:
  --map <name>       Map slug, English name, or Korean name. Default: all-maps.
  --role <role>      all, tank, damage, support, 탱커, 딜러, 지원가. Default: all.
  --tier <tier>      One tier: All, Bronze, Silver, Gold, Platinum, Diamond, Master, Grandmaster.
  --tiers <list>     Comma list, "all-ranks", or "high" for Diamond,Master,Grandmaster.
  --top <number>     Number of meta picks for meta command. Default: 5.
  --format <format>  json or text. Default: json.
  --region <region>  Region query value. Default: Asia.
`)
}

function parseArgs(argv) {
  const command = argv[2] && !argv[2].startsWith('-') ? argv[2] : 'meta'
  const start = command === argv[2] ? 3 : 2
  const options = {}

  for (let i = start; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`)
    }

    const key = token.slice(2)
    const next = argv[i + 1]
    if (key === 'help') {
      options.help = true
      continue
    }
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`)
    }
    options[key] = next
    i += 1
  }

  return { command, options }
}

function resolveMap(value) {
  const key = normalizeKey(value || DEFAULTS.map)
  const slug = MAP_ALIASES.get(key)
  if (!slug) {
    const supported = MAPS.map((map) => `${map.slug} (${map.korean})`).join(', ')
    throw new Error(`Unknown map "${value}". Supported maps: ${supported}`)
  }
  return slug
}

function resolveRole(value) {
  const key = normalizeKey(value || 'all')
  if (!ROLE_ALIASES.has(key)) {
    throw new Error(`Unknown role "${value}". Use all, tank, damage, support, 탱커, 딜러, or 지원가.`)
  }
  return ROLE_ALIASES.get(key)
}

function resolveTiers(options) {
  const tierInput = options.tiers || options.tier || DEFAULTS.tiers.join(',')
  const key = normalizeKey(tierInput)

  if (key === 'high') return HIGH_TIERS
  if (key === 'all-ranks' || key === 'alltiers' || key === 'all-tiers') return ALL_RANK_TIERS

  const tiers = String(tierInput)
    .split(',')
    .map((tier) => tier.trim())
    .filter(Boolean)
    .map((tier) => {
      const found = TIERS.find((candidate) => candidate.toLowerCase() === tier.toLowerCase())
      if (!found) {
        throw new Error(`Unknown tier "${tier}". Use one of: ${TIERS.join(', ')}, high, all-ranks.`)
      }
      return found
    })

  return tiers.length ? tiers : DEFAULTS.tiers
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value))
  if (!valid.length) return null
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2))
}

function round(value) {
  return Number(value.toFixed(2))
}

async function fetchRates({ input, map, region, role, rq, tier }) {
  const search = new URLSearchParams({ input, map, region, role, rq, tier })
  const response = await fetch(`${BASE_URL}?${search.toString()}`, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Overwatch rates API failed with ${response.status}: ${body.slice(0, 300)}`)
  }

  const data = await response.json()
  const rates = data?.rates?.rates
  if (!Array.isArray(rates)) {
    throw new Error('Unexpected Overwatch rates API response: missing rates.rates array.')
  }
  return rates
}

async function getMapData({ map, tiers, input, region, rq }) {
  const heroesByName = new Map()

  for (const tier of tiers) {
    const rows = await fetchRates({ input, map, region, role: 'All', rq, tier })

    for (const heroData of rows) {
      const hero = heroData.hero || {}
      const cells = heroData.cells || {}
      const name = cells.name || hero.name || heroData.id

      if (!heroesByName.has(name)) {
        heroesByName.set(name, {
          id: heroData.id,
          name,
          role: hero.role || null,
          subrole: hero.subrole || null,
          portrait: hero.portrait || null,
          color: hero.color || null,
          rates: []
        })
      }

      heroesByName.get(name).rates.push({
        tier,
        winrate: cells.winrate,
        pickrate: cells.pickrate,
        banrate: cells.banrate
      })
    }
  }

  return [...heroesByName.values()].map((hero) => {
    const averages = {
      winrate: average(hero.rates.map((rate) => rate.winrate)),
      pickrate: average(hero.rates.map((rate) => rate.pickrate)),
      banrate: average(hero.rates.map((rate) => rate.banrate))
    }
    return { ...hero, averages }
  })
}

function scoreHero(hero) {
  const win = hero.averages.winrate ?? 0
  const pick = hero.averages.pickrate ?? 0
  const ban = hero.averages.banrate ?? 0
  return round(pick * 0.7 + (win - 50) * 2.2 + Math.min(ban, 20) * 0.08)
}

function explainHero(hero) {
  const { winrate, pickrate, banrate } = hero.averages
  const reasons = []
  if (pickrate >= 15) reasons.push('very high pickrate')
  else if (pickrate >= 8) reasons.push('solid pickrate')
  else reasons.push('niche pickrate')

  if (winrate >= 52) reasons.push('strong winrate')
  else if (winrate >= 50) reasons.push('positive winrate')
  else reasons.push('below-50 winrate, treat as popularity-driven')

  if (banrate >= 20) reasons.push('often banned')
  return reasons.join(', ')
}

function recommendMeta(heroes, roleFilter, top) {
  return heroes
    .filter((hero) => !roleFilter || hero.role === roleFilter)
    .map((hero) => ({
      ...hero,
      metaScore: scoreHero(hero),
      reason: explainHero(hero)
    }))
    .sort((a, b) => b.metaScore - a.metaScore)
    .slice(0, top)
}

function makeQuery(command, options) {
  return {
    command,
    input: options.input || DEFAULTS.input,
    map: resolveMap(options.map || DEFAULTS.map),
    region: options.region || DEFAULTS.region,
    rq: options.rq || DEFAULTS.rq,
    tiers: resolveTiers(options),
    roleFilter: resolveRole(options.role || 'all'),
    roleInput: options.role || 'all',
    top: Number.parseInt(options.top || DEFAULTS.top, 10),
    format: options.format || DEFAULTS.format
  }
}

function printMaps(format) {
  if (format === 'text') {
    for (const [mode, maps] of Object.entries(MAP_GROUPS)) {
      console.log(`[${mode}]`)
      for (const [slug, name, korean] of maps) {
        console.log(`- ${slug}: ${name} / ${korean}`)
      }
    }
    return
  }
  console.log(JSON.stringify({ maps: MAPS }, null, 2))
}

function printTextMeta(payload) {
  console.log(`Map: ${payload.query.map}`)
  console.log(`Role: ${payload.query.roleFilter || 'ALL'}`)
  console.log(`Tiers: ${payload.query.tiers.join(', ')}`)
  console.log('')
  for (const [index, hero] of payload.recommendations.entries()) {
    console.log(
      `${index + 1}. ${hero.name} (${hero.role}) - score ${hero.metaScore}, win ${hero.averages.winrate}%, pick ${hero.averages.pickrate}%, ban ${hero.averages.banrate}%`
    )
    console.log(`   ${hero.reason}`)
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv)
  if (options.help || command === 'help') {
    printHelp()
    return
  }

  if (command === 'maps') {
    printMaps(options.format || DEFAULTS.format)
    return
  }

  const query = makeQuery(command, options)
  const heroes = await getMapData(query)

  if (command === 'rates') {
    const payload = {
      source: BASE_URL,
      query,
      heroes
    }
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  if (command !== 'meta') {
    throw new Error(`Unknown command "${command}". Use maps, rates, meta, or help.`)
  }

  const recommendations = recommendMeta(heroes, query.roleFilter, query.top)
  const payload = {
    source: BASE_URL,
    query,
    recommendations
  }

  if (query.format === 'text') {
    printTextMeta(payload)
    return
  }

  console.log(JSON.stringify(payload, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ error: true, message: error.message }, null, 2))
  process.exitCode = 1
})
