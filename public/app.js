const mapSelect = document.querySelector('#mapSelect')
const weightSelect = document.querySelector('#weightSelect')
const tierWeightForm = document.querySelector('#tierWeightForm')
const tierWeightInputs = [...document.querySelectorAll('[data-tier-weight]')]
const tierWeightValueInputs = [...document.querySelectorAll('[data-tier-value]')]
const resetTierWeightsButton = document.querySelector('#resetTierWeights')
const globalWeightMinInput = document.querySelector('#globalWeightMin')
const globalWeightMaxInput = document.querySelector('#globalWeightMax')
const tierWeightModeSelect = document.querySelector('#tierWeightMode')
const temperatureSlider = document.querySelector('#temperatureSlider')
const temperatureInput = document.querySelector('#temperatureInput')
const chart = document.querySelector('#chart')
const status = document.querySelector('#status')
const summary = document.querySelector('#summary')
const heroTable = document.querySelector('#heroTable')
const tooltip = document.querySelector('#tooltip')
const zoomInButton = document.querySelector('#zoomIn')
const zoomOutButton = document.querySelector('#zoomOut')
const zoomResetButton = document.querySelector('#zoomReset')

const zoomStep = 1.35
const minZoom = 1
const maxZoom = 10
const jensenShannonLogEpsilon = 1e-6
const defaultTierWeights = Object.fromEntries(
    tierWeightInputs.map(input => [input.dataset.tierWeight, Number(input.defaultValue)])
)
const defaultWeightBounds = {
    min: Math.min(...Object.values(defaultTierWeights)),
    max: Math.max(...Object.values(defaultTierWeights))
}
const tierOrder = tierWeightInputs.map(input => input.dataset.tierWeight)
const tierWeightSliderByTier = Object.fromEntries(
    tierWeightInputs.map(input => [input.dataset.tierWeight, input])
)
const tierWeightValueByTier = Object.fromEntries(
    tierWeightValueInputs.map(input => [input.dataset.tierValue, input])
)
const defaultSoftmaxTemperature = Number(temperatureInput.defaultValue)
const zoomState = {
    scale: 1,
    offsetX: 0,
    offsetY: 0
}
let plotLayer = null
let panStart = null
let analysisSource = null
let renderFrame = null

function formatNumber(value, digits = 3) {
    return Number.isFinite(value) ? value.toFixed(digits) : '0.000'
}

function classForValue(value) {
    if (value > 0) {
        return 'positive'
    }

    if (value < 0) {
        return 'negative'
    }

    return ''
}

function formatWeightControlValue(value) {
    if (!Number.isFinite(value)) {
        return '0'
    }

    return String(Number(value.toPrecision(8)))
}

function readGlobalWeightBounds() {
    const min = Number(globalWeightMinInput.value)
    const max = Number(globalWeightMaxInput.value)

    if (!globalWeightMinInput.checkValidity() || !globalWeightMaxInput.checkValidity() || !Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
        return null
    }

    return { min, max }
}

function readSoftmaxTemperature() {
    const temperature = Number(temperatureInput.value)

    if (!temperatureInput.checkValidity() || !Number.isFinite(temperature) || temperature <= 0) {
        return null
    }

    return temperature
}

function syncTemperatureControls(source = analysisSource) {
    const bounds = source?.temperatureBounds

    if (bounds) {
        temperatureSlider.min = bounds.min
        temperatureSlider.max = bounds.max
        temperatureInput.min = bounds.min
        temperatureInput.max = bounds.max
    }

    if (!temperatureInput.checkValidity()) {
        return false
    }

    temperatureSlider.value = temperatureInput.value
    return true
}

function applyGlobalWeightBounds() {
    const bounds = readGlobalWeightBounds()

    if (!bounds) {
        status.textContent = 'Invalid range'
        return false
    }

    for (const tier of tierOrder) {
        const slider = tierWeightSliderByTier[tier]
        const valueInput = tierWeightValueByTier[tier]
        const clampedValue = clamp(Number(valueInput.value || slider.value), bounds.min, bounds.max)

        slider.min = bounds.min
        slider.max = bounds.max
        valueInput.min = bounds.min
        valueInput.max = bounds.max
        slider.value = formatWeightControlValue(clampedValue)
        valueInput.value = formatWeightControlValue(clampedValue)
    }

    if (tierWeightModeSelect.value !== 'custom') {
        return applyTierWeightMode()
    }

    return true
}

