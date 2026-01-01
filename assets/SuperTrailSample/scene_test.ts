import { _decorator, Color, Component, EventTouch, instantiate, Label, Node, v3, Vec3 } from 'cc';
import { SuperTrail, TrailCoordinateMode } from '../SuperTrail/SuperTrail';
const { ccclass, property } = _decorator;

// 移动模式枚举
enum MoveMode {
  Random = 0, // 随机移动
  UpDown = 1, // 上下直线循环
}

// 每个节点的移动状态
interface NodeState {
  targetPos: Vec3; // 目标位置
  velocity: Vec3; // 当前速度向量
  changeTimer: number; // 切换目标的计时器
  changeInterval: number; // 切换目标的间隔
  isManualControl?: boolean; // 是否处于手动控制状态
  originY?: number; // 原点Y坐标（用于上下循环）
  phase?: number; // 运动相位（用于上下循环）
}

@ccclass('scene_test')
export class scene_test extends Component {
  @property([Node])
  nodes: Node[] = [];

  @property({ tooltip: '移动速度' })
  moveSpeed: number = 1000;

  @property({ tooltip: '转向平滑度（越大转向越快）' })
  turnSmooth: number = 5;

  @property({ tooltip: '屏幕范围X' })
  rangeX: number = 1000;

  @property({ tooltip: '屏幕范围Y' })
  rangeY: number = 800;

  @property({ tooltip: '上下移动幅度' })
  upDownRange: number = 200;

  @property({ tooltip: '上下移动周期（秒）' })
  upDownPeriod: number = 2;

  @property(Node)
  node_root: Node | null = null;

  @property(Label)
  labelCounts: Label | null = null;

  @property(Label)
  label_tips: Label | null = null;

  private _states: NodeState[] = [];
  private _moveMode: MoveMode = MoveMode.UpDown;

  private _isRootRotating: boolean = true; // 控制是否旋转

  // 预分配的临时变量，避免每帧创建
  private _tempVec3: Vec3 = v3();
  private _minDistSq: number = 50 * 50; // 预计算距离平方

  private _registerTouchEvents() {
    // 先 off 再 on，避免重复注册
    this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);

