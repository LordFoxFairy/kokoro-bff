import { loadConfig } from "./config/runtime.js"
import { createBffServer } from "./bootstrap/server.js"

export { createBffServer } from "./bootstrap/server.js"

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig()
  const server = createBffServer(config)
  server.listen(config.port, config.host, () => {
    console.log(`kokoro-bff ${config.mode} listening on http://${config.host}:${config.port}`)
  })
}
