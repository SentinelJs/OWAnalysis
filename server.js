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
const minTierWeight = -100
const maxTierWeight = 100
const defaultSoftmaxTemperature = 1
const minSoftmaxTemperature = 0.01
const maxSoftmaxTemperature = 20
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

function serializeTierWeight(weights) {
    return tierName.map(tier => `${tier}:${weights[tier]}`).join('|')
}

function parseTierWeightParam(value) {
    if (!value) {
        return { ...tierWeight }
    }

    let parsed

    try {
        parsed = JSON.parse(value)
    } catch {
        throw new Error('Invalid tier weights')
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid tier weights')
    }

    return Object.fromEntries(tierName.map(tier => {
        const weight = Number(parsed[tier] ?? tierWeight[tier])

        if (!Number.isFinite(weight) || weight < minTierWeight || weight > maxTierWeight) {
            throw new Error('Invalid tier weights')
        }

        return [tier, weight]
    }))
}

function parseTemperatureParam(value) {
    if (!value) {
        return defaultSoftmaxTemperature
    }

    const temperature = Number(value)

    if (!Number.isFinite(temperature) || temperature < minSoftmaxTemperature || temperature > maxSoftmaxTemperature) {
        throw new Error('Invalid temperature')
    }

    return temperature
}

class HeroStatsAnalyzer {
    constructor(heroData, tierWeight, options = {}) {
        this.heroData = heroData
        this.weightMode = options.weightMode ?? 'softmax'
        this.temperature = options.temperature ?? defaultSoftmaxTemperature
        this.tierWeight = HeroStatsAnalyzer.createTierWeight(tierWeight, this.weightMode, this.temperature)
        this.pickrateBasedTierWeightCache = {}

        for (const heroName in heroData) {
            this.pickrateBasedTierWeightCache[heroName] = this.createPickrateBasedTierWeight(heroName, tierWeight, this.temperature)
        }
    }

    static createTierWeight(tierWeight, weightMode, temperature = defaultSoftmaxTemperature) {
        if (weightMode === 'none') {
            return Object.fromEntries(Object.keys(tierWeight).map(tier => [tier, 1]))
        }

        if (weightMode === 'raw') {
            return { ...tierWeight }
        }

        const denominator = Object.values(tierWeight).reduce((sum, weight) => sum + Math.exp(weight / temperature), 0)
        return Object.fromEntries(
            Object.entries(tierWeight).map(([tier, weight]) => [tier, Math.exp(weight / temperature) / denominator])
        )
    }

    createPickrateBasedTierWeight(heroName, tierWeight, temperature = defaultSoftmaxTemperature) {
        let pickrateWeight = {}
        let pickbasedTierWeight = {}

        const denominator = this.heroData[heroName].reduce((sum, weight) => sum + Math.exp(weight.pickrate / temperature), 0)
        for (const item of this.heroData[heroName]) {
            pickrateWeight[item.tier] = Math.exp(item.pickrate / temperature) / denominator
        }

        const pickbasedWeights = this.heroData[heroName]?.map(item => {
            return { 
                tier: item.tier,
                weight: pickrateWeight[item.tier] * tierWeight[item.tier] // --- 픽률 기반 가중치 계산 ---
            }
        })

        // softmax 계산
        const denominator_ = pickbasedWeights.reduce((sum, weight) => sum + Math.exp(weight.weight / temperature), 0)
        for (const item of pickbasedWeights) {
            pickbasedTierWeight[item.tier] = Math.exp(item.weight / temperature) / denominator_
        }

        return pickbasedTierWeight
    }

    getTierWeight(tier) {
        return this.tierWeight[tier] ?? 0
    }

    getPickrateBasedTierWeight(heroName, tier) {
        return this.pickrateBasedTierWeightCache[heroName]?.[tier] ?? 0
    }