    this.node.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
  }

  private _unregisterTouchEvents() {
    this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
  }

  private _onTouchStart(e: EventTouch) {}
  private _onTouchMove(e: EventTouch) {}
  private _onTouchEnd(e: EventTouch) {}
  private _onTouchCancel(e: EventTouch) {}

  protected onEnable(): void {
    this._registerTouchEvents();
  }
  protected onDisable(): void {
    this._unregisterTouchEvents();
  }

  public toggleTrailsMode(): void {
    this.nodes.forEach((node, index) => {
      const trail = node.getComponent(SuperTrail);
      if (trail) {
        const cmode = trail.coordinateMode;
        trail.coordinateMode = cmode === TrailCoordinateMode.World ? TrailCoordinateMode.Local : TrailCoordinateMode.World;
      }
    });
  }

  /**
   * 切换根节点旋转状态
   */
  public toggleRootRotation(): void {
    this._isRootRotating = !this._isRootRotating;
    if (this.label_tips) {
      this.label_tips.string = `根节点旋转: ${this._isRootRotating ? '开启' : '关闭'}`;
    }
  }

  /**
   * 切换移动模式
   */
  public toggleMoveMode(): void {
    this._moveMode = this._moveMode === MoveMode.Random ? MoveMode.UpDown : MoveMode.Random;

    // 切换到上下模式时，初始化每个节点的原点和相位
    if (this._moveMode === MoveMode.UpDown) {
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        if (!node || !node.isValid) continue;
        const state = this._states[i];
        state.originY = node.position.y;
        state.phase = Math.random() * Math.PI * 2; // 随机初始相位，让每个拖尾不同步
      }
    }

    this.label_tips.string = `移动模式切换为: ${this._moveMode === MoveMode.Random ? '随机移动' : '上下循环'}`;
  }

  start() {
    // 先复制节点
    // const originalNodes = [...this.nodes];
    // for (let m = 1; m < this.multiplier; m++) {
    //   originalNodes.forEach(node => {
    //     if (!node || !node.isValid) return;
    //     const clone = instantiate(node);
    //     if (clone) {
    //       clone.parent = node.parent;
    //       clone.setPosition(node.position);
    //       this.nodes.push(clone);
    //     }
    //   });
    // }

    // 初始化每个节点的状态
    const len = this.nodes.length;
    for (let i = 0; i < len; i++) {
      const node = this.nodes[i];
      const state: NodeState = {
        targetPos: v3((Math.random() * 2 - 1) * this.rangeX, (Math.random() * 2 - 1) * this.rangeY, 0),
        velocity: v3(0, 0, 0),
        changeTimer: 0,
        changeInterval: Math.random() + 0.5,
        originY: node.position.y, // 初始化原点Y
        phase: Math.random() * Math.PI * 2, // 随机初始相位
      };
      this._states.push(state);

      // 随机设置 SuperTrail 的颜色
      // const trail = node.getComponent(SuperTrail);
      // if (trail) {
      //   trail.headColor = new Color(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 255);
      //   trail.tailColor = new Color(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 255);
      // }
    }
  }

  pauseAllTrails() {
    this.nodes.forEach(node => {
      const trail = node.getComponent(SuperTrail);
      if (trail) {
        trail.pause();
      }
    });
  }

  resumeAllTrails() {
    this.nodes.forEach(node => {
      const trail = node.getComponent(SuperTrail);
      if (trail) {
        trail.resume();
      }
    });
  }

  /**
   * 添加指定数量的拖尾节点
   * @param count 要添加的数量，默认100
   */
  public addTrails(): void {
    if (this.nodes.length === 0) return;
    const count = 100;

    const templateNode = this.nodes[Math.floor(Math.random() * this.nodes.length)];
    if (!templateNode || !templateNode.isValid) return;

    for (let i = 0; i < count; i++) {
      const clone = instantiate(templateNode);
      if (clone) {
        clone.parent = templateNode.parent;
        const posX = (Math.random() * 2 - 1) * this.rangeX;
        const posY = (Math.random() * 2 - 1) * this.rangeY;
        clone.setPosition(posX, posY, 0);
        this.nodes.push(clone);

        // 初始化状态
        const state: NodeState = {
          targetPos: v3((Math.random() * 2 - 1) * this.rangeX, (Math.random() * 2 - 1) * this.rangeY, 0),
          velocity: v3(0, 0, 0),
          changeTimer: 0,
          changeInterval: Math.random() + 0.5,
          originY: posY, // 初始化原点Y
          phase: Math.random() * Math.PI * 2, // 随机初始相位
        };
        this._states.push(state);

        // 随机设置颜色
        const trail = clone.getComponent(SuperTrail);
        if (trail) {
          trail.headColor = new Color(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 255);
          trail.tailColor = new Color(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), 255);
          trail.maxPoints = 20 + Math.floor(Math.random() * 20);
          trail.tailWidth = 20 + Math.random() * 16;
        }
      }
    }

    console.log(`添加了 ${count} 个拖尾，当前总数: ${this.nodes.length}`);
  }
  /**
   * 减少指定数量的拖尾节点
   * @param count 要减少的数量，默认100
   */
  public removeTrails(): void {
    const count = 100;
    const removeCount = Math.min(count, this.nodes.length - 1); // 至少保留1个

    for (let i = 0; i < removeCount; i++) {
      const node = this.nodes.pop();
      this._states.pop();
      if (node && node.isValid) {
        node.destroy();
      }
    }

    console.log(`移除了 ${removeCount} 个拖尾，当前总数: ${this.nodes.length}`);
  }

  protected lateUpdate(dt: number): void {
    this.labelCounts.string = `拖尾数量: ${this.nodes.length}`;
  }

  update(dt: number) {
    if (this.node_root && this._isRootRotating) {
      this.node_root.angle += 90 * dt;
    }
    const nodes = this.nodes;
    const states = this._states;
    const len = nodes.length;
    const moveSpeed = this.moveSpeed;
    const turnSmooth = this.turnSmooth;
    const rangeX = this.rangeX;
    const rangeY = this.rangeY;
    const minDistSq = this._minDistSq;

    for (let i = 0; i < len; i++) {
      const node = nodes[i];
      if (!node || !node.isValid) continue;

      const state = states[i];
      const pos = node.position;

      // 如果处于手动控制状态，跳过自动移动逻辑
      if (state.isManualControl) {
        continue;
      }

      // 根据模式选择不同的移动逻辑
      if (this._moveMode === MoveMode.UpDown) {
        // 上下直线循环移动
        state.phase = (state.phase ?? 0) + ((Math.PI * 2) / this.upDownPeriod) * dt;
        const originY = state.originY ?? pos.y;
        const newY = originY + Math.sin(state.phase) * this.upDownRange;
        node.setPosition(pos.x, newY, pos.z);
      } else {
        // 随机移动（原有逻辑）
        const target = state.targetPos;
        const vel = state.velocity;

        state.changeTimer += dt;

        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq || state.changeTimer >= state.changeInterval) {
          target.x = (Math.random() * 2 - 1) * rangeX;
          target.y = (Math.random() * 2 - 1) * rangeY;
          state.changeTimer = 0;
          state.changeInterval = Math.random() + 0.5;
        }

        const dirX = target.x - pos.x;
        const dirY = target.y - pos.y;
        const len2 = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        const normX = dirX / len2;
        const normY = dirY / len2;

        const desiredVelX = normX * moveSpeed;
        const desiredVelY = normY * moveSpeed;

        const lerpFactor = Math.min(1, turnSmooth * dt);
        vel.x += (desiredVelX - vel.x) * lerpFactor;
        vel.y += (desiredVelY - vel.y) * lerpFactor;

        let newX = pos.x + vel.x * dt;
        let newY = pos.y + vel.y * dt;

        if (newX < -rangeX || newX > rangeX) {
          newX = newX < -rangeX ? -rangeX : rangeX;
          vel.x *= -0.5;
          target.x = (Math.random() * 2 - 1) * rangeX;
          target.y = (Math.random() * 2 - 1) * rangeY;
        }

        if (newY < -rangeY || newY > rangeY) {
          newY = newY < -rangeY ? -rangeY : rangeY;
          vel.y *= -0.5;
          target.x = (Math.random() * 2 - 1) * rangeX;
          target.y = (Math.random() * 2 - 1) * rangeY;
        }

        node.setPosition(newX, newY, pos.z);
      }
    }
  }
}
