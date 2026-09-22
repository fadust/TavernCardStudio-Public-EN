import { registerMvuSchema } from 'https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@69abb272d46bed4057a0dfb31758f6164cb7ecef/dist/util/mvu_zod.js';
import { Schema } from '../schema.ts';

// 把 src/schema.ts 的变量结构注册给 MVU。构建时 schema.ts 由本地 esbuild 内联进这份脚本，
// 运行时不加载本地文件；上面那条外链固定提交，并登记在 project.json 的 dependencies。
// 脚本顺序：先加载 MVU 框架（loader.js），再注册变量结构。
// 注册要尽早：helper 在调用时就订阅事件，所以这里不要先等 Mvu 初始化完成，否则可能错过第一次初始化事件。
$(() => {
  registerMvuSchema(Schema);
});
