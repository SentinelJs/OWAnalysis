const mapSelect = document.querySelector('#mapSelect')
const weightSelect = document.querySelector('#weightSelect')
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
const zoomState = {
    scale: 1,
    offsetX: 0,
    offsetY: 0
}
let plotLayer = null
let panStart = null

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
        <span>log2 abs std diff: ${formatNumber(hero.winrateStdDevDiff)}</span>
        <span>variance diff: ${formatNumber(hero.winrateVarianceDiff)}</span>
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
        ['axis-direction y-positive', '숙련도 영향 ↑', 'left', xAxisPercent],
        ['axis-direction y-negative', '숙련도 영향 ↓', 'left', xAxisPercent]
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
    const yDomain = normalizeDataDomain(heroes.map(hero => hero.winrateStdDevDiff))

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
        image.style.top = `${scale(hero.winrateStdDevDiff, yDomain, true)}%`

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
            <td class="${classForValue(hero.winrateVarianceDiff)}">${formatNumber(hero.winrateVarianceDiff)}</td>
            <td class="${classForValue(hero.pickrateMeanDiff)}">${formatNumber(hero.pickrateMeanDiff)}</td>
            <td class="${classForValue(hero.covarianceDiff)}">${formatNumber(hero.covarianceDiff)}</td>
        </tr>
    `).join('')
}

async function loadAnalysis() {
    const map = mapSelect.value
    const weightMode = weightSelect.value

    status.textContent = 'Analyzing...'
    chart.innerHTML = ''
    plotLayer = null
    resetZoomState()
    heroTable.innerHTML = ''
    hideTooltip()

    try {
        const response = await fetch(`/api/analysis?map=${encodeURIComponent(map)}&weightMode=${encodeURIComponent(weightMode)}`)

        if (!response.ok) {
            throw new Error('Analysis request failed')
        }

        const data = await response.json()
        renderChart(data.heroes)
        renderTable(data.heroes)

        status.textContent = `${data.heroes.length} heroes / ${data.weightMode}`
        summary.textContent = `${data.map} 기준으로 현재 맵과 all-maps의 승률 평균 차이와 표준편차 차이 크기를 비교합니다.`
    } catch (error) {
        console.error(error)
        status.textContent = 'Failed'
        chart.innerHTML = '<div class="empty-state">분석 데이터를 불러오지 못했습니다.</div>'
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
    await loadAnalysis()

    mapSelect.addEventListener('change', loadAnalysis)
    weightSelect.addEventListener('change', loadAnalysis)
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
