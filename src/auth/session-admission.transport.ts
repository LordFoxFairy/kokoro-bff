import { requestIamHttp, type IamHttpOptions } from "../infrastructure/clients/iam-http-transport.js"
import type { SessionAdmissionInput } from "./session-admission.types.js"

/** Only the official native Session read crosses this authentication transport. */
export class SessionAdmissionTransport {
  public constructor(private readonly options: IamHttpOptions) {}
  public requestSession(input: SessionAdmissionInput) {
    const target = new URL("/iam/get-session", this.options.baseUrl)
    target.searchParams.set("disableCookieCache", "true")
    if (input.refresh !== true) target.searchParams.set("disableRefresh", "true")
    return requestIamHttp(this.options, {
      target,
      method: "GET",
      headers: { accept: "application/json", cookie: input.cookie, origin: input.origin, "x-request-id": input.requestId },
      body: null,
      signal: input.signal,
    })
  }
}
