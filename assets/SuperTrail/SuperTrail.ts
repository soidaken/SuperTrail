import {
  _decorator,
  CCInteger,
  CCFloat,
  Vec3,
  IAssembler,
  IAssemblerManager,
  RenderData,
  IRenderData,
  UIRenderer,
  SpriteFrame,
  v3,
  macro,
  DynamicAtlasManager,
  Color,
  Mat4,
  Enum,
} from 'cc';
import { JSB, MINIGAME } from 'cc/env';

const { ccclass, property, menu, help } = _decorator;

if (JSB || MINIGAME) {
  macro.CLEANUP_IMAGE_CACHE = false;
  DynamicAtlasManager.instance.enabled = true;
  console.log(`SuperTrail 在JSB 和 MINIGAME 环境下默认开启了[动态合图],如果你不需要,可以手动屏蔽.`);
}

const _fastInvSqrtBuffer = new ArrayBuffer(4);
const _fastInvSqrtF32 = new Float32Array(_fastInvSqrtBuffer);
const _fastInvSqrtI32 = new Int32Array(_fastInvSqrtBuffer);

function fastInvSqrt(x: number): number {
  const half = 0.5 * x;
  _fastInvSqrtF32[0] = x;
  _fastInvSqrtI32[0] = 0x5f3759df - (_fastInvSqrtI32[0] >> 1);
  let y = _fastInvSqrtF32[0];
  y = y * (1.5 - half * y * y);
  return y;
}

/**
 * 拖尾坐标模式
 */
enum TrailCoordinateMode {
  /** 世界坐标模式：拖尾直接在世界坐标系渲染，不受父节点旋转/缩放影响，性能更好 */
  World = 0,
  /** 局部坐标模式：拖尾跟随节点变换，正确响应父节点的旋转和缩放 */
  Local = 1,
}

@ccclass
@menu('SuperTrail')
@help('https://github.com/soidaken/SuperTrail')
export class SuperTrail extends UIRenderer {
  // 添加缓存变量
  private _uvMin: number = 0;
  private _uvMax: number = 1;
  private _vMin: number = 0;
  private _vMax: number = 1;
  private _uvAreaH: number = 1;
  private _uvDirty: boolean = true;

  @property(SpriteFrame)
  private _spriteFrame: SpriteFrame = null!;
  @property({
    type: SpriteFrame,
    tooltip: '拖尾纹理',
    displayName: '纹理文件',
  })
  get spriteFrame(): SpriteFrame {
    return this._spriteFrame;
  }

  set spriteFrame(value: SpriteFrame) {
    if (this._spriteFrame === value) return;
    this._spriteFrame = value;
    if (this.renderData) this.renderData.textureDirty = true;

    if (this._spriteFrame) {
      DynamicAtlasManager.instance.packToDynamicAtlas(this, this._spriteFrame);
    }
    this._uvDirty = true;
    this.markForUpdateRenderData();
  }

  @property({
    type: Enum(TrailCoordinateMode),
    tooltip: '坐标模式：<br>World - 世界坐标，不受父节点旋转/缩放影响，性能更好<br>Local - 局部坐标，正确响应父节点变换',
    displayName: '坐标模式',
  })
  public coordinateMode: TrailCoordinateMode = TrailCoordinateMode.World;

  @property({
    tooltip: '是否使用快速平方根计算（fastInvSqrt），提高性能(1000个拖尾10%提升),精度低一点但视觉效果基本不变',
    displayName: '是否使用快速平方根',
  })
  public useFastSqrt = true;

  @property({
    type: CCInteger,
    min: 4,
    tooltip: '最多保留多少个采样点,和采样距离共同决定拖尾的长度',
    displayName: '最大采样点数',
  })
  public maxPoints = 20;

  @property({
    type: CCFloat,
    min: 0.1,
    tooltip: '两次采样点的最小距离,和最大采样点数共同决定拖尾的长度',
    displayName: '最小采样距离',
  })
  public minDistance = 3;

  @property({
    type: CCFloat,
    min: 0,
    tooltip: '头部宽度（最新点）',
    displayName: '头部宽度',
  })
  public headWidth = 32;

