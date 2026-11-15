# 学习库集合文档与双向同步

本文维护学习库文件组织、迁移及混用版本限制。学习库行为见 [M11](m11-multilingual-local-vault.md)，已知缺陷见[问题跟踪](https://github.com/Kylan3320/peak-distance/issues)。

## 结果与边界

```text
学习库/
  生词本.md
  句子.md
  对话/...
  材料/...
  偏好.md
  .peak-distance/...
```

- 词语、句子各一份 Markdown，记录按稳定 ID 分节；每个会话继续一份 Markdown，材料组织沿用现有实现。
- 记录受管属性写在 YAML 围栏中；“我的笔记”、自定义属性和小节保留。集合有独立格式标识，不能把分隔标记丢失的正文误判成空库。
- 完整词典结果、时间、词形、视频位置保存在共享辅助数据中，另一浏览器读回时不依赖原浏览器私有信息。
- 旧词语／句子散文件合并后重新读取核对，源文件备份在辅助目录。删除源文件前复读校验；外部改动导致冲突时停止归档，保留源和备份。
- 旧句子的稳定 ID 可恢复视频、轨道和起始位置。准确结束位置、标题和完整释义须由保留这些字段的原浏览器写入。

## 混用版本限制

共享同一学习库的浏览器应一起升级。`v0.6.9` 和 `v0.69.1` 的目录格式号均为 `4`，因此目录版本检查无法区分两者。用 `v0.6.9` 的解析器核实，Google 翻译摘录可读，`v0.69.1` 写入的浏览器内置翻译摘录会在读取知识点集合时报格式错误。若库中已有这类摘录，先将仍连接该库的旧端升级至 `v0.69.1` 或更新版本，再同步该库。

## 读取与提交

- 收藏后后台尝试提交；打开生词本和切回该窗口时提交待办并读回共享文件。同步失败时提供重试。实际缺少权限时，在独立设置标签页对原句柄申请读写权限。长期授权由浏览器提供并由用户选择。
- 对话和材料解析兼容 BOM、CRLF 和 CR。读取时统一换行，保留磁盘原文件。内容损坏时报告格式错误，扫描发现的首个格式问题可定位到库内相对路径及原因。
- 事务、待办与共同基准的边界见 [ARCHITECTURE](../ARCHITECTURE.md#多语言与本地学习库边界)，合并规则见 [M11](m11-multilingual-local-vault.md#44-合并与并发)。

## 验证

- `npx tsx tools/m11-vault-format-check.ts`：记录往返、未知内容保留与合并规则；已包含于 `regress`，仅作定向入口，不需重复运行。
- `node tools/vault-sync-check.mjs`：真实 Chrome / Edge 独立 IndexedDB、生产同步与格式代码共用一份磁盘目录；只有目录句柄边界采用适配。覆盖词语／完整释义／视频句子交换、重复同步、不同字段合并、旧快照与新待办竞争、删除提交、并发保存保护、句子笔记、损坏文档和迁移备份。
- `node tools/m11-vault-e2e.mjs`：构建后的真实扩展、原生 OPFS 目录句柄和实际消息路由；验证进入生词本时读回，并检查权限拒绝、格式损坏与错误重试。桌面目录的长期授权需使用真实选目录弹窗，在 Chrome 和 Edge 分别重启后检查收藏是否写入磁盘。

[集合改造的调查与验证记录](https://github.com/Kylan3320/peak-distance/blob/7f53d4803ba915b18c795ba4c1952fe9d065b2aa/docs/specs/vault-collections-sync.md)保留原始证据。迁移复读与删除之间仍有原生 API 无法原子化的间隙。

原生权限约束依据：[Chrome File System Access 文档](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。可写流模式依据：[FileSystemFileHandle.createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)。
