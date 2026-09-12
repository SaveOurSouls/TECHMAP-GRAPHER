export interface TransitionToken {
  readonly sequence: number;
}

export class TransitionGate {
  private sequence = 0;
  private blocked = false;

  get isBlocked(): boolean {
    return this.blocked;
  }

  begin(): TransitionToken {
    this.blocked = true;
    return Object.freeze({ sequence: ++this.sequence });
  }

  isCurrent(token: TransitionToken): boolean {
    return this.blocked && token.sequence === this.sequence;
  }

  finish(token: TransitionToken): boolean {
    if (!this.isCurrent(token)) return false;
    this.blocked = false;
    return true;
  }

  invalidate(): void {
    this.sequence += 1;
    this.blocked = false;
  }

  allowMutation(): boolean {
    return !this.blocked;
  }
}
