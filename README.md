# Surge IP Labeler

此项目为 Surge 节点增加出口 IP 情报标签。上游机场订阅与 Sub-Store 聚合保持不变；Sub-Store 负责检测和加工，私有 Worker 负责向 Surge 提供可直接加载的加工结果。

## 推荐设置：Sub-Store 直接加工

1. 在 Surge 使用 Sub-Store 的 [Surge-ability 模块](https://raw.githubusercontent.com/sub-store-org/Sub-Store/master/config/Surge-ability.sgmodule)。它允许 Sub-Store 操作脚本通过指定节点发起出口探测。
2. 在 Sub-Store 为你的集合添加 Script Operator，脚本 URL 为：

   `https://jiahangren.github.io/surge-ip-labeler/substore-ip-labeler.js`

3. 参数可填写 `limit=5`（默认 5 路并发；可设为 1–10）。
4. 为让本机读取加工结果，给脚本 URL 的 `#` 参数加入本地同步配置。示例中的令牌是占位符，不要公开或提交：

   ```text
   https://jiahangren.github.io/surge-ip-labeler/substore-ip-labeler.js#limit=10&sync_url=https%3A%2F%2Fip-labeler.renjiahang1201.xyz%2Fv1%2Fsnapshot&sync_token=YOUR_SYNC_TOKEN
   ```

   保存并执行一次即时预览后，脚本会在整轮完成时将加工后的 Surge 节点文本上传到 Worker。只填写 `sync_url` 或只填写 `sync_token` 会明确报错，不会上传部分内容。

## 推荐加载方式：本机镜像

部分 Surge 环境无法稳定加载 `sub.store/...` 或 `workers.dev/...` 形式的远程 `policy-path`。此时不要把远程地址放进策略组，改用本机文件：脚本会先下载 Worker 快照、用 `surge-cli --check` 验证，再原子替换本地文件；下载或校验失败时旧文件完全保留。

1. 在 Mac 终端执行以下命令。它会提示输入 `READ_TOKEN`，输入过程不会显示内容，也不要把令牌发给任何人：

   ```bash
   security add-generic-password -U -a "$USER" -s surge-ip-labeler-read-token -w
   ```

2. 首次手动生成本地文件（将仓库路径替换成你的实际路径）：

   ```bash
   node "/Users/jeffereyreng/Documents/surge模块/.worktrees/surge-ip-labeler/scripts/sync-local-policy-file.mjs" \
     --output "$HOME/Library/Application Support/Surge/Profiles/ip-labels.conf"
   ```

   成功时只会输出策略数量，不会输出令牌或节点凭据。失败时也不会覆盖已有的 `ip-labels.conf`。

3. 先在当前 Surge 配置的 `[Proxy Group]` 添加一个**不被任何规则引用**的测试组：

   ```ini
   🧪 IP 标签本地测试 = select, policy-path=ip-labels.conf
   ```

   应用配置后打开这个测试组；若能看到完整 IP 和标签，再将原有策略组中的远程
   `policy-path=...` 改为 `policy-path=ip-labels.conf`。相对路径会从当前 Surge 配置文件所在的 `Profiles` 目录读取。

4. 稳定后可用 macOS 的 `launchd` 定期执行同一条同步命令；首次验证前不要自动重载 Surge 配置，以免影响现有网络。

`sub.store/download/...` 是本地 Sub-Store 模块拦截的虚拟地址；浏览器预览可以使用它，但 Surge 的原生外部资源不会执行这段本地拦截脚本。

节点会显示为：`IPLC 香港 01 [203.0.113.8] | 🟢92 | 原生IP | 住宅 | 人类偏多`。同一出口 IP 的 Net.Coffee 结果缓存 24 小时。

## iOS 独立测试

此流程不修改 macOS 的本地镜像、Keychain、`ip-labels.conf` 或任何现有策略组。

1. 在 Worker 项目目录执行 `wrangler secret put IOS_READ_TOKEN`，为 iPhone 创建一个新的随机读取令牌。不要复用 `READ_TOKEN`，也不要把令牌发到聊天、截图或仓库。
2. 在 Surge iOS 通过 URL 安装模块：`https://jiahangren.github.io/surge-ip-labeler/ios-ip-labeler.sgmodule`。
3. 安装时仅填写 `ios_read_token=你的_iOS_读取令牌`，然后应用模块。模块只创建 `🧪 IP 标签 iOS`，不会改动“手动切换”、自动选优或原订阅。
4. 打开 `🧪 IP 标签 iOS` 并更新外部资源，确认节点名称、完整 IP、评分和延迟测试正常。资源每小时只下载一次已完成快照；不会触发新的 IP 扫描。
5. 若要回退，禁用或删除该模块即可。原有 macOS 本地镜像和策略组不受影响。

## 旧 Worker 方案

旧的 Surge 定时扫描模块不再需要。Worker 只保存已完成的 Sub-Store 快照；应禁用旧的 **Surge IP Labeler** 模块，避免它对 Worker 写入旧结果。

不要把订阅地址、密码、UUID 或令牌提交到仓库、Issues、Actions 日志或公开配置。修改前运行 `npm test`；Pages 工作流也会在部署 `site/` 前运行同一套测试。

## 回滚

1. 把策略组恢复成原有的 `policy-path`，或删除测试组。
2. `ip-labels.conf` 是独立本地文件，删除它不会改动上游订阅。
3. 若令牌曾公开，轮换 Worker 密钥并更新 Keychain 项。