  @property({
    type: CCFloat,
    min: 0,
    tooltip: '尾部宽度（最旧点）',
    displayName: '尾部宽度',
  })
  public tailWidth = 0;

  @property({
    type: CCInteger,
    min: 0,
    max: 255,
    tooltip: '头部透明度（最新点）',
    displayName: '头部透明度',
  })
  public headAlpha = 255;

  @property({
    type: CCInteger,
    min: 0,
    max: 255,
    tooltip: '尾部透明度（最旧点）',
    displayName: '尾部透明度',
  })
  public tailAlpha = 0;

  @property({
    type: CCFloat,
    min: 0,
    tooltip: '停止移动后拖尾完全消失所需时间（秒），0表示不自动衰减',
    displayName: '衰减时间',
  })
  public fadeTime = 0.1;

  @property({
    type: Color,
    tooltip: '头部颜色（最新点）',
    displayName: '头部颜色',
  })
  public headColor: Color = new Color(255, 255, 255, 255);

  @property({
    type: Color,
    tooltip: '尾部颜色（最旧点）',
    displayName: '尾部颜色',
  })
  public tailColor: Color = new Color(255, 255, 255, 255);

  // 是否暂停采样
  private _paused: boolean = false;

  // 计算后的渲染数据
  private _positions: number[] = [];
  private _uvs: number[] = [];
  private _indices: number[] = [];
  private _alphas: number[] = [];
  // 存储每个顶点的颜色
  private _colors: number[] = []; // [r, g, b, r, g, b, ...]
  // 上一帧是否有新增点（用于判断是否停止移动）
  private _hasNewPoint: boolean = false;
  // 衰减累积器（支持小数累积）
  private _fadeAccum: number = 0;

  // 环形缓冲区：预分配的点对象池
  private _pointPool: Vec3[] = [];
  // 环形缓冲区：头部索引（最旧的点）
  private _pointHead: number = 0;
  // 环形缓冲区：当前有效点数量
  private _pointCount: number = 0;

  get positions(): number[] {
    return this._positions;
  }
  get uvs(): number[] {
    return this._uvs;
  }
  get indices(): number[] {
    return this._indices;
  }
  get alphas(): number[] {
    return this._alphas;
  }
  get colors(): number[] {
    return this._colors;
  }
  public __preload(): void {
    super.__preload();
  }

  public onLoad(): void {
    super.onLoad();
    // 预分配点对象池
    this._initPointPool();
    if (this._spriteFrame) {
      DynamicAtlasManager.instance.packToDynamicAtlas(this, this._spriteFrame);
    }
  }

  private _initPointPool(): void {
    const poolSize = this.maxPoints;
    // 确保对象池大小足够
    while (this._pointPool.length < poolSize) {
      this._pointPool.push(v3());
    }
    this._pointHead = 0;
    this._pointCount = 0;
  }

  private _addPoint(x: number, y: number, z: number): void {
    if (this._pointCount < this.maxPoints) {
      // 还没填满，直接在末尾添加
      const idx = (this._pointHead + this._pointCount) % this.maxPoints;
      this._pointPool[idx].set(x, y, z);
      this._pointCount++;
    } else {
      // 已满，覆盖最旧的点（头部），头部后移
      this._pointPool[this._pointHead].set(x, y, z);
      this._pointHead = (this._pointHead + 1) % this.maxPoints;
    }
  }

  private _removeOldestPoint(): void {
    if (this._pointCount > 0) {
      this._pointHead = (this._pointHead + 1) % this.maxPoints;
      this._pointCount--;
    }
  }

  private _getPoint(index: number): Vec3 {
    // index: 0 = 最旧的点，_pointCount - 1 = 最新的点
    const idx = (this._pointHead + index) % this.maxPoints;
    return this._pointPool[idx];
  }

  private _getLastPoint(): Vec3 | null {
    if (this._pointCount === 0) return null;
    const idx = (this._pointHead + this._pointCount - 1) % this.maxPoints;
    return this._pointPool[idx];
  }

