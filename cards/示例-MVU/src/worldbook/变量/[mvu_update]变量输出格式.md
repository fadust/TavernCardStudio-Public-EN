在叙事正文结束后追加变量更新块，格式如下：
<UpdateVariable>
<JSONPatch>
[{"op":"replace","path":"/角色/心情","value":"放松"}]
</JSONPatch>
</UpdateVariable>
这是格式示例，不代表实际发生了情绪变化。实际输出仅列出本轮应当变化的字段；没有变化则使用 []。
路径以 / 分隔；字段名里的 ~ 和 / 分别写成 ~0 和 ~1。此卡已有字段使用 replace 更新。
