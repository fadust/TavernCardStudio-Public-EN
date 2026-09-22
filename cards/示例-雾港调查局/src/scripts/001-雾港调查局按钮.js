// 雾港调查局助手按钮：只读取当前楼层的 MVU 状态并显示摘要，不写入聊天记录与变量。
// 生命周期：$() 里注册按钮与监听；pagehide 时停止监听；按钮名保持稳定，重复加载靠标记与
// appendInexistentScriptButtons 的幂等性避免越点越多。
$(() => {
  const 标记 = '__雾港调查局按钮已注册';
  if (window[标记]) return;
  window[标记] = true;
  let 已卸载 = false;

  const 委托按钮 = '查看当前委托';
  const 雾况按钮 = '简报雾况';
  const 超时毫秒 = 15000;

  appendInexistentScriptButtons([
    { name: 委托按钮, visible: true },
    { name: 雾况按钮, visible: true },
  ]);

  const 提示 = message => {
    if (typeof toastr !== 'undefined' && typeof toastr.info === 'function') toastr.info(message);
    else console.info('[雾港调查局]', message);
  };

  // 读取前先等 MVU 就绪；waitGlobalInitialized 没有超时，这里补一个，避免按钮点了没反应。
  async function 读取状态() {
    let 计时器;
    try {
      await Promise.race([
        waitGlobalInitialized('Mvu'),
        new Promise((_, reject) => {
          计时器 = setTimeout(() => reject(new Error('MVU 未在 15 秒内就绪，请确认卡内 MVU 脚本已启用且公开依赖可以加载。')), 超时毫秒);
        }),
      ]);
    } finally {
      clearTimeout(计时器);
    }
    return Mvu.getMvuData({ type: 'message', message_id: 'latest' })?.stat_data ?? null;
  }

  async function 显示(处理) {
    try {
      const 状态 = await 读取状态();
      if (已卸载) return;
      if (!状态 || typeof 状态 !== 'object') {
        提示('还没有读到变量状态：让本卡完成一次开场或变量更新后再试。');
        return;
      }
      处理(状态);
    } catch (error) {
      if (已卸载) return;
      提示('读取状态失败：' + (error?.message ?? String(error)));
    }
  }

  const 停止列表 = [
    eventOn(getButtonEvent(委托按钮), () =>
      显示(状态 => {
        const 委托 = 状态.调查局?.委托 ?? {};
        const 行 = [
          `编号：${委托.编号 ?? '未登记'}`,
          `名称：${委托.名称 ?? '未登记'}`,
          `阶段：${委托.阶段 ?? '未登记'}`,
        ];
        const 进展 = 状态.调查局?._进展;
        if (typeof 进展 === 'string' && 进展) 行.push(`线索：${进展}`);
        if (状态.调查员?.权限) 行.push(`权限：${状态.调查员.权限}`);
        提示(行.join('｜'));
      }),
    ),
    eventOn(getButtonEvent(雾况按钮), () =>
      显示(状态 => {
        const 雾港 = 状态.雾港 ?? {};
        const 数值 = Number(雾港.雾况);
        const 行 = [
          `时段：${雾港.时段 ?? '未记录'}`,
          `天气：${雾港.天气 ?? '未记录'}`,
        ];
        if (Number.isFinite(数值)) {
          const 程度 = 数值 >= 80 ? '港区夜间停工' : 数值 >= 55 ? '浓雾' : 数值 >= 30 ? '中雾' : '薄雾';
          行.push(`雾况：${数值}（${程度}）`);
        } else {
          行.push('雾况：未记录');
        }
        提示(行.join('｜'));
      }),
    ),
  ];

  window.addEventListener(
    'pagehide',
    () => {
      已卸载 = true;
      for (const 停止 of 停止列表) 停止?.stop?.();
      window[标记] = false;
    },
    { once: true },
  );
});
