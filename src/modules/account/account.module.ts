import { Module } from "@nestjs/common"
import { DatabaseModule } from "../../common/database/database.module.js"
import { IamRelayModule } from "../iam-relay/iam-relay.module.js"

@Module({ imports: [IamRelayModule, DatabaseModule], exports: [IamRelayModule] })
export class AccountModule {}
