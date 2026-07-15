# Surge IP Labeler 交接文档

> 面向完全没有上下文的新会话。本文描述截至 **2026-07-16** 的实际状态；不包含订阅链接、代理凭据或令牌。

## 1. 任务是什么

用户希望在 Surge macOS 的节点选择与延迟测试列表中直接看到每个节点的真实出口 IP 和 IP 情报，以便选择节点。显示格式类似：

```text
IPLC 香港 01 [118.140.56.81] | 🟢100 | 原生IP | 住宅 | 人类偏多 | GPT评分:68
```

约束：

- 原始机场订阅与 Sub-Store 聚合不能被改写；
- 只加工节点名称，不能改变节点协议、服务器、端口、密码或其他连接参数；
- 显示完整 IP；评分颜色为 `🟢 80–100`、`🟡 50–79`、`🔴 0–49`；
- 没有可靠数据时隐藏“原生/住宅/人类”字段，绝不虚构 Bot 百分比；
- GPT 分数必须来自 ChatGPT 实际看到的出口，而不是普通 IP 查询或其他置信度字段；
- 当前交付范围仅为 **Surge macOS**。iOS 尝试已完整撤销，见“绝对不要再踩”。

## 2. 已完成内容

### 核心实现

1. **Sub-Store Script Operator** 已实现并公开发布：
   `https://jiahangren.github.io/surge-ip-labeler/substore-ip-labeler.js`
   - 通过每个节点的 Surge descriptor 请求 IP 回显，获得真实出口 IP；
   - 查询 Net.Coffee 的普通 IP 情报；
   - 通过 `chatgpt.com/cdn-cgi/trace` 经该节点获取 ChatGPT 可见出口，再查询 Net.Coffee `iprisk` 的 `trust_score` 作为 GPT 分数；
   - 24 小时缓存普通 IP 情报和 GPT 可见出口的风险结果；
   - 默认并发 `5`，可用 `#limit=1` 至 `#limit=10` 调整；
   - 每轮完成后可选上传一份完整的 Surge 节点快照。

2. **标签格式化** 已实现：
   - 完整出口 IP、普通 IP 评分、原生/广播/非原生、住宅/机房/非住宅、历史滥用、人机流量、GPT 评分；
   - 只有数据源明确返回时才显示相应类别；
   - 保留原代理定义，仅替换等号左侧名称；名称中的换行和 `=` 会安全转义。

3. **私有 Cloudflare Worker + KV** 已部署：
   - 自定义域名：`https://ip-labeler.renjiahang1201.xyz`
   - `POST /v1/snapshot`：仅 `SYNC_TOKEN` 可上传完整快照；
   - `GET /v1/subscription?token=...`：仅 `READ_TOKEN` 可读取快照；
   - `GET /v1/status`：仅返回更新时间、节点数、失败数，不暴露节点内容或令牌；
   - 当前 Worker 版本曾验证为 `92e7b2b9-3853-41e3-915b-5bf02b535684`（以后部署会变化）。

4. **macOS 本地镜像** 已完成并已启用：
   - 镜像脚本从 Keychain 读取 `READ_TOKEN`；
   - 下载 Worker 快照后用 `surge-cli --check` 校验；
   - 仅校验成功才原子替换 `ip-labels.conf`；失败时旧文件保留；
   - 随后只更新本地外部资源，不重载整份 Surge 配置。

5. **macOS 定时自动化** 已落地：
   - Sub-Store 模块的既有同步：23:55；
   - 新增 Sub-Store 同步：11:55；
   - LaunchAgent 镜像：00:20、12:20；
   - 即扫描完成后约 25 分钟把最新已完成快照写入 Surge 本地节点列表。

6. **发布与测试**：
   - 仓库：`https://github.com/JiahangRen/surge-ip-labeler`
   - GitHub Pages：`https://jiahangren.github.io/surge-ip-labeler/`
   - Pages 工作流只监听 `main`；
   - 当前主线提交：`5bcef8c`（撤销 iOS 功能后）；
   - 最近一次回退后本地全量测试：`41/41` 通过；Pages 回退工作流也已成功。

## 3. 当前实际运行状态

### Surge 配置中已存在的相关项

活跃配置文件：

```text
/Users/jeffereyreng/Library/Application Support/Surge/Profiles/surge-config-optimized.conf
```

其中已验证存在：

```ini
🧪 IP 标签本地测试 = select, policy-path=ip-labels.conf
🔄 手动切换 = select, racknerd-trojan, policy-path=ip-labels.conf
🔄 手动切换2 = select, racknerd-trojan, policy-path=ip-labels.conf
Sub-Store IP Labeler Midday Sync = type=cron,cronexp=55 11 * * *,wake-system=1,timeout=900,script-path=https://github.com/sub-store-org/Sub-Store/releases/latest/download/cron-sync-artifacts.min.js
```

模块仍提供每日 23:55 的 Sub-Store 同步，因此合计为约每 12 小时一次。

### 本地镜像文件与自动化

```text
输出文件：/Users/jeffereyreng/Library/Application Support/Surge/Profiles/ip-labels.conf
包装脚本：/Users/jeffereyreng/Library/Application Support/Surge/Scripts/sync-ip-labels.sh
LaunchAgent：/Users/jeffereyreng/Library/LaunchAgents/com.jiahangren.surge-ip-labeler.plist
标准输出：/Users/jeffereyreng/Library/Logs/Surge/ip-labeler-sync.log
错误输出：/Users/jeffereyreng/Library/Logs/Surge/ip-labeler-sync-error.log
```

LaunchAgent 在加载时立即执行，并在每天 00:20、12:20 运行。其本地外部资源键是：

