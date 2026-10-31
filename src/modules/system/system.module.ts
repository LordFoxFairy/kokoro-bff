import { Module } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"

@Module({ imports: [IamRelayModule, BffConfigModule], exports: [] })
export class SystemModule {}
