export function createEmbedQueue({ embed, onReady, onError = () => {} }) {
  const jobs = []
  let running = false, drainResolvers = []

  async function run() {
    if (running) return
    running = true
    while (jobs.length) {
      const { id, url } = jobs.shift()
      try { onReady(id, await embed(url)) }
      catch (e) { onError(id, e) }
    }
    running = false
    drainResolvers.splice(0).forEach(r => r())
  }

  return {
    enqueue(id, url) { jobs.push({ id, url }); run() },
    drain() { return jobs.length || running ? new Promise(r => drainResolvers.push(r)) : Promise.resolve() },
  }
}
