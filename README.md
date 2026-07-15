# Surge IP Labeler

此项目为 Surge 节点增加出口 IP 情报标签。上游机场订阅与 Sub-Store 聚合保持不变；Sub-Store 负责检测和加工，私有 Worker 负责向 Surge 提供可直接加载的加工结果。

## 推荐设置：Sub-Store 直接加工

1. 在 Surge 使用 Sub-Store 的 [Surge-ability 模块](https://raw.githubusercontent.com/sub-store-org/Sub-Store/master/config/Surge-ability.sgmodule)。它允许 Sub-Store 操作脚本通过指定节点发起出口探测。
2. 在 Sub-Store 为你的集合添加 Script Operator，脚本 URL 为：

   `https://jiahangren.github.io/surge-ip-labeler/substore-ip-labeler.js`

3. 参数可填写 `limit=5`（默认 5 路并发；可设为 1–10）。
4. 为让 Surge 原生节点列表读取加工结果，给脚本 URL 的 `#` 参数加入本地同步配置。示例中的令牌是占位符，不要公开或提交：

   ```text
   https://jiahangren.github.io/surge-ip-labeler/substore-ip-labeler.js#limit=10&sync_url=https%3A%2F%2Fsurge-ip-labeler.jiahangren-surge.workers.dev%2Fv1%2Fsnapshot&sync_token=YOUR_SYNC_TOKEN
   ```

   保存并执行一次即时预览后，脚本会在整轮完成时将加工后的 Surge 节点文本上传到 Worker。只填写 `sync_url` 或只填写 `sync_token` 会明确报错，不会上传部分内容。

5. 仅替换 Surge 需要显示标签的策略组 `policy-path`，使用私有 Worker 输出：

   ```text
   policy-path=https://surge-ip-labeler.jiahangren-surge.workers.dev/v1/subscription?token=YOUR_READ_TOKEN
   ```

   `sub.store/download/...` 是本地 Sub-Store 模块拦截的虚拟地址；浏览器预览可以使用它，但 Surge 的原生外部资源不会执行这段本地拦截脚本。

节点会显示为：`IPLC 香港 01 [203.0.113.8] | 🟢92 | 原生IP | 住宅 | 人类偏多`。同一出口 IP 的 Net.Coffee 结果缓存 24 小时。

## 旧 Worker 方案

旧的 Surge 定时扫描模块不再需要。Worker 只保存已完成的 Sub-Store 快照；应禁用旧的 **Surge IP Labeler** 模块，避免它对 Worker 写入旧结果。

不要把订阅地址、密码、UUID 或令牌提交到仓库、Issues、Actions 日志或公开配置。修改前运行 `npm test`；Pages 工作流也会在部署 `site/` 前运行同一套测试。

## 回滚

1. 从 Sub-Store 集合移除 Script Operator。
2. 继续使用原有 Sub-Store 输出链接并重新加载配置。
3. 若仍保留旧 Worker，轮换曾公开的密钥。
