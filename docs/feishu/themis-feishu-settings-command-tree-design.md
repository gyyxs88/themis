# 飞书 `/settings` 命令树与统一配置设计

更新日期：2026-03-26

## 背景

当前飞书渠道的配置命令存在两个问题：

- 命令较散，主要依赖平铺的一层命令，缺少类似交互式 CLI 的逐层下钻体验。
- `sandbox / search / network / approval / account use` 当前按会话保存，和 Themis 作为“私人助理中间层”的产品心智不一致。

当前 Themis 的实际定位是：

- `Codex` 是底层执行核。
- `Themis` 是覆盖在 Codex 之上的中间层，负责会话、身份、持久化、运行参数和渠道适配。
- `Web` 与 `飞书` 都只是挂在 Themis 中间层上的使用渠道。

因此，配置不应长期挂在单个飞书会话上，而应归属于 Themis 中间层的统一配置模型。

## 目标

本设计要解决两件事：

1. 把飞书 `/settings` 改造成类似交互式 CLI 的命令树。
2. 把相关运行配置从“会话级”调整为“principal 级的 Themis 长期默认配置”。

## 不做的事

- 不做飞书卡片式配置中心。
- 不做“当前会话临时覆盖”。
- 不要求用户必须逐层输入；深层叶子命令仍可直接输入。

## 核心结论

### 1. `/settings` 采用命令树，而不是平铺帮助

命令语法统一采用空格分段，而不是 `/settings /network` 这种嵌套斜杠形式。

推荐交互：

```text
/help
/settings
/settings network
/settings network on
/settings account
/settings account use
/settings account use 2
```

其中：

- `/help` 只展示第一层命令。
- `/settings` 只展示 `/settings` 下的第一层子项。
- `/settings <子项>` 只展示该节点的当前状态和下一层可选项，不直接修改。
- 只有带最终值的叶子命令才会真正修改配置。

### 2. 相关配置归属于 principal，而不是 session

以下配置项统一归属于当前 `principal` 的 Themis 长期默认配置：

- `sandbox`
- `search`
- `network`
- `approval`
- `account`

这份配置是 Themis 中间层的统一默认配置，Web 与飞书都应读取和写入同一份数据。

### 3. 不再保留“当前会话临时覆盖”

这批配置不再作为会话级设置对外暴露。

会话继续承担的职责应收敛为：

- 历史上下文
- conversation / thread 复用
- 渠道侧当前激活会话指针

不再承担上述运行参数的长期配置职责。

### 4. 修改配置只影响之后新发起的任务

配置更新后的行为语义是：

- 已经在运行中的任务不受影响。
- 之后新发起的任务使用最新配置。
- 新建会话天然使用最新配置。
- 旧会话后续继续下一轮时，也使用最新配置。

也就是说，配置影响的是“未来新发起的 turn”，而不是“已经启动中的任务”。

## 命令树设计

### 顶层帮助

`/help` 只展示顶层命令，不展开子树。

建议返回：

```text
Themis 飞书命令：
/help 查看帮助
/sessions 查看最近会话
/new 新建会话
/use <序号|conversationId> 切换会话
/current 查看当前会话
/settings 查看配置命令树
/link <绑定码> 认领旧 Web 身份
/reset confirm 重置当前 principal
/quota 查看额度
```

这里不展开 `/settings` 的内部子项。

### `/settings` 第一层

`/settings` 返回第一层配置树：

```text
/settings sandbox
/settings search
/settings network
/settings approval
/settings account
```

并附带说明：

- 这些配置归属于当前 principal 的 Themis 长期默认配置。
- 会同时影响 Web 和飞书后续新发起的任务。
- 不会影响已经在运行中的任务。

### `/settings sandbox`

只展示，不修改：

```text
当前值：workspace-write
作用范围：当前 principal 的 Themis 默认配置
可选值：
- read-only
- workspace-write
- danger-full-access
示例：/settings sandbox read-only
```

真正写入时使用：

```text
/settings sandbox <read-only|workspace-write|danger-full-access>
```

### `/settings search`

只展示，不修改：

```text
当前值：live
作用范围：当前 principal 的 Themis 默认配置
可选值：
- disabled
- cached
- live
示例：/settings search cached
```

真正写入时使用：

```text
/settings search <disabled|cached|live>
```

### `/settings network`

只展示，不修改：

```text
当前值：on
作用范围：当前 principal 的 Themis 默认配置
可选值：
- on
- off
示例：/settings network off
```

真正写入时使用：

```text
/settings network <on|off>
```

