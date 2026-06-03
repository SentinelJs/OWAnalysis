const axios = require('axios')
const USERAGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const mapName = [
    ["antarctic-peninsula", "nepal", "lijiang-tower", "busan", "samoa", "oasis", "ilios"], 
    ["route-66", "watchpoint-gibraltar", "dorado", "rialto", "shambali-monastery", "circuit-royal", "junkertown", "havana"], 
    ["new-junk-city", "suravasa", "aatlis"],
    ["numbani", "midtown", "blizzard-world", "eichenwalde", "kings-row", "paraiso", "hollywood"], 
    ["new-queen-street", "runasapi", "esperanca", "colosseo"]
]

const tierName = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster']
const roleName = ['tank', 'damage', 'support']

let queryString = {
    'input': 'PC',
    'map': 'all-maps',
    'region': 'Asia',
    'role': 'All',
    'rq': '2',
    'tier': 'All'
}

const baseURL = 'https://overwatch.blizzard.com/ko-kr/rates/data/?'

function generateURL(queryString) {
    let url = baseURL
    for (let key in queryString) {
        url += `${key}=${queryString[key]}&`
    }
    return url.slice(0, -1)
}

async function getMapData(map) {
    let rate_result = {}
    let icon_result = {}

    for (let tier of tierName) {
        queryString['map'] = map
        queryString['tier'] = tier
        const res = await axios.get(generateURL(queryString), {
            headers: {
                'User-Agent': USERAGENT
            }
        })

        for (let hero_data of res.data['rates']['rates']) {
            const hero = hero_data['cells']['name']
            const iconURL = hero_data['hero']['portrait']

            if (rate_result[hero] == undefined) {
                rate_result[hero] = []
            }

            if (icon_result[hero] == undefined) {
                icon_result[hero] = iconURL
            }
    
            rate_result[hero].push({
                'tier': tier,
                'winrate': hero_data['cells']['winrate'],
                'pickrate': hero_data['cells']['pickrate'],
                'banrate': hero_data['cells']['banrate']
            })
        }
    }

    return {
        'rates': rate_result,
        'icons': icon_result
    }
}

;(async () => {
    // const map = 'eichenwalde'
    const data = await getMapData('all-maps')
    console.log(data.rates, data.icons['아나'])
})()