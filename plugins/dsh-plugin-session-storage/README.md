# 会话级插件存储

`amibaSessionStorage` 为插件提供会话目录内的官方 DSH domain 存储。它不管理任务，也不写入或修改会话事件日志。

```text
<官方定位的会话目录>/
  session.jsonl.zstd
  plugins/<namespace>/<domain.name>.json
```

插件声明固定的命名空间和官方 `defineDomain` schema，然后调用：

```ts
const spec = defineDomain({
  name: "records", version: 1,
  tables: { items: domainTable<string, Item>(itemSchema) },
});
const domain = await ctx.amibaSessionStorage.open(sessionId, "my-plugin", spec);
await domain.table("items").put(itemId, item);
```

插件声明 `inject: ["amibaSessionStorage"]`，每个会话/domain 打开一次并复用 handle。命名空间必须是固定的、小写字母开头的字母/数字/连字符字符串，由拥有数据的插件维护。多个插件不要占用同一命名空间。数据结构和版本由插件负责，应用层负责挂载服务与选择布局。

底层直接复用官方 `Storage`、`JsonStorageBackend`、`DomainFacility`：schema 校验、串行写入、fsync 和原子替换由官方实现。这里仅负责 session/plugin 范围及生命周期。目录由 `sessionPersistence.locate(header)` 返回，绝不从客户端传入的 sessionId 拼接路径。读取冷会话先通过官方 inspect 验证会话存在；地址不是授权凭据，本服务是受信插件的内部 API，不对外开放文件路径或跨会话权限。

当前支持 JSONL 会话后端和 JSON domain 文件；没有独立会话目录的后端（如会话 SQLite）会明确拒绝，不能把数据库所在目录当成所有会话的目录。更换布局/介质应通过本服务扩展，业务插件不自行读写文件。不提供旧数据迁移，也不推测旧内存状态。

应用卸载时等待已打开 domain 的写入完成，再关闭官方存储后端。JSON 后端沿用官方单写进程约束。命名空间内的文件随会话目录一起备份，但此服务不新增会话删除或复制逻辑。