  public onEnable(): void {
    super.onEnable();

    // 清空采样点状态
    this._pointHead = 0;
    this._pointCount = 0;
    this._fadeAccum = 0;
    this._hasNewPoint = false;

    // 清空渲染数据缓存（与 onDisable 对应）
    this._positions.length = 0;
    this._uvs.length = 0;
    this._indices.length = 0;
    this._alphas.length = 0;
    this._colors.length = 0;

    //确保对象池已初始化
    if (this._pointPool.length < this.maxPoints) {
      this._initPointPool();
    }

    //重新刷新 assembler（会自动重建 renderData）
    this._flushAssembler();

    // 标记
    this.markForUpdateRenderData();
  }

  onDisable(): void {
    super.onDisable();

    // 清空状态（与 onEnable 对应）
    this._pointHead = 0;
    this._pointCount = 0;
    this._fadeAccum = 0;
    this._hasNewPoint = false;

    // 清空渲染缓存
    this._positions.length = 0;
    this._uvs.length = 0;
    this._indices.length = 0;
    this._alphas.length = 0;
    this._colors.length = 0;

    // 销毁 renderData
    if (this.renderData) {
      this.destroyRenderData();
    }
  }

  private currentWorldPos = new Vec3();
  // 用于世界坐标到局部坐标的转换
  private _inverseWorldMatrix = new Mat4();
  private _tempVec3 = new Vec3();
  protected update(dt: number): void {
    if (!this._spriteFrame?.texture) return;

    // 确保对象池已初始化且大小正确
    if (this._pointPool.length < this.maxPoints) {
      this._initPointPool();
    }

    // 自动采样节点位置
    if (!this._paused) {
      const wp = this.node.getWorldPosition(this.currentWorldPos);
      const last = this._getLastPoint();

      this._hasNewPoint = false;

      if (last) {
        const dx = wp.x - last.x;
        const dy = wp.y - last.y;
        if (dx * dx + dy * dy >= this.minDistance * this.minDistance) {
          this._addPoint(wp.x, wp.y, wp.z);
          this._hasNewPoint = true;
        }
      } else {
        this._addPoint(wp.x, wp.y, wp.z);
        this._hasNewPoint = true;
      }
    } else {
      // 暂停时也需要更新世界坐标（用于渲染计算）
      this.node.getWorldPosition(this.currentWorldPos);
      this._hasNewPoint = false;
    }

    // 自动衰减：如果没有新增点且 fadeTime > 0，逐渐移除尾部点
    let dataChanged = false;
    if (!this._hasNewPoint && this.fadeTime > 0 && this._pointCount > 0) {
      const fadeSpeed = this._pointCount / this.fadeTime;
      this._fadeAccum += fadeSpeed * dt;
      const removeCount = Math.floor(this._fadeAccum);
      if (removeCount > 0) {
        this._fadeAccum -= removeCount;
        for (let i = 0; i < removeCount && this._pointCount > 0; i++) {
          this._removeOldestPoint();
        }
        dataChanged = true; // 点数减少了，数据发生了变化
      }
    } else {
      this._fadeAccum = 0;
    }

    // 如果有新点添加，也标记数据变化
    if (this._hasNewPoint) {
      dataChanged = true;
    }

    // 只有有足够的点才计算和渲染
    if (this._pointCount >= 2) {
      this._calculateVerticesAndUVIndices();
    } else {
      this._positions.length = 0;
      this._uvs.length = 0;
      this._indices.length = 0;
      this._alphas.length = 0;
      this._colors.length = 0;
      dataChanged = true; // 清空数据也是一种变化
    }

    // 只有在数据真正变化时才标记为 dirty
    if (dataChanged) {
      if (this.renderData) {
        this.renderData.vertDirty = true;
      }
      this.markForUpdateRenderData();
    }
  }

  /** 有时候 避免出现跨越式的拖尾渲染 / 需要立即清空拖尾 / 对象池复用需要清空状态 */
  public clear(): void {
    // 清空采样点
    this._pointHead = 0;
    this._pointCount = 0;

    //重置衰减累积器，避免清空后立即触发衰减逻辑
    this._fadeAccum = 0;

    //重置新点标记
    this._hasNewPoint = false;

    // 清空渲染数据缓存
    this._positions.length = 0;
    this._uvs.length = 0;
    this._indices.length = 0;
    this._alphas.length = 0;
    this._colors.length = 0;

    // 标记渲染数据需要更新
    if (this.renderData) {
      this.renderData.vertDirty = true;
    }
    this.markForUpdateRenderData();
  }