function writeTierWeights(weights) {
    for (const tier of tierOrder) {
        const value = weights[tier]

        tierWeightSliderByTier[tier].value = formatWeightControlValue(value)
        tierWeightValueByTier[tier].value = formatWeightControlValue(value)
    }
}

function generateTierWeights(mode, bounds) {
    const tierCount = tierOrder.length
    const lastIndex = tierCount - 1
    const midpoint = (bounds.min + bounds.max) / 2

    if (mode === 'uniform') {
        return Object.fromEntries(tierOrder.map(tier => [tier, midpoint]))
    }

    if (mode === 'linear') {
        const platinumIndex = tierOrder.indexOf('Platinum')

        if (bounds.max - bounds.min < lastIndex) {
            return null
        }

        return Object.fromEntries(tierOrder.map((tier, index) => [tier, midpoint + index - platinumIndex]))
    }

    if (mode === 'reverse-linear') {
        const platinumIndex = tierOrder.indexOf('Platinum')

        if (bounds.max - bounds.min < lastIndex) {
            return null
        }

        return Object.fromEntries(tierOrder.map((tier, index) => [tier, midpoint - index + platinumIndex]))
    }

    if (mode === 'exp' || mode === 'reverse-exp') {
        if (bounds.min <= 0 || bounds.max <= 0) {
            return null
        }

        const minCoefficient = Math.log(bounds.min)
        const step = (Math.log(bounds.max) - minCoefficient) / lastIndex
        const values = tierOrder.map((tier, index) => Math.exp(minCoefficient + step * index))

        if (mode === 'reverse-exp') {
            values.reverse()
        }

        return Object.fromEntries(tierOrder.map((tier, index) => [tier, values[index]]))
    }

    if (mode === 'log' || mode === 'reverse-log') {
        const minCoefficient = Math.exp(bounds.min)
        const maxCoefficient = Math.exp(bounds.max)
        const coefficientStep = (maxCoefficient - minCoefficient) / lastIndex
        const values = tierOrder.map((tier, index) => {
            const coefficient = minCoefficient + coefficientStep * index

            return Math.log(coefficient)
        })

        if (mode === 'reverse-log') {
            values.reverse()
        }

        return Object.fromEntries(tierOrder.map((tier, index) => [tier, values[index]]))
    }

    return null
}

function applyTierWeightMode() {
    const mode = tierWeightModeSelect.value

    if (mode === 'custom') {
        return true
    }

    const bounds = readGlobalWeightBounds()

    if (!bounds) {
        status.textContent = 'Invalid range'
        return false
    }

    const weights = generateTierWeights(mode, bounds)

    if (!weights) {
        if (mode === 'exp' || mode === 'reverse-exp') {
            status.textContent = 'Exp mode needs positive min/max'
        } else if (mode === 'linear' || mode === 'reverse-linear') {
            status.textContent = 'Linear mode needs max-min >= 6'
        } else {
            status.textContent = 'Invalid weight mode'
        }

        return false
    }

    writeTierWeights(weights)
    return true
}

function readTierWeights() {
    const weights = {}

    for (const input of tierWeightValueInputs) {
        const value = input.value.trim()

        if (!value || !input.checkValidity()) {
            return null
        }

        weights[input.dataset.tierValue] = Number(value)
    }

    return weights
}

function resetTierWeights() {
    for (const tier of tierOrder) {
        const value = defaultTierWeights[tier]
        tierWeightSliderByTier[tier].value = value
        tierWeightValueByTier[tier].value = value
    }
}

function formatTierWeightSummary(weights) {
    const values = Object.values(weights ?? {}).filter(Number.isFinite)

    if (!values.length) {
        return ''
    }

    return `weights ${formatNumber(Math.min(...values), 1)}-${formatNumber(Math.max(...values), 1)}`
}

function normalizeDataDomain(values, edgePaddingPercent = 5) {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min

    if (span === 0) {
        const fallbackSpan = Math.max(Math.abs(min), 1)

        return {
            min: min - fallbackSpan / 2,
            max: max + fallbackSpan / 2
        }
    }

    const padding = span * edgePaddingPercent / (100 - edgePaddingPercent * 2)

    return {
        min: min - padding,
        max: max + padding
    }
}

