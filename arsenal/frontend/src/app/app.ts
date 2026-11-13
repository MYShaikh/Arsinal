import { Component, inject } from '@angular/core';

import { MapComponent } from './components/map.component';
import { SidebarComponent } from './components/sidebar.component';
import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  imports: [SidebarComponent, MapComponent],
  template: `
    <app-sidebar />
    <app-map />
    @if (toast.message(); as message) {
      <div class="toast" role="status">{{ message }}</div>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: 400px 1fr;
      height: 100dvh;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      z-index: 100;
      max-width: min(90vw, 480px);
      padding: 12px 20px;
      border-radius: 8px;
      background: #323232;
      color: #fff;
      font-size: 14px;
      transform: translateX(-50%);
      box-shadow: var(--shadow-2);
    }
    @media (max-width: 768px) {
      :host {
        grid-template-columns: 1fr;
        grid-template-rows: 55dvh 1fr;
      }
      app-sidebar {
        order: 2;
      }
      app-map {
        order: 1;
      }
    }
  `,
})
export class App {
  protected readonly toast = inject(ToastService);
}