  /**
   * 暂停采样（停止添加新点，但保留现有拖尾，衰减仍会继续）
   */
  public pause(): void {
    this._paused = true;
  }

  /**
   * 恢复采样
   */
  public resume(): void {
    this._paused = false;
  }

  /**
   * 获取当前是否暂停
   */
  public isPaused(): boolean {
    return this._paused;
  }

  private _calculateVerticesAndUVIndices(): void {
    const n = this._pointCount;

    if (n < 2) {
      this._positions.length = 0;
      this._uvs.length = 0;
      this._indices.length = 0;
      this._alphas.length = 0;
      this._colors.length = 0;
      return;
    }

    const sf = this._spriteFrame;
    if (!sf) return;
    if (this._uvDirty) {
      const uv8 = sf.uv;
      this._uvMin = uv8[0];
      this._uvMax = uv8[0];
      this._vMin = uv8[1];
      this._vMax = uv8[1];
      for (let i = 0; i < 8; i += 2) {
        const u = uv8[i];
        const v = uv8[i + 1];
        if (u < this._uvMin) this._uvMin = u;
        if (u > this._uvMax) this._uvMax = u;
        if (v < this._vMin) this._vMin = v;
        if (v > this._vMax) this._vMax = v;
      }

      this._uvAreaH = this._vMax - this._vMin;
      this._uvDirty = false;
    }

    // 根据坐标模式决定是否需要逆矩阵
    const useLocalMode = this.coordinateMode === TrailCoordinateMode.Local;
    let im: Mat4 | null = null;
    if (useLocalMode) {
      Mat4.invert(this._inverseWorldMatrix, this.node.worldMatrix);
      im = this._inverseWorldMatrix;
    }

    // 在循环外预计算
    const tailAlphaNorm = this.tailAlpha / 255;
    const headAlphaNorm = this.headAlpha / 255;
    const tailColorR = this.tailColor.r / 255;
    const tailColorG = this.tailColor.g / 255;
    const tailColorB = this.tailColor.b / 255;
    const headColorR = this.headColor.r / 255;
    const headColorG = this.headColor.g / 255;
    const headColorB = this.headColor.b / 255;

    // 预计算数组大小
    const vertCount = n * 2;
    const posLen = vertCount * 3;
    const uvLen = vertCount * 2;
    const colorLen = vertCount * 3;

    // 直接设置数组长度，确保 Native 平台数据一致性
    this._positions.length = posLen;
    this._uvs.length = uvLen;
    this._alphas.length = vertCount;
    this._colors.length = colorLen;

    // 使用索引赋值
    let posIdx = 0,
      uvIdx = 0,
      alphaIdx = 0,
      colorIdx = 0;

    for (let i = 0; i < n; i++) {
      const p = this._getPoint(i);
      const pPrev = this._getPoint(i > 0 ? i - 1 : i);
      const pNext = this._getPoint(i < n - 1 ? i + 1 : i);

      // 计算切线方向
      let dx = pNext.x - pPrev.x;
      let dy = pNext.y - pPrev.y;
      const lenSq = dx * dx + dy * dy;

      if (this.useFastSqrt) {
        if (lenSq > 0.0001) {
          const invLen = fastInvSqrt(lenSq);
          dx *= invLen;
          dy *= invLen;
        }
      } else {
        const len = lenSq > 0.0001 ? Math.sqrt(lenSq) : 1;
        dx /= len;
        dy /= len;
      }

      // 法线方向（垂直于切线）
      const nx = -dy;
      const ny = dx;

      // 插值参数：0 = 尾部，1 = 头部
      const t = i / (n - 1);
      const halfW = (this.tailWidth + (this.headWidth - this.tailWidth) * t) * 0.5;
      const alpha = tailAlphaNorm + (headAlphaNorm - tailAlphaNorm) * t;
      // 添加颜色插值计算,直接内联插值函数
      const r = tailColorR + (headColorR - tailColorR) * t;
      const g = tailColorG + (headColorG - tailColorG) * t;
      const b = tailColorB + (headColorB - tailColorB) * t;

      // 左右两个顶点的世界坐标
      const wlx = p.x + nx * halfW;
      const wly = p.y + ny * halfW;
      const wrx = p.x - nx * halfW;
      const wry = p.y - ny * halfW;

      let localLx: number, localLy: number, localRx: number, localRy: number;

      if (useLocalMode && im) {
        // 局部坐标模式：使用逆世界矩阵将世界坐标转换为局部坐标
        // 这样可以正确处理节点的旋转、缩放
        let rhw = im.m03 * wlx + im.m07 * wly + im.m15;
        rhw = rhw ? 1 / rhw : 1;
        localLx = (im.m00 * wlx + im.m04 * wly + im.m12) * rhw;
        localLy = (im.m01 * wlx + im.m05 * wly + im.m13) * rhw;

        rhw = im.m03 * wrx + im.m07 * wry + im.m15;
        rhw = rhw ? 1 / rhw : 1;
        localRx = (im.m00 * wrx + im.m04 * wry + im.m12) * rhw;
        localRy = (im.m01 * wrx + im.m05 * wry + im.m13) * rhw;
      } else {
        // 世界坐标模式：直接使用世界坐标，不进行坐标转换
        localLx = wlx;
        localLy = wly;
        localRx = wrx;
        localRy = wry;
      }

      this._positions[posIdx++] = localLx;
      this._positions[posIdx++] = localLy;
      this._positions[posIdx++] = 0;

      this._positions[posIdx++] = localRx;
      this._positions[posIdx++] = localRy;
      this._positions[posIdx++] = 0;

      // UV坐标：沿着拖尾方向从尾到头
      const vV = this._vMin + this._uvAreaH * (1 - t);
      this._uvs[uvIdx++] = this._uvMin;
      this._uvs[uvIdx++] = vV;
      this._uvs[uvIdx++] = this._uvMax;
      this._uvs[uvIdx++] = vV;

      // 存储每个顶点的透明度
      this._alphas[alphaIdx++] = alpha;
      this._alphas[alphaIdx++] = alpha;

      // 存储每个顶点的颜色
      this._colors[colorIdx++] = r;
      this._colors[colorIdx++] = g;
      this._colors[colorIdx++] = b;
      this._colors[colorIdx++] = r;
      this._colors[colorIdx++] = g;
      this._colors[colorIdx++] = b;
    }

    // 生成索引：每两个相邻的点构成一个四边形（两个三角形）
    const indexCount = (n - 1) * 6;
    this._indices.length = indexCount;
    let indexIdx = 0;
    for (let i = 0; i < n - 1; i++) {
      const start = i * 2;
      const v0 = start;
      const v1 = start + 1;
      const v2 = start + 2;
      const v3 = start + 3;
      this._indices[indexIdx++] = v0;
      this._indices[indexIdx++] = v1;
      this._indices[indexIdx++] = v2;
      this._indices[indexIdx++] = v2;
      this._indices[indexIdx++] = v1;
      this._indices[indexIdx++] = v3;
    }
  }
  protected _canRender(): boolean {
    if (!super._canRender()) return false;
    if (!this._spriteFrame || !this._spriteFrame.texture) return false;
    return this._pointCount >= 2;
  }