function scale(value, domain, invert = false, clampToChart = true) {
    const ratio = (value - domain.min) / (domain.max - domain.min || 1)
    const rawPercent = ratio * 100
    const percent = clampToChart ? Math.max(2, Math.min(98, rawPercent)) : rawPercent
    return invert ? 100 - percent : percent
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
}

function applyChartTransform() {
    if (!plotLayer) {
        return
    }

    const inverseScale = 1 / zoomState.scale
    plotLayer.style.transform = `translate(${zoomState.offsetX}px, ${zoomState.offsetY}px) scale(${zoomState.scale})`
    plotLayer.style.setProperty('--marker-scale', inverseScale)
    plotLayer.style.setProperty('--marker-hover-scale', inverseScale * 1.25)
    plotLayer.style.setProperty('--label-scale', inverseScale)
    zoomOutButton.disabled = zoomState.scale <= minZoom
    zoomResetButton.disabled = zoomState.scale === 1 && zoomState.offsetX === 0 && zoomState.offsetY === 0
    zoomInButton.disabled = zoomState.scale >= maxZoom
}

function resetZoomState() {
    zoomState.scale = 1
    zoomState.offsetX = 0
    zoomState.offsetY = 0
    applyChartTransform()
}

function zoomChart(multiplier) {
    const nextScale = clamp(zoomState.scale * multiplier, minZoom, maxZoom)

    zoomState.scale = nextScale

    if (nextScale === 1) {
        zoomState.offsetX = 0
        zoomState.offsetY = 0
    }

    applyChartTransform()
}

class HeroStatsAnalyzer {
    constructor(heroData, tierWeight, options = {}) {
        this.heroData = heroData
        this.weightMode = options.weightMode ?? 'softmax'
        this.temperature = options.temperature ?? defaultSoftmaxTemperature
        this.tierWeight = HeroStatsAnalyzer.createTierWeight(tierWeight, this.weightMode, this.temperature)

        this.pickrateBasedTierWeightCache = {}

        for (const heroName in heroData) {
            this.pickrateBasedTierWeightCache[heroName] = this.createPickrateBasedTierWeight(heroName, this.tierWeight, this.temperature)
        }
    }

    static createTierWeight(tierWeight, weightMode, temperature = defaultSoftmaxTemperature) {
        if (weightMode === 'none') {
            return Object.fromEntries(Object.keys(tierWeight).map(tier => [tier, 1]))
        } else if (weightMode === 'raw') {
            const denominator = Object.values(tierWeight).reduce((sum, weight) => sum + weight, 0)
            return Object.fromEntries(
                Object.entries(tierWeight).map(([tier, weight]) => [tier, weight / denominator])
            )
        } else {
            const denominator = Object.values(tierWeight).reduce((sum, weight) => sum + Math.exp(weight / temperature), 0)
            return Object.fromEntries(
                Object.entries(tierWeight).map(([tier, weight]) => [tier, Math.exp(weight / temperature) / denominator])
            )
        }
    }

