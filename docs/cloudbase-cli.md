# CloudBase CLI 部署（与 MCP 配套）

本仓库提供两种操作腾讯云开发（CloudBase）环境 `wenjin-cloudbase-d1empq882391ac1` 的方式：

| 方式 | 用途 | 入口 |
| --- | --- | --- |
| MCP 网关（Cloudflare Worker） | AI 查询数据、看日志、排查、调用已有函数 | `src/`，见 README |
| CLI 部署（GitHub Actions） | 把代码部署成云函数，可被任何仓库复用 | `.github/workflows/cloudbase-deploy.yml` |

原则：**部署只走 git → CI；MCP 只用于查询和排查。** 托管版 MCP 运行在 cloud mode，不能读本地代码目录，所以不能用来上传函数代码（`createFunction` 会直接拒绝）。

## 其他仓库如何调用

```yaml
name: Deploy CloudBase functions
on:
  push:
    branches: [main]
    paths: ["cloudbase/**", "cloudbaserc.json"]
  workflow_dispatch:

jobs:
  deploy:
    uses: wenjinliuu/cloudbase-mcp-worker/.github/workflows/cloudbase-deploy.yml@main
    with:
      config-dir: .
      functions: my-fn          # 留空 = cloudbaserc.json 里全部函数
    secrets:
      CLOUDBASE_API_KEY: ${{ secrets.CLOUDBASE_API_KEY }}
```

调用方仓库需要：

1. 根目录（或 `config-dir`）有 `cloudbaserc.json`，`envId` 与环境一致。
2. 在调用方仓库自己的 Secrets 里配置 `CLOUDBASE_API_KEY`（Secrets 不会跨仓库共享）。

## 密钥怎么填

### CLOUDBASE_API_KEY（必需）

1. 打开云开发控制台 → 选环境 `wenjin-cloudbase` → **环境配置 / API Key**（新版控制台在「环境管理 → API Key」）。
2. **为每个仓库新建一个 API Key**，名字写仓库名（如 `gh-football-prob-lab`），这样泄露或停用某个仓库时不影响其他仓库。也可以复用开奖仓库那把，但不建议。
3. 复制密钥（只显示一次）。
4. GitHub 打开目标仓库 → Settings → Secrets and variables → Actions → **New repository secret**：
   - Name：`CLOUDBASE_API_KEY`
   - Secret：粘贴密钥，不要带空格或换行。
5. 在本仓库手动运行 **CloudBase CLI check** 工作流验证（只读，列出函数）。

### TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY（可选，目前不需要）

只有以下场景才需要腾讯云 CAM 密钥：

- 用 `tcb fn invoke` 调用**事件函数**；
- 镜像构建部署（企业版 TCR）等需要 CAM 策略的操作。

如果确实需要：在腾讯云「访问管理 → 用户」新建**子用户**，只授予最小权限（自定义策略，只允许 `scf:InvokeFunction`，资源限定到该环境的函数；不要直接给 `QcloudSCFFullAccess`），生成 SecretId/SecretKey 存入 Secrets，CI 里用 `tcb login --apiKeyId "$TENCENTCLOUD_SECRETID" --apiKey "$TENCENTCLOUD_SECRETKEY"` 登录。**不要用主账号密钥。**

## 2026-10-31 审计记录

背景：在 `lottery-data-repo` 的 `probe/sporttery` 分支用现有 CI 部署探测函数，部署成功，但 `tcb fn invoke` 报 `Cam authentication failed`。

| 项目 | 结论 |
| --- | --- |
| 部署流程本身 | 正常。`tcb login --cloudbase-api-key` + `tcb fn deploy --force --yes` 成功，函数经 COS 上传部署 |
| 事件函数调用失败的原因 | **不是配置错误**。环境级 API Key 不携带 CAM 策略；事件函数调用走 SCF Invoke，需要 CAM 签名。CLI 帮助也写明 `--api-key` 只用于 HTTP 函数 |
| 托管 MCP 调用同样失败 | 同一原因：托管 MCP 用环境级凭证，`invokeFunction` 对事件函数也报 CAM 错误 |
| 解决办法（已验证） | 改用 **HTTP 函数**（`type: "HTTP"` + `scf_bootstrap` 监听 9000），用 `tcb fn invoke <fn> -X POST -d '{...}' --api-key "$CLOUDBASE_API_KEY"` 调用，返回 200 |
| CLI 版本 | 固定 `@cloudbase/cli@3.8.3`，做法正确；升级时先在分支上跑一次 |
| Actions 版本 | 开奖仓库用 `actions/checkout@v4`、`setup-node@v4`，GitHub 已提示 Node 20 弃用；本仓库改用 `@v5` |
| API Key 登录作用域 | API Key 登录按项目目录生效，在另一个目录执行 CLI 前要重新 `tcb login`（开奖仓库已正确处理） |
| 公共仓库 + Secrets | 公共仓库的 fork PR 拿不到 Secrets，部署 job 只在 `main` 运行，安全 |
| 待改进 | 各仓库共用同一把 API Key；建议按仓库分开，便于单独停用 |

## 常用命令

```bash
tcb login --cloudbase-api-key "$CLOUDBASE_API_KEY" -e wenjin-cloudbase-d1empq882391ac1 --yes
tcb fn list -e wenjin-cloudbase-d1empq882391ac1
tcb fn deploy <name> --force --yes                 # 读取当前目录 cloudbaserc.json
tcb fn invoke <http-fn> -X POST -d '{"a":1}' --api-key "$CLOUDBASE_API_KEY"
tcb fn delete <name> -e wenjin-cloudbase-d1empq882391ac1 --yes
```
