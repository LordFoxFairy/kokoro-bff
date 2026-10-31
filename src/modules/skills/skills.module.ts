import { Module } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"

@Module({ imports: [AccountModule, IamRelayModule, BffConfigModule], exports: [] })
export class SkillsModule {}