    createPickrateBasedTierWeight(heroName, tierWeight, temperature = defaultSoftmaxTemperature) {
        const pickrateWeight = {}
        const pickbasedTierWeight = {}
        const denominator = this.heroData[heroName].reduce((sum, weight) => sum + Math.exp(weight.pickrate / temperature), 0)

        for (const item of this.heroData[heroName]) {
            pickrateWeight[item.tier] = Math.exp(item.pickrate / temperature) / denominator
        }

        const pickbasedWeights = this.heroData[heroName]?.map(item => ({
            tier: item.tier,
            weight: pickrateWeight[item.tier] * tierWeight[item.tier]
        }))
        const denominator_ = pickbasedWeights.reduce((sum, weight) => sum + weight.weight, 0)

        for (const item of pickbasedWeights) {
            pickbasedTierWeight[item.tier] = item.weight / denominator_
        }

        return pickbasedTierWeight
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
            const weight = 1 / this.heroData[heroName].length
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

    metricDistribution(heroName, metric) {
        const values = (this.heroData[heroName] ?? []).map(item => ({
            tier: item.tier,
            value: Math.max(Number(item[metric]) || 0, 0) * this.getPickrateBasedTierWeight(heroName, item.tier)
        }))

        if (!values.length) {
            return {}
        }

        const total = values.reduce((sum, item) => sum + item.value, 0)

        if (total <= 0) {
            const uniformWeight = 1 / values.length
            return Object.fromEntries(values.map(item => [item.tier, uniformWeight]))
        }

        return Object.fromEntries(values.map(item => [item.tier, item.value / total]))
    }

    analyze(heroName) {
        const meanWinrate = this.weightedMean(heroName, 'winrate')
        const meanPickrate = this.weightedMean(heroName, 'pickrate')
        const varianceWinrate = this.weightedVariance(heroName, 'winrate', meanWinrate)
        const variancePickrate = this.weightedVariance(heroName, 'pickrate', meanPickrate)
        const standardDeviationWinrate = Math.sqrt(varianceWinrate)
        const standardDeviationPickrate = Math.sqrt(variancePickrate)
        const covarianceWinratePickrate = this.weightedCovariance(heroName, 'winrate', 'pickrate', meanWinrate, meanPickrate)
        const winrateDistribution = this.metricDistribution(heroName, 'winrate')

        return {
            meanWinrate,
            varianceWinrate,
            standardDeviationWinrate,
            meanPickrate,
            variancePickrate,
            standardDeviationPickrate,
            covarianceWinratePickrate,
            winrateDistribution
        }
    }
}

function klDivergence(distributionA, distributionB) {
    let total = 0
    const keys = new Set([...Object.keys(distributionA ?? {}), ...Object.keys(distributionB ?? {})])

    for (const key of keys) {
        const valueA = distributionA[key] ?? 0
        const valueB = distributionB[key] ?? 0

        if (valueA > 0 && valueB > 0) {
            total += valueA * Math.log2(valueA / valueB)
        }
    }

    return total
}

function jensenShannonDivergence(distributionA, distributionB) {
    const keys = new Set([...Object.keys(distributionA ?? {}), ...Object.keys(distributionB ?? {})])

    if (!keys.size) {
        return 0
    }

    const midpoint = {}

    for (const key of keys) {
        midpoint[key] = ((distributionA[key] ?? 0) + (distributionB[key] ?? 0)) / 2
    }

    return (klDivergence(distributionA, midpoint) + klDivergence(distributionB, midpoint)) / 2
}

function analyzeHeroData(allMap, specMap) {
    const winrateJensenShannonDivergence = jensenShannonDivergence(specMap.winrateDistribution, allMap.winrateDistribution)

    return {
        winrateJensenShannonDivergence
    }
}

function centerLogWinrateJensenShannonDivergence(results) {
    const logValues = results
        .map(hero => Math.log2(Math.max(hero.winrateJensenShannonDivergence, 0) + jensenShannonLogEpsilon))
        .filter(Number.isFinite)

    if (!logValues.length) {
        return results.map(hero => ({
            ...hero,
            winrateJensenShannonDivergenceLog: 0,
            winrateJensenShannonDivergenceCenteredLog: 0
        }))
    }

    const meanLog = logValues.reduce((sum, value) => sum + value, 0) / logValues.length

    return results.map(hero => {
        const logValue = Math.log2(Math.max(hero.winrateJensenShannonDivergence, 0) + jensenShannonLogEpsilon)
        const finiteLogValue = Number.isFinite(logValue) ? logValue : meanLog

        return {
            ...hero,
            winrateJensenShannonDivergenceLog: finiteLogValue,
            winrateJensenShannonDivergenceCenteredLog: finiteLogValue - meanLog
        }
    })
}

function analyzeSourceData(source, weightMode, tierWeights, temperature) {
    const allMapAnalyzer = new HeroStatsAnalyzer(source.allMaps.heroData, tierWeights, { weightMode, temperature })
    const selectedMapAnalyzer = new HeroStatsAnalyzer(source.selectedMap.heroData, tierWeights, { weightMode, temperature })
    const heroes = Object.keys(source.selectedMap.heroData).filter(heroName => source.allMaps.heroData[heroName])
    const results = centerLogWinrateJensenShannonDivergence(heroes.map(heroName => {
        const allMap = allMapAnalyzer.analyze(heroName)
        const specMap = selectedMapAnalyzer.analyze(heroName)
        const result = {
            hero: heroName,
            allMap,
            specMap,
            winrateMeanDiff: specMap.meanWinrate - allMap.meanWinrate,
            winrateVarianceDiff: specMap.varianceWinrate - allMap.varianceWinrate,
            pickrateMeanDiff: specMap.meanPickrate - allMap.meanPickrate,
            pickrateVarianceDiff: specMap.variancePickrate - allMap.variancePickrate,
            covarianceDiff: specMap.covarianceWinratePickrate - allMap.covarianceWinratePickrate,
            icon: source.selectedMap.heroIcons[heroName] ?? source.allMaps.heroIcons[heroName]
        }

        return {
            ...result,
            ...analyzeHeroData(allMap, specMap)
        }
    }))

    return {
        map: source.map,
        weightMode,
        temperature,
        tierWeights,
        generatedAt: new Date().toISOString(),
        heroes: results
    }
}

async function loadMaps() {
    const response = await fetch('/api/maps')
    const groups = await response.json()

    mapSelect.innerHTML = groups.map(group => {
        const options = group.maps
            .map(map => `<option value="${map}">${map}</option>`)
            .join('')

        return `<optgroup label="${group.group}">${options}</optgroup>`
    }).join('')

    mapSelect.value = 'numbani'
}

function renderTooltip(event, hero) {
    tooltip.hidden = false
    tooltip.style.left = `${event.clientX + 14}px`
    tooltip.style.top = `${event.clientY + 14}px`
    tooltip.innerHTML = `
        <strong>${hero.hero}</strong>
        <span>mean diff: ${formatNumber(hero.winrateMeanDiff)}</span>
        <span>centered log JSD: ${formatNumber(hero.winrateJensenShannonDivergenceCenteredLog)}</span>
        <span>log JSD: ${formatNumber(hero.winrateJensenShannonDivergenceLog)}</span>
        <span>winrate JSD: ${formatNumber(hero.winrateJensenShannonDivergence, 6)}</span>
        <span>pick mean diff: ${formatNumber(hero.pickrateMeanDiff)}</span>
        <span>cov diff: ${formatNumber(hero.covarianceDiff)}</span>
    `
}

function hideTooltip() {
    tooltip.hidden = true
}

function renderAxisDirectionLabels(targetLayer) {
    const xAxisPercent = targetLayer.dataset.xAxisPercent
    const yAxisPercent = targetLayer.dataset.yAxisPercent
    const labels = [
        ['axis-direction x-negative', '승률 ↓', 'top', yAxisPercent],
        ['axis-direction x-positive', '승률 ↑', 'top', yAxisPercent],
        ['axis-direction y-positive', 'log JSD ↑', 'left', xAxisPercent],
        ['axis-direction y-negative', 'log JSD ↓', 'left', xAxisPercent]
    ]

    for (const [className, text, positionProp, positionValue] of labels) {
        const label = document.createElement('div')
        label.className = className
        label.textContent = text
        label.style[positionProp] = `${positionValue}%`
        targetLayer.appendChild(label)
    }
}

function renderPlotAxes(targetLayer, xDomain, yDomain) {
    const xAxisPercent = scale(0, xDomain, false, false)
    const yAxisPercent = scale(0, yDomain, true, false)
    const clampedXAxisPercent = clamp(xAxisPercent, 5, 95)
    const clampedYAxisPercent = clamp(yAxisPercent, 5, 95)

    targetLayer.dataset.xAxisPercent = clampedXAxisPercent
    targetLayer.dataset.yAxisPercent = clampedYAxisPercent

    if (xAxisPercent >= 0 && xAxisPercent <= 100) {
        const yAxis = document.createElement('div')
        yAxis.className = 'plot-axis y-axis-line'
        yAxis.style.left = `${xAxisPercent}%`
        targetLayer.appendChild(yAxis)
    }

    if (yAxisPercent >= 0 && yAxisPercent <= 100) {
        const xAxis = document.createElement('div')
        xAxis.className = 'plot-axis x-axis-line'
        xAxis.style.top = `${yAxisPercent}%`
        targetLayer.appendChild(xAxis)
    }
}

function renderChart(heroes) {
    const xDomain = normalizeDataDomain(heroes.map(hero => hero.winrateMeanDiff))
    const yDomain = normalizeDataDomain(heroes.map(hero => hero.winrateJensenShannonDivergenceCenteredLog))

    chart.innerHTML = ''
    plotLayer = document.createElement('div')
    plotLayer.className = 'plot-layer'
    chart.appendChild(plotLayer)
    renderPlotAxes(plotLayer, xDomain, yDomain)
    renderAxisDirectionLabels(plotLayer)

    for (const hero of heroes) {
        const image = document.createElement('img')
        image.className = 'point'
        image.src = hero.icon
        image.alt = hero.hero
        image.title = hero.hero
        image.tabIndex = 0
        image.style.left = `${scale(hero.winrateMeanDiff, xDomain)}%`
        image.style.top = `${scale(hero.winrateJensenShannonDivergenceCenteredLog, yDomain, true)}%`

        image.addEventListener('mousemove', event => renderTooltip(event, hero))
        image.addEventListener('mouseleave', hideTooltip)
        image.addEventListener('focus', event => renderTooltip(event, hero))
        image.addEventListener('blur', hideTooltip)

        plotLayer.appendChild(image)
    }

    applyChartTransform()
}

function renderTable(heroes) {
    const sortedHeroes = [...heroes].sort((a, b) => b.winrateMeanDiff - a.winrateMeanDiff)

    heroTable.innerHTML = sortedHeroes.map(hero => `
        <tr>
            <td>
                <div class="hero-cell">
                    <img src="${hero.icon}" alt="">
                    <span>${hero.hero}</span>
                </div>
            </td>
            <td class="${classForValue(hero.winrateMeanDiff)}">${formatNumber(hero.winrateMeanDiff)}</td>
            <td class="${classForValue(hero.winrateJensenShannonDivergenceCenteredLog)}">${formatNumber(hero.winrateJensenShannonDivergenceCenteredLog)}</td>
            <td class="${classForValue(hero.pickrateMeanDiff)}">${formatNumber(hero.pickrateMeanDiff)}</td>
            <td class="${classForValue(hero.covarianceDiff)}">${formatNumber(hero.covarianceDiff)}</td>
        </tr>
    `).join('')
}

function renderCurrentAnalysis(options = {}) {
    const { resetZoom = false } = options
    const weightMode = weightSelect.value

    if (!analysisSource) {
        return
    }

    if (!applyGlobalWeightBounds()) {
        return
    }

    if (!syncTemperatureControls()) {
        status.textContent = 'Invalid temperature'
        return
    }

    const tierWeights = readTierWeights()
    const temperature = readSoftmaxTemperature()

    if (!tierWeights) {
        status.textContent = 'Invalid weights'
        return
    }

    if (!temperature) {
        status.textContent = 'Invalid temperature'
        return
    }

    if (resetZoom) {
        resetZoomState()
    }

    const data = analyzeSourceData(analysisSource, weightMode, tierWeights, temperature)
    renderChart(data.heroes)
    renderTable(data.heroes)

    status.textContent = `${data.heroes.length} heroes / ${data.weightMode} / temp ${formatNumber(data.temperature, 2)} / ${formatTierWeightSummary(data.tierWeights)}`
    summary.textContent = `${data.map} 기준으로 현재 맵과 all-maps의 승률 평균 차이와 평균 중심 로그 JSD 기반 티어별 승률 분포 차이를 비교합니다.`
}

function queueAnalysisRender() {
    if (renderFrame) {
        return
    }

    renderFrame = requestAnimationFrame(() => {
        renderFrame = null
        renderCurrentAnalysis()
    })
}

async function loadAnalysisSource() {
    const map = mapSelect.value

    status.textContent = 'Loading source data...'
    chart.innerHTML = ''
    plotLayer = null
    resetZoomState()
    heroTable.innerHTML = ''
    hideTooltip()

    try {
        const params = new URLSearchParams({
            map
        })
        const response = await fetch(`/api/analysis-source?${params.toString()}`)

        if (!response.ok) {
            throw new Error('Source data request failed')
        }

        analysisSource = await response.json()
        renderCurrentAnalysis({ resetZoom: true })
    } catch (error) {
        console.error(error)
        status.textContent = 'Failed'
        chart.innerHTML = '<div class="empty-state">원본 데이터를 불러오지 못했습니다.</div>'
    }
}

function startChartPan(event) {
    if (!plotLayer || zoomState.scale === 1) {
        return
    }

    panStart = {
        x: event.clientX,
        y: event.clientY,
        offsetX: zoomState.offsetX,
        offsetY: zoomState.offsetY
    }
    chart.classList.add('is-panning')
    chart.setPointerCapture(event.pointerId)
}

function moveChartPan(event) {
    if (!panStart) {
        return
    }

    zoomState.offsetX = panStart.offsetX + event.clientX - panStart.x
    zoomState.offsetY = panStart.offsetY + event.clientY - panStart.y
    applyChartTransform()
}

function endChartPan(event) {
    if (!panStart) {
        return
    }

    panStart = null
    chart.classList.remove('is-panning')

    if (chart.hasPointerCapture(event.pointerId)) {
        chart.releasePointerCapture(event.pointerId)
    }
}

function handleChartWheel(event) {
    if (!plotLayer) {
        return
    }

    event.preventDefault()
    zoomChart(event.deltaY < 0 ? zoomStep : 1 / zoomStep)
}

async function init() {
    await loadMaps()
    applyGlobalWeightBounds()
    await loadAnalysisSource()

    mapSelect.addEventListener('change', loadAnalysisSource)
    weightSelect.addEventListener('change', queueAnalysisRender)
    tierWeightModeSelect.addEventListener('change', () => {
        if (applyTierWeightMode()) {
            queueAnalysisRender()
        }
    })
    tierWeightForm.addEventListener('submit', event => {
        event.preventDefault()
        queueAnalysisRender()
    })
    tierWeightInputs.forEach(input => input.addEventListener('input', event => {
        const tier = event.target.dataset.tierWeight
        tierWeightModeSelect.value = 'custom'
        tierWeightValueByTier[tier].value = event.target.value
        queueAnalysisRender()
    }))
    tierWeightValueInputs.forEach(input => input.addEventListener('input', event => {
        const tier = event.target.dataset.tierValue

        if (event.target.checkValidity() && event.target.value.trim()) {
            tierWeightModeSelect.value = 'custom'
            tierWeightSliderByTier[tier].value = event.target.value
            queueAnalysisRender()
        } else {
            status.textContent = 'Invalid weights'
        }
    }))
    globalWeightMinInput.addEventListener('input', () => {
        if (applyGlobalWeightBounds()) {
            queueAnalysisRender()
        }
    })
    globalWeightMaxInput.addEventListener('input', () => {
        if (applyGlobalWeightBounds()) {
            queueAnalysisRender()
        }
    })
    temperatureSlider.addEventListener('input', event => {
        temperatureInput.value = event.target.value
        queueAnalysisRender()
    })
    temperatureInput.addEventListener('input', event => {
        if (event.target.checkValidity() && event.target.value.trim()) {
            temperatureSlider.value = event.target.value
            queueAnalysisRender()
        } else {
            status.textContent = 'Invalid temperature'
        }
    })
    resetTierWeightsButton.addEventListener('click', () => {
        globalWeightMinInput.value = defaultWeightBounds.min
        globalWeightMaxInput.value = defaultWeightBounds.max
        tierWeightModeSelect.value = 'linear'
        resetTierWeights()
        temperatureInput.value = defaultSoftmaxTemperature
        temperatureSlider.value = defaultSoftmaxTemperature
        applyGlobalWeightBounds()
        queueAnalysisRender()
    })
    zoomInButton.addEventListener('click', () => zoomChart(zoomStep))
    zoomOutButton.addEventListener('click', () => zoomChart(1 / zoomStep))
    zoomResetButton.addEventListener('click', resetZoomState)
    chart.addEventListener('pointerdown', startChartPan)
    chart.addEventListener('pointermove', moveChartPan)
    chart.addEventListener('pointerup', endChartPan)
    chart.addEventListener('pointercancel', endChartPan)
    chart.addEventListener('wheel', handleChartWheel, { passive: false })
}

init()
