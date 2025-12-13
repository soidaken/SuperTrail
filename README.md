# SuperTrail

高性能 2D 拖尾组件，适用于 Cocos Creator 3.8.x

一个基于 Cocos Creator 3.8.x 的 2D 拖尾组件，使用自定义 assembler 实现，完美和 2D 渲染组件合图合批。

有且只有一种使用方式:

1.  挂在一个空节点上
2.  移动这个节点就可以产生正常拖尾

## 特性

- ✅ **跨平台支持** - Web 和 Native 双平台渲染正常
- ✅ **动态合图** - 支持动态合图，可与其他 Sprite 合批渲染
- ✅ **宽度渐变** - 头部到尾部宽度平滑过渡
- ✅ **透明度渐变** - 头部到尾部透明度平滑过渡
- ✅ **颜色渐变** - 头部到尾部颜色平滑过渡
- ✅ **自动衰减** - 停止移动后拖尾自动消失
- ✅ **零 GC** - 环形缓冲区管理采样点，运行时无内存分配
- ✅ **暂停/恢复** - 支持暂停和恢复采样

## 属性

| 属性          | 类型        | 说明                             |
| ------------- | ----------- | -------------------------------- |
| `spriteFrame` | SpriteFrame | 拖尾纹理                         |
| `maxPoints`   | number      | 最大采样点数（默认 20）          |
| `minDistance` | number      | 采样最小距离（默认 3）           |
| `headWidth`   | number      | 头部宽度                         |
| `tailWidth`   | number      | 尾部宽度                         |
| `headAlpha`   | number      | 头部透明度（0-255）              |
| `tailAlpha`   | number      | 尾部透明度（0-255）              |
| `headColor`   | Color       | 头部颜色                         |
| `tailColor`   | Color       | 尾部颜色                         |
| `fadeTime`    | number      | 自动衰减时间（秒），0 表示不衰减 |

## API

```typescript
const trail = node.getComponent(SuperTrail);

// 暂停采样
trail.pause();

// 恢复采样
trail.resume();

// 清除拖尾
trail.clear();

// 检查是否暂停
trail.isPaused();
```

## 使用方式

1. 将 `SuperTrail.ts` 添加到项目中
2. 在节点上添加 `SuperTrail` 组件
3. 设置纹理和参数
4. 移动节点即可产生拖尾效果

## License

MIT
