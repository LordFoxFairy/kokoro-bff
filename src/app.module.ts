import { Module } from "@nestjs/common"
import { BffConfigModule } from "./config/config.module.js"
import { DatabaseModule } from "./common/database/database.module.js"
import { RedisModule } from "./common/redis/redis.module.js"
import { GracefulShutdown } from "./common/lifecycle/graceful-shutdown.js"
import { HealthModule } from "./modules/health/health.module.js"
import { IamRelayModule } from "./modules/iam-relay/iam-relay.module.js"
import { LegacyRoutesModule } from "./modules/legacy-routes/legacy-routes.module.js"

@Module({
  imports: [BffConfigModule, DatabaseModule, RedisModule, HealthModule, IamRelayModule, LegacyRoutesModule],
  providers: [GracefulShutdown],
})
export class AppModule {}