```text
d8d090b2170f2ddcd948ea6f2721a0cd
```

### 重要维护风险（当前未阻塞）

包装脚本目前引用：

```text
/Users/jeffereyreng/Documents/surge模块/.worktrees/surge-ip-labeler/scripts/sync-local-policy-file.mjs
```

该 worktree 现在仍存在，所以运行正常；**不要删除该 worktree**。若未来要清理 worktree，应先把包装脚本改为当前主仓库路径：

```text
/Users/jeffereyreng/Documents/surge模块/scripts/sync-local-policy-file.mjs
```

改动前必须运行 `surge-cli --check`，并手动执行一次包装脚本确认成功。

## 4. 当前卡点与下一步

没有已知的 macOS 功能阻塞。项目当前处于可使用状态。

建议的新会话按这个顺序继续：

1. 先读取本文件和 `PROJECT_SUMMARY.md`，不要重建架构；
2. 在 Surge 外部资源中确认 `ip-labels.conf` 状态为“就绪”；
3. 查看 `/v1/status` 的 `updatedAt`、`nodeCount`、`failedCount`，但不要把带令牌的订阅 URL 发到聊天；
4. 若名称没有更新，先查看两个本地日志，再手动运行包装脚本；
5. 只有在本地镜像通过后，才考虑调整任何正式策略组；
6. 若更换机场服务商但仍使用同一 Sub-Store 集合，保留 Script Operator，下一轮扫描会处理新节点；若新建集合，则把同一个 Operator 重新添加到新集合。

## 5. 绝对不要再踩的坑

1. **不要把 `sub.store/download/...` 直接作为 Surge 原生 `policy-path`。** 浏览器/Sub-Store 预览可正确显示，但 Surge 原生外部资源不能执行 Sub-Store 的本地拦截逻辑，曾出现解析失败或超时。
2. **不要把 Worker 远程订阅直接替换现有正式策略组。** 此环境出现过远程 `policy-path` 的 404、超时和格式加载问题。当前稳定方案是 Worker → Mac 本地镜像 → `policy-path=ip-labels.conf`。
3. **不要在失败时覆盖 `ip-labels.conf`。** 必须保持“下载 → 解析 → `surge-cli --check` → 原子替换”的顺序，否则一次网络故障会让节点列表或网络不可用。
4. **不要把令牌、订阅 URL、节点行或 curl 完整错误输出贴到聊天、日志或仓库。** curl 参数可能包含 `READ_TOKEN`。项目已将下载错误处理为通用错误，后续改动不要恢复详细 URL 输出。
5. **不要把 Net.Coffee `ai_verdict.confidence` 当成 GPT 分数。** 它曾导致几乎全为 99 的错误显示。GPT 分数只能来自：节点访问 `chatgpt.com/cdn-cgi/trace` 得到的 ChatGPT 可见出口，再查询 `/api/iprisk/<IP>` 的 `trust_score`。
6. **不要为未知字段强行显示“原生未知/住宅未知/人类未知”。** 当前规范是：普通评分无数据时显示“评分未知”；类别字段无可靠数据则隐藏。
7. **不要重新启用或重新开发 iOS 专用模块/端点，除非用户重新明确授权并重新评审架构。** iOS 功能已在提交 `5bcef8c` 完整撤销：模块文件删除、`/v1/ios-policy` 返回 404、`IOS_READ_TOKEN` 已删除。iOS 上若遗留模块，应禁用或删除。
8. **GitHub Pages 只监听 `main`。** 仅推送特性分支或 `master` 不会更新 Pages，曾直接造成模块 URL 404。发布静态文件前必须确认变更进入 `main` 并检查 Pages 工作流。
9. **不要删除 `.worktrees/surge-ip-labeler`，直到先迁移本地包装脚本路径。** 这会中断自动镜像，而不是只影响开发。
10. **不要将原订阅替换成加工订阅。** 加工结果是用于选择节点的独立本地策略资源；原始订阅仍是连接信息的来源与回退路径。

## 6. 常用安全检查命令

以下命令不应输出令牌。执行前后不要把终端中可能含敏感信息的行完整截图公开。

```bash
# 项目测试
cd "/Users/jeffereyreng/Documents/surge模块"
npm test

# 查看 Worker 的无敏感状态
curl --noproxy '*' --silent --show-error \
  https://ip-labeler.renjiahang1201.xyz/v1/status

# 查看本地镜像最近日志
tail -n 30 "/Users/jeffereyreng/Library/Logs/Surge/ip-labeler-sync.log"
tail -n 30 "/Users/jeffereyreng/Library/Logs/Surge/ip-labeler-sync-error.log"

# 手动运行本地镜像（会从 Keychain 读取令牌）
"/Users/jeffereyreng/Library/Application Support/Surge/Scripts/sync-ip-labels.sh"
```

## 7. 关键文件速查

| 位置 | 用途 |
| --- | --- |
| `site/substore-ip-labeler.js` | 实际给 Sub-Store 使用的公开、无 import 的 Operator 脚本 |
| `src/substore/ip-labeler.js` | 可单元测试的 Operator 源逻辑 |
| `src/shared/policy.js` | 标签字段和显示规则 |
| `worker/src/index.js` | Worker 的上传、私有订阅、状态端点 |
| `scripts/sync-local-policy-file.mjs` | macOS 本地镜像命令行入口 |
| `src/local/*` | 下载、Keychain 账户选择、校验与原子写入 |
| `worker/wrangler.toml` | Worker KV 绑定和自定义域名配置；不含密钥 |
| `README.md` | 精简使用说明 |
| `PROJECT_SUMMARY.md` | 完整项目说明、重部署教程与复盘 |

