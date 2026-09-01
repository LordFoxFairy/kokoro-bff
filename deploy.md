# Kokoro BFF 部署说明

## 方案 A：直接运行 Node

适合本地或 Cloudflare/平台的 Node 运行环境：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
NODE_ENV=production pnpm start
```

将 `.env.prod.example` 复制为平台变量模板，再注入真实值。不要把 `.env.prod` 提交到仓库。

## 方案 B：生产 Docker 镜像

Dockerfile 是生产模式，启动命令为 `node dist/main.js`；本地开发不需要 Docker：

```bash
docker build -t ghcr.io/OWNER/kokoro-bff:v0.1.0 .
docker run --rm --name kokoro-bff \
  --env-file .env.prod \
  -p 4300:4300 \
  ghcr.io/OWNER/kokoro-bff:v0.1.0
```

镜像 workflow 只响应 `v*.*.*` tag，普通 branch push 不打镜像：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Web 对接

当前 Web 只在服务端代理到 BFF：

```dotenv
KOKORO_BFF_BASE_URL=http://127.0.0.1:4300
KOKORO_INTERNAL_SECRET_WEB_BFF=local-web-bff-secret
```

BFF：

```dotenv
KOKORO_BFF_MODE=mock
KOKORO_BFF_SHARED_SECRET=local-web-bff-secret
KOKORO_DOMAIN=dev.kokoro.localhost
```

生产拓扑为 `Web → BFF → 业务 API/Agent`。`kokoro-gateway` 不在该路径中；Chat 由 BFF 的 Chat 业务模块边界统一承接，Agent 仅负责 Run、control、HITL 与恢复执行。

## 健康检查和回滚

```bash
curl -fsS http://127.0.0.1:4300/healthz
curl -fsS http://127.0.0.1:4300/readyz
```

发布前保留上一个 tag；新版本异常时把容器镜像回滚到上一个 tag，并检查 `request_id` 日志链路。不要用 `X-Domain` 诊断租户/域名，检查 `KOKORO_DOMAIN` 和 `Forwarded`。
