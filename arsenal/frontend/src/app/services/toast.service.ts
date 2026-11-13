import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal('');
  private timer?: ReturnType<typeof setTimeout>;

  dismiss() {
    clearTimeout(this.timer);
    this.message.set('');
  }

  show(message: string, ms = 15000) {
    this.message.set(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(''), ms);
  }
}
