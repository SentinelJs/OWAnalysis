const http = require('http')
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const USERAGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
const PORT = process.env.PORT || 3000

const mapName = [
    ["antarctic-peninsula", "nepal", "lijiang-tower", "busan", "samoa", "oasis", "ilios"],
    ["route-66", "watchpoint-gibraltar", "dorado", "rialto", "shambali-monastery", "circuit-royal", "junkertown", "havana"],
    ["new-junk-city", "suravasa", "aatlis"],
    ["numbani", "midtown", "blizzard-world", "eichenwalde", "kings-row", "paraiso", "hollywood"],
    ["new-queen-street", "runasapi", "esperanca", "colosseo"]
]
const mapGroups = ['Control', 'Escort', 'Flashpoint', 'Hybrid', 'Push']
const allMapName = 'all-maps'
const tierName = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster']
const tierWeight = {
    Bronze: 11,
    Silver: 12,
    Gold: 13,
    Platinum: 14,
    Diamond: 15,
    Master: 16,
    Grandmaster: 17
}
const stdDevDiffLogFloor = 0.001

const baseURL = 'https://overwatch.blizzard.com/ko-kr/rates/data/?'
const queryString = {
    input: 'PC',
    region: 'Asia',
    role: 'All',
    rq: '1'
}

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
}

const cache = new Map()

function generateURL(params) {
    const searchParams = new URLSearchParams(params)
    return `${baseURL}${searchParams.toString()}`
}

class HeroStatsAnalyzer {
    constructor(heroData, tierWeight, options = {}) {
        this.heroData = heroData
        this.weightMode = options.weightMode ?? 'softmax'
        this.tierWeight = HeroStatsAnalyzer.createTierWeight(tierWeight, this.weightMode)
    }

    static createTierWeight(tierWeight, weightMode) {
        if (weightMode === 'none') {
            return Object.fromEntries(Object.keys(tierWeight).map(tier => [tier, 1]))
        }

        if (weightMode === 'raw') {
            return { ...tierWeight }
        }

        const denominator = Object.values(tierWeight).reduce((sum, weight) => sum + Math.exp(weight), 0)
        return Object.fromEntries(
            Object.entries(tierWeight).map(([tier, weight]) => [tier, Math.exp(weight) / denominator])
        )
    }

    getTierWeight(tier) {
        return this.tierWeight[tier] ?? 0
    }

    weightedMean(heroName, metric) {
        let total = 0

        for (const item of this.heroData[heroName] ?? []) {
            const weight = this.getTierWeight(item.tier)
            total += item[metric] * weight
        }

        return total
    }

    weightedVariance(heroName, metric, mean = this.weightedMean(heroName, metric)) {
        let total = 0

        for (const item of this.heroData[heroName] ?? []) {
            // const weight = this.getTierWeight(item.tier)
            const weight = 1/this.heroData[heroName].length // --- Variance 계산 시 가중치 제거 ---
            total += Math.pow(item[metric] - mean, 2) * weight
        }

        return total
    }

    weightedCovariance(heroName, metricA, metricB, meanA = this.weightedMean(heroName, metricA), meanB = this.weightedMean(heroName, metricB)) {
        let total = 0

        for (const item of this.heroData[heroName] ?? []) {
            const weight = this.getTierWeight(item.tier)
            total += (item[metricA] - meanA) * (item[metricB] - meanB) * weight
        }

        return total
    }

    analyze(heroName) {
        const meanWinrate = this.weightedMean(heroName, 'winrate')
        const meanPickrate = this.weightedMean(heroName, 'pickrate')
        const varianceWinrate = this.weightedVariance(heroName, 'winrate', meanWinrate)
        const variancePickrate = this.weightedVariance(heroName, 'pickrate', meanPickrate)
        const standardDeviationWinrate = Math.sqrt(varianceWinrate)
        const standardDeviationPickrate = Math.sqrt(variancePickrate)
        const covarianceWinratePickrate = this.weightedCovariance(heroName, 'winrate', 'pickrate', meanWinrate, meanPickrate)

        return {
            meanWinrate,
            varianceWinrate,
            standardDeviationWinrate,
            meanPickrate,
            variancePickrate,
            standardDeviationPickrate,
            covarianceWinratePickrate
        }
    }
}

async function getHeroesData(map, tier) {
    const params = { ...queryString, map, tier }
    const response = await axios.get(generateURL(params), {
        headers: {
            'User-Agent': USERAGENT
        }
    })

    return response.data.rates.rates.map(item => ({
        ...item.cells,
        icon: item.hero.portrait
    }))
}