  // @ts-ignore
  protected _render(render: IBatcher): void {
    render.commitComp(this, this.renderData, this._spriteFrame, this._assembler!, null);
  }

  protected _flushAssembler(): void {
    const assembler = SuperTrail.Assembler.getAssembler(this);

    if (this._assembler !== assembler) {
      this.destroyRenderData();
      this._assembler = assembler;
    }

    if (!this.renderData) {
      if (this._assembler && this._assembler.createData) {
        this._renderData = this._assembler.createData(this) as RenderData;
        this.renderData!.material = this.material;
        this._updateColor();
      }
    }
  }

  public static Assembler: IAssemblerManager;
}

class SuperTrailAssemblerImpl implements IAssembler {
  createData(comp: SuperTrail): RenderData {
    const renderData = comp.requestRenderData();
    renderData.dataLength = 4;
    renderData.resize(4, 6);
    return renderData;
  }

  updateRenderData(comp: SuperTrail): void {
    if (!comp) return;
    if (!comp.spriteFrame?.texture) return;

    const renderData = comp.renderData;
    if (!renderData) return;

    const vertCount = comp.positions.length / 3;
    const indexCount = comp.indices.length;

    if (vertCount === 0 || indexCount === 0) {
      renderData.vertDirty = false;
      return;
    }

    if (renderData.dataLength !== vertCount) {
      renderData.dataLength = vertCount;
    }

    const dataList: IRenderData[] = renderData.data;
    for (let i = 0; i < vertCount; ++i) {
      const item = dataList[i];
      item.x = comp.positions[i * 3];
      item.y = comp.positions[i * 3 + 1];
    }

    if (renderData.vertexCount !== vertCount || renderData.indexCount !== indexCount) {
      // comp.renderEntity.colorDirty = true;
      renderData.resize(vertCount, indexCount);
    }

    if (JSB) {
      // 在 JSB 模式下，确保所有数据数组长度匹配后再更新
      const expectedUvLen = vertCount * 2;
      const expectedColorLen = vertCount * 3;
      const expectedAlphaLen = vertCount;

      // 只有当所有数据完整时才更新，否则跳过本次更新避免读取不一致的数据
      if (
        comp.uvs.length === expectedUvLen &&
        comp.colors.length === expectedColorLen &&
        comp.alphas.length === expectedAlphaLen &&
        comp.indices.length === indexCount
      ) {
        const tmp = new Uint16Array(indexCount);
        const indices = comp.indices;
        for (let i = 0; i < indexCount; ++i) {
          tmp[i] = indices[i];
        }
        renderData.chunk.setIndexBuffer(tmp);

        this._updateJustUV(comp);
      }
    }

    renderData.updateRenderData(comp, comp.spriteFrame);
    renderData.vertDirty = false;
  }