    weightedMean(heroName, metric) {
        let total = 0

        for (const item of this.heroData[heroName] ?? []) {
            const weight = this.getPickrateBasedTierWeight(heroName, item.tier)
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
            const weight = this.getPickrateBasedTierWeight(heroName, item.tier)
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

async function collectHeroDataCached(map) {
    const cacheKey = `hero-data:${map}`

    if (cache.has(cacheKey)) {
        return cache.get(cacheKey)
    }

    const data = await collectHeroData(map)
    cache.set(cacheKey, data)
    return data
}

async function getAnalysisSourceData(map) {
    const cacheKey = `analysis-source:${map}`

    if (cache.has(cacheKey)) {
        return cache.get(cacheKey)
    }

    const [allMaps, selectedMap] = await Promise.all([
        collectHeroDataCached(allMapName),
        collectHeroDataCached(map)
    ])
    const payload = {
        map,
        allMapName,
        tiers: tierName,
        defaultTierWeights: tierWeight,
        weightBounds: {
            min: minTierWeight,
            max: maxTierWeight
        },
        defaultSoftmaxTemperature,
        temperatureBounds: {
            min: minSoftmaxTemperature,
            max: maxSoftmaxTemperature
        },
        stdDevDiffLogFloor,
        allMaps,
        selectedMap,
        generatedAt: new Date().toISOString()
    }

    cache.set(cacheKey, payload)
    return payload
}

function analyzeHeroData(allMap, specMap) {
    // 분산 차 계산
    // log2(|분산A - 분산B|)

    const winrateVarianceDiffAbs = Math.abs(specMap.varianceWinrate - allMap.varianceWinrate)
    const maxWinrateVarianceDiffAbs = Math.max(winrateVarianceDiffAbs, stdDevDiffLogFloor)
    const winrateStdDevDiff = Math.log2(maxWinrateVarianceDiffAbs)

    return {
        winrateStdDevDiff
    }
}


async function getAnalysis(map, weightMode, selectedTierWeight, temperature) {
    const cacheKey = `${map}:${weightMode}:${temperature}:${serializeTierWeight(selectedTierWeight)}`
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey)
    }

    const { allMaps, selectedMap } = await getAnalysisSourceData(map)

    // console.log(allMaps.heroData['아나'], selectedMap.heroData['아나']) // --- DEBUG LOG ---
    // console.log(allMapName, map) // --- DEBUG LOG ---

    const allMapAnalyzer = new HeroStatsAnalyzer(allMaps.heroData, selectedTierWeight, { weightMode, temperature })
    const selectedMapAnalyzer = new HeroStatsAnalyzer(selectedMap.heroData, selectedTierWeight, { weightMode, temperature })
    const heroes = Object.keys(selectedMap.heroData).filter(heroName => allMaps.heroData[heroName])

    const results = heroes.map(heroName => {
        const allMap = allMapAnalyzer.analyze(heroName)
        const specMap = selectedMapAnalyzer.analyze(heroName)
        const winrateStdDevDiffAbs = Math.abs(specMap.standardDeviationWinrate - allMap.standardDeviationWinrate)
        const pickrateStdDevDiffAbs = Math.abs(specMap.standardDeviationPickrate - allMap.standardDeviationPickrate)

        let rt_result = {
            hero: heroName,
            allMap,
            specMap,
            winrateMeanDiff: specMap.meanWinrate - allMap.meanWinrate,
            winrateVarianceDiff: specMap.varianceWinrate - allMap.varianceWinrate,
            pickrateMeanDiff: specMap.meanPickrate - allMap.meanPickrate,
            pickrateVarianceDiff: specMap.variancePickrate - allMap.variancePickrate,
            covarianceDiff: specMap.covarianceWinratePickrate - allMap.covarianceWinratePickrate,
            icon: selectedMap.heroIcons[heroName] ?? allMaps.heroIcons[heroName]
        }

        let analysisResult = analyzeHeroData(allMap, specMap)

        return {
            ...rt_result,
            ...analysisResult
        }
    })

    const payload = {
        map,
        weightMode,
        temperature,
        tierWeights: selectedTierWeight,
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

        if (url.pathname === '/api/analysis-source') {
            const map = url.searchParams.get('map') ?? 'numbani'
            const validMaps = mapName.flat()

            if (!validMaps.includes(map)) {
                sendJson(response, 400, { error: 'Unknown map' })
                return
            }

            sendJson(response, 200, await getAnalysisSourceData(map))
            return
        }

        if (url.pathname === '/api/analysis') {
            const map = url.searchParams.get('map') ?? 'numbani'
            const weightMode = url.searchParams.get('weightMode') ?? 'softmax'
            const validMaps = mapName.flat()
            let selectedTierWeight
            let temperature

            try {
                selectedTierWeight = parseTierWeightParam(url.searchParams.get('tierWeights'))
                temperature = parseTemperatureParam(url.searchParams.get('temperature'))
            } catch {
                sendJson(response, 400, { error: 'Invalid tier weights or temperature' })
                return
            }

            if (!validMaps.includes(map)) {
                sendJson(response, 400, { error: 'Unknown map' })
                return
            }

            if (!['softmax', 'raw', 'none'].includes(weightMode)) {
                sendJson(response, 400, { error: 'Unknown weight mode' })
                return
            }

            sendJson(response, 200, await getAnalysis(map, weightMode, selectedTierWeight, temperature))
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
