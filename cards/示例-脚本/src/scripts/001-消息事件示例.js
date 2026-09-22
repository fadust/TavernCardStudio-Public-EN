// 只观察事件，不修改聊天记录。按需求替换此处的处理逻辑。
$(() => {
  const listener = eventOn(tavern_events.MESSAGE_RECEIVED, messageId => {
    console.debug('[角色卡脚本] 收到消息', messageId);
  });
  window.addEventListener('pagehide', () => listener.stop(), { once: true });
});
