import { _decorator, Component, EventTouch, Input, Node, tween, UITransform, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

export type MOVEABLE_CALLBACK = (moveable: UIMoveable, evt?: EventTouch) => void;

@ccclass('UIMoveable')
export default class UIMoveable extends Component {
  private _cbStarted: MOVEABLE_CALLBACK | null = null;
  private _cbMoved: MOVEABLE_CALLBACK | null = null;
  private _cbEnded: MOVEABLE_CALLBACK | null = null;
  private _cbCanceled: MOVEABLE_CALLBACK | null = null;

  protected onEnable(): void {
    this.node.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.on(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
  }

  protected onDisable(): void {
    this.node.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
    this.node.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
    this.node.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    this.node.off(Input.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
  }

  private onTouchStart(evt: EventTouch) {
    this._cbStarted && this._cbStarted(this, evt);
  }

  private _tmpVec3: Vec3 = new Vec3();
  /**
   * 一般情况下相机的比例和设计分辨率是一致的, 这里没有考虑不一致的情况.
   * 如果游戏中有不一致的情况,需要根据相机的的相对比例(要区分相机的类型)来重新计算移动的绝对差值.
   */
  private onTouchMove(evt: EventTouch) {
    const delta = evt.getUIDelta();
    this.node.getPosition(this._tmpVec3);
    this._tmpVec3.x += delta.x;
    this._tmpVec3.y += delta.y;
    this.node.setPosition(this._tmpVec3.x, this._tmpVec3.y, 0);
    this._cbMoved && this._cbMoved(this, evt);
  }

  private onTouchEnd(evt: EventTouch) {
    this._cbEnded && this._cbEnded(this, evt);
  }

  private onTouchCancel(evt: EventTouch) {
    this._cbCanceled && this._cbCanceled(this, evt);
  }

  public onStarted(cb: MOVEABLE_CALLBACK) {
    this._cbStarted && (this._cbStarted = null);
    this._cbStarted = cb;
  }
  public onMoved(cb: MOVEABLE_CALLBACK) {
    this._cbMoved && (this._cbMoved = null);
    this._cbMoved = cb;
  }
  public onEnded(cb: MOVEABLE_CALLBACK) {
    this._cbEnded && (this._cbEnded = null);
    this._cbEnded = cb;
  }
  public onCanceled(cb: MOVEABLE_CALLBACK) {
    this._cbCanceled && (this._cbCanceled = null);
    this._cbCanceled = cb;
  }

  public static onStarted(buttonOrNode: UIMoveable | Node, cb: MOVEABLE_CALLBACK) {
    if (buttonOrNode instanceof UIMoveable) {
      buttonOrNode.onStarted(cb);
    } else if (buttonOrNode instanceof Node) {
      const moveable = buttonOrNode.getComponent(UIMoveable);
      if (moveable) {
        moveable.onStarted(cb);
      } else {
        //Glog.warn(`UIMoveable: onStarted, node ${buttonOrNode.name} does not have UIMoveable component`);
      }
    } else {
      //Glog.warn(`UIMoveable: onStarted, invalid parameter type`);
    }
  }

  public static onMoved(buttonOrNode: UIMoveable | Node, cb: MOVEABLE_CALLBACK) {
    if (buttonOrNode instanceof UIMoveable) {
      buttonOrNode.onMoved(cb);
    } else if (buttonOrNode instanceof Node) {
      const moveable = buttonOrNode.getComponent(UIMoveable);
      if (moveable) {
        moveable.onMoved(cb);
      } else {
        //Glog.warn(`UIMoveable: onMoved, node ${buttonOrNode.name} does not have UIMoveable component`);
      }
    } else {
      //Glog.warn(`UIMoveable: onMoved, invalid parameter type`);
    }
  }

  public static onEnded(buttonOrNode: UIMoveable | Node, cb: MOVEABLE_CALLBACK) {
    if (buttonOrNode instanceof UIMoveable) {
      buttonOrNode.onEnded(cb);
    } else if (buttonOrNode instanceof Node) {
      const moveable = buttonOrNode.getComponent(UIMoveable);
      if (moveable) {
        moveable.onEnded(cb);
      } else {
        //Glog.warn(`UIMoveable: onEnded, node ${buttonOrNode.name} does not have UIMoveable component`);
      }
    } else {
      //Glog.warn(`UIMoveable: onEnded, invalid parameter type`);
    }
  }

  public static onCanceled(buttonOrNode: UIMoveable | Node, cb: MOVEABLE_CALLBACK) {
    if (buttonOrNode instanceof UIMoveable) {
      buttonOrNode.onCanceled(cb);
    } else if (buttonOrNode instanceof Node) {
      const moveable = buttonOrNode.getComponent(UIMoveable);
      if (moveable) {
        moveable.onCanceled(cb);
      } else {
        //Glog.warn(`UIMoveable: onCanceled, node ${buttonOrNode.name} does not have UIMoveable component`);
      }
    } else {
      //Glog.warn(`UIMoveable: onCanceled, invalid parameter type`);
    }
  }
}
