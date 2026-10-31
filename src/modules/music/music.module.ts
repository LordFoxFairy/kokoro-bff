import { Module } from "@nestjs/common"
import { BffConfigModule } from "../../config/config.module.js"
import { AccountModule } from "../account/account.module.js"

@Module({ imports: [AccountModule, BffConfigModule], exports: [] })
export class MusicModule {}
