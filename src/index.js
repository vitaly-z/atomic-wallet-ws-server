const fastify = require('fastify')({
  logger: {
    prettyPrint: {
      translateTime: true,
      ignore: 'pid,hostname,reqId,responseTime,req,res',
      messageFormat: '{msg} [id={reqId} {req.method} {req.url}]'
    }
  }
})
const { join } = require('path')
const { readFile } = require('fs').promises
const axios = require('axios')

fastify.decorate('cryptoCurrenciesPrices', new Map())
fastify.decorate('clientsCache', new Map())

fastify.decorate('fetchCurrencyRates', async function () {
  // fastify.cryptoCurrenciesPrices.set('BTC', { USD: 61851.46, JPY: 7036851.15, EUR: 53109.28 })
  const url = new URL('https://min-api.cryptocompare.com/data/price')

  url.searchParams.set('fsym', 'BTC')
  url.searchParams.set('tsyms', ['USD', 'JPY', 'EUR'].join(','))

  try {
    const { status, data } = await axios.get(url.toString())
    if (status === 200 && data) {
      fastify.cryptoCurrenciesPrices.set('BTC', data)
    }
  } catch (error) {
    fastify.log.error(error)
  }
})

fastify.register(require('./fastify-socket.io'), {
  // put options here
})

fastify.get('/', async (req, reply) => {
  const data = await readFile(join(__dirname, '..', 'index.html'))
  reply.header('content-type', 'text/html; charset=utf-8')
  reply.send(data)
})

fastify.get('/pushPrices/:userId', async (req, reply) => {
  const userId = req.params.userId
  const userSession = fastify.clientsCache.get(userId)

  if (userSession) {
    const { socketId } = userSession
    fastify.io.to(socketId).emit('message', { BTC: fastify.cryptoCurrenciesPrices.get('BTC') })
  }

  // For debug
  function mapToObj (map) {
    const obj = {}
    map.forEach(function (v, k) {
      obj[k] = v
    })
    return obj
  }

  return {
    clientsCache: mapToObj(fastify.clientsCache),
    cryptoCurrenciesPrices: mapToObj(fastify.cryptoCurrenciesPrices)
  }
})

fastify.ready(err => {
  if (err) throw err

  fastify.fetchCurrencyRates()

  setInterval(() => {
    fastify.fetchCurrencyRates()
  }, 60 * 1000)

  fastify.io.on('connect', (socket) => {
    const { userId } = socket.handshake.query
    const socketId = socket.id

    const session = { userId, socketId }

    fastify.log.info(`WS client connected ${JSON.stringify(session)}`)

    fastify.clientsCache.set(userId, session)
    fastify.clientsCache.set(socketId, session)

    socket.on('disconnect', (reason) => {
      fastify.log.info(`disconnect ${socket.id} due to ${reason}`)
      fastify.clientsCache.delete(userId)
      fastify.clientsCache.delete(socketId)
    })
  })
})

const start = async () => {
  try {
    await fastify.listen(3000)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start()