async function collectHeroData(map) {
    const heroData = {}
    const heroIcons = {}

    for (const tier of tierName) {
        const data = await getHeroesData(map, tier)

        for (const item of data) {
            if (!heroData[item.name]) {
                heroData[item.name] = []
            }

            heroData[item.name].push({
                tier,
                winrate: item.winrate,
                pickrate: item.pickrate,
                banrate: item.banrate
            })

            if (!heroIcons[item.name]) {
                heroIcons[item.name] = item.icon
            }
        }
    }

    return { heroData, heroIcons }
}

async function getAnalysis(map, weightMode) {
    const cacheKey = `${map}:${weightMode}`
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey)
    }

    const [allMaps, selectedMap] = await Promise.all([
        collectHeroData(allMapName),
        collectHeroData(map)
    ])

    // console.log(allMaps.heroData['아나'], selectedMap.heroData['아나']) // --- DEBUG LOG ---
    // console.log(allMapName, map) // --- DEBUG LOG ---

    const allMapAnalyzer = new HeroStatsAnalyzer(allMaps.heroData, tierWeight, { weightMode })
    const selectedMapAnalyzer = new HeroStatsAnalyzer(selectedMap.heroData, tierWeight, { weightMode })
    const heroes = Object.keys(selectedMap.heroData).filter(heroName => allMaps.heroData[heroName])

    const results = heroes.map(heroName => {
        const allMap = allMapAnalyzer.analyze(heroName)
        const specMap = selectedMapAnalyzer.analyze(heroName)
        const winrateStdDevDiffAbs = Math.abs(specMap.standardDeviationWinrate - allMap.standardDeviationWinrate)
        const pickrateStdDevDiffAbs = Math.abs(specMap.standardDeviationPickrate - allMap.standardDeviationPickrate)

        return {
            hero: heroName,
            allMap,
            specMap,
            winrateMeanDiff: specMap.meanWinrate - allMap.meanWinrate,
            winrateVarianceDiff: specMap.varianceWinrate - allMap.varianceWinrate,
            winrateStdDevDiff: Math.log2(Math.max(winrateStdDevDiffAbs, stdDevDiffLogFloor)),
            pickrateMeanDiff: specMap.meanPickrate - allMap.meanPickrate,
            pickrateVarianceDiff: specMap.variancePickrate - allMap.variancePickrate,
            pickrateStdDevDiff: Math.log2(Math.max(pickrateStdDevDiffAbs, stdDevDiffLogFloor)),
            covarianceDiff: specMap.covarianceWinratePickrate - allMap.covarianceWinratePickrate,
            icon: selectedMap.heroIcons[heroName] ?? allMaps.heroIcons[heroName]
        }
    })

    const payload = {
        map,
        weightMode,
        generatedAt: new Date().toISOString(),
        heroes: results
    }

    cache.set(cacheKey, payload)
    return payload
}

function getMapsPayload() {
    return mapName.map((maps, index) => ({
        group: mapGroups[index],
        maps
    }))
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'Content-Type': mimeTypes['.json'] })
    response.end(JSON.stringify(payload))
}

function serveStatic(request, response, pathname) {
    const publicDir = path.join(__dirname, 'public')
    const safePath = pathname === '/' ? '/index.html' : pathname
    const filePath = path.normalize(path.join(publicDir, safePath))

    if (!filePath.startsWith(publicDir)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(404)
            response.end('Not Found')
            return
        }

        const extension = path.extname(filePath)
        response.writeHead(200, { 'Content-Type': mimeTypes[extension] ?? 'application/octet-stream' })
        response.end(content)
    })
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`)

    try {
        if (url.pathname === '/api/maps') {
            sendJson(response, 200, getMapsPayload())
            return
        }

        if (url.pathname === '/api/analysis') {
            const map = url.searchParams.get('map') ?? 'numbani'
            const weightMode = url.searchParams.get('weightMode') ?? 'softmax'
            const validMaps = mapName.flat()

            if (!validMaps.includes(map)) {
                sendJson(response, 400, { error: 'Unknown map' })
                return
            }

            if (!['softmax', 'raw', 'none'].includes(weightMode)) {
                sendJson(response, 400, { error: 'Unknown weight mode' })
                return
            }

            sendJson(response, 200, await getAnalysis(map, weightMode))
            return
        }

        serveStatic(request, response, url.pathname)
    } catch (error) {
        console.error(error)
        sendJson(response, 500, { error: 'Analysis failed' })
    }
})

server.listen(PORT, () => {
    console.log(`OWAnalysis server running at http://localhost:${PORT}`)
})
