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

for (let i = 0; i < mapName.length; i++) {
    for (let j = 0; j < tierName.length; j++) {
        queryString['map'] = mapName[i][0]
        queryString['tier'] = tierName[j]
        console.log(generateURL(queryString))

        const res = axios.get(generateURL(queryString), {
            headers: {
                'User-Agent': USERAGENT
            }
        }).then((response) => {
            const data = response.data['rates']['rates']
            console.log(response.data)
        }).catch((error) => {
            console.error(error)
        })
    }
}