# Library API v1

BFF owns Product visibility, Conversation/Project associations and pagination; Storage owns files,
Artifacts, FINAL/CLEAN metadata and object bytes. The canonical wire schema is
[OpenAPI](../../../contract/openapi/v1/openapi.yaml). Browser requests use the Web same-origin adapter
and current IAM admission; self-reported tenant, subject or scope never grants access.

## GET `/v1/library`

Required `kind=file|artifact`; `limit` is 1–100 (default 50), and `cursor` is opaque. Repeated or
unknown parameters are rejected. Success is the existing private no-store `data.items/next_cursor`
page; 400 is invalid query/cursor, 401/403 admission denial, 502 invalid owner response and 503 an
unavailable owner. Errors are not successful empty pages.

- `file`: CLEAN personal assets in the admitted subject's personal scope. `q` and `type` are rejected.
- `artifact`: FINAL/CLEAN Artifacts linked to current active Conversations and valid Projects.
  Optional `q` is at most 200 Unicode code points **before** normalization, with C0 controls and DEL
  rejected. Trim, NFC and locale-independent lowercase are applied; matching is substring search
  over the current Storage title or filename. It is not full-text content search or relevance ranking.
  Optional `type` is `all` (default), `slides`, `documents`, `spreadsheets`, `images`, `video`, `audio`
  or `other`. An empty/whitespace-only `q` removes the text filter.

Type taxonomy retains the existing Product display precedence over final MIME/title: presentation,
powerpoint or a whole-word slides/deck token → slides; spreadsheet/excel/csv or 试算表/試算表 →
spreadsheets; then image, audio or video MIME/known title suffix; then text/pdf/document MIME or
`.doc[x]/pdf/txt/md` title suffix; otherwise other. MIME comparisons are case-insensitive. This
classification is Product metadata, not the Storage Artifact kind enum.

### Bounded federated pagination

Every request reads at most `min(500, limit*5)` currently authorized relationship candidates, then
revalidates each through the existing conversation-scoped Storage FINAL read. Only verified final
metadata participates in filtering; unverified Agent delivery claims do not decide matches. The
existing 30-second request deadline/cancellation and candidate upper bound remain. This does not
introduce a duplicate metadata index, a background search worker, or cross-owner SQL.

Results keep delivery-time/Conversation/Artifact keyset order. The cursor records the last **scanned**
candidate, not merely the last matched result, and binds the normalized query/type, tenant, subject,
kind and limit. Changing any bound value requires starting a new query. Visibility is rechecked on
each page; a cursor is not authorization or snapshot isolation. Public18 retires previous Artifact
cursor shapes; start a new query instead of retrying an old cursor.

An empty `items` array with non-null `next_cursor` is a **sparse candidate window**, not proof of no
matches. Consumers must retain an explicit continue action, and only show a definitive no-match
state after `next_cursor=null`. Do not auto-scan all pages or pretend a single window is exhaustive.

## Artifact detail and content

`GET /v1/library/artifacts/{conversation_id}/{artifact_id}` revalidates the current BFF association
and Storage FINAL metadata. Its `/content` child streams the authorized original bytes with the
existing hash, expiry, byte limit and cancellation checks; it does not redirect to an owner URL.
Personal upload/content commands retain their canonical admission, scope, idempotency and scan
requirements. Search does not read object bytes, invoke a model/tool, or change resources.

This Public18 slice is a source candidate until the fixed consumers and normal runtime are paired.
No normal database or process change is implied by updating this document.
