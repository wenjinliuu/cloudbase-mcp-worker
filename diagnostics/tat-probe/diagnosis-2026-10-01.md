# TAT 专属 SSE 地址连接诊断

检查时间：2026-10-01 02:20–02:28（北京时间）。

## 实测结果

在同一个临时 Cloudflare Worker 中并发请求腾讯 MCP 域名首页、一个无效 SSE 地址、用户专属 SSE 地址。用户专属地址保存在 secret_text 绑定中，不写入源码和报告。

| 请求 | 第一轮：默认请求头 | 第二轮：专属 SSE 增加明确 User-Agent |
| --- | --- | --- |
| 域名首页 | HTTP 404，760 ms | HTTP 404，1177 ms |
| 无效 SSE 地址 | HTTP 404，743 ms | HTTP 404，1203 ms |
| 专属 SSE 地址 | 45000 ms 超时，无响应头 | 20001 ms 超时，无响应头 |

上述 404 是控制请求的预期结果：无首页、无效路由，证明该域名能从此 Worker 返回 HTTP 响应。测试 Worker 自身请求均为 HTTP 200。

## 能确定的结论

- 此测试路径能够访问腾讯 MCP 域名，不能把故障统称为 CF 无法访问腾讯云。
- 用户专属 SSE 连接在 HTTP 响应头阶段等待；尚未获得 SSE endpoint 事件，也未发送 initialize、tools/list 或任何 tools/call。
- 延长等待至 45 秒仍未获得响应；增加明确 User-Agent 的另一轮仍超时。
- 故障范围优先缩小至该专属路由和它后面的托管会话/服务。无法仅凭这些请求确定会话失效、服务启动失败、特定路由访问策略等具体原因。
- 腾讯体验馆能显示服务名称和示例问题，不能单独证明专属地址成功握手。

## 源码核对

官方 TAT 页面链接项目 https://github.com/jubaoliang/mcp-server-tat 。读取 master/src/mcp_server_tat/server.py：

- 使用 Python MCP Server 与 stdio transport。
- 暴露 SyncRunCommand、RunCommand、QueryTask 三个工具。
- list_tools 返回静态定义，不调用 TAT API。
- 工具执行时才创建 Tencent Cloud SDK 客户端并调用 tat.tencentcloudapi.com。
- 源码不包含 MCP 广场 SSE 托管外层的部署实现。因此不能通过此仓库定位外层专属 URL 的后台日志。

这表明本次连接失败尚未到服务器上执行命令这一步。未验证腾讯托管端当前部署是否与 master 完全相同，不据此断言密钥配置肯定正确。

## 下一步

用户在已经登录的官方 TAT 页面重新点击连接 Server，使用原有 CAM 凭据取得最新连接结果；比较地址是否变化，并用同一组控制请求检查最新地址。

该页面属于用户的腾讯登录会话，Cloudflare 账户连接器没有此页面的登录权限。当前无法代替用户生成新的腾讯托管地址，也无法读取其托管实例内部日志。

如果新连接仍在响应头阶段卡住，应向托管平台提供诊断结果，或者用项目源码建设自管 MCP HTTP 服务。不要直接把 stdio Python 程序当作 CF HTTP Worker 上传。

## 清理

临时 Worker wardrobe-tat-probe 已删除。未执行服务器命令，未修改 CloudBase 网关、AI 衣柜应用、部署工作流或 CAM 密钥。
