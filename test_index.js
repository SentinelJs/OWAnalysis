const axios = require('axios')
const USERAGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
const mapName = [
    ["antarctic-peninsula", "nepal", "lijiang-tower", "busan", "samoa", "oasis", "ilios"], 
    ["route-66", "watchpoint-gibraltar", "dorado", "rialto", "shambali-monastery", "circuit-royal", "junkertown", "havana"], 
    ["new-junk-city", "suravasa", "aatlis"],
    ["numbani", "midtown", "blizzard-world", "eichenwalde", "kings-row", "paraiso", "hollywood"], 
    ["new-queen-street", "runasapi", "esperanca", "colosseo"]
]
const roleName = ['tank', 'damage', 'support']
const allMapName = "all-maps"
const tierName = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster']
const tierWeight = {
    'Bronze': 1,
    'Silver': 2,
    'Gold': 3,
    'Platinum': 4,
    'Diamond': 5,
    'Master': 6,
    'Grandmaster': 7
}

let queryString = {
    'input': 'PC',
    'map': 'example_map',
    'region': 'Asia',
    'role': 'All',
    'rq': '2',
    'tier': 'example_tier'
}

const baseURL = 'https://overwatch.blizzard.com/ko-kr/rates/data/?'

function generateURL(queryString) {
    let url = baseURL
    for (let key in queryString) {
        url += `${key}=${queryString[key]}&`
    }
    return url.slice(0, -1)
}

class HeroStatsAnalyzer {
    constructor(heroData, tierWeight, options = { weightMode: 'softmax' }) {
        this.heroData = heroData
        this.weightMode = options.weightMode ?? (options.useSoftmax === false ? 'none' : 'softmax')
        this.tierWeight = HeroStatsAnalyzer.createTierWeight(tierWeight, this.weightMode)
    }

    static createTierWeight(tierWeight, weightMode) {
        if (weightMode === 'none') {
            return Object.keys(tierWeight).reduce((weightMap, tier) => {
                weightMap[tier] = 1
                return weightMap
            }, {})
        }

        if (weightMode === 'raw') {
            return { ...tierWeight }
        }

        const denominator = Object.values(tierWeight).reduce((sum, weight) => sum + Math.exp(weight), 0)

        return Object.entries(tierWeight).reduce((weightMap, [tier, weight]) => {
            weightMap[tier] = Math.exp(weight) / denominator
            return weightMap
        }, {})
    }

    getTierWeight(tier) {
        return this.tierWeight[tier] ?? 0
    }

    weightedMean(heroname, metric) {
        let total = 0

        for (let item of this.heroData[heroname]) {
            const weight = this.getTierWeight(item.tier)
            total += item[metric] * weight
        }

        return total 
    }

    weightedVariance(heroname, metric, mean = this.weightedMean(heroname, metric)) {
        let total = 0

        for (let item of this.heroData[heroname]) {
            const weight = this.getTierWeight(item.tier)
            total += Math.pow(item[metric] - mean, 2) * weight
        }

        return total
    }

    weightedCovariance(heroname, metricA, metricB, meanA = this.weightedMean(heroname, metricA), meanB = this.weightedMean(heroname, metricB)) {
        let total = 0

        for (let item of this.heroData[heroname]) {
            total += (item[metricA] - meanA) * (item[metricB] - meanB) * this.getTierWeight(item.tier)
        }

        return total
    }

    analyze(heroname) {
        if (!heroname) {
            throw new Error('Hero data is empty or not provided')
        }

        const meanWinrate = this.weightedMean(heroname, 'winrate')
        const meanPickrate = this.weightedMean(heroname, 'pickrate')
        const varianceWinrate = this.weightedVariance(heroname, 'winrate', meanWinrate)
        const variancePickrate = this.weightedVariance(heroname, 'pickrate', meanPickrate)
        const covarianceWinratePickrate = this.weightedCovariance(heroname, 'winrate', 'pickrate', meanWinrate, meanPickrate)

        return {
            meanWinrate,
            varianceWinrate,
            meanPickrate,
            variancePickrate,
            covarianceWinratePickrate
        }
    }
}

