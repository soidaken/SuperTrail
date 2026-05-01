import { _decorator, Color, Component, EventTouch, instantiate, Label, Mat4, Node, Sprite, UITransform, v3, Vec3 } from 'cc';
import { SuperTrail, TrailCoordinateMode } from '../SuperTrail/SuperTrail';

const { ccclass, property } = _decorator;

enum MoveMode {
  Nebula = 0,
  Random = 1,
  UpDown = 2,
}

interface NodeState {
  targetPos: Vec3;
  velocity: Vec3;
  changeTimer: number;
  changeInterval: number;
  originX: number;
  originY: number;
  phase: number;
  phase2: number;
  radiusX: number;
  radiusY: number;
  angularSpeed: number;
  waveSpeed: number;
  group: number;
  isManualControl?: boolean;
}

const PALETTE: ReadonlyArray<Color> = [
  new Color(255, 66, 138, 255),
  new Color(255, 172, 48, 255),
  new Color(56, 239, 190, 255),
  new Color(59, 151, 255, 255),
  new Color(178, 102, 255, 255),
  new Color(255, 255, 120, 255),
];

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

  @property(Node)
  node_root2: Node | null = null;

  @property(Label)
  labelCounts: Label | null = null;

  @property(Label)
  label_tips: Label | null = null;

  @property({ tooltip: '启动后自动扩展到多少条拖尾' })
  autoTrailCount = 8;

  @property({ tooltip: '每次按钮添加多少条拖尾' })
  addCount = 8;

  @property({ tooltip: '测试允许的最大拖尾数量' })
  maxTrailCount = 96;

  private _states: NodeState[] = [];
  private _moveMode: MoveMode = MoveMode.Nebula;
  private _isRootRotating = true;
  private _time = 0;
  private _touching = false;
  private _touchLocal = v3();
  private _tmpVec3 = v3();
  private _tmpMat4 = new Mat4();
  private _minDistSq = 50 * 50;
  private _runtimeRootA: Node | null = null;
  private _runtimeRootB: Node | null = null;
  private _pendingSpawn = 0;
  private _spawnPerFrame = 2;

  protected onEnable(): void {
    this._registerTouchEvents();
  }

  protected onDisable(): void {
    this._unregisterTouchEvents();
  }

  start(): void {
    this._prepareDemo();
    this._updateTips();
  }

  private _prepareDemo(): void {
    this.nodes = this.nodes.filter(node => node && node.isValid);

    if (this.nodes.length === 0) {
      this._collectTrailNodes(this.node, this.nodes);
    }

    this._ensureRuntimeRoots();

    for (let i = 0; i < this.nodes.length; i++) {
      this._setupNode(this.nodes[i], i);
    }

    if (this.nodes.length > 0) {
      const targetCount = Math.min(this.autoTrailCount, this.maxTrailCount);
      this._pendingSpawn += Math.max(0, targetCount - this.nodes.length);
    }
  }

  private _ensureRuntimeRoots(): void {
    if (!this._runtimeRootA || !this._runtimeRootA.isValid) {
      this._runtimeRootA = new Node('SuperTrail_RuntimeRoot_A');
      this._runtimeRootA.parent = this.node;
      this._runtimeRootA.layer = this.node.layer;
    }

    if (!this._runtimeRootB || !this._runtimeRootB.isValid) {
      this._runtimeRootB = new Node('SuperTrail_RuntimeRoot_B');
      this._runtimeRootB.parent = this.node;
      this._runtimeRootB.layer = this.node.layer;
    }
  }

  private _collectTrailNodes(root: Node, out: Node[]): void {
    if (root.getComponent(SuperTrail)) {
      out.push(root);
    }

    const children = root.children;
    for (let i = 0; i < children.length; i++) {
      this._collectTrailNodes(children[i], out);
    }
  }

  private _registerTouchEvents(): void {
    this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);

    this.node.on(Node.EventType.TOUCH_START, this._onTouchStart, this);
    this.node.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
    this.node.on(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    this.node.on(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
  }

  private _unregisterTouchEvents(): void {
    this.node.off(Node.EventType.TOUCH_START, this._onTouchStart, this);
    this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
    this.node.off(Node.EventType.TOUCH_END, this._onTouchEnd, this);
    this.node.off(Node.EventType.TOUCH_CANCEL, this._onTouchCancel, this);
  }

  private _onTouchStart(e: EventTouch): void {
    this._touching = true;
    this._updateTouchLocal(e);
  }

  private _onTouchMove(e: EventTouch): void {
    this._updateTouchLocal(e);
  }

  private _onTouchEnd(): void {
    this._touching = false;
  }

  private _onTouchCancel(): void {
    this._touching = false;
  }

  private _updateTouchLocal(e: EventTouch): void {
    const ui = this.node.getComponent(UITransform);
    const loc = e.getUILocation();

    if (ui) {
      ui.convertToNodeSpaceAR(v3(loc.x, loc.y, 0), this._touchLocal);
    } else {
      this._touchLocal.set(loc.x, loc.y, 0);
    }
  }

  private _setupNode(node: Node, index: number): void {
    const state = this._createState(index, node.position.x, node.position.y);
    this._states[index] = state;

    const parent = this._getGroupRoot(state.group);
    if (parent && node.parent !== parent && node !== parent) {
      this._setParentKeepWorld(node, parent);
    }

    const trail = node.getComponent(SuperTrail);
    if (trail) {
      this._setupTrail(trail, index);
    }

    const sprite = node.getComponent(Sprite);
    if (sprite) {
      sprite.color = PALETTE[index % PALETTE.length].clone();
    }
  }

  private _setupTrail(trail: SuperTrail, index: number): void {
    const head = PALETTE[index % PALETTE.length];
    const tail = PALETTE[(index + 3) % PALETTE.length];

    trail.coordinateMode = index % 3 === 0 ? TrailCoordinateMode.Local : TrailCoordinateMode.World;
    trail.maxPoints = 24 + (index % 16);
    trail.minDistance = 2 + (index % 4);
    trail.headWidth = 18 + (index % 5) * 5;
    trail.tailWidth = index % 2 === 0 ? 0 : 6;
    trail.headAlpha = 240;
    trail.tailAlpha = 0;
    trail.fadeTime = 0.28 + (index % 5) * 0.08;
    trail.headColor = head.clone();
    trail.tailColor = new Color(tail.r, tail.g, tail.b, 0);
    trail.useFastSqrt = true;
    trail.miterLimit = 1.35;
    trail.clear();
  }

  private _createState(index: number, x: number, y: number): NodeState {
    const ring = index % 7;
    const angle = (index * 137.508 * Math.PI) / 180;
    const radius = 120 + ring * 56;

    return {
      targetPos: v3((Math.random() * 2 - 1) * this.rangeX, (Math.random() * 2 - 1) * this.rangeY, 0),
      velocity: v3(),
      changeTimer: 0,
      changeInterval: 0.35 + Math.random() * 0.7,
      originX: x || Math.cos(angle) * radius,
      originY: y || Math.sin(angle) * radius * 0.65,
      phase: angle,
      phase2: angle * 0.37 + ring,
      radiusX: radius + (index % 5) * 24,
      radiusY: radius * (0.45 + (index % 4) * 0.09),
      angularSpeed: (0.55 + (index % 9) * 0.08) * (index % 2 === 0 ? 1 : -1),
      waveSpeed: 1.1 + (index % 6) * 0.18,
      group: index % 2,
    };
  }

  private _spawnTrails(count: number): void {
    if (count <= 0 || this.nodes.length === 0) return;
    count = Math.min(count, Math.max(0, this.maxTrailCount - this.nodes.length));
    if (count <= 0) return;

    const seedNodes = this.nodes.filter(node => node && node.isValid && node.getComponent(SuperTrail));
    if (seedNodes.length === 0) return;

    for (let i = 0; i < count; i++) {
      const template = seedNodes[i % seedNodes.length];
      if (!template || !template.isValid) continue;

      const clone = instantiate(template);
      const index = this.nodes.length;
      const state = this._createState(index, 0, 0);
      const parent = this._getGroupRoot(state.group);

      clone.name = `trail_${index}`;
      clone.parent = parent || template.parent;
      clone.setPosition(state.originX, state.originY, 0);

      this.nodes.push(clone);
      this._states.push(state);

      const trail = clone.getComponent(SuperTrail);
      if (trail) {
        this._setupTrail(trail, index);
      }

      const sprite = clone.getComponent(Sprite);
      if (sprite) {
        sprite.color = PALETTE[index % PALETTE.length].clone();
      }
    }
  }

  public addTrails(): void {
    const room = Math.max(0, this.maxTrailCount - this.nodes.length - this._pendingSpawn);
    this._pendingSpawn += Math.min(this.addCount, room);
    this._updateTips();
  }

  public removeTrails(): void {
    const keepCount = Math.max(1, this.nodes.length - this.addCount);

    while (this.nodes.length > keepCount) {
      const node = this.nodes.pop();
      this._states.pop();

      if (node && node.isValid) {
        node.destroy();
      }
    }

    this._updateTips();
  }

  public toggleTrailsMode(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      const trail = this.nodes[i]?.getComponent(SuperTrail);

      if (trail) {
        trail.coordinateMode = trail.coordinateMode === TrailCoordinateMode.World ? TrailCoordinateMode.Local : TrailCoordinateMode.World;
      }
    }

    this._updateTips();
  }

  public toggleRootRotation(): void {
    this._isRootRotating = !this._isRootRotating;
    this._updateTips();
  }

  public toggleMoveMode(): void {
    this._moveMode = (this._moveMode + 1) % 3;

    if (this._moveMode === MoveMode.UpDown) {
      for (let i = 0; i < this.nodes.length; i++) {
        const node = this.nodes[i];
        const state = this._ensureState(i, node);

        if (node && node.isValid) {
          state.originY = node.position.y;
        }
      }
    }

    this._updateTips();
  }

  public toggleReparentAllChildrenBetweenRoots(): void {
    const root1 = this._runtimeRootA;
    const root2 = this._runtimeRootB;

    if (!root1 || !root2 || !root1.isValid || !root2.isValid) return;

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node || !node.isValid) continue;

      const nextParent = node.parent === root1 ? root2 : root1;
      this._setParentKeepWorld(node, nextParent);

      const state = this._ensureState(i, node);
      state.group = nextParent === root1 ? 0 : 1;
    }

    this._updateTips();
  }

  public pauseAllTrails(): void {
    this.nodes.forEach(node => node?.getComponent(SuperTrail)?.pause());
    this._updateTips('暂停采样，衰减仍会继续');
  }

  public resumeAllTrails(): void {
    this.nodes.forEach(node => node?.getComponent(SuperTrail)?.resume());
    this._updateTips('恢复采样');
  }

  protected lateUpdate(): void {
    if (this.labelCounts) {
      const localCount = this._countMode(TrailCoordinateMode.Local);
      this.labelCounts.string = `拖尾数量: ${this.nodes.length}  Local: ${localCount}  World: ${this.nodes.length - localCount}`;
    }
  }

  update(dt: number): void {
    this._time += dt;

    this._flushPendingSpawn();
    this._updateRoots(dt);

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      if (!node || !node.isValid) continue;

      const state = this._ensureState(i, node);

      if (state.isManualControl) {
        continue;
      }

      if (this._moveMode === MoveMode.Nebula) {
        this._updateNebulaNode(node, state, i);
      } else if (this._moveMode === MoveMode.UpDown) {
        this._updateUpDownNode(node, state, dt);
      } else {
        this._updateRandomNode(node, state, dt);
      }
    }
  }

  private _updateRoots(dt: number): void {
    if (!this._isRootRotating) return;

    const t = this._time;

    if (this._runtimeRootA && this._runtimeRootA.isValid) {
      this._runtimeRootA.setRotationFromEuler(0, 0, t * 24);
      this._runtimeRootA.setScale(1 + Math.sin(t * 1.7) * 0.1, 1 + Math.cos(t * 1.3) * 0.08, 1);
      this._runtimeRootA.setPosition(Math.cos(t * 0.34) * 42, Math.sin(t * 0.28) * 34, 0);
    }

    if (this._runtimeRootB && this._runtimeRootB.isValid) {
      this._runtimeRootB.setRotationFromEuler(0, 0, -t * 36);
      this._runtimeRootB.setScale(0.92 + Math.cos(t * 1.5) * 0.12, 1.06 + Math.sin(t * 1.1) * 0.1, 1);
      this._runtimeRootB.setPosition(Math.sin(t * 0.31) * 52, Math.cos(t * 0.37) * 38, 0);
    }
  }

  private _flushPendingSpawn(): void {
    if (this._pendingSpawn <= 0) return;

    const count = Math.min(this._spawnPerFrame, this._pendingSpawn);
    this._pendingSpawn -= count;
    this._spawnTrails(count);
  }

  private _getGroupRoot(group: number): Node | null {
    this._ensureRuntimeRoots();
    return group === 0 ? this._runtimeRootA : this._runtimeRootB;
  }

  private _updateNebulaNode(node: Node, state: NodeState, index: number): void {
    const t = this._time;
    const phase = state.phase + t * state.angularSpeed;
    const phase2 = state.phase2 + t * state.waveSpeed;
    const twist = Math.sin(phase2 * 1.7 + index * 0.11) * 55;

    let x = Math.cos(phase) * state.radiusX + Math.sin(phase2) * 80 + twist;
    let y = Math.sin(phase * 1.35) * state.radiusY + Math.cos(phase2 * 0.83) * 95;

    if (this._touching) {
      const pull = 0.22 + (index % 7) * 0.025;
      x += (this._touchLocal.x - x) * pull;
      y += (this._touchLocal.y - y) * pull;
    }

    node.setPosition(x, y, 0);
  }

  private _updateUpDownNode(node: Node, state: NodeState, dt: number): void {
    state.phase += ((Math.PI * 2) / this.upDownPeriod) * dt;

    const x = state.originX + Math.cos(state.phase2 + this._time * 0.8) * 140;
    const y = state.originY + Math.sin(state.phase) * this.upDownRange;

    node.setPosition(x, y, 0);
  }

  private _updateRandomNode(node: Node, state: NodeState, dt: number): void {
    const pos = node.position;
    const target = state.targetPos;
    const vel = state.velocity;

    state.changeTimer += dt;

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < this._minDistSq || state.changeTimer >= state.changeInterval) {
      target.x = (Math.random() * 2 - 1) * this.rangeX;
      target.y = (Math.random() * 2 - 1) * this.rangeY;
      state.changeTimer = 0;
      state.changeInterval = 0.35 + Math.random() * 0.7;
    }

    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const lerpFactor = Math.min(1, this.turnSmooth * dt);

    vel.x += ((dx / len) * this.moveSpeed - vel.x) * lerpFactor;
    vel.y += ((dy / len) * this.moveSpeed - vel.y) * lerpFactor;

    let newX = pos.x + vel.x * dt;
    let newY = pos.y + vel.y * dt;

    if (newX < -this.rangeX || newX > this.rangeX) {
      newX = newX < -this.rangeX ? -this.rangeX : this.rangeX;
      vel.x *= -0.5;
      target.x = (Math.random() * 2 - 1) * this.rangeX;
    }

    if (newY < -this.rangeY || newY > this.rangeY) {
      newY = newY < -this.rangeY ? -this.rangeY : this.rangeY;
      vel.y *= -0.5;
      target.y = (Math.random() * 2 - 1) * this.rangeY;
    }

    node.setPosition(newX, newY, pos.z);
  }

  private _ensureState(index: number, node: Node | null): NodeState {
    let state = this._states[index];

    if (!state) {
      const x = node?.position.x ?? 0;
      const y = node?.position.y ?? 0;
      state = this._createState(index, x, y);
      this._states[index] = state;
    }

    return state;
  }

  private _setParentKeepWorld(node: Node, parent: Node): void {
    node.getWorldPosition(this._tmpVec3);
    node.setParent(parent);

    Mat4.invert(this._tmpMat4, parent.worldMatrix);
    Vec3.transformMat4(this._tmpVec3, this._tmpVec3, this._tmpMat4);
    node.setPosition(this._tmpVec3);
  }

  private _countMode(mode: TrailCoordinateMode): number {
    let count = 0;

    for (let i = 0; i < this.nodes.length; i++) {
      const trail = this.nodes[i]?.getComponent(SuperTrail);

      if (trail?.coordinateMode === mode) {
        count++;
      }
    }

    return count;
  }

  private _updateTips(extra = ''): void {
    if (!this.label_tips) return;

    const modeName = this._moveMode === MoveMode.Nebula ? '星云压力测试' : this._moveMode === MoveMode.Random ? '随机高速转向' : '上下波形扫描';
    const rootState = this._isRootRotating ? '父节点旋转/缩放: 开' : '父节点旋转/缩放: 关';
    const suffix = extra ? `  ${extra}` : '';

    this.label_tips.string = `${modeName}  ${rootState}${suffix}`;
  }
}