### `/settings approval`

只展示，不修改：

```text
当前值：never
作用范围：当前 principal 的 Themis 默认配置
可选值：
- never
- on-request
- on-failure
- untrusted
示例：/settings approval on-request
```

真正写入时使用：

```text
/settings approval <never|on-request|on-failure|untrusted>
```

### `/settings account`

作为 `/settings` 子树的一部分，承担默认认证账号相关操作。

建议第二层子命令为：

```text
/settings account current
/settings account list
/settings account use
```

#### `/settings account current`

展示当前 principal 默认使用的账号。

如果未固定账号，则明确显示：

- 当前为“跟随 Themis 系统默认账号”

#### `/settings account list`

列出可用账号，并标记：

- 系统默认账号
- 当前 principal 默认账号

#### `/settings account use`

只展示当前值、可选账号和用法，不直接修改。

真正写入时使用：

```text
/settings account use <账号名|邮箱|序号|default>
```

其中：

- 指定账号名 / 邮箱 / 序号：把当前 principal 默认账号固定到该账号。
- `default`：清除 principal 级固定账号，回退为跟随 Themis 系统默认账号。

## 非法输入与回退规则

命令树不应把所有异常都统一打成“未知命令”，而应尽量回到最近的合法层级。

建议规则：

- `/settings foo`
  - 返回 `/settings` 第一层帮助。
- `/settings network maybe`
  - 返回 `network` 节点当前值、合法可选值和示例。
- `/settings account bar`
  - 返回 `account` 节点下的合法子命令。
- `/settings account use`
  - 返回当前默认账号、可选账号和示例，但不修改。

这样可以保持 CLI 风格的容错和可探索性。

## 数据模型调整

### 当前问题

当前飞书实现把 `sandbox / search / network / approval / account use` 写进 session settings，这意味着：

- 新会话不会自动继承用户刚修改过的配置。
- 同一个 principal 在 Web / 飞书之间难以共享统一默认配置。
- 配置语义更像“某条会话的小开关”，而不是“私人助理的运行默认值”。

### 目标模型

需要新增一份 principal 级默认任务配置，至少覆盖：

- `authAccountId`
- `sandboxMode`
- `webSearchMode`
- `networkAccessEnabled`
- `approvalPolicy`

当前实现已经继续扩展到：

- `model`
- `reasoning`
- `accessMode`
- `thirdPartyProviderId`

其中 `accessMode` 和 `thirdPartyProviderId` 仍未接入飞书 `/settings` 命令树。

### 生效顺序

本次设计完成后，建议任务运行参数的来源顺序收敛为：

1. 当前 principal 的 Themis 长期默认配置。
2. Themis 系统级硬编码兜底默认值。

在本设计范围内，不再保留“会话级覆盖”这一层。

## 兼容策略

不建议一次性硬切现有平铺命令，建议分阶段迁移。

### 阶段一

新增命令树路径：

- `/settings sandbox ...`
- `/settings search ...`
- `/settings network ...`
- `/settings approval ...`
- `/settings account ...`

同时保留旧命令：

- `/sandbox ...`
- `/search ...`
- `/network ...`
- `/approval ...`
- `/account ...`

但旧命令执行成功后要附带提示：

```text
该命令仍可使用，推荐改用：/settings network on
```

### 阶段二

待用户习惯迁移后，再决定是否彻底移除旧平铺命令。

在阶段一中：

- `/help` 只展示顶层命令。
- 不在 `/help` 中展开旧平铺命令，避免继续强化旧入口。
- `/settings` 作为配置入口的主路径。

## 文档与界面同步要求

该设计落地后，需要同步更新：

- `docs/feishu/themis-feishu-channel.md`
- `docs/feishu/README.md`
- Web 侧如果存在同类配置入口，其文案也应与 principal 级统一配置模型保持一致

需要特别避免继续出现这类表述：

- “以上配置只作用于当前会话”
- “新会话默认回到默认值，但不继承用户刚修改的设置”

因为这些都将与新的配置模型冲突。

## 实施建议

建议实现顺序：

1. 先新增 principal 级默认配置的数据模型与读写接口。
2. 把任务请求构建改为读取 principal 级默认配置。
3. 把飞书 `/settings` 改成命令树解析与逐层帮助输出。
4. 保留旧命令作为兼容入口，但内部全部转发到同一套配置写入逻辑。
5. 更新文档和帮助文案。

这样可以先把语义改对，再把交互入口统一起来，避免“命令看起来升级了，但底层还是旧模型”的半成品状态。