async function getHeroesData(map, tier) {
    let localQueryString = { ...queryString }

    localQueryString['map'] = map
    localQueryString['tier'] = tier

    try {
        const response = await axios.get(generateURL(localQueryString), {
            headers: {
                'User-Agent': USERAGENT 
            }
        })
        const data = response.data['rates']['rates']
        // { name: '시에라', winrate: 55.2, pickrate: 1.3, banrate: 0.8 }
        
        return data.map(item => {
            let result = item.cells

            result['icon'] = item['hero']['portrait']
            return result
        })
    } catch (error) {
        console.error(error)
    }
}

const targetMap = 'suravasa'

;(async () => {
    const allMapsHeroData = {}
    const heroIcons = {}

    for (let tier of tierName) {
        const data = await getHeroesData(allMapName, tier)
        
        for (let item of data) {
            if (!allMapsHeroData[item.name]) {
                allMapsHeroData[item.name] = [
                    { tier: tier, winrate: item.winrate, pickrate: item.pickrate, banrate: item.banrate }
                ]
            } else {        
                allMapsHeroData[item.name].push({ tier: tier, winrate: item.winrate, pickrate: item.pickrate, banrate: item.banrate })
            }

            if (!heroIcons[item.name]) {
                heroIcons[item.name] = item.icon
            }
        }
    }
    console.log(allMapsHeroData)
    const allMapHeroesAnalyzer = new HeroStatsAnalyzer(allMapsHeroData, tierWeight)

    const heroData = {}

    for (let tier of tierName) {
        const data = await getHeroesData(targetMap, tier)

        for (let item of data) {
            if (!heroData[item.name]) {
                heroData[item.name] = [
                    { tier: tier, winrate: item.winrate, pickrate: item.pickrate, banrate: item.banrate }
                ]
            } else {
                heroData[item.name].push({ tier: tier, winrate: item.winrate, pickrate: item.pickrate, banrate: item.banrate })
            }
        }
    }
    console.log(heroData)
    const mapHeroesAnalyzer = new HeroStatsAnalyzer(heroData, tierWeight)

    const analysisResults = {}

    for (let heroName in heroData) {
        const all_map_stats = allMapHeroesAnalyzer.analyze(heroName)
        const spec_map_stats = mapHeroesAnalyzer.analyze(heroName)
        
        analysisResults[heroName] = {
            allMap: all_map_stats,
            specMap: spec_map_stats,
            winratemeanDiff: spec_map_stats.meanWinrate - all_map_stats.meanWinrate,
            winratevarianceDiff: spec_map_stats.varianceWinrate - all_map_stats.varianceWinrate,
            pickratemeanDiff: spec_map_stats.meanPickrate - all_map_stats.meanPickrate,
            pickratevarianceDiff: spec_map_stats.variancePickrate - all_map_stats.variancePickrate,
            covarianceDiff: spec_map_stats.covarianceWinratePickrate - all_map_stats.covarianceWinratePickrate,
            icon: heroIcons[heroName]
        }
    }

    console.log(analysisResults)

    /**
{
   '한조': [
    { tier: 'Bronze', winrate: 51.6, pickrate: 5.3, banrate: 0.4 },
    { tier: 'Silver', winrate: 48.3, pickrate: 6, banrate: 0.4 },
    { tier: 'Gold', winrate: 45, pickrate: 6.2, banrate: 0.4 },
    { tier: 'Platinum', winrate: 49, pickrate: 6.9, banrate: 0.4 },
    { tier: 'Diamond', winrate: 47.6, pickrate: 7.3, banrate: 0.8 },
    { tier: 'Master', winrate: 49, pickrate: 8.9, banrate: 0.4 },
    { tier: 'Grandmaster', winrate: 38.5, pickrate: 7.7, banrate: 0.2 }
  ],
  '해저드': [
    { tier: 'Bronze', winrate: 47.5, pickrate: 3.7, banrate: 2.1 },
    { tier: 'Silver', winrate: 53.2, pickrate: 5, banrate: 3 },
    { tier: 'Gold', winrate: 53.2, pickrate: 6.4, banrate: 4.2 },
    { tier: 'Platinum', winrate: 54, pickrate: 8.6, banrate: 5.2 },
    { tier: 'Diamond', winrate: 51.3, pickrate: 10.7, banrate: 8.4 },
    { tier: 'Master', winrate: 52.2, pickrate: 13.9, banrate: 13.2 },
    {
      tier: 'Grandmaster',
      winrate: 50.1,
      pickrate: 11.4,
      banrate: 14.8
    }
  ]
}
     */
})()