  // @ts-ignore
  fillBuffers(comp: SuperTrail, renderer: IBatcher): void {
    if (!comp) return;
    const renderData = comp.renderData;
    if (!renderData) return;

    const vertCount = comp.positions.length / 3;
    const indexCount = comp.indices.length;
    if (vertCount === 0 || indexCount === 0) return;

    this._updateVertexsAndUV(comp);
    this._updateIndices(comp);
  }

  private _updateIndices(comp: SuperTrail): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const chunk = renderData.chunk;
    const vid = chunk.vertexOffset;
    const meshBuffer = chunk.meshBuffer;
    const ib = meshBuffer.iData;
    let indexOffset = meshBuffer.indexOffset;

    const indices = comp.indices;
    for (let i = 0; i < indices.length; ++i) {
      ib[indexOffset++] = vid + indices[i];
    }
    meshBuffer.indexOffset += indices.length;
  }

  private _updateVertexsAndUV(comp: SuperTrail): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const vertCount = comp.positions.length / 3;

    // 验证数据完整性
    const expectedPosLen = vertCount * 3;
    const expectedUvLen = vertCount * 2;
    const expectedColorLen = vertCount * 3;
    const expectedAlphaLen = vertCount;

    // 如果数据不完整，直接返回
    if (
      comp.positions.length !== expectedPosLen ||
      comp.uvs.length !== expectedUvLen ||
      comp.colors.length !== expectedColorLen ||
      comp.alphas.length !== expectedAlphaLen
    ) {
      return;
    }

    const chunk = renderData.chunk;
    const vb = chunk.vb;
    const stride = renderData.floatStride;

    // 根据坐标模式决定是否应用世界矩阵变换
    const useLocalMode = comp.coordinateMode === TrailCoordinateMode.Local;

    if (useLocalMode) {
      // 局部坐标模式：应用世界矩阵变换
      const m = comp.node.worldMatrix;
      for (let i = 0; i < vertCount; ++i) {
        const posIdx = i * 3;
        const uvIdx = i * 2;
        const colorIdx = i * 3;

        const x = comp.positions[posIdx];
        const y = comp.positions[posIdx + 1];

        let rhw = m.m03 * x + m.m07 * y + m.m15;
        rhw = rhw ? 1 / rhw : 1;

        const offset = i * stride;
        vb[offset + 0] = (m.m00 * x + m.m04 * y + m.m12) * rhw;
        vb[offset + 1] = (m.m01 * x + m.m05 * y + m.m13) * rhw;
        vb[offset + 2] = (m.m02 * x + m.m06 * y + m.m14) * rhw;
        vb[offset + 3] = comp.uvs[uvIdx];
        vb[offset + 4] = comp.uvs[uvIdx + 1];
        vb[offset + 5] = comp.colors[colorIdx];
        vb[offset + 6] = comp.colors[colorIdx + 1];
        vb[offset + 7] = comp.colors[colorIdx + 2];
        vb[offset + 8] = comp.alphas[i];
      }
    } else {
      // 世界坐标模式：直接使用世界坐标
      for (let i = 0; i < vertCount; ++i) {
        const posIdx = i * 3;
        const uvIdx = i * 2;
        const colorIdx = i * 3;

        const x = comp.positions[posIdx];
        const y = comp.positions[posIdx + 1];
        const z = comp.positions[posIdx + 2];

        const offset = i * stride;
        vb[offset + 0] = x;
        vb[offset + 1] = y;
        vb[offset + 2] = z;
        vb[offset + 3] = comp.uvs[uvIdx];
        vb[offset + 4] = comp.uvs[uvIdx + 1];
        vb[offset + 5] = comp.colors[colorIdx];
        vb[offset + 6] = comp.colors[colorIdx + 1];
        vb[offset + 7] = comp.colors[colorIdx + 2];
        vb[offset + 8] = comp.alphas[i];
      }
    }
  }
  private _updateJustUV(comp: SuperTrail): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const vertCount = comp.positions.length / 3;

    // 验证数据完整性 - 关键！确保所有数组长度匹配
    const expectedUvLen = vertCount * 2;
    const expectedColorLen = vertCount * 3;
    const expectedAlphaLen = vertCount;

    // 如果数据不完整，直接返回，不更新（避免访问越界或未初始化的数据）
    if (comp.uvs.length !== expectedUvLen || comp.colors.length !== expectedColorLen || comp.alphas.length !== expectedAlphaLen) {
      return;
    }

    const chunk = renderData.chunk;
    const vb = chunk.vb;
    const stride = renderData.floatStride;

    for (let i = 0; i < vertCount; ++i) {
      const offset = i * stride;
      const uvIdx = i * 2;
      const colorIdx = i * 3;

      vb[offset + 3] = comp.uvs[uvIdx];
      vb[offset + 4] = comp.uvs[uvIdx + 1];
      vb[offset + 5] = comp.colors[colorIdx]; // r
      vb[offset + 6] = comp.colors[colorIdx + 1]; // g
      vb[offset + 7] = comp.colors[colorIdx + 2]; // b
      vb[offset + 8] = comp.alphas[i]; // a
    }
  }

  updateColor(comp: SuperTrail): void {
    const renderData = comp.renderData;
    if (!renderData) return;

    const vertCount = comp.positions.length / 3;
    if (vertCount === 0) return;

    // 验证数据完整性
    const expectedColorLen = vertCount * 3;
    const expectedAlphaLen = vertCount;

    // 如果数据不完整，直接返回
    if (comp.colors.length !== expectedColorLen || comp.alphas.length !== expectedAlphaLen) {
      return;
    }

    const chunk = renderData.chunk;
    const vb = chunk.vb;
    const stride = renderData.floatStride;

    for (let i = 0; i < vertCount; ++i) {
      const offset = i * stride;
      const colorIdx = i * 3;

      vb[offset + 5] = comp.colors[colorIdx]; // r
      vb[offset + 6] = comp.colors[colorIdx + 1]; // g
      vb[offset + 7] = comp.colors[colorIdx + 2]; // b
      vb[offset + 8] = comp.alphas[i]; // a
    }
  }
}

const superTrailAssemblerImpl = new SuperTrailAssemblerImpl();
const superTrailAssemblerImplMgr: IAssemblerManager = {
  getAssembler(_comp: SuperTrail): IAssembler {
    return superTrailAssemblerImpl;
  },
};
SuperTrail.Assembler = superTrailAssemblerImplMgr;
