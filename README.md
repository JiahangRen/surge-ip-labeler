# Surge IP Labeler

此项目为 Surge 节点增加出口 IP 情报标签。推荐方式是在 Sub-Store 的节点处理阶段直接运行脚本：不修改原始机场订阅，也不需要 Worker、Token 或额外 `policy-path`。

## 推荐设置：Sub-Store 直接加工

1. 在 Surge 使用 Sub-Store 的 [Surge-ability 模块](https://raw.githubusercontent.com/sub-store-org/Sub-Store/master/config/Surge-ability.sgmodule)。它允许 Sub-Store 操作脚本通过指定节点发起出口探测。
2. 在 Sub-Store 为你的集合添加 Script Operator，脚本 URL 为：

   `https://jiahangren.github.io/surge-ip-labeler/substore-ip-labeler.js`

3. 参数可填写 `limit=5`（默认 5 路并发；可设为 1–10）。
4. 继续使用你原有的 Sub-Store Surge 输出链接，例如 `https://sub.store/download/collection/combo_all?target=Surge`，不要再使用 Worker 的 `/v1/subscription` 地址。

节点会显示为：`IPLC 香港 01 [203.0.113.8] | 🟢92 | 原生IP | 住宅 | 人类偏多`。同一出口 IP 的 Net.Coffee 结果缓存 24 小时。

## 旧 Worker 方案

`module.sgmodule` 和 `worker/` 保留为旧实现的代码记录。若你已采用推荐方案，应禁用 Surge IP Labeler 模块，并从配置删除指向 Worker 的 `policy-path`。

不要把订阅地址、密码、UUID 或令牌提交到仓库、Issues、Actions 日志或公开配置。修改前运行 `npm test`；Pages 工作流也会在部署 `site/` 前运行同一套测试。

## 回滚

1. 从 Sub-Store 集合移除 Script Operator。
2. 继续使用原有 Sub-Store 输出链接并重新加载配置。
3. 若仍保留旧 Worker，轮换曾公开的密钥。
