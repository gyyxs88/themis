# Themis Principal 级 Plugins 管理 V2 设计

## 背景

截至 `2026-04-11`，Themis 已完成 `plugins` 管理第一版：

- 直接复用 app-server 原生 `plugin/list|read|install|uninstall`
- Web / 飞书都能查看、安装、卸载
- repo marketplace 会优先按当前 session `workspacePath` 发现

但第一版的产品边界是“当前 Codex 运行环境的 plugin 视图”，不是 `principal` 级长期资产。

这和当前已经明确的 Themis 定位冲突：

- Themis 是专属于某个单独人类主人的个人助理
- Themis 是只听命于主人的硅基合伙人
- 宿主机器默认属于 Themis 本体，不应把长期拥有权继续外包给“当前环境”

因此，下一版不应继续停留在环境级视图，而应把 `plugins` 升级为 `principal` 级资产。

## 目标

- 让 `plugins` 的拥有权归属于 `principal`，而不是当前运行环境
- 保留当前环境 / 工作区 / runtime 的发现与可用状态，但把它降成“运行事实”
- 让 Web / 飞书形成统一心智：主人拥有一组 plugins，不会因切工作区或切认证账号而失去拥有权
- 为后续 `plugin app`、`app/*` 入口以及更完整的插件生态治理留出稳定底座

## 当前进度

截至 `2026-04-11`，V2 首刀已经落地：

- SQLite 已新增 `themis_principal_plugins` 与 `themis_principal_plugin_materializations`
- `PrincipalPluginsService` 已接管 principal 级 `list / read / install / uninstall`
- HTTP `/api/plugins/*` 已切到 principal 语义
- Web `plugins` 面板已改成“当前 principal 已拥有 + 当前环境发现”的双层视图
- 飞书 `/plugins` 已切到 principal 语义，并补齐“已拥有 / 当前状态 / 当前环境发现”的文本表达

同日第二刀也已落地：

- 新增 HTTP `/api/plugins/sync`
- Web 已补“同步到当前环境”动作，并复用 principal 语义刷新
- 飞书已补 `/plugins sync [remote]`
- `PrincipalPluginsService` 现在会把“已拥有但当前 runtime 缺失 / 待认证 / 失败”变成显式可治理状态，而不再只是被动展示
- `read` 在当前 runtime 无法解析时，已能回退到 principal 已保存定义，不会把“当前工作区不可用”直接等同于“详情不可读”
- Web / 飞书 现在都会补充展示 plugin 来源与最近问题，repo-local / 宿主机本地 / marketplace 的边界更清楚
- 服务层已进一步派生 `sourceScope + repairAction + repairHint`，能区分“当前工作区 / 其他工作区 / 宿主机本地 / 可跨工作区复用”这些来源边界，并给出更接近操作层的修复建议

V2 第一阶段现已完成并收口；如果后续继续平台化，候选重点主要是：

- 更完整的 source 分层、失败修复与更深的 sync 治理
- `plugin app` / `app/*` 的后续扩面

## 非目标

- 不在这一版直接把所有 Codex 原生 `plugin/*` / `app/*` 协议都完整产品化
- 不在这一版引入多租户、多主人共享一套宿主机的复杂权限系统
- 不在这一版把插件上传、发布、审核、跨实例分发一起做完
- 不把 repo-local plugin 的工作区限制抹平；“归属”升级为 `principal`，不等于“任何工作区都必然可运行”

## 产品判断

新的判断是：

- `plugins` 属于主人本人，也就是 `principal`
- 当前账号、当前工作区、当前 runtime 只决定“它现在能不能运行”
- 宿主机既然属于 Themis，本机安装或已接入的 plugin 来源，不应继续只表现成环境级偶然事实

对应一句话：

- `principal` 决定“我拥有什么”
- runtime / workspace 决定“我现在能不能用”

## 第一版为什么不够

第一版的主要问题不是“功能没接通”，而是归属模型不对：

1. 工作区漂移
   - 同一主人换一个工作区，plugin 列表就可能变化
   - 当前 UI 容易把“当前没发现到”误解成“我没有这个 plugin”
2. 账号漂移
   - 当前 install / uninstall 走的是当前 active auth/runtime
   - 用户难以判断这是“长期拥有权变化”还是“当前环境变化”
3. 文案漂移
   - Web 和飞书现在都在讲“当前环境 plugins”
   - 这和 Themis 作为主人长期助理的心智不一致

## V2 总体方案

### 三层模型

V2 把 `plugins` 拆成三层：

1. `principal plugin record`
   - 当前主人拥有的 plugin 主记录
   - 是长期拥有权来源
2. `plugin source / materialization`
   - plugin 是从哪里来的
   - 以及要如何物化到某个 runtime 环境
3. `runtime state`
   - 当前 runtime / 工作区 / 账号下的可用状态
   - 包括是否已安装、是否启用、是否需要认证、最近错误

### 设计原则

- 不再把 `plugin/list` 直接当产品主事实
- 先读 Themis 自己的 `principal` 主记录，再叠加 runtime 状态
- 继续允许“主人已拥有，但当前工作区不可用”
- repo-local plugin 必须保留工作区约束，但不再承担拥有权来源

## 数据模型建议

### 表一：`themis_principal_plugins`

建议最少字段：

- `principal_id`
- `plugin_id`
- `plugin_name`
- `display_name`
- `source_type`
  - `marketplace`
  - `repo-local`
  - `home-local`
  - `unknown`
- `source_ref_json`
  - 记录 marketplace path、repo path、workspace 线索、原始 plugin id 等
- `install_policy`
- `auth_policy`
- `enabled`
- `ownership_status`
  - `owned`
  - `removed`
  - `orphaned`
- `created_at`
- `updated_at`
- `last_error`

### 表二：`themis_principal_plugin_materializations`

记录 runtime 侧物化与状态：

- `principal_id`
- `plugin_id`
- `target_kind`
  - 第一版建议先固定为 `auth-account`
- `target_id`
- `workspace_fingerprint`
  - 用来区分 repo-local plugin 是否依赖特定工作区
- `state`
  - `installed`
  - `available`
  - `missing`
  - `auth_required`
  - `failed`
- `last_synced_at`
- `last_error`

### 可选表三：`themis_principal_plugin_sources`

如果后续 source 需要单独扩展，可拆独立表；否则首刀可以先把 source 信息塞进主表 `source_ref_json`。

## 关键边界

### 1. repo-local plugin

repo-local plugin 不能因为升级到 `principal` 级，就假装已经脱离工作区。

正确表达应是：

- 主人拥有这条 plugin 记录
- 这条记录的 source 指向某个 repo / marketplace
- 当前会话如果绑定了能解析到该 plugin 的工作区，则显示“当前可用”
- 如果当前工作区解析不到，则显示“已拥有，但当前工作区不可用”

### 2. curated / home marketplace plugin

这类更接近宿主机长期资产：

- 可以默认视为 `principal` 长期拥有的稳定来源
- 更适合在 V2 首刀优先接入完整持久化

### 3. 认证账号

认证账号不再承担 plugin 拥有权来源，只承担：

- 当前安装动作落在哪个 runtime
- 当前状态是否可用
- 是否需要 OAuth / app auth

## HTTP / Web / 飞书 口径调整

### HTTP

当前：

- `/api/plugins/list|read|install|uninstall`

V2 建议：

- 保留现有接口，但返回结构改成：
  - `principalPlugins`
  - `runtimeState`
  - `marketplaceCandidates`
- 或者新增：
  - `/api/principal/plugins/list`
  - `/api/principal/plugins/read`
  - `/api/principal/plugins/install`
  - `/api/principal/plugins/remove`
  - `/api/principal/plugins/sync`

首刀更建议新增 `principal` 语义接口，避免把旧环境级接口越改越绕。

### Web

当前文案：

- “当前 Codex 运行环境可见的 plugin marketplaces”

V2 应改成：

- “当前 principal 的 plugins”
- 列表主视图先展示主人已拥有的 plugins
- 再展示当前工作区 / runtime 的状态标签

建议最少补这几种状态：

- 已拥有，当前可用
- 已拥有，当前工作区不可用
- 已拥有，需要认证
- 已拥有，当前 runtime 安装失败
- 当前环境发现到但尚未纳入 principal

### 飞书

当前：

- `/plugins list|read|install|uninstall`

V2 应改成：

- `/plugins` 默认返回当前 principal 已拥有项
- 对 repo-local plugin 明确提示“当前工作区不可用”
- `install` 的语义从“装到当前环境”改成“纳入当前 principal，并尝试物化到当前 runtime”

## 迁移策略

### 阶段 A：补主记录，不改现有入口

- 新增 SQLite 主表与 materialization 表
- install / uninstall 先双写：
  - 继续走现有环境级协议
  - 同时写入 `principal` 主记录
- list 先只做内部对账，不改前端

### 阶段 B：Web / 飞书切主视图

- Web `Plugins` 面板切到 `principal` 主记录
- 飞书 `/plugins` 切到 `principal` 主记录
- 旧环境级返回只保留为调试/诊断层

### 阶段 C：补 runtime 同步与异常修复

- 已完成第一刀：
  - 已新增 `sync`
  - 已把“已拥有但当前 runtime 缺失”变成显式可治理状态
- 后续再补：
  - 更细的 source 分层
  - 失败原因展示与重试
  - 更自动化的补同步策略

## 首刀建议顺序

1. 先补决策与设计文档，统一产品口径
2. 先加 SQLite `principal plugin` 主记录
3. 让 install / uninstall 双写
4. 再把 Web 主列表从 environment-level 切到 principal-level
5. 最后再补更深的 runtime 状态治理

## 风险

- repo-local plugin 的来源如果只依赖瞬时 `workspacePath`，迁移时可能出现历史记录不完整
- 当前 app-server 原生返回可能不足以直接支撑完整 `principal` 模型，需要 Themis 自己补 source 归一化
- 如果一步到位把旧接口全改掉，容易把现有环境级功能一起打断

## 结论

`plugins` 的下一步不该是继续往“环境级列表更好看”上打补丁，而应先完成归属模型纠偏：

- 让 `plugins` 成为 `principal` 长期资产
- 让环境 / 工作区 / runtime 退回“状态层”
- 再在这个底座上继续做后续治理
